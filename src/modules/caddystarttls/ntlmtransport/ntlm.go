// Copyright 2015 Matthew Holt and The Caddy Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Derived from github.com/caddyserver/ntlm-transport v0.1.2:
// https://github.com/caddyserver/ntlm-transport/blob/v0.1.2/ntlm.go
// Local changes isolate downstream connections and fix transport cleanup/error locking.

package ntlmtransport

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy"
)

func init() {
	caddy.RegisterModule(NTLMTransport{})
}

// NTLMTransport proxies HTTP with NTLM authentication.
// It basically wraps HTTPTransport so that it is compatible with
// NTLM's HTTP-hostile requirements. Specifically, it will use
// HTTPTransport's single, default *http.Transport for all requests
// (unless the client's connection is already mapped to a different
// transport) until a request comes in with an Authorization header
// that has "NTLM" or "Negotiate"; when that happens, NTLMTransport
// maps the client's actual downstream connection identity
// to a new transport that is used only by that downstream conn.
// When the upstream connection is closed, the mapping is deleted.
// This preserves NTLM authentication contexts by ensuring that
// client connections use the same upstream connection. It does
// hurt performance a bit, but that's NTLM for you.
//
// This transport also forces HTTP/1.1 and Keep-Alives in order
// for NTLM to succeed.
//
// It is basically the same thing as
// [nginx's paid ntlm directive](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#ntlm)
// (but is free in Caddy!).
type NTLMTransport struct {
	*reverseproxy.HTTPTransport

	ctx caddy.Context

	transports   map[net.Conn]*http.Transport
	transportsMu *sync.RWMutex
}

// CaddyModule returns the Caddy module information.
func (NTLMTransport) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID: "http.reverse_proxy.transport.http_ntlm",
		New: func() caddy.Module {
			m := new(NTLMTransport)
			m.HTTPTransport = new(reverseproxy.HTTPTransport)
			return m
		},
	}
}

// Provision sets up the transport module.
func (n *NTLMTransport) Provision(ctx caddy.Context) error {
	n.ctx = ctx
	n.transports = make(map[net.Conn]*http.Transport)
	n.transportsMu = new(sync.RWMutex)

	if n.HTTPTransport == nil {
		n.HTTPTransport = new(reverseproxy.HTTPTransport)
	}

	// NTLM requires HTTP/1.1
	n.HTTPTransport.Versions = []string{"1.1"}

	// NLTM requires keep-alive
	if n.HTTPTransport.KeepAlive != nil {
		enabled := true
		n.HTTPTransport.KeepAlive.Enabled = &enabled
	}

	// set up the underlying transport, since we
	// rely on it for the heavy lifting
	err := n.HTTPTransport.Provision(ctx)
	if err != nil {
		return err
	}
	if server, ok := ctx.Value(caddyhttp.ServerCtxKey).(*caddyhttp.Server); ok {
		server.RegisterConnContext(n.connectionContext)
		server.RegisterConnState(n.connectionState)
	}

	return nil
}

// RoundTrip implements http.RoundTripper. It basically wraps
// the underlying HTTPTransport.Transport in a way that preserves
// NTLM context by mapping transports/connections. Note that this
// method does not call n.HTTPTransport.RoundTrip (our own method),
// but the underlying n.HTTPTransport.Transport.RoundTrip (standard
// library's method).
func (n *NTLMTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	n.HTTPTransport.SetScheme(req)
	client, hasIdentity := req.Context().Value(n).(net.Conn)
	if !hasIdentity {
		if requestHasAuth(req) {
			return nil, fmt.Errorf("NTLM requires downstream connection identity")
		}
		return n.HTTPTransport.Transport.RoundTrip(req)
	}

	// when the upstream connection is closed, make sure
	// we close the downstream connection with the client
	// when this request is done; we only do this if
	// using a bound transport
	closeDownstreamIfClosedUpstream := func() {
		n.transportsMu.Lock()
		if _, ok := n.transports[client]; !ok {
			req.Close = true
		}
		n.transportsMu.Unlock()
	}

	// first, see if this downstream connection is
	// already bound to a particular transport
	// (transports are abstractions over connections
	// to our upstream, and NTLM auth requires
	// preserving authentication state for separate
	// connections over multiple roundtrips, sigh)
	n.transportsMu.Lock()
	transport, ok := n.transports[client]
	if ok {
		n.transportsMu.Unlock()
		defer closeDownstreamIfClosedUpstream()
		return n.roundTripBound(req, client, transport)
	}

	// otherwise, start by assuming we will use
	// the default transport that carries all
	// normal/non-NTLM-authenticated requests
	transport = n.HTTPTransport.Transport

	// but if this request begins the NTLM authentication
	// process, we need to pin it to a specific transport
	if requestHasAuth(req) {
		transport = n.newTransport(client)
		n.transports[client] = transport
		n.transportsMu.Unlock()
		defer closeDownstreamIfClosedUpstream()
		return n.roundTripBound(req, client, transport)
	}
	n.transportsMu.Unlock()

	// finally, do the roundtrip with the transport we selected
	return transport.RoundTrip(req)
}

