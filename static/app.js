// UUID Generator
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const app = {
    config: {
        general: { enabled: false, enable_layer4: false, http_port: "", https_port: "", log_level: "", tls_email: "", auto_https: "", http_versions: "", timeout_read_body: "", timeout_read_header: "", timeout_write: "", timeout_idle: "", log_credentials: false, log_roll_size_mb: 10, log_roll_keep: 7 },
        domains: [],
        subdomains: [],
        handlers: [],
        accessLists: [],
        basicAuths: [],
        headers: [],
        layer4: []
    },
    certs: [],
    logStreamSource: null,

    init: async function() {
        await this.loadCerts();
        await this.loadConfig();
        this.ui.initModals();
        this.ui.renderAll();
        this.fetchStats();
        this.fetchLogFiles();

        // Add event listeners for dynamic log filtering
        $('#logFilterLevel, #logFilterStatus, #logFilterMethod, #logFilterIp, #logFilterPath, #logFilterText').on('input change', () => {
             // Since it's a stream we only filter incoming, but let's re-filter what's in the DOM if possible,
             // but that is hard for plain text. We will just filter new lines.
             // Actually, a better UX is to hide/show existing lines if they don't match.
             app.applyLogFiltersToDOM();
        });
    },

    loadConfig: async function() {
        try {
            const res = await fetch('/api/config/structured');
            if (res.ok) {
                const data = await res.json();
                this.config = Object.assign(this.config, data);
                // load raw caddyfile too
                const rawRes = await fetch('/api/config');
                if (rawRes.ok) {
                    const rawData = await rawRes.json();
                    $('#rawCaddyfile').val(rawData.content);
                }
            }
        } catch (e) {
            console.error("Failed to load config", e);
        }
    },

    saveStructuredConfig: async function() {
        this.config.general.enabled = $('#genEnabled').is(':checked');
        this.config.general.enable_layer4 = $('#genEnableLayer4').is(':checked');
        this.config.general.http_port = $('#genHttpPort').val();
        this.config.general.https_port = $('#genHttpsPort').val();
        this.config.general.log_level = $('#genLogLevel').val();
        this.config.general.tls_email = $('#genTlsEmail').val();
        this.config.general.auto_https = $('#genAutoHttps').val();
        this.config.general.http_versions = $('#genHttpVersions').val();
        this.config.general.timeout_read_body = $('#genTOutReadBody').val();
        this.config.general.timeout_read_header = $('#genTOutReadHeader').val();
        this.config.general.timeout_write = $('#genTOutWrite').val();
        this.config.general.timeout_idle = $('#genTOutIdle').val();
        this.config.general.log_credentials = $('#genLogCreds').is(':checked');
        this.config.general.log_roll_size_mb = parseInt($('#genLogRollSize').val()) || 10;
        this.config.general.log_roll_keep = parseInt($('#genLogRollKeep').val()) || 7;

        try {
            const res = await fetch('/api/config/structured', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify(this.config)
            });
            if (res.ok) {
                this.showStatus('Saved successfully!', 'success');
                this.loadConfig(); // Refresh raw caddyfile
            } else {
                this.showStatus('Failed to save config.', 'danger');
            }
        } catch (e) {
            this.showStatus('Error: ' + e.message, 'danger');
        }
    },

    validateConfig: async function() {
        try {
            const res = await fetch('/api/validate', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const data = await res.json();
            if (res.ok && !data.error) {
                this.showStatus('Configuration is valid!\n\n' + data.output, 'success');
            } else {
                this.showStatus('Validation failed!\n\n' + (data.error || '') + '\n' + (data.output || ''), 'danger');
            }
        } catch (e) {
            this.showStatus('Error: ' + e.message, 'danger');
        }
    },

    showStatus: function(msg, type) {
        const box = $('#globalStatus');
        box.text(msg).removeClass('text-success text-danger').addClass('text-' + type).fadeIn();
        setTimeout(() => box.fadeOut(), 5000);
    },

    control: async function(action) {
        try {
            const res = await fetch('/api/' + action, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const data = await res.json();
            let msg = data.output || "Success";
            if (data.error) msg += "\nError: " + data.error;
            $('#controlStatus').text(msg).show();
        } catch (e) {
            $('#controlStatus').text("Error: " + e.message).show();
        }
    },

    fetchStats: async function() {
        try {
            const res = await fetch('/api/stats');
            const text = await res.text();
            $('#statsOutput').text(text);
        } catch (e) {
             $('#statsOutput').text("Error fetching stats. Is Caddy running with metrics enabled?");
        }
    },

    loadCerts: async function() {
        try {
            const res = await fetch('/api/certs');
            if (res.ok) {
                this.certs = await res.json();
                this.ui.renderCerts();
            }
        } catch (e) {
            console.error("Failed to load certs", e);
        }
    },

    uploadCert: async function() {
        const fileInput = document.getElementById('certUploadInput');
        if (!fileInput.files.length) return;
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const res = await fetch('/api/certs', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: formData });
            if (res.ok) {
                $('#certUploadStatus').text("File uploaded successfully!").show();
                fileInput.value = "";
                this.loadCerts();
            } else {
                $('#certUploadStatus').text("Upload failed.").show();
            }
        } catch (e) {
             $('#certUploadStatus').text("Error: " + e.message).show();
        }
    },

    deleteCert: async function(filename) {
        if (!confirm(`Delete ${filename}?`)) return;
        try {
            const res = await fetch(`/api/certs?file=${encodeURIComponent(filename)}`, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            if (res.ok) {
                this.loadCerts();
            } else {
                alert("Failed to delete cert.");
            }
        } catch (e) {
            alert("Error: " + e.message);
        }
    },

    // --- 2FA Management ---
    check2faStatus: async function() {
        try {
            const res = await fetch('/api/2fa/status');
            const data = await res.json();
            const badge = $('#2faStatusBadge');
            if (data.enabled) {
                badge.text('Enabled').removeClass('bg-secondary bg-danger').addClass('bg-success');
                $('#2faSetupArea').hide();
                $('#2faDisableArea').show();
            } else {
                badge.text('Disabled').removeClass('bg-secondary bg-success').addClass('bg-danger');
                $('#2faDisableArea').hide();
                this.generate2fa();
            }
        } catch(e) { console.error(e); }
    },
    generate2fa: async function() {
        try {
            const res = await fetch('/api/2fa/generate', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const data = await res.json();
            $('#2faQrCode').attr('src', data.qrCodeUrl);
            $('#2faVerifySecret').val(data.secret);
            $('#2faSetupArea').show();
        } catch(e) { console.error(e); }
    },
    verify2fa: async function() {
        const token = $('#2faVerifyToken').val();
        const secret = $('#2faVerifySecret').val();
        try {
            const res = await fetch('/api/2fa/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ token, secret })
            });
            if (res.ok) {
                alert('2FA Enabled successfully!');
                this.check2faStatus();
            } else {
                alert('Invalid Code.');
            }
        } catch(e) { console.error(e); }
    },
    disable2fa: async function() {
        if (!confirm('Are you sure you want to disable 2FA?')) return;
        try {
            const res = await fetch('/api/2fa/disable', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            if (res.ok) {
                this.check2faStatus();
            }
        } catch(e) { console.error(e); }
    },

    // --- Logs Management ---
    fetchLogFiles: async function() {
        try {
            const res = await fetch('/api/logs/files');
            if (res.ok) {
                const files = await res.json();
                const select = $('#logFileSelect').empty();
                files.forEach(f => select.append(new Option(f, f)));
            }
        } catch (e) {
            console.error("Failed to load log files", e);
        }
    },

    startTailing: function() {
        const file = $('#logFileSelect').val();
        if (!file) return;

        this.stopTailing(); // Ensure previous is closed
        $('#logOutputArea').empty();
        $('#startTailBtn').hide();
        $('#stopTailBtn').show();

        this.logStreamSource = new EventSource(`/api/logs/stream?file=${encodeURIComponent(file)}`);

        this.logStreamSource.onmessage = (event) => {
            const lineStr = event.data;
            let lineData = null;
            let isJson = false;

            try {
                lineData = JSON.parse(lineStr);
                isJson = true;
            } catch (e) {
                // Not JSON, just plain text line
            }

            if (this.passesLogFilters(lineStr, lineData)) {
                this.appendLogLine(lineStr, lineData, isJson);
            }
        };

        this.logStreamSource.onerror = (err) => {
            console.error("EventSource failed:", err);
            this.stopTailing();
        };
    },

    stopTailing: function() {
        if (this.logStreamSource) {
            this.logStreamSource.close();
            this.logStreamSource = null;
        }
        $('#startTailBtn').show();
        $('#stopTailBtn').hide();
    },

    clearLogs: function() {
        $('#logOutputArea').empty();
    },

    passesLogFilters: function(lineStr, lineData) {
        const fLevel = $('#logFilterLevel').val().toLowerCase();
        const fStatus = $('#logFilterStatus').val().toLowerCase();
        const fMethod = $('#logFilterMethod').val().toUpperCase();
        const fIp = $('#logFilterIp').val().toLowerCase();
        const fPath = $('#logFilterPath').val().toLowerCase();
        const fText = $('#logFilterText').val().toLowerCase();

        if (fText && !lineStr.toLowerCase().includes(fText)) return false;

        if (lineData) {
            if (fLevel && lineData.level && lineData.level.toLowerCase() !== fLevel) return false;

            const req = lineData.request;
            if (req) {
                 if (fMethod && req.method && req.method.toUpperCase() !== fMethod) return false;
                 if (fIp && req.remote_ip && !req.remote_ip.toLowerCase().includes(fIp)) return false;
                 if (fPath && req.uri && !req.uri.toLowerCase().includes(fPath)) return false;
            }

            if (fStatus && lineData.status !== undefined) {
                 const statStr = String(lineData.status);
                 // Handle 5xx, 4xx filters
                 if (fStatus.endsWith('xx')) {
                      if (!statStr.startsWith(fStatus.charAt(0))) return false;
                 } else {
                      if (statStr !== fStatus) return false;
                 }
            }
        }

        return true;
    },

    escapeHtml: function(unsafe) {
        return (unsafe || '').toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    },

    appendLogLine: function(lineStr, lineData, isJson) {
        const area = $('#logOutputArea');
        const div = $('<div>').addClass('log-line').css('border-bottom', '1px solid #444').css('padding', '2px 0');

        // Store data on the element so we can re-filter the DOM later if needed
        div.attr('data-raw', lineStr);
        if (isJson) {
             div.attr('data-json', JSON.stringify(lineData));

             // Format JSON nicely
             const levelColor = lineData.level === 'error' ? '#ff4444' : lineData.level === 'warn' ? '#ffbb33' : '#00C851';
             const time = lineData.ts ? new Date(lineData.ts * 1000).toLocaleString() : '';

             let reqStr = '';
             if (lineData.request) {
                 reqStr = ` <span style="color:#33b5e5">${this.escapeHtml(lineData.request.method)}</span> ${this.escapeHtml(lineData.request.uri)} [${this.escapeHtml(lineData.request.remote_ip)}]`;
             }
             let statusStr = lineData.status !== undefined ? ` <span style="color:#ffbb33">Status: ${this.escapeHtml(lineData.status)}</span>` : '';

             div.html(`<strong style="color:${levelColor}">[${this.escapeHtml(lineData.level)}]</strong> <span class="text-muted">${this.escapeHtml(time)}</span> ${this.escapeHtml(lineData.msg)}${reqStr}${statusStr}`);
        } else {
             div.text(lineStr);
        }

        area.append(div);

        // Auto-scroll to bottom
        area.scrollTop(area[0].scrollHeight);

        // Keep DOM from getting too large
        if (area.children().length > 1000) {
            area.children().first().remove();
        }
    },

    applyLogFiltersToDOM: function() {
        $('#logOutputArea .log-line').each(function() {
             const div = $(this);
             const raw = div.attr('data-raw');
             const jsonStr = div.attr('data-json');
             let data = null;
             if (jsonStr) {
                 try { data = JSON.parse(jsonStr); } catch(e){}
             }

             if (app.passesLogFilters(raw, data)) {
                 div.show();
             } else {
                 div.hide();
             }
        });
    },

    // --- Data Management ---
    duplicateItem: function(type, id) {
        const item = this.config[type].find(i => i.id === id);
        if (!item) return;

        const clone = JSON.parse(JSON.stringify(item));
        clone.id = uuidv4();
        if (clone.description) {
            clone.description = clone.description + " (Copy)";
        } else {
            clone.description = "Copy";
        }

        this.config[type].push(clone);
        this.ui.renderAll();
    },

    deleteItem: function(type, id) {
        if (confirm('Are you sure you want to delete this item?')) {
            if (type === 'domains') {
                const subdomainsToDelete = this.config.subdomains.filter(s => s.reverse === id).map(s => s.id);
                this.config.domains = this.config.domains.filter(d => d.id !== id);
                this.config.subdomains = this.config.subdomains.filter(s => s.reverse !== id);
                this.config.handlers = this.config.handlers.filter(h => h.reverse !== id && !subdomainsToDelete.includes(h.subdomain));
            } else if (type === 'subdomains') {
                this.config.subdomains = this.config.subdomains.filter(s => s.id !== id);
                this.config.handlers = this.config.handlers.filter(h => h.subdomain !== id);
            } else {
                this.config[type] = this.config[type].filter(item => item.id !== id);
            }
            this.ui.renderAll();
        }
    },

    ui: {
        renderAll: function() {
            // General
            $('#genEnabled').prop('checked', app.config.general.enabled);
            $('#genEnableLayer4').prop('checked', app.config.general.enable_layer4);
            $('#genHttpPort').val(app.config.general.http_port);
            $('#genHttpsPort').val(app.config.general.https_port);
            $('#genLogLevel').val(app.config.general.log_level);
            $('#genTlsEmail').val(app.config.general.tls_email);
            $('#genAutoHttps').val(app.config.general.auto_https);
            $('#genHttpVersions').val(app.config.general.http_versions);
            $('#genTOutReadBody').val(app.config.general.timeout_read_body);
            $('#genTOutReadHeader').val(app.config.general.timeout_read_header);
            $('#genTOutWrite').val(app.config.general.timeout_write);
            $('#genTOutIdle').val(app.config.general.timeout_idle);
            $('#genLogCreds').prop('checked', app.config.general.log_credentials);
            $('#genLogRollSize').val(app.config.general.log_roll_size_mb);
            $('#genLogRollKeep').val(app.config.general.log_roll_keep);

            this.renderTable('domains', 'domainsTable', ['enabled', 'fromDomain', 'fromPort', 'description']);
            this.renderTable('subdomains', 'subdomainsTable', ['enabled', 'fromDomain', 'reverse', 'description']);
            this.renderTable('handlers', 'handlersTable', ['enabled', 'reverse', 'handlePath', 'toDomain', 'description']);
            this.renderTable('accessLists', 'accessListsTable', ['accesslistName', 'clientIps', 'invert', 'description']);
            this.renderTable('basicAuths', 'basicAuthsTable', ['basicauthuser', 'description']);
            this.renderTable('headers', 'headersTable', ['headerUpDown', 'headerType', 'headerValue', 'description']);
            this.renderTable('layer4', 'layer4Table', ['enabled', 'sequence', 'matchers', 'fromPort', 'toDomain', 'description']);

            this.populateSelects();
        },

        renderTable: function(configKey, tableId, cols) {
            const tbody = $(`#${tableId} tbody`).empty();

            // Optimization: Create lookup maps for O(1) resolution instead of O(N) array finds
            let domainMap = null;
            let subdomainMap = null;
            if (configKey === 'handlers' || configKey === 'subdomains') {
                domainMap = {};
                (app.config.domains || []).forEach(d => domainMap[d.id] = d);
            }
            if (configKey === 'handlers') {
                subdomainMap = {};
                (app.config.subdomains || []).forEach(s => subdomainMap[s.id] = s);
            }

            // Optimization: Batch DOM appends to prevent layout thrashing
            const rows = [];
            (app.config[configKey] || []).forEach(item => {
                let tr = $('<tr>');
                cols.forEach(col => {
                    let val = item[col];
                    if (col === 'enabled' || col === 'invert') val = val ? 'Yes' : 'No';
                    if (Array.isArray(val)) val = val.join(', ');
                    if (col === 'reverse' && configKey === 'handlers') {
                        // resolve domain name
                        const dom = domainMap[item.reverse];
                        const sub = subdomainMap[item.subdomain];
                        val = dom ? dom.fromDomain : '';
                        if (sub) val = sub.fromDomain + '.' + val;
                    } else if (col === 'reverse' && configKey === 'subdomains') {
                         const dom = domainMap[item.reverse];
                         val = dom ? dom.fromDomain : '';
                    }

                    tr.append($('<td>').text(val || ''));
                });

                let actions = $('<td>').addClass('action-btns');
                let editBtn = $('<button>').addClass('btn btn-sm btn-outline-primary').text('Edit').click(() => this.editItem(configKey, item.id));

                let dupBtn = null;
                if (['domains', 'subdomains', 'handlers'].includes(configKey)) {
                    dupBtn = $('<button>').addClass('btn btn-sm btn-outline-info').text('Dup').click(() => app.duplicateItem(configKey, item.id));
                }

                let delBtn = $('<button>').addClass('btn btn-sm btn-outline-danger').text('Del').click(() => app.deleteItem(configKey, item.id));

                if (dupBtn) {
                    tr.append(actions.append(editBtn, dupBtn, delBtn));
                } else {
                    tr.append(actions.append(editBtn, delBtn));
                }

                rows.push(tr);
            });
            tbody.append(rows);
        },

        renderCerts: function() {
            const list = $('#certsList').empty();
            (app.certs || []).forEach(c => {
                let li = $('<li>').addClass('list-group-item d-flex justify-content-between align-items-center').text(c);
                let btn = $('<button>').addClass('btn btn-sm btn-danger').text('Delete').click(() => app.deleteCert(c));
                list.append(li.append(btn));
            });
            this.populateSelects();
        },

        populateSelects: function() {
            // Update multi-selects in modals
            const alSelects = $('.al-select').empty();
            app.config.accessLists.forEach(al => alSelects.append(new Option(al.accesslistName, al.id)));

            const baSelects = $('.ba-select').empty();
            app.config.basicAuths.forEach(ba => baSelects.append(new Option(ba.basicauthuser, ba.id)));

            const headerSelects = $('.header-select').empty();
            app.config.headers.forEach(h => headerSelects.append(new Option(h.headerType + " (" + h.headerUpDown + ")", h.id)));

            const certSelects = $('.cert-select').empty().append(new Option("Auto HTTPS / Internal", ""));
            (app.certs || []).filter(c => c.endsWith('.pem')).forEach(c => certSelects.append(new Option(c, c)));

            // Handlers and Subdomains need Domain selects
            const domainSelects = $('.domain-select').empty().append(new Option("Select Domain", ""));
            app.config.domains.forEach(d => domainSelects.append(new Option(d.fromDomain, d.id)));

            const subDomainSelects = $('.subdomain-select').empty().append(new Option("None / Match All", ""));
            app.config.subdomains.forEach(s => subDomainSelects.append(new Option(s.fromDomain, s.id)));
        },

        openModal: function(modalId, item = null) {
            if (modalId === '2faModal') {
                app.check2faStatus();
                const modal = new bootstrap.Modal(document.getElementById(modalId));
                modal.show();
                return;
            }

            const form = document.getElementById(modalId + 'Form');
            if (form) form.reset();

            $(`#${modalId} input[type="checkbox"]`).prop('checked', false);

            if (item) {
                $(`#${modalId} .modal-title`).text('Edit Item');
                // Auto-fill form
                Object.keys(item).forEach(key => {
                    const el = $(`#${modalId} [name="${key}"]`);
                    if (el.length) {
                        if (el.attr('type') === 'checkbox') {
                            el.prop('checked', item[key]);
                        } else if (el.prop('multiple')) {
                            el.val(item[key]);
                        } else if (Array.isArray(item[key])) {
                             el.val(item[key].join(', '));
                        } else {
                            el.val(item[key]);
                        }
                    }
                });
                $(`#${modalId}`).data('edit-id', item.id);
            } else {
                $(`#${modalId} .modal-title`).text('Add Item');
                $(`#${modalId}`).removeData('edit-id');
            }

            const modal = new bootstrap.Modal(document.getElementById(modalId));
            modal.show();

            // Trigger change events to update dynamic UI fields
            if (modalId === 'handlerModal') {
                $('#h_hd').trigger('change');
            }
        },

        editItem: function(configKey, id) {
            const item = app.config[configKey].find(i => i.id === id);
            if (!item) return;
            // Map configKey to modalId
            const modalMap = {
                'domains': 'domainModal',
                'subdomains': 'subdomainModal',
                'handlers': 'handlerModal',
                'accessLists': 'accessListModal',
                'basicAuths': 'basicAuthModal',
                'headers': 'headerModal',
                'layer4': 'layer4Modal'
            };
            this.openModal(modalMap[configKey], item);
        },

        saveModal: function(modalId, configKey) {
            const form = document.getElementById(modalId + 'Form');
            const data = new FormData(form);
            const obj = {};

            // Handle checkboxes manually as FormData doesn't include unchecked boxes
            $(`#${modalId}Form input[type="checkbox"]`).each(function() {
                obj[this.name] = $(this).is(':checked');
            });

            for (let [key, value] of data.entries()) {
                 const el = $(`#${modalId}Form [name="${key}"]`);
                 if (el.prop('multiple')) {
                      obj[key] = el.val() || [];
                 } else if (el.hasClass('array-input')) {
                      obj[key] = value.split(',').map(s => s.trim()).filter(s => s);
                 } else if (el.attr('type') !== 'checkbox') {
                      // Number cast if needed
                      if (el.attr('type') === 'number') {
                          obj[key] = parseInt(value) || 0;
                      } else {
                          obj[key] = value;
                      }
                 }
            }

            const editId = $(`#${modalId}`).data('edit-id');
            if (editId) {
                const idx = app.config[configKey].findIndex(i => i.id === editId);
                obj.id = editId;
                app.config[configKey][idx] = Object.assign(app.config[configKey][idx], obj);
            } else {
                obj.id = uuidv4();
                app.config[configKey].push(obj);
            }

            bootstrap.Modal.getInstance(document.getElementById(modalId)).hide();
            this.renderAll();
        },

        initModals: function() {
            const modalHTML = `
                <!-- Domain Modal -->
                <div class="modal fade" id="domainModal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Domain</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="domainModalForm">
                        <div class="mb-2"><input type="checkbox" name="enabled" id="d_en"> <label for="d_en">Enabled</label></div>
                        <div class="mb-2"><label for="d_fd">Domain</label><input type="text" id="d_fd" name="fromDomain" class="form-control" required placeholder="example.com"></div>
                        <div class="mb-2"><label for="d_fp">Port (Empty for default)</label><input type="text" id="d_fp" name="fromPort" class="form-control"></div>
                        <div class="mb-2"><label for="d_desc">Description</label><input type="text" id="d_desc" name="description" class="form-control"></div>
                        <div class="mb-2"><input type="checkbox" name="accessLog" id="d_al"> <label for="d_al">Enable Access Log</label></div>
                        <div class="mb-2"><input type="checkbox" name="disableTls" id="d_dtls"> <label for="d_dtls">Disable TLS (HTTP only)</label></div>
                        <div class="mb-2"><label for="d_cc">Custom Certificate</label><select id="d_cc" name="customCert" class="form-select cert-select"></select></div>
                        <div class="mb-2"><label for="d_cam">Client Auth Mode</label><select id="d_cam" name="client_auth_mode" class="form-select"><option value="">None</option><option value="request">request</option><option value="require">require</option><option value="verify_if_given">verify_if_given</option><option value="require_and_verify">require_and_verify</option></select></div>
                        <div class="mb-2"><label for="d_catp">Client Auth Trust Pool (CA Cert)</label><select id="d_catp" name="client_auth_trust_pool" class="form-select cert-select"></select></div>
                        <div class="mb-2"><label for="d_ac">Access Lists</label><select id="d_ac" name="accesslist" class="form-select al-select" multiple></select></div>
                        <div class="mb-2"><label for="d_ba">Basic Auth</label><select id="d_ba" name="basicauth" class="form-select ba-select" multiple></select></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('domainModal', 'domains')">Save</button></div>
                  </div></div>
                </div>

                <!-- Subdomain Modal -->
                <div class="modal fade" id="subdomainModal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Subdomain</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="subdomainModalForm">
                        <div class="mb-2"><input type="checkbox" name="enabled" id="sd_en"> <label for="sd_en">Enabled</label></div>
                        <div class="mb-2"><label for="sd_fd">Subdomain (e.g. 'api' for api.example.com)</label><input type="text" id="sd_fd" name="fromDomain" class="form-control" required></div>
                        <div class="mb-2"><label for="sd_rev">Parent Domain</label><select id="sd_rev" name="reverse" class="form-select domain-select" required></select></div>
                        <div class="mb-2"><label for="sd_desc">Description</label><input type="text" id="sd_desc" name="description" class="form-control"></div>
                        <div class="mb-2"><label for="sd_cam">Client Auth Mode</label><select id="sd_cam" name="client_auth_mode" class="form-select"><option value="">None</option><option value="request">request</option><option value="require">require</option><option value="verify_if_given">verify_if_given</option><option value="require_and_verify">require_and_verify</option></select></div>
                        <div class="mb-2"><label for="sd_catp">Client Auth Trust Pool (CA Cert)</label><select id="sd_catp" name="client_auth_trust_pool" class="form-select cert-select"></select></div>
                        <div class="mb-2"><label for="sd_ac">Access Lists</label><select id="sd_ac" name="accesslist" class="form-select al-select" multiple></select></div>
                        <div class="mb-2"><label for="sd_ba">Basic Auth</label><select id="sd_ba" name="basicauth" class="form-select ba-select" multiple></select></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('subdomainModal', 'subdomains')">Save</button></div>
                  </div></div>
                </div>

                <!-- Handler Modal -->

                <!-- Handler Modal -->
                <div class="modal fade" id="handlerModal" tabindex="-1">
                  <div class="modal-dialog modal-lg"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Handler</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="handlerModalForm">

                        <ul class="nav nav-tabs mb-3" id="handlerTabs" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="h-general-tab" data-bs-toggle="tab" data-bs-target="#h-general" type="button" role="tab">General</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link directive-rp" id="h-upstream-tab" data-bs-toggle="tab" data-bs-target="#h-upstream" type="button" role="tab">Upstream</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link directive-rp" id="h-health-tab" data-bs-toggle="tab" data-bs-target="#h-health" type="button" role="tab">Health Checks</button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link directive-rp" id="h-access-tab" data-bs-toggle="tab" data-bs-target="#h-access" type="button" role="tab">Access & Headers</button>
                            </li>
                        </ul>

                        <div class="tab-content" id="handlerTabsContent">
                            <!-- General Tab -->
                            <div class="tab-pane fade show active" id="h-general" role="tabpanel">
                                <div class="mb-2"><input type="checkbox" name="enabled" id="h_en"> <label for="h_en">Enabled</label></div>
                                <div class="mb-2"><label for="h_rev">Domain</label><select id="h_rev" name="reverse" class="form-select domain-select" required></select></div>
                                <div class="mb-2"><label for="h_sub">Subdomain Filter</label><select id="h_sub" name="subdomain" class="form-select subdomain-select"></select></div>
                                <div class="mb-2"><label for="h_ht">Handle Type</label><select id="h_ht" name="handleType" class="form-select"><option value="handle">Handle</option><option value="handle_path">Handle Path (Strips prefix)</option></select></div>
                                <div class="mb-2"><label for="h_hp">Path Matcher (e.g. /api/*)</label><input type="text" id="h_hp" name="handlePath" class="form-control"></div>
                                <div class="mb-2"><label for="h_hd">Directive</label><select id="h_hd" name="handleDirective" class="form-select" onchange="if (this.value === 'reverse_proxy') { $('.directive-rp').show(); } else { $('.directive-rp').hide(); } $('.directive-redir').toggle(this.value === 'redir'); if (this.value === 'redir') { $('#h-general-tab').tab('show'); }"><option value="reverse_proxy">Reverse Proxy</option><option value="redir">Redirect</option></select></div>
                                <div class="mb-2"><label for="h_desc">Description</label><input type="text" id="h_desc" name="description" class="form-control"></div>
                                <div class="mb-2 directive-redir"><label for="h_rstat">Redirect Status Code</label><input type="text" id="h_rstat" name="redir_status" class="form-control" placeholder="301"></div>
                            </div>

                            <!-- Upstream Tab -->
                            <div class="tab-pane fade" id="h-upstream" role="tabpanel">
                                <div class="mb-2"><label for="h_td">Upstream Domains/IPs (comma separated)</label><input type="text" id="h_td" name="toDomain" class="form-control array-input"></div>
                                <div class="mb-2"><label for="h_tp">Upstream Port</label><input type="text" id="h_tp" name="toPort" class="form-control"></div>
                                <div class="mb-2"><input type="checkbox" name="httpTls" id="h_tls"> <label for="h_tls">Upstream TLS (HTTPS)</label></div>
                                <div class="mb-2"><input type="checkbox" name="http_tls_insecure_skip_verify" id="h_tls_skip"> <label for="h_tls_skip">Insecure Skip TLS Verify</label></div>
                                <div class="mb-2"><label for="h_tls_sni">Upstream TLS Server Name (SNI)</label><input type="text" id="h_tls_sni" name="http_tls_server_name" class="form-control"></div>
                                <div class="mb-2"><label for="h_tls_ca">Upstream TLS Trusted CA Cert</label><select id="h_tls_ca" name="http_tls_trusted_ca_certs" class="form-select cert-select"></select></div>
                                <div class="mb-2"><label for="h_hver">HTTP Versions (e.g. h1, h2, h3)</label><input type="text" id="h_hver" name="http_version" class="form-control"></div>
                                <div class="mb-2"><label for="h_hka">HTTP Keepalive (seconds)</label><input type="number" id="h_hka" name="http_keepalive" class="form-control"></div>
                                <div class="mb-2"><input type="checkbox" name="ntlm" id="h_ntlm"> <label for="h_ntlm">NTLM Transport</label></div>
                                <div class="mb-2"><label for="h_lb">LB Policy</label><select id="h_lb" name="lb_policy" class="form-select"><option value="">Default (Random/RoundRobin)</option><option value="round_robin">Round Robin</option><option value="ip_hash">IP Hash</option><option value="least_conn">Least Conn</option><option value="client_ip_hash">Client IP Hash</option></select></div>
                            </div>

                            <!-- Health Checks Tab -->
                            <div class="tab-pane fade" id="h-health" role="tabpanel">
                                <div class="mb-3">
                                    <h6>Active Health Checks</h6>
                                    <div class="mb-2"><label for="h_hu">Health URI <i class="text-muted" style="font-size:0.9em;">(?) The URI for active health checks.</i></label><input type="text" id="h_hu" name="health_uri" class="form-control" placeholder="/health"></div>
                                    <div class="mb-2"><label for="h_hp_h">Health Port <i class="text-muted" style="font-size:0.9em;">(?) The port for active health checks.</i></label><input type="text" id="h_hp_h" name="health_port" class="form-control" placeholder="80"></div>
                                    <div class="mb-2"><label for="h_hi">Health Interval <i class="text-muted" style="font-size:0.9em;">(?) The interval between active health checks.</i></label><input type="text" id="h_hi" name="health_interval" class="form-control" placeholder="30s"></div>
                                    <div class="mb-2"><label for="h_hto">Health Timeout <i class="text-muted" style="font-size:0.9em;">(?) The timeout for active health checks.</i></label><input type="text" id="h_hto" name="health_timeout" class="form-control" placeholder="5s"></div>
                                    <div class="mb-2"><label for="h_hs">Health Status <i class="text-muted" style="font-size:0.9em;">(?) Expected HTTP status code (e.g. 200).</i></label><input type="text" id="h_hs" name="health_status" class="form-control" placeholder="2xx"></div>
                                    <div class="mb-2"><label for="h_hb">Health Body <i class="text-muted" style="font-size:0.9em;">(?) Expected text in the response body.</i></label><input type="text" id="h_hb" name="health_body" class="form-control" placeholder="OK"></div>
                                    <div class="mb-2"><label for="h_hp_passes">Health Passes <i class="text-muted" style="font-size:0.9em;">(?) Number of passes to consider healthy.</i></label><input type="number" id="h_hp_passes" name="health_passes" class="form-control"></div>
                                    <div class="mb-2"><label for="h_hp_fails">Health Fails <i class="text-muted" style="font-size:0.9em;">(?) Number of failures to consider unhealthy.</i></label><input type="number" id="h_hp_fails" name="health_fails" class="form-control"></div>
                                    <div class="mb-2"><input type="checkbox" name="health_follow_redirects" id="h_hfr"> <label for="h_hfr">Follow Redirects <i class="text-muted" style="font-size:0.9em;">(?) Follow HTTP redirects during health checks.</i></label></div>
                                </div>

                                <div class="mb-3 mt-3 border-top pt-3">
                                    <h6>Passive Health Checks</h6>
                                    <div class="mb-2"><label for="h_hfd">Fail Duration <i class="text-muted" style="font-size:0.9em;">(?) How long to remember a failure.</i></label><input type="text" id="h_hfd" name="passive_health_fail_duration" class="form-control" placeholder="10s"></div>
                                    <div class="mb-2"><label for="h_hmf">Max Fails <i class="text-muted" style="font-size:0.9em;">(?) Number of fails to consider a host down.</i></label><input type="number" id="h_hmf" name="passive_health_max_fails" class="form-control" placeholder="1"></div>
                                    <div class="mb-2"><label for="h_hus">Unhealthy Status <i class="text-muted" style="font-size:0.9em;">(?) HTTP status code that implies failure (e.g. 5xx).</i></label><input type="text" id="h_hus" name="passive_health_unhealthy_status" class="form-control" placeholder="5xx"></div>
                                    <div class="mb-2"><label for="h_hul">Unhealthy Latency <i class="text-muted" style="font-size:0.9em;">(?) Latency that implies failure (e.g. 5s).</i></label><input type="text" id="h_hul" name="passive_health_unhealthy_latency" class="form-control" placeholder="5s"></div>
                                    <div class="mb-2"><label for="h_hurc">Unhealthy Request Count <i class="text-muted" style="font-size:0.9em;">(?) Request count that implies failure.</i></label><input type="number" id="h_hurc" name="passive_health_unhealthy_request_count" class="form-control"></div>
                                </div>
                            </div>

                            <!-- Access & Headers Tab -->
                            <div class="tab-pane fade" id="h-access" role="tabpanel">
                                <div class="mb-2"><label for="h_al">Access Lists</label><select id="h_al" name="accesslist" class="form-select al-select" multiple></select></div>
                                <div class="mb-2"><label for="h_head">Headers</label><select id="h_head" name="header" class="form-select header-select" multiple></select></div>
                            </div>
                        </div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('handlerModal', 'handlers')">Save</button></div>
                  </div></div>
                </div>


                <!-- Access List Modal -->
                <div class="modal fade" id="accessListModal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Access List</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="accessListModalForm">
                        <div class="mb-2"><label for="al_name">Name</label><input type="text" id="al_name" name="accesslistName" class="form-control" required></div>
                        <div class="mb-2"><label for="al_match">Request Matcher</label><select id="al_match" name="request_matcher" class="form-select"><option value="client_ip">Client IP</option><option value="remote_ip">Remote IP</option></select></div>
                        <div class="mb-2"><label for="al_ips">Client IPs (comma separated CIDR)</label><input type="text" id="al_ips" name="clientIps" class="form-control array-input" required></div>
                        <div class="mb-2"><input type="checkbox" name="invert" id="al_inv"> <label for="al_inv">Invert (Block these IPs)</label></div>
                        <div class="mb-2"><label for="al_rc">Custom HTTP Response Code (e.g. 403)</label><input type="text" id="al_rc" name="http_response_code" class="form-control"></div>
                        <div class="mb-2"><label for="al_rm">Custom HTTP Response Message</label><input type="text" id="al_rm" name="http_response_message" class="form-control"></div>
                        <div class="mb-2"><label for="al_desc">Description</label><input type="text" id="al_desc" name="description" class="form-control"></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('accessListModal', 'accessLists')">Save</button></div>
                  </div></div>
                </div>

                <!-- Basic Auth Modal -->
                <div class="modal fade" id="basicAuthModal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Basic Auth</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="basicAuthModalForm">
                        <div class="mb-2"><label for="ba_user">Username</label><input type="text" id="ba_user" name="basicauthuser" class="form-control" required></div>
                        <div class="mb-2"><label for="ba_pass">Password (BCrypt Hash in Caddyfile)</label><input type="password" id="ba_pass" name="basicauthpass" class="form-control" required></div>
                        <div class="mb-2"><label for="ba_desc">Description</label><input type="text" id="ba_desc" name="description" class="form-control"></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('basicAuthModal', 'basicAuths')">Save</button></div>
                  </div></div>
                </div>

                <!-- Header Modal -->
                <div class="modal fade" id="headerModal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Header</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="headerModalForm">
                        <div class="mb-2"><label for="hd_dir">Direction</label><select id="hd_dir" name="headerUpDown" class="form-select"><option value="header_up">Request (Up)</option><option value="header_down">Response (Down)</option></select></div>
                        <div class="mb-2"><label for="hd_name">Header Name</label><input type="text" id="hd_name" name="headerType" class="form-control" required placeholder="X-Forwarded-For"></div>
                        <div class="mb-2"><label for="hd_val">Value (Leave empty to delete)</label><input type="text" id="hd_val" name="headerValue" class="form-control"></div>
                        <div class="mb-2"><label for="hd_desc">Description</label><input type="text" id="hd_desc" name="description" class="form-control"></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('headerModal', 'headers')">Save</button></div>
                  </div></div>
                </div>

                <!-- Layer 4 Modal -->
                <div class="modal fade" id="layer4Modal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Layer 4 Route</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="layer4ModalForm">
                        <div class="mb-2"><input type="checkbox" name="enabled" id="l4_en"> <label for="l4_en">Enabled</label></div>
                        <div class="mb-2"><label for="l4_seq">Sequence (Priority)</label><input type="text" id="l4_seq" name="sequence" class="form-control"></div>
                        <div class="mb-2"><label for="l4_match">Matchers (e.g. tlssni, http, any)</label><input type="text" id="l4_match" name="matchers" class="form-control" value="any"></div>
                        <div class="mb-2"><label for="l4_fd">Listen Domains/IPs (comma separated)</label><input type="text" id="l4_fd" name="fromDomain" class="form-control array-input"></div>
                        <div class="mb-2"><label for="l4_fp">Listen Port</label><input type="text" id="l4_fp" name="fromPort" class="form-control" required placeholder="443"></div>
                        <div class="mb-2"><label for="l4_td">Upstream IPs/Domains (comma separated)</label><input type="text" id="l4_td" name="toDomain" class="form-control array-input" required></div>
                        <div class="mb-2"><label for="l4_tp">Upstream Port</label><input type="text" id="l4_tp" name="toPort" class="form-control" required></div>
                        <div class="mb-2"><label for="l4_lb">LB Policy</label><select id="l4_lb" name="lb_policy" class="form-select"><option value="">Default (Random)</option><option value="round_robin">Round Robin</option><option value="ip_hash">IP Hash</option><option value="least_conn">Least Conn</option></select></div>
                        <div class="mb-2"><label for="l4_hfd">Passive Health Fail Duration</label><input type="text" id="l4_hfd" name="passive_health_fail_duration" class="form-control"></div>
                        <div class="mb-2"><label for="l4_hmf">Passive Health Max Fails</label><input type="number" id="l4_hmf" name="passive_health_max_fails" class="form-control"></div>
                        <div class="mb-2"><input type="checkbox" name="terminateTls" id="l4_ttls"> <label for="l4_ttls">Terminate TLS</label></div>
                        <div class="mb-2"><label for="l4_otls">Originate TLS to Upstream</label><select id="l4_otls" name="originate_tls" class="form-select"><option value="">Off</option><option value="tls">TLS (Verify)</option><option value="tls_insecure_skip_verify">TLS (Skip Verification)</option></select></div>
                        <div class="mb-2"><label for="l4_pp">Proxy Protocol</label><select id="l4_pp" name="proxyProtocol" class="form-select"><option value="">Off</option><option value="v1">v1</option><option value="v2">v2</option></select></div>
                        <div class="mb-2"><label for="l4_desc">Description</label><input type="text" id="l4_desc" name="description" class="form-control"></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('layer4Modal', 'layer4')">Save</button></div>
                  </div></div>
                </div>
            `;
            $('#modalsContainer').html(modalHTML);
        }
    }
};

$(document).ready(() => app.init());
