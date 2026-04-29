(function(global) {
    const STORAGE_KEY = 'localcaddyhub.language';
    const supportedLanguages = ['en', 'de'];
    const textSources = new WeakMap();
    const attrSources = new WeakMap();

    const translations = {
        de: {
            'Login - LocalCaddyHub': 'Anmeldung - LocalCaddyHub',
            'Setup - LocalCaddyHub': 'Einrichtung - LocalCaddyHub',
            'Apply Configuration': 'Konfiguration anwenden',
            'Validate Configuration': 'Konfiguration prüfen',
            '2FA Settings': '2FA-Einstellungen',
            'Logout': 'Abmelden',
            'Language': 'Sprache',
            'General': 'Allgemein',
            'Reverse Proxy': 'Reverse Proxy',
            'Layer 4': 'Layer 4',
            'Certificates': 'Zertifikate',
            'Control & Raw': 'Steuerung & Rohdaten',
            'Live Logs': 'Live-Logs',
            'General Settings': 'Allgemeine Einstellungen',
            'Enable Caddy Configuration': 'Caddy-Konfiguration aktivieren',
            'Enable Layer 4 Configuration': 'Layer-4-Konfiguration aktivieren',
            'HTTP Port': 'HTTP-Port',
            'HTTPS Port': 'HTTPS-Port',
            'Log Level': 'Log-Level',
            'Default (INFO)': 'Standard (INFO)',
            'Log Credentials': 'Zugangsdaten protokollieren',
            '(?) Enables logging of credentials.': '(?) Aktiviert die Protokollierung von Zugangsdaten.',
            'Log Roll Size (MB)': 'Log-Rotationsgröße (MB)',
            '(?) Max size of a log file before it gets rotated.': '(?) Maximale Größe einer Logdatei vor der Rotation.',
            'Rotated Log Files to Keep': 'Anzahl aufzubewahrender rotierter Logdateien',
            '(?) Max number of rotated log files to keep.': '(?) Maximale Anzahl rotierter Logdateien, die behalten werden.',
            'TLS Email': 'TLS-E-Mail',
            '(?) The email address to use for the ACME account.': '(?) Die E-Mail-Adresse für das ACME-Konto.',
            'Auto HTTPS': 'Auto HTTPS',
            '(?) Configures Caddy Automatic HTTPS. Off and Disable Certs prevent public ACME certificate issuance.': '(?) Konfiguriert Caddy Automatic HTTPS. Aus und Zertifikate deaktivieren verhindern öffentliche ACME-Zertifikate.',
            'On (Default)': 'Ein (Standard)',
            'Off': 'Aus',
            'Disable Redirects': 'Weiterleitungen deaktivieren',
            'Disable Certs': 'Zertifikate deaktivieren',
            'Ignore Loaded Certs': 'Geladene Zertifikate ignorieren',
            'HTTP Versions': 'HTTP-Versionen',
            '(?) Select supported HTTP versions.': '(?) Unterstützte HTTP-Versionen auswählen.',
            'Read Body Timeout': 'Zeitlimit für Request-Body',
            '(?) Duration to allow for reading the request body.': '(?) Erlaubte Dauer zum Lesen des Request-Bodys.',
            'Read Header Timeout': 'Zeitlimit für Request-Header',
            '(?) Duration to allow for reading the request headers.': '(?) Erlaubte Dauer zum Lesen der Request-Header.',
            'Write Timeout': 'Schreibzeitlimit',
            '(?) Duration to allow for writing the response.': '(?) Erlaubte Dauer zum Schreiben der Antwort.',
            'Idle Timeout': 'Leerlaufzeitlimit',
            '(?) Maximum time to wait for the next request when keep-alives are enabled.': '(?) Maximale Wartezeit auf die nächste Anfrage, wenn Keep-Alive aktiv ist.',
            'Domains': 'Domains',
            'Subdomains': 'Subdomains',
            'Handlers': 'Handler',
            'Access Lists': 'Zugriffslisten',
            'Basic Auth': 'Basic Auth',
            'Headers': 'Header',
            '+ Add Domain': '+ Domain hinzufügen',
            '+ Add Subdomain': '+ Subdomain hinzufügen',
            '+ Add Handler': '+ Handler hinzufügen',
            '+ Add Access List': '+ Zugriffsliste hinzufügen',
            '+ Add Basic Auth': '+ Basic Auth hinzufügen',
            '+ Add Header': '+ Header hinzufügen',
            '+ Add Route': '+ Route hinzufügen',
            'En': 'Aktiv',
            'Domain': 'Domain',
            'Port': 'Port',
            'Desc': 'Beschr.',
            'Actions': 'Aktionen',
            'Subdomain': 'Subdomain',
            'Parent Domain': 'Übergeordnete Domain',
            'Domain/Sub': 'Domain/Sub',
            'Path': 'Pfad',
            'Upstream': 'Upstream',
            'Name': 'Name',
            'Client IPs': 'Client-IPs',
            'Invert': 'Umkehren',
            'User': 'Benutzer',
            'Type': 'Typ',
            'Header': 'Header',
            'Value': 'Wert',
            'Replace': 'Ersetzen',
            'Seq': 'Seq',
            'Protocol': 'Protokoll',
            'Listen Port': 'Listen-Port',
            'Layer 4 Routes': 'Layer-4-Routen',
            'Custom Certificates': 'Benutzerdefinierte Zertifikate',
            'Upload your': 'Lade deine',
            'and': 'und',
            'files here. They will be available for selection in Domains.': 'Dateien hier hoch. Sie stehen danach in Domains zur Auswahl.',
            'Certificate File Upload': 'Zertifikatsdatei hochladen',
            'Upload File': 'Datei hochladen',
            'Caddy-managed ACME Certificates': 'Von Caddy verwaltete ACME-Zertifikate',
            'Download Caddy-managed ACME certificate storage, including private keys. Handle this archive securely.': 'Lade den von Caddy verwalteten ACME-Zertifikatsspeicher inklusive privater Schlüssel herunter. Behandle dieses Archiv vertraulich.',
            'Download .tar.gz': '.tar.gz herunterladen',
            'Available Files in ./certs/': 'Verfügbare Dateien in ./certs/',
            'Process Control': 'Prozesssteuerung',
            'Start': 'Starten',
            'Stop': 'Stoppen',
            'Reload': 'Neu laden',
            'Raw Caddyfile': 'Rohes Caddyfile',
            'Copy to Clipboard': 'In Zwischenablage kopieren',
            'Raw Caddyfile Content': 'Inhalt des rohen Caddyfiles',
            'Stats': 'Statistiken',
            'Refresh Stats': 'Statistiken aktualisieren',
            'Live Log Viewer': 'Live-Log-Anzeige',
            'Log File': 'Logdatei',
            'Start Tailing': 'Tailing starten',
            'Stop Tailing': 'Tailing stoppen',
            'Clear Output': 'Ausgabe leeren',
            'Filters': 'Filter',
            'All': 'Alle',
            'Status': 'Status',
            'Method': 'Methode',
            'Client IP': 'Client-IP',
            'Path / URI': 'Pfad / URI',
            'Free-text Search': 'Freitextsuche',
            'e.g. 404, 5xx': 'z. B. 404, 5xx',
            'e.g. 192.168.1.1': 'z. B. 192.168.1.1',
            'e.g. /api': 'z. B. /api',
            'Keyword...': 'Suchbegriff...',
            'Close': 'Schließen',
            'Status:': 'Status:',
            'Loading...': 'Lädt...',
            'Scan this QR code with your authenticator app:': 'Scanne diesen QR-Code mit deiner Authenticator-App:',
            'QR Code': 'QR-Code',
            'Verification Code': 'Bestätigungscode',
            'Enable 2FA': '2FA aktivieren',
            'Disable 2FA': '2FA deaktivieren',
            'Enabled': 'Aktiviert',
            'Disabled': 'Deaktiviert',
            'Saving...': 'Speichert...',
            'Validating...': 'Prüft...',
            'Loading...': 'Lädt...',
            'Uploading...': 'Lädt hoch...',
            'Verifying...': 'Prüft...',
            'Saved successfully!': 'Erfolgreich gespeichert!',
            'Failed to save config.': 'Konfiguration konnte nicht gespeichert werden.',
            'Configuration is valid!': 'Konfiguration ist gültig!',
            'Validation failed!': 'Validierung fehlgeschlagen!',
            'Success': 'Erfolg',
            'Error': 'Fehler',
            'Save': 'Speichern',
            'None': 'Keiner',
            'Copied!': 'Kopiert!',
            'Failed to copy text.': 'Text konnte nicht kopiert werden.',
            'Error fetching stats. Is Caddy running with metrics enabled?': 'Fehler beim Abrufen der Statistiken. Läuft Caddy mit aktivierten Metriken?',
            'File uploaded successfully!': 'Datei erfolgreich hochgeladen!',
            'Upload failed.': 'Upload fehlgeschlagen.',
            'Failed to delete cert.': 'Zertifikat konnte nicht gelöscht werden.',
            'Delete {name}?': '{name} löschen?',
            '2FA Enabled successfully!': '2FA erfolgreich aktiviert!',
            'Invalid Code.': 'Ungültiger Code.',
            'Are you sure you want to disable 2FA?': '2FA wirklich deaktivieren?',
            'Are you sure you want to delete this item?': 'Diesen Eintrag wirklich löschen?',
            '(Copy)': '(Kopie)',
            'Copy': 'Kopie',
            'No items found. Click Add to create one.': 'Keine Einträge gefunden. Klicke auf Hinzufügen, um einen zu erstellen.',
            'Yes': 'Ja',
            'No': 'Nein',
            'Move Up': 'Nach oben',
            'Move Down': 'Nach unten',
            'Edit': 'Bearbeiten',
            'Dup': 'Dupl.',
            'Duplicate': 'Duplizieren',
            'Del': 'Löschen',
            'Delete': 'Löschen',
            'Delete certificate': 'Zertifikat löschen',
            'No certificates found. Upload one above.': 'Keine Zertifikate gefunden. Lade oben eines hoch.',
            'Caddy-managed / Internal': 'Caddy-verwaltet / Intern',
            'Select Domain': 'Domain auswählen',
            'None / Match All': 'Keine / alle abgleichen',
            'Edit Item': 'Eintrag bearbeiten',
            'Add Item': 'Eintrag hinzufügen',
            'Port (Empty for default)': 'Port (leer für Standard)',
            'Description': 'Beschreibung',
            'Enable Access Log': 'Access-Log aktivieren',
            'Disable TLS (HTTP only)': 'TLS deaktivieren (nur HTTP)',
            'Use Caddy-managed public ACME certificate': 'Von Caddy verwaltetes öffentliches ACME-Zertifikat verwenden',
            'Uses Caddy Automatic HTTPS with a public ACME issuer such as Let\'s Encrypt or ZeroSSL. Overrides custom certificate when enabled.': 'Verwendet Caddy Automatic HTTPS mit einem öffentlichen ACME-Issuer wie Let\'s Encrypt oder ZeroSSL. Überschreibt ein benutzerdefiniertes Zertifikat, wenn aktiviert.',
            'Unavailable because global Auto HTTPS is set to Off or Disable Certs.': 'Nicht verfügbar, weil Auto HTTPS global auf Aus oder Zertifikate deaktivieren steht.',
            'Unavailable for HTTP-only domains.': 'Nicht verfügbar für reine HTTP-Domains.',
            'Custom Certificate': 'Benutzerdefiniertes Zertifikat',
            'Client Auth Mode': 'Client-Auth-Modus',
            'Client Auth Trust Pool (CA Cert)': 'Client-Auth Trust Pool (CA-Zertifikat)',
            'Subdomain (e.g. \'api\' for api.example.com)': 'Subdomain (z. B. \'api\' für api.example.com)',
            'Uses Caddy Automatic HTTPS for this subdomain. Parent domain ACME is inherited.': 'Verwendet Caddy Automatic HTTPS für diese Subdomain. ACME der übergeordneten Domain wird geerbt.',
            'Unavailable because the parent domain is HTTP-only.': 'Nicht verfügbar, weil die übergeordnete Domain nur HTTP nutzt.',
            'Parent domain ACME is enabled, so this subdomain already uses a Caddy-managed public certificate.': 'ACME ist für die übergeordnete Domain aktiv, daher nutzt diese Subdomain bereits ein von Caddy verwaltetes öffentliches Zertifikat.',
            'Health Checks': 'Health Checks',
            'Access & Headers': 'Zugriff & Header',
            'Enable WAF (Coraza OWASP CRS)': 'WAF aktivieren (Coraza OWASP CRS)',
            'Subdomain Filter': 'Subdomain-Filter',
            'Handle Type': 'Handle-Typ',
            'Handle': 'Handle',
            'Handle Path (Strips prefix)': 'Handle Path (entfernt Präfix)',
            'Path Matcher (e.g. /api/*)': 'Pfad-Matcher (z. B. /api/*)',
            'Directive': 'Direktive',
            'Redirect': 'Weiterleitung',
            'Redirect Target URL': 'Weiterleitungsziel-URL',
            'Redirect Status Code': 'Weiterleitungsstatuscode',
            '301 (Moved Permanently)': '301 (Dauerhaft verschoben)',
            '302 (Found / Temporary)': '302 (Gefunden / temporär)',
            '303 (See Other)': '303 (Siehe andere URL)',
            '307 (Temporary Redirect)': '307 (Temporäre Weiterleitung)',
            '308 (Permanent Redirect)': '308 (Dauerhafte Weiterleitung)',
            'html (HTML Document)': 'html (HTML-Dokument)',
            'Upstream Domains/IPs (comma separated)': 'Upstream-Domains/IPs (kommagetrennt)',
            'Upstream Port': 'Upstream-Port',
            'Upstream Rewrite Path': 'Upstream-Rewrite-Pfad',
            'Upstream TLS (HTTPS)': 'Upstream-TLS (HTTPS)',
            'Insecure Skip TLS Verify': 'TLS-Prüfung unsicher überspringen',
            'Upstream TLS Server Name (SNI)': 'Upstream-TLS-Servername (SNI)',
            'Upstream TLS Trusted CA Cert': 'Vertrauenswürdiges Upstream-TLS-CA-Zertifikat',
            'HTTP Keepalive (seconds)': 'HTTP-Keepalive (Sekunden)',
            'NTLM Transport': 'NTLM-Transport',
            'LB Policy': 'LB-Richtlinie',
            'Default (Random/RoundRobin)': 'Standard (Random/RoundRobin)',
            'Round Robin': 'Round Robin',
            'IP Hash': 'IP-Hash',
            'Least Conn': 'Least Conn',
            'Client IP Hash': 'Client-IP-Hash',
            'LB Retries': 'LB-Wiederholungen',
            '(?) Number of retries.': '(?) Anzahl der Wiederholungen.',
            'LB Try Duration': 'LB-Versuchsdauer',
            '(?) How long to try selecting upstream (e.g. 5s).': '(?) Wie lange versucht wird, einen Upstream auszuwählen (z. B. 5s).',
            'LB Try Interval': 'LB-Versuchsintervall',
            '(?) Time between retries (e.g. 250ms).': '(?) Zeit zwischen Wiederholungen (z. B. 250ms).',
            'Active Health Checks': 'Aktive Health Checks',
            'Health URI': 'Health-URI',
            '(?) The URI for active health checks.': '(?) URI für aktive Health Checks.',
            'Health Port': 'Health-Port',
            '(?) The port for active health checks.': '(?) Port für aktive Health Checks.',
            'Health Interval': 'Health-Intervall',
            '(?) The interval between active health checks.': '(?) Intervall zwischen aktiven Health Checks.',
            'Health Timeout': 'Health-Zeitlimit',
            '(?) The timeout for active health checks.': '(?) Zeitlimit für aktive Health Checks.',
            'Health Status': 'Health-Status',
            '(?) Expected HTTP status code (e.g. 200).': '(?) Erwarteter HTTP-Statuscode (z. B. 200).',
            'Health Body': 'Health-Body',
            '(?) Expected text in the response body.': '(?) Erwarteter Text im Antwort-Body.',
            'Health Headers': 'Health-Header',
            '(?) Select headers to use for health checks.': '(?) Header auswählen, die für Health Checks verwendet werden.',
            'Health Passes': 'Health-Erfolge',
            '(?) Number of passes to consider healthy.': '(?) Anzahl erfolgreicher Prüfungen, bis der Dienst als gesund gilt.',
            'Health Fails': 'Health-Fehler',
            '(?) Number of failures to consider unhealthy.': '(?) Anzahl fehlgeschlagener Prüfungen, bis der Dienst als fehlerhaft gilt.',
            'Follow Redirects': 'Weiterleitungen folgen',
            '(?) Follow HTTP redirects during health checks.': '(?) HTTP-Weiterleitungen bei Health Checks folgen.',
            'Passive Health Checks': 'Passive Health Checks',
            'Fail Duration': 'Fehlerdauer',
            '(?) How long to remember a failure.': '(?) Wie lange ein Fehler gemerkt wird.',
            'Max Fails': 'Max. Fehler',
            '(?) Number of fails to consider a host down.': '(?) Anzahl Fehler, ab der ein Host als ausgefallen gilt.',
            'Unhealthy Status': 'Fehlerstatus',
            '(?) HTTP status code that implies failure (e.g. 5xx).': '(?) HTTP-Statuscode, der einen Fehler bedeutet (z. B. 5xx).',
            'Unhealthy Latency': 'Fehlerlatenz',
            '(?) Latency that implies failure (e.g. 5s).': '(?) Latenz, die einen Fehler bedeutet (z. B. 5s).',
            'Unhealthy Request Count': 'Fehlerhafte Request-Anzahl',
            '(?) Request count that implies failure.': '(?) Request-Anzahl, die einen Fehler bedeutet.',
            'Request Matcher': 'Request-Matcher',
            'Remote IP': 'Remote-IP',
            'Client IPs (comma separated CIDR)': 'Client-IPs (CIDR, kommagetrennt)',
            'Invert (Block these IPs)': 'Umkehren (diese IPs blockieren)',
            'Custom HTTP Response Code (e.g. 403)': 'Benutzerdefinierter HTTP-Antwortcode (z. B. 403)',
            'Custom HTTP Response Message': 'Benutzerdefinierte HTTP-Antwortnachricht',
            'Username': 'Benutzername',
            'Password': 'Passwort',
            'Password (BCrypt Hash in Caddyfile)': 'Passwort (BCrypt-Hash im Caddyfile)',
            'Direction': 'Richtung',
            'Request (Up)': 'Request (Up)',
            'Response (Down)': 'Response (Down)',
            'Header Name': 'Header-Name',
            'Value / Match Regex (Leave empty to delete)': 'Wert / Match-Regex (leer lassen zum Löschen)',
            'Replacement (optional)': 'Ersatz (optional)',
            'Layer 4 Route': 'Layer-4-Route',
            'Sequence': 'Sequenz',
            'Layer 7': 'Layer 7',
            'Matcher': 'Matcher',
            'Listen Domains/IPs (comma separated)': 'Listen-Domains/IPs (kommagetrennt)',
            'Invert matcher': 'Matcher umkehren',
            'Upstream Domain/IPs (comma separated)': 'Upstream-Domains/IPs (kommagetrennt)',
            'Custom Certificate (Terminate)': 'Benutzerdefiniertes Zertifikat (Terminieren)',
            'Default SNI': 'Standard-SNI',
            'Fallback SNI if client (e.g., SMTP) does not provide one during TLS termination.': 'Fallback-SNI, wenn der Client (z. B. SMTP) bei TLS-Terminierung keine SNI sendet.',
            'Originate TLS to Upstream': 'TLS zum Upstream aufbauen',
            'TLS (Verify)': 'TLS (prüfen)',
            'TLS (Skip Verification)': 'TLS (Prüfung überspringen)',
            'STARTTLS (Verify)': 'STARTTLS (prüfen)',
            'STARTTLS (Skip Verification)': 'STARTTLS (Prüfung überspringen)',
            'Proxy Protocol': 'Proxy-Protokoll',
            'Off (Default)': 'Aus (Standard)',
            'Load Balancing': 'Lastausgleich',
            'Default (Random)': 'Standard (Random)',
            'Passive Health Fail Duration (seconds)': 'Passive-Health-Fehlerdauer (Sekunden)',
            'Max Passive Health Fails': 'Max. Passive-Health-Fehler',
            'Access': 'Zugriff',
            'Remote IPs (comma separated)': 'Remote-IPs (kommagetrennt)',
            'Login': 'Anmelden',
            'Logging in...': 'Meldet an...',
            'Invalid username or password': 'Ungültiger Benutzername oder ungültiges Passwort',
            '2FA Code': '2FA-Code',
            'Invalid 2FA code.': 'Ungültiger 2FA-Code.',
            'Error occurred during login.': 'Beim Anmelden ist ein Fehler aufgetreten.',
            'First Time Setup': 'Ersteinrichtung',
            'Please change your admin credentials.': 'Bitte ändere deine Admin-Zugangsdaten.',
            'Passwords do not match.': 'Passwörter stimmen nicht überein.',
            'New Username': 'Neuer Benutzername',
            'New Password': 'Neues Passwort',
            'Confirm Password': 'Passwort bestätigen',
            'Save & Continue': 'Speichern & Fortfahren',
            'Failed to save.': 'Speichern fehlgeschlagen.',
            'Caddy is already running.': 'Caddy läuft bereits.',
            'Caddy started successfully.': 'Caddy wurde erfolgreich gestartet.',
            'Caddy start command executed.': 'Caddy-Startbefehl wurde ausgeführt.',
            'Caddy stopped successfully.': 'Caddy wurde erfolgreich gestoppt.',
            'Caddy reloaded successfully.': 'Caddy wurde erfolgreich neu geladen.'
        }
    };

    const dynamicPrefixes = {
        de: [
            ['Error: ', 'Fehler: '],
            ['Failed to stop: ', 'Stoppen fehlgeschlagen: '],
            ['Failed to reload: ', 'Neu laden fehlgeschlagen: '],
            ['Caddy exited with code ', 'Caddy wurde mit Code beendet: ']
        ]
    };

    function detectLanguage() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (supportedLanguages.includes(saved)) return saved;
        return (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
    }

    function currentLanguage() {
        const lang = localStorage.getItem(STORAGE_KEY) || detectLanguage();
        return supportedLanguages.includes(lang) ? lang : 'en';
    }

    function splitWhitespace(value) {
        const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
        return { leading: match[1], core: match[2], trailing: match[3] };
    }

    function translateForLanguage(source, lang, replacements = {}) {
        let value = source == null ? '' : String(source);
        if (lang !== 'en') {
            const translated = translations[lang] && translations[lang][value];
            if (translated) {
                value = translated;
            } else {
                for (const [prefix, translatedPrefix] of dynamicPrefixes[lang] || []) {
                    if (value.startsWith(prefix)) {
                        value = translatedPrefix + value.slice(prefix.length);
                        break;
                    }
                }
            }
        }
        Object.entries(replacements).forEach(([key, replacement]) => {
            value = value.replace(new RegExp(`\\{${key}\\}`, 'g'), replacement);
        });
        return value;
    }

    function translate(source, replacements = {}) {
        return translateForLanguage(source, currentLanguage(), replacements);
    }

    function expectedForSource(source, language = currentLanguage()) {
        const parts = splitWhitespace(source);
        return parts.leading + translateForLanguage(parts.core, language) + parts.trailing;
    }

    function isRenderedSource(current, source) {
        if (current === source) return true;
        return supportedLanguages.some(language => current === expectedForSource(source, language));
    }

    function shouldSkipNode(node) {
        const parent = node.parentElement;
        if (!parent) return true;
        return ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName);
    }

    function translateTextNode(node) {
        if (shouldSkipNode(node)) return;
        if (!node.nodeValue || !node.nodeValue.trim()) return;

        let source = textSources.get(node);
        if (source !== undefined) {
            const current = node.nodeValue;
            if (!isRenderedSource(current, source)) {
                source = current;
                textSources.set(node, source);
            }
        } else {
            source = node.nodeValue;
            textSources.set(node, source);
        }

        node.nodeValue = expectedForSource(source);
    }

    function attrStore(element) {
        let store = attrSources.get(element);
        if (!store) {
            store = {};
            attrSources.set(element, store);
        }
        return store;
    }

    function translateAttribute(element, attr) {
        if (!element.hasAttribute(attr)) return;
        const store = attrStore(element);
        let source = store[attr];
        const current = element.getAttribute(attr);
        if (source !== undefined) {
            if (!supportedLanguages.some(language => current === translateForLanguage(source, language)) && current !== source) {
                source = current;
                store[attr] = source;
            }
        } else {
            source = current;
            store[attr] = source;
        }
        element.setAttribute(attr, translate(source));
    }

    function apply(root = document) {
        document.documentElement.lang = currentLanguage();
        const select = document.getElementById('languageSelect');
        if (select) select.value = currentLanguage();

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return shouldSkipNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(translateTextNode);

        const elements = root.nodeType === Node.ELEMENT_NODE
            ? [root, ...root.querySelectorAll('*')]
            : [...document.querySelectorAll('*')];
        elements.forEach(element => {
            ['placeholder', 'title', 'aria-label', 'alt'].forEach(attr => translateAttribute(element, attr));
        });
    }

    function setLanguage(language) {
        const normalized = supportedLanguages.includes(language) ? language : 'en';
        localStorage.setItem(STORAGE_KEY, normalized);
        apply(document);
    }

    function init() {
        if (!localStorage.getItem(STORAGE_KEY)) {
            localStorage.setItem(STORAGE_KEY, detectLanguage());
        }
        const select = document.getElementById('languageSelect');
        if (select) {
            select.value = currentLanguage();
            select.addEventListener('change', () => {
                setLanguage(select.value);
                if (global.app && global.app.ui && typeof global.app.ui.renderAll === 'function') {
                    global.app.ui.renderAll();
                }
            });
        }
        apply(document);
    }

    global.LocalCaddyHubI18n = {
        apply,
        init,
        setLanguage,
        getLanguage: currentLanguage,
        t: translate
    };
})(window);
