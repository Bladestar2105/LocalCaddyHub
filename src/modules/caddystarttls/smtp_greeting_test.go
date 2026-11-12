package caddystarttls

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/smtp"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/mholt/caddy-l4/layer4"
	"go.uber.org/zap"
)

func serveSMTPDialogue(config *tls.Config) func(net.Conn) error {
	return func(conn net.Conn) error {
		if _, err := io.WriteString(conn, "220-backend.example\r\n220 Ready\r\n"); err != nil {
			return err
		}
		r := bufio.NewReader(conn)
		for _, step := range []struct{ command, reply string }{
			{"EHLO caddy\r\n", "250-backend.example\r\n250 STARTTLS\r\n"},
			{"STARTTLS\r\n", "220 Upgrade\r\n"},
		} {
			if got, err := r.ReadString('\n'); err != nil || got != step.command {
				return fmt.Errorf("SMTP command = %q, %v; want %q", got, err, step.command)
			}
			if _, err := io.WriteString(conn, step.reply); err != nil {
				return err
			}
		}
		secure := tls.Server(&bufferedConn{Conn: conn, r: r}, config)
		if err := secure.Handshake(); err != nil {
			return err
		}
		r = bufio.NewReader(secure)
		for _, step := range []struct{ command, reply string }{
			{"EHLO localhost\r\n", "250 backend.example\r\n"},
			{"NOOP\r\n", "250 OK\r\n"},
			{"QUIT\r\n", "221 Bye\r\n"},
		} {
			if got, err := r.ReadString('\n'); err != nil || got != step.command {
				return fmt.Errorf("secured SMTP command = %q, %v; want %q", got, err, step.command)
			}
			if _, err := io.WriteString(secure, step.reply); err != nil {
				return err
			}
		}
		return nil
	}
}

func TestUpstreamSTARTTLSWaitingSMTPClientModes(t *testing.T) {
	for _, mode := range []string{"plaintext", "implicit TLS", "STARTTLS already greeted"} {
		t.Run(mode, func(t *testing.T) {
			cert, pool, certPath, keyPath := testCertificate(t)
			upstreamAddr, upstreamDone := testListener(t, serveSMTPDialogue(&tls.Config{Certificates: []tls.Certificate{cert}}))
			upstream := &UpstreamSTARTTLS{Upstreams: []string{upstreamAddr}, InsecureSkipVerify: true, ServerName: "localhost", logger: zap.NewNop()}
			termination := &CustomTLS{CertPath: certPath, KeyPath: keyPath}
			ctx, cancel := caddy.NewContext(caddy.Context{Context: context.Background()})
			defer cancel()
			if err := termination.Provision(ctx); err != nil {
				t.Fatal(err)
			}
			proxyAddr, proxyDone := testListener(t, func(conn net.Conn) error {
				cx := layer4.WrapConnection(conn, nil, zap.NewNop())
				proxy := handlerFunc(func(cx *layer4.Connection) error { return upstream.Handle(cx, nil) })
				terminate := handlerFunc(func(cx *layer4.Connection) error { return termination.Handle(cx, proxy) })
				switch mode {
				case "plaintext":
					return proxy.Handle(cx)
				case "implicit TLS":
					return terminate.Handle(cx)
				default:
					return (&StartTLS{}).Handle(cx, terminate)
				}
			})
			raw, err := net.Dial("tcp", proxyAddr)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			raw.SetDeadline(time.Now().Add(time.Second))
			var conn net.Conn = raw
			tlsConfig := &tls.Config{RootCAs: pool, ServerName: "localhost"}
			if mode == "implicit TLS" {
				conn = tls.Client(raw, tlsConfig)
			}
			// NewClient waits for the initial220 before sending any SMTP command.
			client, err := smtp.NewClient(conn, "localhost")
			if err != nil {
				t.Fatalf("waiting SMTP client: %v", err)
			}
			defer client.Close()
			if mode == "STARTTLS already greeted" {
				if err := client.StartTLS(tlsConfig); err != nil {
					t.Fatal(err)
				}
			}
			if err := client.Noop(); err != nil {
				t.Fatalf("SMTP session after greeting: %v", err)
			}
			if err := client.Quit(); err != nil {
				t.Fatal(err)
			}
			if err := awaitResult(t, proxyDone); err != nil {
				t.Fatal(err)
			}
			if err := awaitResult(t, upstreamDone); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func readUpstreamGreeting(t *testing.T, r *bufio.Reader) {
	t.Helper()
	for _, want := range []string{"220-test\r\n", "220 Ready\r\n"} {
		if got, err := r.ReadString('\n'); err != nil || got != want {
			t.Fatalf("upstream greeting = %q, %v; want %q", got, err, want)
		}
	}
}

func TestUpstreamSTARTTLSDoesNotFailOverAfterPartialGreeting(t *testing.T) {
	cert, _, _, _ := testCertificate(t)
	firstAddr, firstDone := testListener(t, serveSMTP(&tls.Config{Certificates: []tls.Certificate{cert}}, nil, false))
	fallback, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer fallback.Close()
	fallbackDialed := make(chan bool, 1)
	go func() {
		conn, err := fallback.Accept()
		if err != nil {
			fallbackDialed <- false
			return
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(time.Second))
		_, _ = io.WriteString(conn, "421 Unavailable\r\n")
		fallbackDialed <- true
	}()
	client, proxy := net.Pipe()
	defer client.Close()
	defer proxy.Close()
	client.SetDeadline(time.Now().Add(time.Second))
	h := &UpstreamSTARTTLS{Upstreams: []string{firstAddr, fallback.Addr().String()}, InsecureSkipVerify: true, ServerName: "localhost", logger: zap.NewNop(), next: 1}
	done := make(chan error, 1)
	go func() { done <- h.Handle(layer4.WrapConnection(proxy, nil, zap.NewNop()), nil) }()
	partial := make([]byte, 5)
	if _, err := io.ReadFull(client, partial); err != nil {
		t.Fatal(err)
	}
	if string(partial) != "220-t" {
		t.Fatalf("greeting prefix=%q", partial)
	}
	client.Close()
	if err := awaitResult(t, done); err != nil {
		t.Fatalf("committed greeting failure should finish the session: %v", err)
	}
	fallback.Close()
	if <-fallbackDialed {
		t.Fatal("retried another upstream after sending partial greeting")
	}
	_ = awaitResult(t, firstDone)
}
