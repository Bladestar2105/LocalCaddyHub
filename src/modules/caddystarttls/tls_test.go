package caddystarttls

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/mholt/caddy-l4/layer4"
	"go.uber.org/zap"
)

func testCertificate(t *testing.T) (tls.Certificate, *x509.CertPool, string, string) {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true}
	der, err := x509.CreateCertificate(rand.Reader, template, template, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(certPEM)
	dir := t.TempDir()
	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certPath, certPEM, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		t.Fatal(err)
	}
	return cert, pool, certPath, keyPath
}

func testListener(t *testing.T, serve func(net.Conn) error) (string, <-chan error) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	done := make(chan error, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		t.Cleanup(func() { conn.Close() })
		conn.SetDeadline(time.Now().Add(3 * time.Second))
		done <- serve(conn)
	}()
	return ln.Addr().String(), done
}

func awaitResult(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(4 * time.Second):
		t.Fatal("network handler did not terminate")
		return nil
	}
}

func TestCustomTLSRealHandshake(t *testing.T) {
	_, pool, certPath, keyPath := testCertificate(t)
	h := &CustomTLS{CertPath: certPath, KeyPath: keyPath, DefaultSNI: "localhost"}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: context.Background()})
	defer cancel()
	if err := h.Provision(ctx); err != nil {
		t.Fatal(err)
	}
	addr, done := testListener(t, func(conn net.Conn) error {
		cx := layer4.WrapConnection(conn, nil, zap.NewNop())
		cx.SetVar("sentinel", "preserved")
		return h.Handle(cx, handlerFunc(func(secure *layer4.Connection) error {
			if secure.GetVar("sentinel") != "preserved" {
				return fmt.Errorf("lost layer4 variables")
			}
			payload := make([]byte, 4)
			if _, err := io.ReadFull(secure, payload); err != nil {
				return err
			}
			if string(payload) != "PING" {
				return fmt.Errorf("unexpected payload %q", payload)
			}
			_, err := io.WriteString(secure, "PONG")
			return err
		}))
	})
	conn, err := tls.Dial("tcp", addr, &tls.Config{RootCAs: pool, ServerName: "localhost"})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(time.Second))
	if _, err := io.WriteString(conn, "PING"); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, 4)
	if _, err := io.ReadFull(conn, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != "PONG" {
		t.Fatalf("got %q", got)
	}
	if err := awaitResult(t, done); err != nil {
		t.Fatal(err)
	}
}

func TestCustomTLSRejectsMissingCertificate(t *testing.T) {
	ctx, cancel := caddy.NewContext(caddy.Context{Context: context.Background()})
	defer cancel()
	for _, h := range []*CustomTLS{{}, {CertPath: "missing", KeyPath: "missing"}} {
		if err := h.Provision(ctx); err == nil {
			t.Fatal("accepted absent key pair")
		}
	}
}

func TestCustomTLSRejectsLegacyCBCCipher(t *testing.T) {
	_, _, certPath, keyPath := testCertificate(t)
	h := &CustomTLS{CertPath: certPath, KeyPath: keyPath}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: context.Background()})
	defer cancel()
	if err := h.Provision(ctx); err != nil {
		t.Fatal(err)
	}
	addr, done := testListener(t, func(conn net.Conn) error {
		return h.Handle(layer4.WrapConnection(conn, nil, zap.NewNop()), handlerFunc(func(*layer4.Connection) error { return nil }))
	})
	conn, err := tls.Dial("tcp", addr, &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12, MaxVersion: tls.VersionTLS12, CipherSuites: []uint16{tls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA}})
	if conn != nil {
		conn.Close()
	}
	if err == nil {
		t.Error("accepted obsolete CBC-only TLS client")
	}
	if err := awaitResult(t, done); err == nil {
		t.Error("CBC-only handshake succeeded")
	}
}

func serveSMTP(tlsConfig *tls.Config, sni chan<- string, waitForEOF bool) func(net.Conn) error {
	return func(conn net.Conn) error {
		// Deliberately split and coalesce SMTP response lines at arbitrary boundaries.
		for _, part := range []string{"2", "20-test\r\n220 Ready\r", "\n"} {
			if _, err := io.WriteString(conn, part); err != nil {
				return err
			}
		}
		r := bufio.NewReader(conn)
		if line, err := r.ReadString('\n'); err != nil || line != "EHLO caddy\r\n" {
			return fmt.Errorf("EHLO = %q, %v", line, err)
		}
		if _, err := io.WriteString(conn, "250-localhost\r\n250 STARTTLS\r\n"); err != nil {
			return err
		}
		if line, err := r.ReadString('\n'); err != nil || line != "STARTTLS\r\n" {
			return fmt.Errorf("STARTTLS = %q, %v", line, err)
		}
		if _, err := io.WriteString(conn, "220 Ready\r\n"); err != nil {
			return err
		}
		secure := tls.Server(&bufferedConn{Conn: conn, r: r}, tlsConfig)
		if err := secure.Handshake(); err != nil {
			return err
		}
		if sni != nil {
			sni <- secure.ConnectionState().ServerName
		}
		var data []byte
		var err error
		if waitForEOF {
			data, err = io.ReadAll(secure)
		} else {
			data = make([]byte, 4)
			_, err = io.ReadFull(secure, data)
		}
		if err != nil {
			return err
		}
		if string(data) != "PING" {
			return fmt.Errorf("payload = %q", data)
		}
		_, err = io.WriteString(secure, "250 PONG\r\n")
		if err == nil {
			err = secure.CloseWrite()
		}
		return err
	}
}

