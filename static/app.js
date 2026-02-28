// UUID Generator
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const app = {
    config: {
        general: { enabled: false, enable_layer4: false, http_port: "", https_port: "", log_level: "" },
        domains: [],
        subdomains: [],
        handlers: [],
        accessLists: [],
        basicAuths: [],
        headers: [],
        layer4: []
    },
    certs: [],

    init: async function() {
        await this.loadCerts();
        await this.loadConfig();
        this.ui.initModals();
        this.ui.renderAll();
        this.fetchStats();
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

        try {
            const res = await fetch('/api/config/structured', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const res = await fetch('/api/validate', { method: 'POST' });
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
            const res = await fetch('/api/' + action, { method: 'POST' });
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
            const res = await fetch('/api/certs', { method: 'POST', body: formData });
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
            const res = await fetch(`/api/certs?file=${encodeURIComponent(filename)}`, { method: 'DELETE' });
            if (res.ok) {
                this.loadCerts();
            } else {
                alert("Failed to delete cert.");
            }
        } catch (e) {
            alert("Error: " + e.message);
        }
    },

    // --- Data Management ---
    deleteItem: function(type, id) {
        if (confirm('Are you sure you want to delete this item?')) {
            this.config[type] = this.config[type].filter(item => item.id !== id);
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
                let delBtn = $('<button>').addClass('btn btn-sm btn-outline-danger').text('Del').click(() => app.deleteItem(configKey, item.id));
                tr.append(actions.append(editBtn, delBtn));
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
            app.certs.filter(c => c.endsWith('.pem')).forEach(c => certSelects.append(new Option(c, c)));

            // Handlers and Subdomains need Domain selects
            const domainSelects = $('.domain-select').empty().append(new Option("Select Domain", ""));
            app.config.domains.forEach(d => domainSelects.append(new Option(d.fromDomain, d.id)));

            const subDomainSelects = $('.subdomain-select').empty().append(new Option("None / Match All", ""));
            app.config.subdomains.forEach(s => subDomainSelects.append(new Option(s.fromDomain, s.id)));
        },

        openModal: function(modalId, item = null) {
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
                        <div class="mb-2"><label>Domain</label><input type="text" name="fromDomain" class="form-control" required placeholder="example.com"></div>
                        <div class="mb-2"><label>Port (Empty for default)</label><input type="text" name="fromPort" class="form-control"></div>
                        <div class="mb-2"><label>Description</label><input type="text" name="description" class="form-control"></div>
                        <div class="mb-2"><input type="checkbox" name="accessLog" id="d_al"> <label for="d_al">Enable Access Log</label></div>
                        <div class="mb-2"><input type="checkbox" name="disableTls" id="d_dtls"> <label for="d_dtls">Disable TLS (HTTP only)</label></div>
                        <div class="mb-2"><label>Custom Certificate</label><select name="customCert" class="form-select cert-select"></select></div>
                        <div class="mb-2"><label>Access Lists</label><select name="accesslist" class="form-select al-select" multiple></select></div>
                        <div class="mb-2"><label>Basic Auth</label><select name="basicauth" class="form-select ba-select" multiple></select></div>
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
                        <div class="mb-2"><label>Subdomain (e.g. 'api' for api.example.com)</label><input type="text" name="fromDomain" class="form-control" required></div>
                        <div class="mb-2"><label>Parent Domain</label><select name="reverse" class="form-select domain-select" required></select></div>
                        <div class="mb-2"><label>Description</label><input type="text" name="description" class="form-control"></div>
                        <div class="mb-2"><label>Access Lists</label><select name="accesslist" class="form-select al-select" multiple></select></div>
                        <div class="mb-2"><label>Basic Auth</label><select name="basicauth" class="form-select ba-select" multiple></select></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('subdomainModal', 'subdomains')">Save</button></div>
                  </div></div>
                </div>

                <!-- Handler Modal -->
                <div class="modal fade" id="handlerModal" tabindex="-1">
                  <div class="modal-dialog modal-lg"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Handler</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="handlerModalForm">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="mb-2"><input type="checkbox" name="enabled" id="h_en"> <label for="h_en">Enabled</label></div>
                                <div class="mb-2"><label>Domain</label><select name="reverse" class="form-select domain-select" required></select></div>
                                <div class="mb-2"><label>Subdomain Filter</label><select name="subdomain" class="form-select subdomain-select"></select></div>
                                <div class="mb-2"><label>Handle Type</label><select name="handleType" class="form-select"><option value="handle">Handle</option><option value="handle_path">Handle Path (Strips prefix)</option></select></div>
                                <div class="mb-2"><label>Path Matcher (e.g. /api/*)</label><input type="text" name="handlePath" class="form-control"></div>
                                <div class="mb-2"><label>Directive</label><select name="handleDirective" class="form-select"><option value="reverse_proxy">Reverse Proxy</option><option value="redir">Redirect</option></select></div>
                                <div class="mb-2"><label>Description</label><input type="text" name="description" class="form-control"></div>
                            </div>
                            <div class="col-md-6">
                                <div class="mb-2"><label>Upstream Domains/IPs (comma separated)</label><input type="text" name="toDomain" class="form-control array-input"></div>
                                <div class="mb-2"><label>Upstream Port</label><input type="text" name="toPort" class="form-control"></div>
                                <div class="mb-2"><input type="checkbox" name="httpTls" id="h_tls"> <label for="h_tls">Upstream TLS (HTTPS)</label></div>
                                <div class="mb-2"><input type="checkbox" name="ntlm" id="h_ntlm"> <label for="h_ntlm">NTLM Transport</label></div>
                                <div class="mb-2"><label>LB Policy</label><select name="lb_policy" class="form-select"><option value="">Default (Random/RoundRobin)</option><option value="round_robin">Round Robin</option><option value="ip_hash">IP Hash</option></select></div>
                                <div class="mb-2"><label>Access Lists</label><select name="accesslist" class="form-select al-select" multiple></select></div>
                                <div class="mb-2"><label>Headers</label><select name="header" class="form-select header-select" multiple></select></div>
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
                        <div class="mb-2"><label>Name</label><input type="text" name="accesslistName" class="form-control" required></div>
                        <div class="mb-2"><label>Client IPs (comma separated CIDR)</label><input type="text" name="clientIps" class="form-control array-input" required></div>
                        <div class="mb-2"><input type="checkbox" name="invert" id="al_inv"> <label for="al_inv">Invert (Block these IPs)</label></div>
                        <div class="mb-2"><label>Description</label><input type="text" name="description" class="form-control"></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('accessListModal', 'accessLists')">Save</button></div>
                  </div></div>
                </div>

                <!-- Basic Auth Modal -->
                <div class="modal fade" id="basicAuthModal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Basic Auth</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="basicAuthModalForm">
                        <div class="mb-2"><label>Username</label><input type="text" name="basicauthuser" class="form-control" required></div>
                        <div class="mb-2"><label>Password (BCrypt Hash in Caddyfile)</label><input type="password" name="basicauthpass" class="form-control" required></div>
                        <div class="mb-2"><label>Description</label><input type="text" name="description" class="form-control"></div>
                    </form></div>
                    <div class="modal-footer"><button class="btn btn-primary" onclick="app.ui.saveModal('basicAuthModal', 'basicAuths')">Save</button></div>
                  </div></div>
                </div>

                <!-- Header Modal -->
                <div class="modal fade" id="headerModal" tabindex="-1">
                  <div class="modal-dialog"><div class="modal-content">
                    <div class="modal-header"><h5 class="modal-title">Header</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body"><form id="headerModalForm">
                        <div class="mb-2"><label>Direction</label><select name="headerUpDown" class="form-select"><option value="header_up">Request (Up)</option><option value="header_down">Response (Down)</option></select></div>
                        <div class="mb-2"><label>Header Name</label><input type="text" name="headerType" class="form-control" required placeholder="X-Forwarded-For"></div>
                        <div class="mb-2"><label>Value (Leave empty to delete)</label><input type="text" name="headerValue" class="form-control"></div>
                        <div class="mb-2"><label>Description</label><input type="text" name="description" class="form-control"></div>
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
                        <div class="mb-2"><label>Sequence (Priority)</label><input type="text" name="sequence" class="form-control"></div>
                        <div class="mb-2"><label>Matchers (e.g. tlssni, http, any)</label><input type="text" name="matchers" class="form-control" value="any"></div>
                        <div class="mb-2"><label>Listen Domains/IPs (comma separated)</label><input type="text" name="fromDomain" class="form-control array-input"></div>
                        <div class="mb-2"><label>Listen Port</label><input type="text" name="fromPort" class="form-control" required placeholder="443"></div>
                        <div class="mb-2"><label>Upstream IPs/Domains (comma separated)</label><input type="text" name="toDomain" class="form-control array-input" required></div>
                        <div class="mb-2"><label>Upstream Port</label><input type="text" name="toPort" class="form-control" required></div>
                        <div class="mb-2"><input type="checkbox" name="terminateTls" id="l4_ttls"> <label for="l4_ttls">Terminate TLS</label></div>
                        <div class="mb-2"><label>Proxy Protocol</label><select name="proxyProtocol" class="form-select"><option value="">Off</option><option value="v1">v1</option><option value="v2">v2</option></select></div>
                        <div class="mb-2"><label>Description</label><input type="text" name="description" class="form-control"></div>
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
