package caddystarttls

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/mholt/caddy-l4/layer4"
)

func init() {
	caddy.RegisterModule(&StartTLS{})
	caddy.RegisterModule(&Drop220{})
}

// StartTLS is a layer4 handler that simulates the SMTP plaintext phase
// up to the STARTTLS command, then hands over the connection to the next handler
// (which should be the TLS handler).
type StartTLS struct{}

// CaddyModule returns the Caddy module information.
func (*StartTLS) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "layer4.handlers.starttls",
		New: func() caddy.Module { return new(StartTLS) },
	}
}

func (h *StartTLS) Handle(cx *layer4.Connection, next layer4.Handler) error {
	finish, err := negotiationDeadline(cx, cx.Context)
	if err != nil {
		return err
	}
	defer finish()
	// Send initial 220 greeting
	_, err = io.WriteString(cx, "220 StartTLS ready\r\n")
	if err != nil {
		return err
	}
	cx.SetVar(smtpGreetedVar, true)

	transport := takeTransport(cx)
	reader := bufio.NewReader(transport)
	for {
		line, err := readSMTPLine(reader)
		if err != nil {
			return err
		}
		parts := strings.Fields(line)
		if len(parts) == 0 {
			parts = []string{""}
		}
		cmd := strings.ToUpper(parts[0])

		switch cmd {
		case "EHLO", "HELO":
			if len(parts) != 2 {
				_, err = io.WriteString(cx, "501 Expected hostname\r\n")
			} else if cmd == "EHLO" {
				_, err = io.WriteString(cx, "250-StartTLS ready\r\n250 STARTTLS\r\n")
			} else {
				_, err = io.WriteString(cx, "250 StartTLS ready\r\n")
			}
		case "STARTTLS":
			if len(parts) != 1 {
				_, err = io.WriteString(cx, "501 STARTTLS takes no arguments\r\n")
				break
			}
			if _, err = io.WriteString(cx, "220 Ready to start TLS\r\n"); err != nil {
				return err
			}
			finish()
			return next.Handle(cx.Wrap(&bufferedConn{Conn: transport, r: reader}))
		case "QUIT":
			_, err = io.WriteString(cx, "221 Bye\r\n")
			return err
		default:
			_, err = io.WriteString(cx, "502 Command not implemented\r\n")
		}
		if err != nil {
			return err
		}
	}
}

// UnmarshalCaddyfile sets up the handler from Caddyfile tokens.
func (h *StartTLS) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	return noArguments(d)
}

// Drop220 is a layer4 handler that connects to an upstream (after TLS termination)
// and discards the first 220 greeting from the upstream so the client doesn't see it
// after STARTTLS.
type Drop220 struct{}

func (*Drop220) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "layer4.handlers.drop220",
		New: func() caddy.Module { return new(Drop220) },
	}
}

func (h *Drop220) Handle(cx *layer4.Connection, next layer4.Handler) error {
	wrappedCx := &wrappedWriteConn{
		Connection: cx,
		dropped:    false,
	}

	return next.Handle(cx.Wrap(wrappedCx))
}

type wrappedWriteConn struct {
	*layer4.Connection
	dropped bool
	mu      sync.Mutex
	pending []byte
	total   int
}

func (c *wrappedWriteConn) Write(b []byte) (n int, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	n = len(b)
	for !c.dropped && len(b) > 0 {
		c.pending = append(c.pending, b[0])
		b = b[1:]
		c.total++
		if c.total > maxSMTPResponse || len(c.pending) > maxSMTPLine {
			return 0, fmt.Errorf("SMTP greeting too large")
		}
		prefixMismatch := len(c.pending) <= 3 && !strings.HasPrefix("220", string(c.pending))
		invalidSeparator := len(c.pending) == 4 && c.pending[3] != ' ' && c.pending[3] != '-' && c.pending[3] != '\r'
		if prefixMismatch || invalidSeparator {
			c.dropped = true
			if _, err = c.Connection.Conn.Write(c.pending); err != nil {
				return 0, err
			}
			c.pending = nil
		} else if c.pending[len(c.pending)-1] == '\n' {
			if len(c.pending) < 5 || c.pending[len(c.pending)-2] != '\r' || c.pending[3] == '\r' && len(c.pending) != 5 {
				return 0, fmt.Errorf("invalid SMTP greeting")
			}
			c.dropped = c.pending[3] != '-'
			c.pending = nil
		}
	}
	if len(b) > 0 {
		written, err := c.Connection.Conn.Write(b)
		if err != nil {
			return n - len(b) + written, err
		}
		if written != len(b) {
			return n - len(b) + written, io.ErrShortWrite
		}
	}
	return n, nil
}

func (c *wrappedWriteConn) Read(p []byte) (int, error) { return c.Connection.Conn.Read(p) }

func (h *Drop220) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	return noArguments(d)
}

const maxSMTPLine = 512
const maxSMTPResponse = 64 * 1024
const negotiationTimeout = 30 * time.Second
const smtpGreetedVar = "caddystarttls.greeted"

func readSMTPLine(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadSlice('\n')
	if err != nil {
		return "", err
	}
	if len(line) > maxSMTPLine || len(line) < 2 || line[len(line)-2] != '\r' {
		return "", fmt.Errorf("invalid or oversized SMTP line")
	}
	return string(line), nil
}

// Move prefetched bytes to the transport so a subsequent Wrap cannot replay them.
func takeTransport(cx *layer4.Connection) net.Conn {
	transport := cx.Wrap(cx.Conn)
	_, _ = io.CopyN(io.Discard, cx, int64(len(cx.MatchingBytes())))
	return transport
}

func negotiationDeadline(conn net.Conn, ctx context.Context) (func(), error) {
	deadline := time.Now().Add(negotiationTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return nil, err
	}
	done := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()); close(done) })
	var once sync.Once
	return func() {
		once.Do(func() {
			if !stop() {
				<-done
			}
			_ = conn.SetDeadline(time.Time{})
		})
	}, nil
}

func noArguments(d *caddyfile.Dispenser) error {
	for d.Next() {
		if len(d.RemainingArgs()) > 0 || d.NextBlock(0) {
			return d.ArgErr()
		}
	}
	return nil
}

type bufferedConn struct {
	net.Conn
	r io.Reader
}

func (b *bufferedConn) Read(p []byte) (n int, err error) {
	return b.r.Read(p)
}

// Interface guards
var (
	_ layer4.NextHandler    = (*StartTLS)(nil)
	_ caddyfile.Unmarshaler = (*StartTLS)(nil)
	_ layer4.NextHandler    = (*Drop220)(nil)
	_ caddyfile.Unmarshaler = (*Drop220)(nil)
)
