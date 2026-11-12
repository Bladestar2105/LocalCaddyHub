const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadApp() {
    const fields = new Map();
    const $ = selector => {
        if (!fields.has(selector)) fields.set(selector, {
            value: '', properties: {}, length: 0,
            val(value) { if (!arguments.length) return this.value; this.value = value; return this; },
            prop(key, value) { if (arguments.length === 1) return this.properties[key]; this.properties[key] = value; return this; },
            ready() {}, text() { return this; }, html() { return this; },
            empty() { return this; }, append() { return this; }, show() { return this; }, hide() { return this; },
            removeClass() { return this; }, addClass() { return this; }
        });
        return fields.get(selector);
    };
    const document = { getElementById() { return null; } };
    const context = { window: {}, document, $, console: { error() {} }, setTimeout() {}, fetch() { throw new Error('unexpected request'); } };
    vm.runInNewContext(fs.readFileSync('static/app.js', 'utf8'), context);
    const app = context.window.app;
    app.ui.renderTable = app.ui.populateSelects = app.ui.syncAcmeControls = app.applyI18n = () => {};
    return { app, $, context };
}

test('row rendering preserves unsaved general settings', () => {
    const { app, $ } = loadApp();
    $('#genHttpPort').val('9080');
    app.ui.renderAll();
    assert.equal($('#genHttpPort').val(), '9080');
});

test('deleting a referenced access list cannot silently drop its protection', () => {
    const { app, context } = loadApp();
    context.confirm = () => true;
    app.config.domains = [{ id: 'domain', accesslist: ['management'] }];
    app.config.accessLists = [{ id: 'management', clientIps: ['10.0.0.0/8'] }];
    let reported = false;
    app.showStatus = (message, error) => { reported = error; };
    app.deleteItem('accessLists', 'management');
    assert.equal(app.config.accessLists.length, 1);
    assert.equal(reported, true);
});

test('failed initial config load cannot submit default configuration', async () => {
    const { app, context } = loadApp();
    context.fetch = async () => ({ ok: false, status: 503 });
    app.showStatus = () => {};
    await app.loadConfig();
    let posts = 0;
    context.fetch = async () => { posts++; return { ok: true }; };
    app.collectGeneralConfigFromForm = () => {};
    await app.saveStructuredConfig();
    assert.equal(posts, 0);
});

test('failed RSA configuration leaves the selected certificate key type unchanged', async () => {
    const { app, context, $ } = loadApp();
    app.config.general.tls_key_type = 'p256';
    $('#genTlsKeyType').val('p256');
    context.confirm = () => true;
    context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Caddy unavailable' }) });
    await app.renewAllManagedCertificatesAsRsa();
    assert.equal(app.config.general.tls_key_type, 'p256');
    assert.equal($('#genTlsKeyType').val(), 'p256');
});

test('invalid modal data remains open without mutating configuration', () => {
    const { app, context } = loadApp();
    let reported = false;
    context.document.getElementById = () => ({ checkValidity: () => false, reportValidity() { reported = true; }, querySelector: () => null });
    context.FormData = class { constructor() { throw new Error('invalid form must not be serialized'); } };
    app.ui.saveModal('domainModal', 'domains');
    assert.equal(reported, true);
    assert.equal(app.config.domains.length, 0);
});

test('HTML escaping keeps attacker-controlled log strings inert', () => {
    const { app } = loadApp();
    assert.equal(app.escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('structured log filtering tolerates non-string fields', () => {
    const { app } = loadApp();
    app.logFiltersCache.level = 'error';
    assert.equal(app.passesLogFilters('', '', { level: 5 }), false);
    app.logFiltersCache.level = '';
    app.logFiltersCache.method = 'GET';
    assert.equal(app.passesLogFilters('', '', { request: { method: 5 } }), false);
});

test('log formatting preserves zero and safely formats object values', () => {
    const { app } = loadApp();
    assert.equal(app.escapeHtml(0), '0');
    assert.equal(app.escapeHtml({ toString: '<img onerror=alert(1)>' }), '{&quot;toString&quot;:&quot;&lt;img onerror=alert(1)&gt;&quot;}');
});

test('JSON null log lines use the plain-text renderer', () => {
    const { app, context, $ } = loadApp();
    context.EventSource = class { close() {} };
    $('#logFileSelect').val('access.log');
    let formattedAsJson;
    app.appendLogLine = (line, raw, data, isJson) => { formattedAsJson = isJson; };
    app.startTailing();
    app.logStreamSource.onmessage({ data: 'null' });
    assert.equal(formattedAsJson, false);
});
