package ntlmtransport

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	_ "github.com/caddyserver/caddy/v2/modules/filestorage"
)

func freeAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	return address
}

func TestCaddyConnectionIdentityLifecycleAndReload(t *testing.T) {
	for _, secure := range []bool{false, true} {
		name := "HTTP"
		if secure {
			name = "TLS"
		}
		t.Run(name, func(t *testing.T) {
			t.Setenv("XDG_DATA_HOME", t.TempDir())
			t.Setenv("XDG_CONFIG_HOME", t.TempDir())
			backend := statefulBackend(t, secure)
			address := freeAddress(t)
			server := map[string]any{"listen": []string{address}, "automatic_https": map[string]any{"disable": true}, "protocols": []string{"h1"}}
			var routes []any
			for _, path := range []string{"/one", "/two"} {
				transport := map[string]any{"protocol": "http_ntlm"}
				if secure {
					transport["tls"] = map[string]any{"server_name": "example.com", "ca": map[string]any{"provider": "inline", "trusted_ca_certs": []string{base64.StdEncoding.EncodeToString(backend.Certificate().Raw)}}}
				}
				routes = append(routes, map[string]any{"match": []any{map[string]any{"path": []string{path}}}, "handle": []any{map[string]any{"handler": "reverse_proxy", "upstreams": []any{map[string]any{"dial": backend.Listener.Addr().String()}}, "transport": transport}}})
			}
			server["routes"] = routes
			apps := map[string]any{"http": map[string]any{"servers": map[string]any{"ntlm_test": server}}}
			scheme := "http://"
			if secure {
				scheme = "https://"
				certServer := httptest.NewTLSServer(http.NotFoundHandler())
				cert := certServer.TLS.Certificates[0]
				certServer.Close()
				private, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
				if err != nil {
					t.Fatal(err)
				}
				apps["tls"] = map[string]any{"certificates": map[string]any{"load_pem": []any{map[string]any{"certificate": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]})), "key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}))}}}}
				server["tls_connection_policies"] = []any{map[string]any{}}
			}
			config, err := json.Marshal(map[string]any{"admin": map[string]any{"disabled": true, "config": map[string]any{"persist": false}}, "storage": map[string]any{"module": "file_system", "root": t.TempDir()}, "apps": apps})
			if err != nil {
				t.Fatal(err)
			}
			if err := caddy.Load(config, true); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := caddy.Stop(); err != nil {
					t.Error(err)
				}
			})
			local, err := net.ResolveTCPAddr("tcp", freeAddress(t))
			if err != nil {
				t.Fatal(err)
			}
			makeClient := func(localAddr *net.TCPAddr) (*http.Client, *http.Transport) {
				var dials atomic.Uint32
				transport := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
					dialer := net.Dialer{Timeout: time.Second}
					// Fix only the first dial for the RST proof; reload reconnects must avoid TIME_WAIT.
					if dials.Add(1) == 1 {
						dialer.LocalAddr = localAddr
					}
					return dialer.DialContext(ctx, network, address)
				}, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, MaxConnsPerHost: 1}
				t.Cleanup(transport.CloseIdleConnections)
				return &http.Client{Transport: transport, Timeout: 3 * time.Second}, transport
			}
			first, firstTransport := makeClient(local)
			connections := make(chan net.Conn, 1)
			var usedConnections sync.Map
			request := func(client *http.Client, path, auth string) string {
				t.Helper()
				req, err := http.NewRequest("GET", scheme+address+path, nil)
				if err != nil {
					t.Fatal(err)
				}
				if auth != "" {
					req.Header.Set("Authorization", auth)
				}
				req = req.WithContext(httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
					usedConnections.Store(client, info.Conn)
					select {
					case connections <- info.Conn:
					default:
					}
				}}))
				response, err := client.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				body, err := io.ReadAll(response.Body)
				if err != nil {
					t.Fatal(err)
				}
				return string(body)
			}
			if got := request(first, "/one", "NTLM alice"); got != "alice" {
				t.Fatal(got)
			}
			connection := <-connections
			if got := request(first, "/one", ""); got != "alice" {
				t.Fatalf("lost connection authentication: %q", got)
			}
			if tlsConn, ok := connection.(*tls.Conn); ok {
				connection = tlsConn.NetConn()
			}
			if err := connection.(*net.TCPConn).SetLinger(0); err != nil {
				t.Fatal(err)
			}
			connection.Close()
			firstTransport.CloseIdleConnections()
			second, _ := makeClient(local)
			if got := request(second, "/one", ""); got != "anonymous" {
				t.Fatalf("reused source port inherited %q", got)
			}
			if got := request(second, "/one", "NTLM alice"); got != "alice" {
				t.Fatal(got)
			}
			if got := request(second, "/two", ""); got != "anonymous" {
				t.Fatalf("route transport contexts were overwritten: %q", got)
			}
			if got := request(second, "/two", "NTLM bob"); got != "bob" {
				t.Fatal(got)
			}
			if got := request(second, "/one", ""); got != "alice" {
				t.Fatalf("second route overwrote first context: %q", got)
			}
			beforeReload, _ := usedConnections.Load(second)
			done := make(chan error, 1)
			go func() { done <- caddy.Load(config, true) }()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("Caddy reload deadlocked after idle NTLM traffic")
			}
			if got := request(second, "/one", ""); got != "anonymous" {
				t.Fatalf("pre-reload client kept stale authentication: %q", got)
			}
			afterReload, _ := usedConnections.Load(second)
			t.Logf("pre-reload HTTP client reused exact downstream socket: %t", beforeReload == afterReload)
			if got := request(second, "/one", "NTLM carol"); got != "carol" {
				t.Fatalf("pre-reload client could not authenticate after reload: %q", got)
			}
			third, _ := makeClient(nil)
			if got := request(third, "/one", ""); got != "anonymous" {
				t.Fatalf("reload did not serve clean traffic: %q", got)
			}
		})
	}
}
