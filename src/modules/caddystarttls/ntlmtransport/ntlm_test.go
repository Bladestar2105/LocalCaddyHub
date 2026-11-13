package ntlmtransport

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy"
)

func testTransport(t *testing.T, config ...*reverseproxy.HTTPTransport) *NTLMTransport {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: context.WithValue(context.Background(), caddyhttp.ServerCtxKey, new(caddyhttp.Server))})
	t.Cleanup(cancel)
	n := new(NTLMTransport)
	if len(config) > 0 {
		n.HTTPTransport = config[0]
	}
	if err := n.Provision(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { n.HTTPTransport.Transport.CloseIdleConnections() })
	return n
}

func clientConnection(t *testing.T) net.Conn {
	t.Helper()
	a, b := net.Pipe()
	t.Cleanup(func() { a.Close(); b.Close() })
	return a
}

func testRequest(t *testing.T, n *NTLMTransport, client net.Conn, target, auth, remote string) *http.Request {
	t.Helper()
	req, err := http.NewRequest("GET", target, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.RemoteAddr = remote
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	ctx := context.WithValue(req.Context(), caddy.ReplacerCtxKey, caddy.NewReplacer())
	ctx = context.WithValue(ctx, caddyhttp.OriginalRequestCtxKey, *req)
	if client != nil {
		ctx = context.WithValue(ctx, n, client)
	}
	return req.WithContext(ctx)
}

func roundTrip(t *testing.T, n *NTLMTransport, req *http.Request) (int, string) {
	t.Helper()
	resp, err := n.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, string(body)
}

func statefulBackend(t *testing.T, secure ...bool) *httptest.Server {
	t.Helper()
	type key struct{}
	type state struct{ user string }
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("slow") != "" {
			time.Sleep(20 * time.Millisecond)
		}
		client := r.Context().Value(key{}).(*state)
		if auth := r.Header.Get("Authorization"); auth != "" {
			parts := strings.Fields(auth)
			client.user = parts[len(parts)-1]
			w.Header().Set("WWW-Authenticate", "NTLM challenge")
			w.WriteHeader(http.StatusUnauthorized)
		}
		user := client.user
		if user == "" {
			user = "anonymous"
		}
		_, _ = io.WriteString(w, user)
	}))
	server.Config.ConnContext = func(ctx context.Context, _ net.Conn) context.Context {
		return context.WithValue(ctx, key{}, new(state))
	}
	if len(secure) > 0 && secure[0] {
		server.StartTLS()
	} else {
		server.Start()
	}
	t.Cleanup(server.Close)
	return server
}

func TestCleanupClosesIdleAuthenticatedTransportWithoutDeadlock(t *testing.T) {
	server := statefulBackend(t)
	n := testTransport(t)
	client := clientConnection(t)
	status, _ := roundTrip(t, n, testRequest(t, n, client, server.URL, "NTLM alice", "192.0.2.1:50000"))
	if status != http.StatusUnauthorized {
		t.Fatal(status)
	}
	done := make(chan error, 1)
	go func() { done <- n.Cleanup() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cleanup deadlocked closing a bound idle HTTP connection")
	}
	n.transportsMu.Lock()
	count := len(n.transports)
	n.transportsMu.Unlock()
	if count != 0 {
		t.Fatalf("cleanup retained %d bindings", count)
	}
}

func TestFailedDialsDoNotRetainBindings(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	target := "http://" + listener.Addr().String()
	listener.Close()
	n := testTransport(t)
	for _, remote := range []string{"192.0.2.1:50001", "192.0.2.1:50002", "192.0.2.1:50003"} {
		if _, err := n.RoundTrip(testRequest(t, n, clientConnection(t), target, "NTLM alice", remote)); err == nil {
			t.Fatal("dial succeeded against closed listener")
		}
	}
	n.transportsMu.Lock()
	count := len(n.transports)
	n.transportsMu.Unlock()
	if count != 0 {
		t.Fatalf("failed dials leaked %d client bindings", count)
	}
}

func TestBoundTransportDoesNotReprovisionRawConfiguration(t *testing.T) {
	n := testTransport(t)
	server := statefulBackend(t)
	n.HTTPTransport.LocalAddress = "udp/127.0.0.1:0"
	_, body := roundTrip(t, n, testRequest(t, n, clientConnection(t), server.URL, "NTLM alice", "192.0.2.1:50000"))
	if body != "alice" {
		t.Fatal(body)
	}
	if !n.transportsMu.TryLock() {
		t.Fatal("bound transport construction retained binding mutex")
	}
	n.transportsMu.Unlock()
}

func TestDownstreamIdentityCannotBeReusedByAddress(t *testing.T) {
	server := statefulBackend(t)
	n := testTransport(t)
	first, second := clientConnection(t), clientConnection(t)
	_, authenticated := roundTrip(t, n, testRequest(t, n, first, server.URL, "NTLM alice", "192.0.2.1:50000"))
	if authenticated != "alice" {
		t.Fatalf("auth=%q", authenticated)
	}
	_, continued := roundTrip(t, n, testRequest(t, n, first, server.URL, "", "192.0.2.1:50000"))
	if continued != "alice" {
		t.Fatalf("lost same-connection NTLM context: %q", continued)
	}
	_, anonymous := roundTrip(t, n, testRequest(t, n, second, server.URL, "", "192.0.2.1:50000"))
	if anonymous != "anonymous" {
		t.Fatalf("new downstream connection inherited %q through reused source address", anonymous)
	}
}

