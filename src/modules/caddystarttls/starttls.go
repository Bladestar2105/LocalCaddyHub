package caddystarttls

import (
	"bufio"
	"strings"

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
	// Send initial 220 greeting
	_, err := cx.Write([]byte("220 StartTLS ready\r\n"))
	if err != nil {
		return err
	}

	reader := bufio.NewReader(cx)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return err
		}
		line = strings.TrimSpace(line)
		parts := strings.Split(line, " ")
		cmd := strings.ToUpper(parts[0])

		switch cmd {
		case "EHLO", "HELO":
			// We only advertise STARTTLS
			cx.Write([]byte("250-StartTLS ready\r\n"))
			cx.Write([]byte("250 STARTTLS\r\n"))
		case "STARTTLS":
			cx.Write([]byte("220 Ready to start TLS\r\n"))
			// Hand over to the next handler (the TLS handler)
			return next.Handle(cx)
		case "QUIT":
			cx.Write([]byte("221 Bye\r\n"))
			cx.Close()
			return nil
		default:
			cx.Write([]byte("502 Command not implemented\r\n"))
		}
	}
}

// UnmarshalCaddyfile sets up the handler from Caddyfile tokens.
func (h *StartTLS) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	return nil
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
	// We need to wrap the connection *after* we dial the upstream.
	// However, layer4 handlers act on the *client* connection.
	// To drop the upstream's 220, we would ideally wrap the upstream net.Conn.
	// But `proxy` dials the upstream itself.
	//
	// A simpler approach for this proof-of-concept is to wrap the *client* connection's
	// Write method, so that when the upstream `proxy` tries to copy the upstream's 220
	// to the client, we intercept it.

	wrappedCx := &wrappedWriteConn{
		Connection: cx,
		dropped:    false,
	}

	// Replace the connection with our wrapped one
	// This requires creating a new layer4.Connection or modifying the existing one.
	newCx := layer4.WrapConnection(wrappedCx, nil, cx.Logger)
	// preserve context
	newCx.Context = cx.Context

	return next.Handle(newCx)
}

type wrappedWriteConn struct {
	*layer4.Connection
	dropped bool
}

func (c *wrappedWriteConn) Write(b []byte) (n int, err error) {
	if !c.dropped {
		str := string(b)
		if strings.HasPrefix(str, "220") {
			c.dropped = true
			// We pretend we wrote it
			return len(b), nil
		}
	}
	return c.Connection.Write(b)
}

func (h *Drop220) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	return nil
}

// Interface guards
var (
	_ layer4.NextHandler    = (*StartTLS)(nil)
	_ caddyfile.Unmarshaler = (*StartTLS)(nil)
	_ layer4.NextHandler    = (*Drop220)(nil)
	_ caddyfile.Unmarshaler = (*Drop220)(nil)
)