func TestUpstreamSTARTTLSRealProxyAndFailover(t *testing.T) {
	cert, _, _, _ := testCertificate(t)
	sni := make(chan string, 1)
	addr, upstreamDone := testListener(t, serveSMTP(&tls.Config{Certificates: []tls.Certificate{cert}}, sni, false))
	badAddr, badDone := testListener(t, func(conn net.Conn) error { _, err := io.WriteString(conn, "421 Unavailable\r\n"); return err })
	client, proxy := net.Pipe()
	defer client.Close()
	defer proxy.Close()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	cx := layer4.WrapConnection(proxy, nil, zap.NewNop())
	h := &UpstreamSTARTTLS{Upstreams: []string{"tcp/" + badAddr, "tcp/" + addr}, InsecureSkipVerify: true, ServerName: "localhost", logger: zap.NewNop(), next: 1}
	done := make(chan error, 1)
	go func() { done <- h.Handle(cx, nil) }()
	r := bufio.NewReader(client)
	readUpstreamGreeting(t, r)
	if _, err := io.WriteString(client, "PING"); err != nil {
		t.Fatal(err)
	}
	got, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if got != "250 PONG\r\n" {
		t.Fatalf("got %q", got)
	}
	if err := awaitResult(t, done); err != nil {
		t.Fatal(err)
	}
	if err := awaitResult(t, upstreamDone); err != nil {
		t.Fatal(err)
	}
	if err := awaitResult(t, badDone); err != nil {
		t.Fatal(err)
	}
	if got := <-sni; got != "localhost" {
		t.Fatalf("SNI = %q", got)
	}
}

func TestStartTLSAndCustomTLSRealClient(t *testing.T) {
	_, pool, certPath, keyPath := testCertificate(t)
	h := &CustomTLS{CertPath: certPath, KeyPath: keyPath}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: context.Background()})
	defer cancel()
	if err := h.Provision(ctx); err != nil {
		t.Fatal(err)
	}
	addr, done := testListener(t, func(conn net.Conn) error {
		cx := layer4.WrapConnection(conn, nil, zap.NewNop())
		cx.SetVar("sentinel", "preserved")
		return (&StartTLS{}).Handle(cx, handlerFunc(func(upgraded *layer4.Connection) error {
			return h.Handle(upgraded, handlerFunc(func(secure *layer4.Connection) error {
				if secure.GetVar("sentinel") != "preserved" {
					return fmt.Errorf("lost context")
				}
				_, err := io.WriteString(secure, "250 Secured\r\n")
				return err
			}))
		}))
	})
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	r := bufio.NewReader(conn)
	if got, err := r.ReadString('\n'); err != nil || got != "220 StartTLS ready\r\n" {
		t.Fatalf("greeting=%q, %v", got, err)
	}
	for _, chunk := range []string{"EH", "LO localhost\r", "\nSTART", "TLS\r\n"} {
		if _, err := io.WriteString(conn, chunk); err != nil {
			t.Fatal(err)
		}
	}
	for _, want := range []string{"250-StartTLS ready\r\n", "250 STARTTLS\r\n", "220 Ready to start TLS\r\n"} {
		if got, err := r.ReadString('\n'); err != nil || got != want {
			t.Fatalf("reply=%q, %v; want %q", got, err, want)
		}
	}
	secure := tls.Client(&bufferedConn{Conn: conn, r: r}, &tls.Config{RootCAs: pool, ServerName: "localhost", MinVersion: tls.VersionTLS12, MaxVersion: tls.VersionTLS12})
	if err := secure.Handshake(); err != nil {
		t.Fatal(err)
	}
	if got, err := bufio.NewReader(secure).ReadString('\n'); err != nil || got != "250 Secured\r\n" {
		t.Fatalf("secured reply=%q, %v", got, err)
	}
	if err := awaitResult(t, done); err != nil {
		t.Fatal(err)
	}
}