func TestOrdinaryTrafficRemainsUnbound(t *testing.T) {
	server := statefulBackend(t)
	n := testTransport(t)
	for i := 0; i < 3; i++ {
		status, body := roundTrip(t, n, testRequest(t, n, clientConnection(t), server.URL, "", "192.0.2.1:50000"))
		if status != 200 || body != "anonymous" {
			t.Fatalf("ordinary response=%d %q", status, body)
		}
	}
	if len(n.transports) != 0 {
		t.Fatal("ordinary traffic created NTLM bindings")
	}
}

func TestAuthenticationWithoutConnectionIdentityFailsClosed(t *testing.T) {
	server := statefulBackend(t)
	n := testTransport(t)
	if resp, err := n.RoundTrip(testRequest(t, n, nil, server.URL, "NTLM alice", "192.0.2.1:50000")); err == nil {
		resp.Body.Close()
		t.Fatal("authenticated request accepted without downstream identity")
	}
}

func TestAuthenticationSchemeCaseCannotBypassIsolation(t *testing.T) {
	for _, scheme := range []string{"ntlm", "nEgOtIaTe"} {
		t.Run(scheme, func(t *testing.T) {
			server := statefulBackend(t)
			n := testTransport(t)
			_, body := roundTrip(t, n, testRequest(t, n, clientConnection(t), server.URL, scheme+" alice", "192.0.2.1:50000"))
			if body != "alice" {
				t.Fatal(body)
			}
			_, body = roundTrip(t, n, testRequest(t, n, clientConnection(t), server.URL, "", "192.0.2.1:50001"))
			if body != "anonymous" {
				t.Fatalf("anonymous client inherited %q through shared pool", body)
			}
		})
	}
}

func TestConcurrentRequestsPreserveOneBoundAuthenticationContext(t *testing.T) {
	server := statefulBackend(t)
	n := testTransport(t)
	client := clientConnection(t)
	roundTrip(t, n, testRequest(t, n, client, server.URL, "NTLM alice", "192.0.2.1:50000"))
	results := make(chan string, 6)
	for i := 0; i < 6; i++ {
		req := testRequest(t, n, client, server.URL+"?slow=1", "", "192.0.2.1:50000")
		go func() {
			resp, err := n.RoundTrip(req)
			if err != nil {
				results <- err.Error()
				return
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				results <- err.Error()
				return
			}
			results <- string(body)
		}()
	}
	for i := 0; i < 6; i++ {
		if got := <-results; got != "alice" {
			t.Errorf("concurrent bound request lost context: %q", got)
		}
	}
}

func TestBoundTransportPreservesProvisionedTLSVerification(t *testing.T) {
	for _, tc := range []struct {
		name, serverName string
		trusted, success bool
	}{
		{"trusted static SNI", "example.com", true, true},
		{"trusted dynamic SNI", "{ntlm.test.server_name}", true, true},
		{"untrusted CA", "example.com", false, false},
		{"wrong SNI", "wrong.invalid", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := statefulBackend(t, true)
			config := &reverseproxy.TLSConfig{ServerName: tc.serverName}
			if tc.trusted {
				config.CARaw = json.RawMessage(`{"provider":"inline","trusted_ca_certs":["` + base64.StdEncoding.EncodeToString(server.Certificate().Raw) + `"]}`)
			}
			n := testTransport(t, &reverseproxy.HTTPTransport{TLS: config})
			req := testRequest(t, n, clientConnection(t), server.URL, "NTLM alice", "192.0.2.1:50000")
			req.Context().Value(caddy.ReplacerCtxKey).(*caddy.Replacer).Set("ntlm.test.server_name", "example.com")
			response, err := n.RoundTrip(req)
			if !tc.success {
				if err == nil {
					response.Body.Close()
					t.Fatal("accepted unverifiable upstream certificate")
				}
				return
			}
			if err != nil {
				t.Fatalf("lost provisioned CA/SNI configuration: %v", err)
			}
			body, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil || string(body) != "alice" {
				t.Fatalf("verified response=%q,%v", body, err)
			}
			if response.TLS == nil {
				t.Fatal("lost TLS connection state")
			}
			server.CloseClientConnections()
			deadline := time.Now().Add(time.Second)
			for {
				n.transportsMu.Lock()
				count := len(n.transports)
				n.transportsMu.Unlock()
				if count == 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("upstream TLS close retained authenticated binding")
				}
				time.Sleep(time.Millisecond)
			}
		})
	}
}

func TestClosedOrHijackedDownstreamReleasesItsBinding(t *testing.T) {
	for _, state := range []http.ConnState{http.StateClosed, http.StateHijacked} {
		t.Run(state.String(), func(t *testing.T) {
			server := statefulBackend(t)
			n := testTransport(t)
			client := clientConnection(t)
			roundTrip(t, n, testRequest(t, n, client, server.URL, "NTLM alice", "192.0.2.1:50000"))
			n.connectionState(client, state)
			n.transportsMu.Lock()
			count := len(n.transports)
			n.transportsMu.Unlock()
			if count != 0 {
				t.Fatalf("closed client retained %d bindings", count)
			}
		})
	}
}

func TestLateUpstreamCloseCannotDeleteReplacementBinding(t *testing.T) {
	server := statefulBackend(t)
	n := testTransport(t)
	client := clientConnection(t)
	roundTrip(t, n, testRequest(t, n, client, server.URL, "NTLM alice", "192.0.2.1:50000"))
	n.transportsMu.Lock()
	old := n.transports[client]
	replacement := n.newTransport(client)
	n.transports[client] = replacement
	n.transportsMu.Unlock()
	old.CloseIdleConnections()
	n.transportsMu.Lock()
	remaining := n.transports[client]
	n.transportsMu.Unlock()
	if remaining != replacement {
		t.Fatal("late old upstream close removed a replacement binding")
	}
}
