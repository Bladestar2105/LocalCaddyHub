package main

import (
	"strings"
	"testing"
)

func TestGenerateCaddyfile(t *testing.T) {
	config := AppConfig{
		Proxies: []ProxyConfig{
			{
				Listen:   ":80",
				Upstream: "localhost:8080",
				NTLM:     true,
			},
			{
				Listen:   "example.com",
				Upstream: "127.0.0.1:9000",
				NTLM:     false,
			},
		},
		Layer4: []Layer4Config{
			{
				Listen:   ":443",
				Upstream: "127.0.0.1:8443",
			},
		},
	}

	expected := `{
    layer4 {
        :443 {
            proxy 127.0.0.1:8443
        }
    }
}

:80 {
    reverse_proxy localhost:8080 {
        transport http_ntlm
    }
}

example.com {
    reverse_proxy 127.0.0.1:9000 {
    }
}

`

	got := generateCaddyfile(config)

	// Normalize whitespace for comparison
	if normalize(got) != normalize(expected) {
		t.Errorf("generateCaddyfile() = %v, want %v", got, expected)
	}
}

func normalize(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
