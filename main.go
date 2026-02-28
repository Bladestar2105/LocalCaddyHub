package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Content string `json:"content"`
}

type CommandResult struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

type GeneralConfig struct {
	Enabled      bool   `json:"enabled"`
	EnableLayer4 bool   `json:"enable_layer4"`
	HttpPort     string `json:"http_port"`
	HttpsPort    string `json:"https_port"`
	LogLevel     string `json:"log_level"`
}

type AccessList struct {
	ID             string   `json:"id"`
	AccesslistName string   `json:"accesslistName"`
	ClientIps      []string `json:"clientIps"`
	Invert         bool     `json:"invert"`
	Description    string   `json:"description"`
}

type BasicAuth struct {
	ID            string `json:"id"`
	BasicAuthUser string `json:"basicauthuser"`
	BasicAuthPass string `json:"basicauthpass"`
	Description   string `json:"description"`
}

type Header struct {
	ID            string `json:"id"`
	HeaderUpDown  string `json:"headerUpDown"` // "header_up" or "header_down"
	HeaderType    string `json:"headerType"`   // e.g., "Set", "Add", "Delete" (implied by directive)
	HeaderValue   string `json:"headerValue"`
	HeaderReplace string `json:"headerReplace"`
	Description   string `json:"description"`
}

type Domain struct {
	ID           string   `json:"id"`
	Enabled      bool     `json:"enabled"`
	FromDomain   string   `json:"fromDomain"`
	FromPort     string   `json:"fromPort"`
	AccessList   []string `json:"accesslist"` // IDs of AccessList
	BasicAuth    []string `json:"basicauth"`  // IDs of BasicAuth
	Description  string   `json:"description"`
	AccessLog    bool     `json:"accessLog"`
	DisableTls   bool     `json:"disableTls"`
	CustomCert   string   `json:"customCert"` // Filename or empty
}

type Subdomain struct {
	ID          string   `json:"id"`
	Enabled     bool     `json:"enabled"`
	Reverse     string   `json:"reverse"` // ID of Domain
	FromDomain  string   `json:"fromDomain"`
	AccessList  []string `json:"accesslist"` // IDs of AccessList
	BasicAuth   []string `json:"basicauth"`  // IDs of BasicAuth
	Description string   `json:"description"`
}

type Handler struct {
	ID              string   `json:"id"`
	Enabled         bool     `json:"enabled"`
	Reverse         string   `json:"reverse"`   // ID of Domain
	Subdomain       string   `json:"subdomain"` // ID of Subdomain
	HandleType      string   `json:"handleType"` // "handle" or "handle_path"
	HandlePath      string   `json:"handlePath"`
	AccessList      []string `json:"accesslist"` // IDs of AccessList
	BasicAuth       []string `json:"basicauth"`  // IDs of BasicAuth
	Header          []string `json:"header"`     // IDs of Header
	HandleDirective string   `json:"handleDirective"` // "reverse_proxy", "redir"
	ToDomain        []string `json:"toDomain"`
	ToPort          string   `json:"toPort"`
	HttpTls         bool     `json:"httpTls"`
	NTLM            bool     `json:"ntlm"`
	Description     string   `json:"description"`

	// Load Balancing
	LbPolicy      string `json:"lb_policy"`
	LbRetries     int    `json:"lb_retries"`
	LbTryDuration string `json:"lb_try_duration"`
	LbTryInterval string `json:"lb_try_interval"`

	// Health checks
	HealthFails           int    `json:"health_fails"`
	HealthPasses          int    `json:"health_passes"`
	HealthTimeout         string `json:"health_timeout"`
	HealthInterval        string `json:"health_interval"`
	HealthUri             string `json:"health_uri"`
	HealthPort            string `json:"health_port"`
	HealthStatus          string `json:"health_status"`
	HealthBody            string `json:"health_body"`
	HealthFollowRedirects bool   `json:"health_follow_redirects"`
}

