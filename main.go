package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

type Config struct {
	Content string `json:"content"`
}

type CommandResult struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

type ProxyConfig struct {
	Listen   string `json:"listen"`
	Upstream string `json:"upstream"`
	NTLM     bool   `json:"ntlm"`
}

type Layer4Config struct {
	Listen   string `json:"listen"`
	Upstream string `json:"upstream"`
}

type AppConfig struct {
	Proxies []ProxyConfig  `json:"proxies"`
	Layer4  []Layer4Config `json:"layer4"`
}

func generateCaddyfile(config AppConfig) string {
	var sb strings.Builder

	// Global options or snippets could go here

	// Layer 4 configuration
	if len(config.Layer4) > 0 {
		sb.WriteString("{\n")
		sb.WriteString("    layer4 {\n")
		for _, l4 := range config.Layer4 {
			sb.WriteString("        " + l4.Listen + " {\n")
			sb.WriteString("            proxy " + l4.Upstream + "\n")
			sb.WriteString("        }\n")
		}
		sb.WriteString("    }\n")
		sb.WriteString("}\n\n")
	}

	// Reverse Proxy configuration
	for _, proxy := range config.Proxies {
		sb.WriteString(proxy.Listen + " {\n")
		sb.WriteString("    reverse_proxy " + proxy.Upstream + " {\n")
		if proxy.NTLM {
			sb.WriteString("        transport http_ntlm\n")
		}
		sb.WriteString("    }\n")
		sb.WriteString("}\n\n")
	}

	return sb.String()
}

func main() {
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	http.HandleFunc("/api/config", handleConfig)
	http.HandleFunc("/api/config/structured", handleStructuredConfig)
	http.HandleFunc("/api/validate", handleValidate)
	http.HandleFunc("/api/start", handleStart)
	http.HandleFunc("/api/stop", handleStop)
	http.HandleFunc("/api/reload", handleReload)
	http.HandleFunc("/api/stats", handleStats)

	log.Println("Server started on :8090")
	log.Fatal(http.ListenAndServe(":8090", nil))
}

func handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		content, err := os.ReadFile("Caddyfile")
		if err != nil {
			if os.IsNotExist(err) {
				json.NewEncoder(w).Encode(Config{Content: ""})
				return
			}
			http.Error(w, "Failed to read Caddyfile", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(Config{Content: string(content)})
	} else if r.Method == http.MethodPost {
		var config Config
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if err := os.WriteFile("Caddyfile", []byte(config.Content), 0644); err != nil {
			http.Error(w, "Failed to write Caddyfile", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	} else {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleStructuredConfig(w http.ResponseWriter, r *http.Request) {
	configFile := "config.json"
	if r.Method == http.MethodGet {
		content, err := os.ReadFile(configFile)
		if err != nil {
			if os.IsNotExist(err) {
				// Return empty default config
				json.NewEncoder(w).Encode(AppConfig{
					Proxies: []ProxyConfig{},
					Layer4:  []Layer4Config{},
				})
				return
			}
			http.Error(w, "Failed to read config", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(content)

	} else if r.Method == http.MethodPost {
		var config AppConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		// Save structured config
		data, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			http.Error(w, "Failed to marshal config", http.StatusInternalServerError)
			return
		}
		if err := os.WriteFile(configFile, data, 0644); err != nil {
			http.Error(w, "Failed to write config file", http.StatusInternalServerError)
			return
		}

		// Generate and save Caddyfile
		caddyfileContent := generateCaddyfile(config)
		if err := os.WriteFile("Caddyfile", []byte(caddyfileContent), 0644); err != nil {
			http.Error(w, "Failed to write Caddyfile", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	} else {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Use "caddy" to rely on $PATH (e.g. /usr/bin/caddy in Docker)
	cmd := exec.Command("caddy", "validate", "--config", "Caddyfile")
	output, err := cmd.CombinedOutput()
	result := CommandResult{Output: string(output)}
	if err != nil {
		result.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cmd := exec.Command("caddy", "start", "--config", "Caddyfile")
	output, err := cmd.CombinedOutput()
	result := CommandResult{Output: string(output)}
	if err != nil {
		result.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cmd := exec.Command("caddy", "stop")
	output, err := cmd.CombinedOutput()
	result := CommandResult{Output: string(output)}
	if err != nil {
		result.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleReload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cmd := exec.Command("caddy", "reload", "--config", "Caddyfile")
	output, err := cmd.CombinedOutput()
	result := CommandResult{Output: string(output)}
	if err != nil {
		result.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	resp, err := http.Get("http://localhost:2019/metrics")
	if err != nil {
		// If Caddy is not running or metrics are unavailable
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte("Metrics unavailable (is Caddy running?)"))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read metrics", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write(body)
}