func (n *NTLMTransport) roundTripBound(req *http.Request, client net.Conn, transport *http.Transport) (*http.Response, error) {
	response, err := transport.RoundTrip(req)
	if err != nil {
		n.deleteTransportsForClient(client, transport)
		transport.CloseIdleConnections()
	}
	return response, err
}

func (n *NTLMTransport) connectionContext(ctx context.Context, client net.Conn) context.Context {
	return context.WithValue(ctx, n, client)
}

func (n *NTLMTransport) connectionState(client net.Conn, state http.ConnState) {
	if state == http.StateClosed || state == http.StateHijacked {
		if transport := n.deleteTransportsForClient(client, nil); transport != nil {
			transport.CloseIdleConnections()
		}
	}
}

// newTransport makes an NTLM-compatible transport.
func (n *NTLMTransport) newTransport(client net.Conn) *http.Transport {
	// Preserve provisioned trust pools; rebuilding consumes already-loaded raw module config.
	transport := n.HTTPTransport.Transport.Clone()
	// Parallel requests must queue on the same authenticated upstream connection.
	transport.MaxConnsPerHost = 1

	// we need to wrap upstream connections so we can
	// clean up in two ways when that connection is
	// closed: 1) destroy the transport that housed
	// this connection, and 2) use that as a signal
	// to close the connection to the downstream.
	wrappedDialContext := transport.DialContext

	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		conn2, err := wrappedDialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		conn := &unbinderConn{Conn: conn2, ntlm: n, client: client, transport: transport}
		return conn, nil
	}
	if transport.DialTLSContext != nil {
		// Caddy's custom TLS dialer captures its raw dialer, so rebuild it over the bound connection.
		transport.DialTLSContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			config := transport.TLSClientConfig.Clone()
			if strings.Contains(config.ServerName, "{") {
				replacer, ok := ctx.Value(caddy.ReplacerCtxKey).(*caddy.Replacer)
				if !ok {
					return nil, fmt.Errorf("missing request replacer for TLS server name")
				}
				config.ServerName = replacer.ReplaceAll(config.ServerName, "")
			}
			conn, err := transport.DialContext(ctx, network, address)
			if err != nil {
				return nil, err
			}
			if transport.TLSHandshakeTimeout != 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, transport.TLSHandshakeTimeout)
				defer cancel()
			}
			secure := tls.Client(conn, config)
			if err := secure.HandshakeContext(ctx); err != nil {
				_ = secure.Close()
				return nil, err
			}
			return secure, nil
		}
	}

	return transport
}

// TLSEnabled returns true if TLS is enabled.
func (n NTLMTransport) TLSEnabled() bool {
	return n.HTTPTransport.TLS != nil
}

// EnableTLS enables TLS on the transport.
func (n *NTLMTransport) EnableTLS(base *reverseproxy.TLSConfig) error {
	n.HTTPTransport.TLS = base
	return nil
}

// Cleanup implements caddy.CleanerUpper and closes any idle connections.
func (n *NTLMTransport) Cleanup() error {
	if err := n.HTTPTransport.Cleanup(); err != nil {
		return err
	}

	n.transportsMu.Lock()
	transports := n.transports
	n.transports = make(map[net.Conn]*http.Transport)
	n.transportsMu.Unlock()
	// Closing an idle connection calls unbinderConn.Close, which takes this mutex again.
	for _, t := range transports {
		t.CloseIdleConnections()
	}

	return nil
}

// deleteTransportsForClient detaches only the expected binding, preserving replacements.
func (n *NTLMTransport) deleteTransportsForClient(client net.Conn, expected *http.Transport) *http.Transport {
	n.transportsMu.Lock()
	defer n.transportsMu.Unlock()
	transport := n.transports[client]
	if expected != nil && transport != expected {
		return nil
	}
	delete(n.transports, client)
	return transport
}

// requestHasAuth returns true if req has an Authorization
// header with values "NTLM" or "Negotiate".
func requestHasAuth(req *http.Request) bool {
	for _, val := range req.Header["Authorization"] {
		parts := strings.Fields(val)
		if len(parts) > 0 && (strings.EqualFold(parts[0], "NTLM") || strings.EqualFold(parts[0], "Negotiate")) {
			return true
		}
	}
	return false
}

// unbinderConn is used to wrap upstream connections
// so that we know when they are closed and can clean
// up after that.
type unbinderConn struct {
	net.Conn
	client    net.Conn
	transport *http.Transport
	ntlm      *NTLMTransport
}

func (uc *unbinderConn) Close() error {
	uc.ntlm.deleteTransportsForClient(uc.client, uc.transport)
	return uc.Conn.Close()
}

// Interface guards
var (
	_ caddy.Provisioner         = (*NTLMTransport)(nil)
	_ http.RoundTripper         = (*NTLMTransport)(nil)
	_ caddy.CleanerUpper        = (*NTLMTransport)(nil)
	_ reverseproxy.TLSTransport = (*NTLMTransport)(nil)
)
