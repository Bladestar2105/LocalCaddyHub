package caddystarttls

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/mholt/caddy-l4/layer4"
	"go.uber.org/zap"
)

type handlerFunc func(*layer4.Connection) error

func (f handlerFunc) Handle(cx *layer4.Connection) error { return f(cx) }

func TestDrop220StreamBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name   string
		chunks []string
		want   string
	}{
		{"coalesced reply", []string{"220 Welcome\r\n250 Reply\r\n"}, "250 Reply\r\n"},
		{"fragmented multiline", []string{"2", "20-Wel", "come\r\n220 Ready\r", "\n250 Reply\r\n"}, "250 Reply\r\n"},
		{"only first reply", []string{"500 Error\r\n", "220 Later\r\n"}, "500 Error\r\n220 Later\r\n"},
		{"non greeting prefix", []string{"2200 Data\r\n"}, "2200 Data\r\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := &mockConn{readBuf: new(bytes.Buffer), writeBuf: new(bytes.Buffer)}
			filtered := &wrappedWriteConn{Connection: layer4.WrapConnection(conn, nil, nil)}
			for _, chunk := range tc.chunks {
				if n, err := filtered.Write([]byte(chunk)); err != nil || n != len(chunk) {
					t.Fatalf("Write = %d, %v", n, err)
				}
			}
			if got := conn.writeBuf.String(); got != tc.want {
				t.Fatalf("got %q; want %q", got, tc.want)
			}
		})
	}
}

func TestDrop220PreservesLayer4StateAndClientInput(t *testing.T) {
	conn := &mockConn{readBuf: bytes.NewBufferString("tail"), writeBuf: new(bytes.Buffer)}
	cx := layer4.WrapConnection(conn, []byte("prefetched"), nil)
	cx.SetVar("sentinel", "preserved")
	err := (&Drop220{}).Handle(cx, handlerFunc(func(filtered *layer4.Connection) error {
		if filtered.GetVar("sentinel") != "preserved" {
			t.Error("lost layer4 variables")
		}
		input, err := io.ReadAll(filtered)
		if err != nil {
			return err
		}
		if string(input) != "prefetchedtail" {
			t.Errorf("client stream = %q", input)
		}
		_, err = io.WriteString(filtered, "220 Welcome\r\n250 Reply\r\n")
		return err
	}))
	if err != nil {
		t.Fatal(err)
	}
	if got := conn.writeBuf.String(); got != "250 Reply\r\n" {
		t.Fatalf("filtered reply = %q", got)
	}
}

func TestCaddyfileParsesSupportedOptions(t *testing.T) {
	custom := &CustomTLS{}
	if err := custom.UnmarshalCaddyfile(caddyfile.NewTestDispenser("custom_tls cert.pem key.pem {\n default_sni localhost\n}")); err != nil {
		t.Fatal(err)
	}
	if custom.CertPath != "cert.pem" || custom.KeyPath != "key.pem" || custom.DefaultSNI != "localhost" {
		t.Fatalf("parsed custom TLS = %+v", custom)
	}
	upstream := &UpstreamSTARTTLS{}
	if err := upstream.UnmarshalCaddyfile(caddyfile.NewTestDispenser("upstream_starttls {\n upstream tcp/localhost:25 tcp/localhost:587\n server_name localhost\n insecure_skip_verify\n}")); err != nil {
		t.Fatal(err)
	}
	if len(upstream.Upstreams) != 2 || upstream.Upstreams[0] != "tcp/localhost:25" || upstream.Upstreams[1] != "tcp/localhost:587" || upstream.ServerName != "localhost" || !upstream.InsecureSkipVerify {
		t.Fatalf("parsed upstream TLS = %+v", upstream)
	}
}

func TestSMTPResponseValidation(t *testing.T) {
	for _, response := range []string{
		"250-first\r\n550 final\r\n", "nonsense\n250 final\r\n", "250 LF only\n", strings.Repeat("x", 4096) + "\r\n", strings.Repeat("250-"+strings.Repeat("x", 500)+"\r\n", 200) + "250 end\r\n",
	} {
		if _, err := readSMTPResponse(bufio.NewReader(strings.NewReader(response))); err == nil {
			t.Errorf("accepted malformed or oversized SMTP response of %d bytes", len(response))
		}
	}
	const valid = "250-first\r\n250 STARTTLS\r\n"
	if got, err := readSMTPResponse(bufio.NewReader(strings.NewReader(valid))); err != nil || got != valid {
		t.Fatalf("valid response = %q, %v", got, err)
	}
}