type Layer4Route struct {
	ID            string   `json:"id"`
	Enabled       bool     `json:"enabled"`
	Sequence      string   `json:"sequence"`
	Type          string   `json:"type"` // "global" or "listener_wrappers"
	Protocol      string   `json:"protocol"` // "tcp" or "udp"
	FromDomain    []string `json:"fromDomain"`
	FromPort      string   `json:"fromPort"`
	Matchers      string   `json:"matchers"` // e.g. "tlssni", "http", "any"
	ToDomain      []string `json:"toDomain"`
	ToPort        string   `json:"toPort"`
	TerminateTls  bool     `json:"terminateTls"`
	ProxyProtocol string   `json:"proxyProtocol"`
	Description   string   `json:"description"`
}

type AppConfig struct {
	General     GeneralConfig `json:"general"`
	Domains     []Domain      `json:"domains"`
	Subdomains  []Subdomain   `json:"subdomains"`
	Handlers    []Handler     `json:"handlers"`
	AccessLists []AccessList  `json:"accessLists"`
	BasicAuths  []BasicAuth   `json:"basicAuths"`
	Headers     []Header      `json:"headers"`
	Layer4      []Layer4Route `json:"layer4"`
}

func generateCaddyfile(config AppConfig) string {
	var sb strings.Builder

	// Global options
	sb.WriteString("{\n")
	if config.General.HttpPort != "" {
		sb.WriteString("\thttp_port " + config.General.HttpPort + "\n")
	}
	if config.General.HttpsPort != "" {
		sb.WriteString("\thttps_port " + config.General.HttpsPort + "\n")
	}
	if config.General.LogLevel != "" {
		sb.WriteString("\tlog {\n")
		sb.WriteString("\t\tlevel " + config.General.LogLevel + "\n")
		sb.WriteString("\t}\n")
	}

	// Layer 4 configuration
	if config.General.EnableLayer4 && len(config.Layer4) > 0 {
		sb.WriteString("\tlayer4 {\n")
		for _, l4 := range config.Layer4 {
			if !l4.Enabled {
				continue
			}
			listenPort := l4.FromPort
			if listenPort == "" {
				listenPort = "443" // Default fallback if not provided
			}

			sb.WriteString("\t\t:" + listenPort + " {\n")
			if l4.Matchers != "" && l4.Matchers != "any" {
				sb.WriteString("\t\t\tmatch {\n")
				sb.WriteString("\t\t\t\t" + l4.Matchers)
				if len(l4.FromDomain) > 0 {
					sb.WriteString(" " + strings.Join(l4.FromDomain, " "))
				}
				sb.WriteString("\n\t\t\t}\n")
			}

			// Upstreams
			if len(l4.ToDomain) > 0 {
				sb.WriteString("\t\t\tproxy")
				for _, to := range l4.ToDomain {
					sb.WriteString(" " + to + ":" + l4.ToPort)
				}
				sb.WriteString(" {\n")
				if l4.ProxyProtocol == "v1" || l4.ProxyProtocol == "v2" {
					sb.WriteString("\t\t\t\tproxy_protocol " + l4.ProxyProtocol + "\n")
				}
				sb.WriteString("\t\t\t}\n")
			}

			if l4.TerminateTls {
				sb.WriteString("\t\t\ttls\n")
			}
			sb.WriteString("\t\t}\n")
		}
		sb.WriteString("\t}\n")
	}
	sb.WriteString("}\n\n")

	if !config.General.Enabled {
		return sb.String() // Return early if General is disabled
	}

	// Helper maps for relations
	accessLists := make(map[string]AccessList)
	for _, al := range config.AccessLists {
		accessLists[al.ID] = al
	}
	basicAuths := make(map[string]BasicAuth)
	for _, ba := range config.BasicAuths {
		basicAuths[ba.ID] = ba
	}
	headers := make(map[string]Header)
	for _, h := range config.Headers {
		headers[h.ID] = h
	}

	// Reverse Proxy Domains
	for _, domain := range config.Domains {
		if !domain.Enabled {
			continue
		}

		// Find subdomains for this domain
		var domainSubdomains []Subdomain
		for _, sub := range config.Subdomains {
			if sub.Enabled && sub.Reverse == domain.ID {
				domainSubdomains = append(domainSubdomains, sub)
			}
		}

		// Determine site addresses
		var siteAddrs []string
		port := domain.FromPort
		if port == "" {
			if domain.DisableTls {
				port = "80"
			} else {
				port = "443"
			}
		}

		baseAddr := domain.FromDomain
		if !strings.HasPrefix(baseAddr, "http://") && !strings.HasPrefix(baseAddr, "https://") {
			if domain.DisableTls {
				baseAddr = "http://" + baseAddr
			} else {
				baseAddr = "https://" + baseAddr
			}
		}
		siteAddrs = append(siteAddrs, baseAddr+":"+port)

		for _, sub := range domainSubdomains {
			subAddr := sub.FromDomain + "." + domain.FromDomain
			if !strings.HasPrefix(subAddr, "http://") && !strings.HasPrefix(subAddr, "https://") {
				if domain.DisableTls {
					subAddr = "http://" + subAddr
				} else {
					subAddr = "https://" + subAddr
				}
			}
			siteAddrs = append(siteAddrs, subAddr+":"+port)
		}

		sb.WriteString(strings.Join(siteAddrs, ", ") + " {\n")

		// Domain TLS settings
		if domain.DisableTls {
			// Handled by http:// prefix, but could add specific block if needed
		} else if domain.CustomCert != "" {
			// Expecting .pem and .key with same base name if custom cert is provided
			certPath := "./certs/" + domain.CustomCert
			keyPath := "./certs/" + strings.TrimSuffix(domain.CustomCert, ".pem") + ".key"
			sb.WriteString("\ttls " + certPath + " " + keyPath + "\n")
		} else {
			sb.WriteString("\ttls internal\n") // Auto HTTPS disabled by default in our app without ACME
		}

		// Access Log
		if domain.AccessLog {
			sb.WriteString("\tlog\n")
		}

		// Domain Access Lists
		for _, alID := range domain.AccessList {
			if al, ok := accessLists[alID]; ok && len(al.ClientIps) > 0 {
				matcherName := "@al_" + al.ID
				sb.WriteString("\t" + matcherName + " {\n")
				sb.WriteString("\t\tremote_ip " + strings.Join(al.ClientIps, " ") + "\n")
				sb.WriteString("\t}\n")
				if al.Invert {
					// Invert = true means "Block these IPs". Abort if they MATCH.
					sb.WriteString("\tabort " + matcherName + "\n")
				} else {
					// Invert = false means "Allow only these IPs". Abort if they DO NOT MATCH.
					sb.WriteString("\tabort not " + matcherName + "\n")
				}
			}
		}

		// Domain Basic Auth
		for _, baID := range domain.BasicAuth {
			if ba, ok := basicAuths[baID]; ok {
				sb.WriteString("\tbasicauth {\n")
				sb.WriteString("\t\t" + ba.BasicAuthUser + " " + ba.BasicAuthPass + "\n")
				sb.WriteString("\t}\n")
			}
		}

		// Handlers for this Domain
		for _, handler := range config.Handlers {
			if !handler.Enabled || (handler.Reverse != domain.ID && handler.Subdomain == "") {
				continue
			}

			// Subdomain check
			isSubdomainMatch := false
			if handler.Subdomain != "" {
				for _, sub := range domainSubdomains {
					if handler.Subdomain == sub.ID {
						isSubdomainMatch = true
						break
					}
				}
				if !isSubdomainMatch {
					continue // This handler is for a subdomain not associated with this domain loop
				}
			}

			// Construct handler matchers
			matcherStr := ""
			if handler.HandlePath != "" {
				if handler.HandleType == "handle_path" {
					matcherStr = " " + handler.HandlePath + "/*"
				} else {
					matcherStr = " " + handler.HandlePath
				}
			}

			directive := handler.HandleDirective
			if directive == "" {
				directive = "reverse_proxy"
			}

			if handler.HandleType == "handle_path" {
				sb.WriteString("\thandle_path" + matcherStr + " {\n")
			} else {
				sb.WriteString("\thandle" + matcherStr + " {\n")
			}

			// Handler Access Lists
			for _, alID := range handler.AccessList {
				if al, ok := accessLists[alID]; ok && len(al.ClientIps) > 0 {
					matcherName := "@al_h_" + al.ID
					sb.WriteString("\t\t" + matcherName + " {\n")
					sb.WriteString("\t\t\tremote_ip " + strings.Join(al.ClientIps, " ") + "\n")
					sb.WriteString("\t\t}\n")
					if al.Invert {
						sb.WriteString("\t\tabort " + matcherName + "\n")
					} else {
						sb.WriteString("\t\tabort not " + matcherName + "\n")
					}
				}
			}

			// Handler Basic Auth
			for _, baID := range handler.BasicAuth {
				if ba, ok := basicAuths[baID]; ok {
					sb.WriteString("\t\tbasicauth {\n")
					sb.WriteString("\t\t\t" + ba.BasicAuthUser + " " + ba.BasicAuthPass + "\n")
					sb.WriteString("\t\t}\n")
				}
			}

			// Handler Headers
			for _, hID := range handler.Header {
				if h, ok := headers[hID]; ok {
					dir := h.HeaderUpDown
					if dir == "" {
						dir = "header_up" // Default to header_up for proxy
					}
					// Only emit if it's not a proxy, or if it is a proxy we add it later
					if directive != "reverse_proxy" {
						action := "set" // Simplified header logic
						if h.HeaderValue == "" {
							action = "-"
						}
						if action == "-" {
							sb.WriteString("\t\theader " + action + h.HeaderType + "\n")
						} else {
							sb.WriteString("\t\theader " + h.HeaderType + " " + h.HeaderValue + "\n")
						}
					}
				}
			}

			// Upstreams
			if directive == "reverse_proxy" {
				sb.WriteString("\t\treverse_proxy")
				for _, to := range handler.ToDomain {
					sb.WriteString(" " + to + ":" + handler.ToPort)
				}
				sb.WriteString(" {\n")

				// Headers for proxy
				for _, hID := range handler.Header {
					if h, ok := headers[hID]; ok {
						action := "set"
						if h.HeaderValue == "" {
							action = "-"
						}
						dir := h.HeaderUpDown
						if dir == "header_down" {
							if action == "-" {
								sb.WriteString("\t\t\theader_down -" + h.HeaderType + "\n")
							} else {
								sb.WriteString("\t\t\theader_down " + h.HeaderType + " " + h.HeaderValue + "\n")
							}
						} else {
							if action == "-" {
								sb.WriteString("\t\t\theader_up -" + h.HeaderType + "\n")
							} else {
								sb.WriteString("\t\t\theader_up " + h.HeaderType + " " + h.HeaderValue + "\n")
							}
						}
					}
				}

				// Transport
				if handler.NTLM {
					sb.WriteString("\t\t\ttransport http_ntlm {\n")
					if handler.HttpTls {
						sb.WriteString("\t\t\t\ttls\n")
					}
					sb.WriteString("\t\t\t}\n")
				} else if handler.HttpTls {
					sb.WriteString("\t\t\ttransport http {\n")
					sb.WriteString("\t\t\t\ttls\n")
					sb.WriteString("\t\t\t}\n")
				}

				// Load Balancing
				if handler.LbPolicy != "" {
					sb.WriteString("\t\t\tlb_policy " + handler.LbPolicy + "\n")
				}
				if handler.LbRetries > 0 {
					sb.WriteString("\t\t\tlb_retries " + strconv.Itoa(handler.LbRetries) + "\n")
				}
				if handler.LbTryDuration != "" {
					sb.WriteString("\t\t\tlb_try_duration " + handler.LbTryDuration + "\n")
				}
				if handler.LbTryInterval != "" {
					sb.WriteString("\t\t\tlb_try_interval " + handler.LbTryInterval + "\n")
				}

				// Health Checks
				if handler.HealthUri != "" {
					sb.WriteString("\t\t\thealth_uri " + handler.HealthUri + "\n")
				}
				if handler.HealthPort != "" {
					sb.WriteString("\t\t\thealth_port " + handler.HealthPort + "\n")
				}
				if handler.HealthInterval != "" {
					sb.WriteString("\t\t\thealth_interval " + handler.HealthInterval + "\n")
				}
				if handler.HealthTimeout != "" {
					sb.WriteString("\t\t\thealth_timeout " + handler.HealthTimeout + "\n")
				}

				sb.WriteString("\t\t}\n")
			} else if directive == "redir" {
				to := ""
				if len(handler.ToDomain) > 0 {
					to = handler.ToDomain[0]
				}
				sb.WriteString("\t\tredir " + to + "\n")
			}

			sb.WriteString("\t}\n") // End handle
		}

		sb.WriteString("}\n\n") // End domain
	}

	return sb.String()
}

func csrfMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Protect state-changing API methods
		if (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete) && strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Header.Get("X-Requested-With") != "XMLHttpRequest" {
				http.Error(w, "CSRF check failed: missing X-Requested-With header", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	mux := http.NewServeMux()
	fs := http.FileServer(http.Dir("./static"))
	mux.Handle("/", fs)

	mux.HandleFunc("/api/config", handleConfig)
	mux.HandleFunc("/api/config/structured", handleStructuredConfig)
	mux.HandleFunc("/api/validate", handleValidate)
	mux.HandleFunc("/api/start", handleStart)
	mux.HandleFunc("/api/stop", handleStop)
	mux.HandleFunc("/api/reload", handleReload)
	mux.HandleFunc("/api/stats", handleStats)
	mux.HandleFunc("/api/certs", handleCerts)

	handler := csrfMiddleware(mux)

	log.Println("Server started on :8090")
	log.Fatal(http.ListenAndServe(":8090", handler))
}

func handleCerts(w http.ResponseWriter, r *http.Request) {
	certDir := "./certs"
	if err := os.MkdirAll(certDir, 0755); err != nil {
		http.Error(w, "Failed to create certs directory", http.StatusInternalServerError)
		return
	}

	if r.Method == http.MethodGet {
		files, err := os.ReadDir(certDir)
		if err != nil {
			http.Error(w, "Failed to read certs directory", http.StatusInternalServerError)
			return
		}
		var certNames []string
		for _, f := range files {
			if !f.IsDir() {
				certNames = append(certNames, f.Name())
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(certNames)
		return
	} else if r.Method == http.MethodPost {
		err := r.ParseMultipartForm(10 << 20) // 10 MB limit
		if err != nil {
			http.Error(w, "Failed to parse form", http.StatusBadRequest)
			return
		}

		file, handler, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "Failed to get file", http.StatusBadRequest)
			return
		}
		defer file.Close()

		safeName := filepath.Base(handler.Filename)
		dst, err := os.Create(filepath.Join(certDir, safeName))
		if err != nil {
			http.Error(w, "Failed to create file", http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			http.Error(w, "Failed to write file", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		return
	} else if r.Method == http.MethodDelete {
		filename := r.URL.Query().Get("file")
		if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") {
			http.Error(w, "Invalid filename", http.StatusBadRequest)
			return
		}
		err := os.Remove(certDir + "/" + filename)
		if err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "File not found", http.StatusNotFound)
			} else {
				http.Error(w, "Failed to delete file", http.StatusInternalServerError)
			}
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
					General: GeneralConfig{
						HttpPort:  "80",
						HttpsPort: "443",
					},
					Domains:     []Domain{},
					Subdomains:  []Subdomain{},
					Handlers:    []Handler{},
					AccessLists: []AccessList{},
					BasicAuths:  []BasicAuth{},
					Headers:     []Header{},
					Layer4:      []Layer4Route{},
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
