package caddystarttls

import (
	"crypto/tls"
	"fmt"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/mholt/caddy-l4/layer4"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(&CustomTLS{})
}

// CustomTLS is a layer4 handler that terminates TLS using a specific
// certificate and key file.
type CustomTLS struct {
	// Path to the certificate file
	CertPath string `json:"cert_path,omitempty"`
	// Path to the key file
	KeyPath string `json:"key_path,omitempty"`

	// Optional default SNI if needed
	DefaultSNI string `json:"default_sni,omitempty"`

	logger    *zap.Logger
	tlsConfig *tls.Config

	Next layer4.Handler `json:"-"`
}

func (*CustomTLS) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "layer4.handlers.custom_tls",
		New: func() caddy.Module { return new(CustomTLS) },
	}
}

func (c *CustomTLS) Provision(ctx caddy.Context) error {
	c.logger = ctx.Logger()

	if c.CertPath == "" || c.KeyPath == "" {
		return fmt.Errorf("cert_path and key_path are required")
	}

	cert, err := tls.LoadX509KeyPair(c.CertPath, c.KeyPath)
	if err != nil {
		return fmt.Errorf("loading key pair: %v", err)
	}

	c.tlsConfig = &tls.Config{
		Certificates: []tls.Certificate{cert},
		// Explicitly allow TLS 1.2 and CBC ciphers to support older SMTP clients like checktls.com
		CipherSuites: []uint16{
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
			tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA,
		},
		MinVersion: tls.VersionTLS12,
	}

	return nil
}

func (c *CustomTLS) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		args := d.RemainingArgs()
		if len(args) == 2 {
			c.CertPath = args[0]
			c.KeyPath = args[1]
		} else if len(args) > 0 {
			return d.ArgErr()
		}

		for d.NextBlock(0) {
			switch d.Val() {
			case "cert_path":
				if !d.NextArg() {
					return d.ArgErr()
				}
				c.CertPath = d.Val()
			case "key_path":
				if !d.NextArg() {
					return d.ArgErr()
				}
				c.KeyPath = d.Val()
			case "default_sni":
				if !d.NextArg() {
					return d.ArgErr()
				}
				c.DefaultSNI = d.Val()
			default:
				return d.Errf("unrecognized subdirective: %s", d.Val())
			}
		}
	}
	return nil
}

func (c *CustomTLS) Handle(cx *layer4.Connection, next layer4.Handler) error {
	tlsConn := tls.Server(cx, c.tlsConfig)

	// Perform handshake explicitly to catch errors early,
	// otherwise it happens lazily on first read/write.
	if err := tlsConn.HandshakeContext(cx.Context); err != nil {
		c.logger.Error("TLS handshake failed", zap.Error(err), zap.String("remote", cx.Conn.RemoteAddr().String()))
		return err
	}

	c.logger.Debug("TLS handshake successful", zap.String("remote", cx.Conn.RemoteAddr().String()))

	// Preserve any Layer4 context while replacing the transport with TLS.
	newCx := cx.Wrap(tlsConn)

	return next.Handle(newCx)
}

// Interface guards
var (
	_ layer4.NextHandler    = (*CustomTLS)(nil)
	_ caddyfile.Unmarshaler = (*CustomTLS)(nil)
	_ caddy.Provisioner     = (*CustomTLS)(nil)
)
