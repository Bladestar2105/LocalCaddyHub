package caddystarttls

import (
	"bytes"
	"net"
	"testing"
	"time"

	"github.com/mholt/caddy-l4/layer4"
)

// mockConn implements net.Conn to help with testing
type mockConn struct {
	readBuf  *bytes.Buffer
	writeBuf *bytes.Buffer
}

func (m *mockConn) Read(b []byte) (n int, err error) {
	return m.readBuf.Read(b)
}
func (m *mockConn) Write(b []byte) (n int, err error) {
	return m.writeBuf.Write(b)
}
func (m *mockConn) Close() error { return nil }
func (m *mockConn) LocalAddr() net.Addr {
	return &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 1234}
}
func (m *mockConn) RemoteAddr() net.Addr {
	return &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 5678}
}
func (m *mockConn) SetDeadline(t time.Time) error      { return nil }
func (m *mockConn) SetReadDeadline(t time.Time) error  { return nil }
func (m *mockConn) SetWriteDeadline(t time.Time) error { return nil }

type mockNextHandler struct {
	called bool
}

func (m *mockNextHandler) Handle(cx *layer4.Connection) error {
	m.called = true
	return nil
}

func TestStartTLS(t *testing.T) {
	tests := []struct {
		name         string
		clientInput  string
		expectedOut  string
		expectNext   bool
	}{
		{
			name:        "EHLO followed by STARTTLS",
			clientInput: "EHLO mail.example.com\r\nSTARTTLS\r\n",
			expectedOut: "220 StartTLS ready\r\n250-StartTLS ready\r\n250 STARTTLS\r\n220 Ready to start TLS\r\n",
			expectNext:  true,
		},
		{
			name:        "QUIT command",
			clientInput: "QUIT\r\n",
			expectedOut: "220 StartTLS ready\r\n221 Bye\r\n",
			expectNext:  false,
		},
		{
			name:        "Unknown command",
			clientInput: "BADCMD\r\nQUIT\r\n",
			expectedOut: "220 StartTLS ready\r\n502 Command not implemented\r\n221 Bye\r\n",
			expectNext:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mConn := &mockConn{
				readBuf:  bytes.NewBufferString(tt.clientInput),
				writeBuf: new(bytes.Buffer),
			}
			l4Conn := layer4.WrapConnection(mConn, nil, nil)

			handler := &StartTLS{}
			next := &mockNextHandler{}

			err := handler.Handle(l4Conn, next)
			if err != nil {
				t.Fatalf("Handle returned unexpected error: %v", err)
			}

			if next.called != tt.expectNext {
				t.Errorf("expected next handler called: %v, got: %v", tt.expectNext, next.called)
			}

			if mConn.writeBuf.String() != tt.expectedOut {
				t.Errorf("expected output %q, got %q", tt.expectedOut, mConn.writeBuf.String())
			}
		})
	}
}

func TestDrop220(t *testing.T) {
	t.Run("drops 220 from being written", func(t *testing.T) {
		mConn := &mockConn{
			readBuf:  new(bytes.Buffer),
			writeBuf: new(bytes.Buffer),
		}

		l4Conn := layer4.WrapConnection(mConn, nil, nil)
		wrappedConn := &wrappedWriteConn{Connection: l4Conn, dropped: false}

		// First write, should be dropped
		wrappedConn.Write([]byte("220 Welcome\r\n"))
		if mConn.writeBuf.Len() != 0 {
			t.Errorf("Expected 220 greeting to be dropped")
		}

		// Second write, should go through
		wrappedConn.Write([]byte("250 Hello\r\n"))
		if mConn.writeBuf.String() != "250 Hello\r\n" {
			t.Errorf("Expected '250 Hello\\r\\n', got %q", mConn.writeBuf.String())
		}
	})

	t.Run("does not drop non-220 from being written", func(t *testing.T) {
		mConn := &mockConn{
			readBuf:  new(bytes.Buffer),
			writeBuf: new(bytes.Buffer),
		}

		l4Conn := layer4.WrapConnection(mConn, nil, nil)
		wrappedConn := &wrappedWriteConn{Connection: l4Conn, dropped: false}

		// First write, non-220, should go through
		wrappedConn.Write([]byte("500 Bad\r\n"))
		if mConn.writeBuf.String() != "500 Bad\r\n" {
			t.Errorf("Expected '500 Bad\\r\\n', got %q", mConn.writeBuf.String())
		}
	})
}