func TestUpstreamSTARTTLSRejectsUntrustedCertificate(t *testing.T) {
	cert, _, _, _ := testCertificate(t)
	addr, serverDone := testListener(t, serveSMTP(&tls.Config{Certificates: []tls.Certificate{cert}}, nil, false))
	client, proxy := net.Pipe()
	defer client.Close()
	defer proxy.Close()
	h := &UpstreamSTARTTLS{Upstreams: []string{addr}, ServerName: "localhost", logger: zap.NewNop()}
	err := h.Handle(layer4.WrapConnection(proxy, nil, zap.NewNop()), nil)
	if err == nil || !strings.Contains(err.Error(), "certificate") {
		t.Fatalf("trust failure = %v", err)
	}
	if err := awaitResult(t, serverDone); err == nil {
		t.Fatal("server accepted failed verification")
	}
}

func TestUpstreamSTARTTLSCancellationDuringGreeting(t *testing.T) {
	accepted := make(chan struct{})
	addr, serverDone := testListener(t, func(conn net.Conn) error { close(accepted); _, err := io.Copy(io.Discard, conn); return err })
	client, proxy := net.Pipe()
	defer client.Close()
	defer proxy.Close()
	cx := layer4.WrapConnection(proxy, nil, zap.NewNop())
	ctx, cancel := context.WithCancel(cx.Context)
	cx.Context = ctx
	defer cancel()
	h := &UpstreamSTARTTLS{Upstreams: []string{addr}, logger: zap.NewNop()}
	done := make(chan error, 1)
	go func() { done <- h.Handle(cx, nil) }()
	select {
	case <-accepted:
	case <-time.After(time.Second):
		t.Fatal("upstream was not dialed")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("canceled greeting succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not stop greeting/dial")
	}
	if err := awaitResult(t, serverDone); err != nil {
		t.Fatal(err)
	}
}

func TestUpstreamSTARTTLSRejectsInvalidConfiguration(t *testing.T) {
	ctx, cancel := caddy.NewContext(caddy.Context{Context: context.Background()})
	defer cancel()
	for _, addresses := range [][]string{nil, {"udp/127.0.0.1:25"}, {"tcp/localhost"}, {"tcp/localhost:0"}, {"tcp/localhost:65536"}} {
		if err := (&UpstreamSTARTTLS{Upstreams: addresses}).Provision(ctx); err == nil {
			t.Errorf("accepted upstreams %v", addresses)
		}
	}
}

func TestUpstreamSTARTTLSCancellationUnblocksClientWrites(t *testing.T) {
	cert, _, _, _ := testCertificate(t)
	sent := make(chan struct{})
	addr, serverDone := testListener(t, func(conn net.Conn) error {
		err := serveSMTP(&tls.Config{Certificates: []tls.Certificate{cert}}, nil, false)(conn)
		close(sent)
		return err
	})
	client, proxy := net.Pipe()
	defer client.Close()
	defer proxy.Close()
	cx := layer4.WrapConnection(proxy, nil, zap.NewNop())
	ctx, cancel := context.WithCancel(cx.Context)
	defer cancel()
	cx.Context = ctx
	h := &UpstreamSTARTTLS{Upstreams: []string{addr}, InsecureSkipVerify: true, ServerName: "localhost", logger: zap.NewNop()}
	done := make(chan error, 1)
	go func() { done <- h.Handle(cx, nil) }()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	readUpstreamGreeting(t, bufio.NewReader(client))
	if _, err := io.WriteString(client, "PING"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-sent:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not reply")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancellation leaked proxy blocked writing to client")
	}
	if err := awaitResult(t, serverDone); err != nil {
		t.Fatal(err)
	}
}

func TestUpstreamSTARTTLSDrainsResponseAfterClientHalfClose(t *testing.T) {
	cert, _, _, _ := testCertificate(t)
	addr, upstreamDone := testListener(t, serveSMTP(&tls.Config{Certificates: []tls.Certificate{cert}}, nil, true))
	proxyAddr, proxyDone := testListener(t, func(conn net.Conn) error {
		h := &UpstreamSTARTTLS{Upstreams: []string{addr}, InsecureSkipVerify: true, ServerName: "localhost", logger: zap.NewNop()}
		return h.Handle(layer4.WrapConnection(conn, nil, zap.NewNop()), nil)
	})
	conn, err := net.Dial("tcp", proxyAddr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	r := bufio.NewReader(conn)
	readUpstreamGreeting(t, r)
	if _, err := io.WriteString(conn, "PING"); err != nil {
		t.Fatal(err)
	}
	if err := conn.(*net.TCPConn).CloseWrite(); err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "250 PONG\r\n" {
		t.Fatalf("response lost after client FIN: %q", got)
	}
	if err := awaitResult(t, proxyDone); err != nil {
		t.Fatal(err)
	}
	if err := awaitResult(t, upstreamDone); err != nil {
		t.Fatal(err)
	}
}
