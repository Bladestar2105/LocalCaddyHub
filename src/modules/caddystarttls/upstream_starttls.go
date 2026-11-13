package caddystarttls

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/mholt/caddy-l4/layer4"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(&UpstreamSTARTTLS{})
}

// UpstreamSTARTTLS implements a layer4 handler that upgrades
// a plaintext upstream connection to TLS via the STARTTLS protocol.
// It connects to one of the configured upstreams, performs the STARTTLS handshake,
// and proxies the layer4.Connection. It supports simple round-robin load balancing.
type UpstreamSTARTTLS struct {
	// List of upstream addresses to connect to.
	// E.g. ["tcp/172.16.16.5:587", "tcp/172.16.16.6:587"]
	Upstreams []string `json:"upstreams,omitempty"`

	// Whether to skip TLS verification
	InsecureSkipVerify bool `json:"insecure_skip_verify,omitempty"`

	// Optional SNI
	ServerName string `json:"server_name,omitempty"`

	logger *zap.Logger
	next   uint32 // Atomic counter for round-robin selection
}

func (*UpstreamSTARTTLS) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "layer4.handlers.upstream_starttls",
		New: func() caddy.Module { return new(UpstreamSTARTTLS) },
	}
}

func (u *UpstreamSTARTTLS) Provision(ctx caddy.Context) error {
	u.logger = ctx.Logger()
	if len(u.Upstreams) == 0 {
		return fmt.Errorf("at least one upstream address is required")
	}
	for _, upstream := range u.Upstreams {
		network, address := parseNetworkAddress(upstream)
		if network != "tcp" && network != "tcp4" && network != "tcp6" {
			return fmt.Errorf("SMTP upstream requires TCP: %s", upstream)
		}
		host, port, err := net.SplitHostPort(address)
		number, portErr := strconv.Atoi(port)
		if err != nil || host == "" || portErr != nil || number < 1 || number > 65535 {
			return fmt.Errorf("invalid SMTP upstream address: %s", upstream)
		}
	}
	return nil
}

func (u *UpstreamSTARTTLS) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		if len(d.RemainingArgs()) > 0 {
			return d.ArgErr()
		}
		for d.NextBlock(0) {
			switch d.Val() {
			case "insecure_skip_verify":
				if len(d.RemainingArgs()) > 0 {
					return d.ArgErr()
				}
				u.InsecureSkipVerify = true
			case "server_name":
				if !d.AllArgs(&u.ServerName) {
					return d.ArgErr()
				}
			case "upstream":
				args := d.RemainingArgs()
				if len(args) == 0 {
					return d.ArgErr()
				}
				u.Upstreams = append(u.Upstreams, args...)
			default:
				return d.Errf("unrecognized subdirective: %s", d.Val())
			}
		}
	}
	return nil
}

// parseNetworkAddress parses a Caddy-style network address (e.g. "tcp/127.0.0.1:8080")
// into its network ("tcp") and address ("127.0.0.1:8080") components.
func parseNetworkAddress(addr string) (string, string) {
	parts := strings.SplitN(addr, "/", 2)
	if len(parts) == 1 {
		return "tcp", parts[0]
	}
	return parts[0], parts[1]
}

func (u *UpstreamSTARTTLS) Handle(cx *layer4.Connection, nextHandler layer4.Handler) error {
	if len(u.Upstreams) == 0 {
		return fmt.Errorf("no upstream addresses configured")
	}

	// Simple round-robin: iterate through all upstreams starting from the next index.
	// If one fails, try the next.
	startIdx := atomic.AddUint32(&u.next, 1) % uint32(len(u.Upstreams))
	var lastErr error

	for i := 0; i < len(u.Upstreams); i++ {
		if err := cx.Context.Err(); err != nil {
			return err
		}
		idx := (startIdx + uint32(i)) % uint32(len(u.Upstreams))
		upstreamAddr := u.Upstreams[idx]

		err := u.tryConnectAndProxy(cx, upstreamAddr)
		if err == nil {
			// Successfully connected and proxied. Connection is now closed.
			return nil
		}

		u.logger.Error("upstream connection failed", zap.String("upstream", upstreamAddr), zap.Error(err))
		lastErr = err
	}

	return fmt.Errorf("all upstreams failed. last error: %w", lastErr)
}