func TestStartTLSPreservesLayer4Prefetch(t *testing.T) {
	const size = 8192
	conn := &mockConn{readBuf: new(bytes.Buffer), writeBuf: new(bytes.Buffer)}
	cx := layer4.WrapConnection(conn, []byte("STARTTLS\r\n"+strings.Repeat("x", size)), nil)
	cx.SetVar("sentinel", "preserved")
	err := (&StartTLS{}).Handle(cx, handlerFunc(func(upgraded *layer4.Connection) error {
		if upgraded.GetVar("sentinel") != "preserved" {
			t.Error("lost layer4 variables")
		}
		data, err := io.ReadAll(upgraded)
		if err != nil {
			return err
		}
		if len(data) != size {
			t.Errorf("lost prefetched TLS bytes: got %d, want %d", len(data), size)
		}
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
}

func TestStartTLSDoesNotUpgradeAfterReplyFailure(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	cx := layer4.WrapConnection(server, nil, zap.NewNop())
	upgraded := make(chan struct{}, 1)
	done := make(chan error, 1)
	go func() {
		done <- (&StartTLS{}).Handle(cx, handlerFunc(func(*layer4.Connection) error { upgraded <- struct{}{}; return nil }))
	}()
	client.SetDeadline(time.Now().Add(time.Second))
	if _, err := bufio.NewReader(client).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(client, "STARTTLS\r\n"); err != nil {
		t.Fatal(err)
	}
	client.Close()
	select {
	case err := <-done:
		if err == nil {
			t.Error("ignored failed upgrade reply")
		}
	case <-time.After(time.Second):
		t.Fatal("stalled after client closed")
	}
	select {
	case <-upgraded:
		t.Fatal("upgraded despite failed reply")
	default:
	}
}

func TestDrop220RejectsOversizedGreeting(t *testing.T) {
	for _, greeting := range []string{"220 " + strings.Repeat("x", 512) + "\r\n", strings.Repeat("220-"+strings.Repeat("x", 500)+"\r\n", 200)} {
		conn := &mockConn{readBuf: new(bytes.Buffer), writeBuf: new(bytes.Buffer)}
		filtered := &wrappedWriteConn{Connection: layer4.WrapConnection(conn, nil, nil)}
		if _, err := filtered.Write([]byte(greeting)); err == nil {
			t.Fatal("accepted unbounded SMTP greeting")
		}
	}
}

func TestStartTLSRejectsOversizedCommand(t *testing.T) {
	conn := &mockConn{readBuf: bytes.NewBufferString(strings.Repeat("x", 4096) + "\r\nQUIT\r\n"), writeBuf: new(bytes.Buffer)}
	err := (&StartTLS{}).Handle(layer4.WrapConnection(conn, nil, nil), handlerFunc(func(*layer4.Connection) error { t.Fatal("upgraded oversized command"); return nil }))
	if err == nil {
		t.Fatal("accepted oversized command")
	}
}

func TestStartTLSCancellation(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	cx := layer4.WrapConnection(server, nil, zap.NewNop())
	ctx, cancel := context.WithCancel(cx.Context)
	defer cancel()
	cx.Context = ctx
	done := make(chan error, 1)
	go func() { done <- (&StartTLS{}).Handle(cx, handlerFunc(func(*layer4.Connection) error { return nil })) }()
	client.SetDeadline(time.Now().Add(time.Second))
	if _, err := bufio.NewReader(client).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("canceled negotiation succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not interrupt SMTP read")
	}
}

func TestCaddyfileRejectsUnexpectedArguments(t *testing.T) {
	for _, tc := range []struct {
		input  string
		target caddyfile.Unmarshaler
	}{
		{"starttls unexpected", &StartTLS{}},
		{"drop220 unexpected", &Drop220{}},
		{"custom_tls {\n cert_path cert extra\n key_path key\n}", &CustomTLS{}},
		{"custom_tls {\n cert_path cert\n key_path key extra\n}", &CustomTLS{}},
		{"custom_tls {\n default_sni host extra\n}", &CustomTLS{}},
		{"upstream_starttls ignored", &UpstreamSTARTTLS{}},
		{"upstream_starttls {\n insecure_skip_verify false\n}", &UpstreamSTARTTLS{}},
		{"upstream_starttls {\n server_name host extra\n}", &UpstreamSTARTTLS{}},
	} {
		if err := tc.target.UnmarshalCaddyfile(caddyfile.NewTestDispenser(tc.input)); err == nil {
			t.Errorf("accepted invalid config %q", tc.input)
		}
	}
}

func TestSMTPBareReplyCode(t *testing.T) {
	if got, err := readSMTPResponse(bufio.NewReader(strings.NewReader("250\r\n"))); err != nil || got != "250\r\n" {
		t.Fatalf("bare reply = %q, %v", got, err)
	}
	conn := &mockConn{readBuf: new(bytes.Buffer), writeBuf: new(bytes.Buffer)}
	filtered := &wrappedWriteConn{Connection: layer4.WrapConnection(conn, nil, nil)}
	if _, err := filtered.Write([]byte("220\r\n250\r\n")); err != nil {
		t.Fatal(err)
	}
	if got := conn.writeBuf.String(); got != "250\r\n" {
		t.Fatalf("bare greeting = %q", got)
	}
}