func (u *UpstreamSTARTTLS) tryConnectAndProxy(cx *layer4.Connection, upstreamAddr string) error {
	network, address := parseNetworkAddress(upstreamAddr)

	// 1. Connect to the upstream
	u.logger.Debug("dialing upstream", zap.String("network", network), zap.String("address", address))
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(cx.Context, network, address)
	if err != nil {
		return fmt.Errorf("dialing upstream %s: %w", upstreamAddr, err)
	}
	defer conn.Close()
	stop := context.AfterFunc(cx.Context, func() { _ = conn.Close(); _ = cx.Close() })
	defer stop()
	finish, err := negotiationDeadline(conn, cx.Context)
	if err != nil {
		return err
	}
	defer finish()

	reader := bufio.NewReader(conn)

	// 2. Read the initial 220 greeting from Exchange
	greeting, err := readSMTPResponse(reader)
	if err != nil {
		return fmt.Errorf("reading initial greeting: %w", err)
	}
	if !strings.HasPrefix(greeting, "220") {
		return fmt.Errorf("expected 220 greeting, got: %s", greeting)
	}
	u.logger.Debug("received greeting", zap.String("greeting", greeting))

	// 3. Send the EHLO caddy command
	_, err = fmt.Fprintf(conn, "EHLO caddy\r\n")
	if err != nil {
		return fmt.Errorf("sending EHLO: %w", err)
	}

	// 4. Read the 250 response
	ehloResp, err := readSMTPResponse(reader)
	if err != nil {
		return fmt.Errorf("reading EHLO response: %w", err)
	}
	if !strings.HasPrefix(ehloResp, "250") {
		return fmt.Errorf("expected 250 response to EHLO, got: %s", ehloResp)
	}
	u.logger.Debug("received EHLO response", zap.String("response", ehloResp))

	// 5. Send the STARTTLS command
	_, err = fmt.Fprintf(conn, "STARTTLS\r\n")
	if err != nil {
		return fmt.Errorf("sending STARTTLS: %w", err)
	}

	// 6. Read the 220 response (Ready to start TLS)
	starttlsResp, err := readSMTPResponse(reader)
	if err != nil {
		return fmt.Errorf("reading STARTTLS response: %w", err)
	}
	if !strings.HasPrefix(starttlsResp, "220") {
		return fmt.Errorf("expected 220 response to STARTTLS, got: %s", starttlsResp)
	}
	u.logger.Debug("received STARTTLS response", zap.String("response", starttlsResp))

	// Determine SNI. If not configured, try to derive from upstream address (strip port).
	serverName := u.ServerName
	if serverName == "" {
		host, _, err := net.SplitHostPort(address)
		if err == nil {
			serverName = host
		} else {
			serverName = address
		}
	}

	// 7. Perform a TLS client handshake with the upstream
	tlsConfig := modernTLSConfig()
	tlsConfig.InsecureSkipVerify = u.InsecureSkipVerify
	tlsConfig.ServerName = serverName

	// Any leftover bytes in the bufio.Reader need to be prepended to the TLS connection.
	rawConn := &bufferedConn{Conn: conn, r: reader}

	u.logger.Debug("starting TLS handshake with upstream", zap.String("server_name", serverName))
	tlsConn := tls.Client(rawConn, tlsConfig)
	err = tlsConn.HandshakeContext(cx.Context)
	if err != nil {
		return fmt.Errorf("upstream TLS handshake failed: %w", err)
	}

	u.logger.Debug("upstream TLS handshake successful")
	finish()
	if cx.GetVar(smtpGreetedVar) != true {
		finishGreeting, err := negotiationDeadline(cx, cx.Context)
		if err != nil {
			return err
		}
		n, err := io.WriteString(cx, greeting)
		finishGreeting()
		if err == nil && n != len(greeting) {
			err = io.ErrShortWrite
		}
		if err != nil {
			// Greeting bytes commit the session, so a failed write must never trigger failover.
			u.logger.Error("writing downstream SMTP greeting failed", zap.Error(err))
			_ = cx.Close()
			return nil
		}
		cx.SetVar(smtpGreetedVar, true)
	}

	// 8. The upstream connection is now secured. We need to proxy the data.
	type copyResult struct {
		client bool
		err    error
	}
	errc := make(chan copyResult, 2)
	go func() {
		_, err := io.Copy(tlsConn, cx)
		if err == nil {
			_ = conn.SetDeadline(time.Now().Add(negotiationTimeout))
			_ = cx.SetDeadline(time.Now().Add(negotiationTimeout))
			err = tlsConn.CloseWrite()
		}
		errc <- copyResult{client: true, err: err}
	}()
	go func() {
		_, err := io.Copy(cx, tlsConn)
		errc <- copyResult{err: err}
	}()

	result := <-errc
	if result.client && result.err == nil {
		// Preserve the server's final reply after a client half-close, with a bounded drain.
		<-errc
	} else {
		_ = conn.Close()
		_ = cx.Close()
		<-errc
	}
	_ = cx.Close()
	return nil
}

// readSMTPResponse reads a multi-line SMTP response from a bufio.Reader.
func readSMTPResponse(reader *bufio.Reader) (string, error) {
	var response strings.Builder
	var code string
	for {
		line, err := readSMTPLine(reader)
		if err != nil {
			return "", err
		}
		if len(line) < 5 {
			return "", fmt.Errorf("invalid SMTP reply")
		}
		status, parseErr := strconv.Atoi(line[:3])
		validSeparator := line[3] == ' ' || line[3] == '-' || len(line) == 5
		if parseErr != nil || status < 200 || status > 599 || !validSeparator {
			return "", fmt.Errorf("invalid SMTP reply")
		}
		if code == "" {
			code = line[:3]
		}
		if line[:3] != code {
			return "", fmt.Errorf("inconsistent SMTP reply codes")
		}
		if response.Len()+len(line) > maxSMTPResponse {
			return "", fmt.Errorf("SMTP response too large")
		}
		response.WriteString(line)
		// Multi-line responses end with a space after the 3-digit code (e.g., "250 ")
		if line[3] != '-' {
			break
		}
	}
	return response.String(), nil
}

// Interface guards
var (
	_ caddy.Module          = (*UpstreamSTARTTLS)(nil)
	_ caddy.Provisioner     = (*UpstreamSTARTTLS)(nil)
	_ caddyfile.Unmarshaler = (*UpstreamSTARTTLS)(nil)
)
