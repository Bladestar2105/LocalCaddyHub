const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generateCaddyfile } = require('../src/caddy');

function blockFor(config, address) {
  const start = config.indexOf(`${address} {\n`);
  assert.notStrictEqual(start, -1, `missing site block for ${address}`);

  let depth = 0;
  for (let i = start; i < config.length; i++) {
    if (config[i] === '{') depth++;
    if (config[i] === '}') {
      depth--;
      if (depth === 0) return config.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated site block for ${address}`);
}

describe('generateCaddyfile UI parity', () => {
  test('generates isolated domain and subdomain site blocks', () => {
    const config = generateCaddyfile({
      general: { enabled: true },
      domains: [{
        id: 'd1',
        enabled: true,
        fromDomain: 'example.com',
        acme: true,
        basicauth: ['ba-domain']
      }],
      subdomains: [{
        id: 's1',
        enabled: true,
        reverse: 'd1',
        fromDomain: 'api',
        acme: true,
        accesslist: ['al1'],
        basicauth: ['ba-sub'],
        client_auth_mode: 'require_and_verify',
        client_auth_trust_pool: 'ca.pem'
      }],
      handlers: [{
        id: 'h-domain',
        enabled: true,
        reverse: 'd1',
        handlePath: '/',
        handleDirective: 'reverse_proxy',
        toDomain: ['domain-upstream'],
        toPort: '8080'
      }, {
        id: 'h-sub',
        enabled: true,
        reverse: 'd1',
        subdomain: 's1',
        handlePath: '/api',
        handleType: 'handle_path',
        handleDirective: 'reverse_proxy',
        basicauth: ['ba-sub'],
        toDomain: ['sub-upstream'],
        toPort: '9090'
      }],
      accessLists: [{
        id: 'al1',
        clientIps: ['10.0.0.0/8'],
        request_matcher: 'client_ip',
        http_response_code: '403',
        http_response_message: 'Forbidden'
      }],
      basicAuths: [{
        id: 'ba-domain',
        basicauthuser: 'domain-user',
        basicauthpass: '$2a$14$domain'
      }, {
        id: 'ba-sub',
        basicauthuser: 'sub-user',
        basicauthpass: '$2a$14$sub'
      }]
    }, '/certs');

    const domainBlock = blockFor(config, 'https://example.com:443');
    const subBlock = blockFor(config, 'https://api.example.com:443');

    assert.match(domainBlock, /reverse_proxy domain-upstream:8080/);
    assert.doesNotMatch(domainBlock, /sub-upstream:9090/);
    assert.doesNotMatch(domainBlock, /\ttls (internal|\/certs)/);
    assert.match(domainBlock, /basic_auth \{\n\t\tdomain-user/);

    assert.doesNotMatch(subBlock, /\ttls (internal|\/certs)/);
    assert.match(subBlock, /trust_pool file \/certs\/ca\.pem/);
    assert.match(subBlock, /@al_sub_s1_al1 not client_ip 10\.0\.0\.0\/8/);
    assert.match(subBlock, /respond @al_sub_s1_al1 "Forbidden" 403/);
    assert.match(subBlock, /basic_auth \{\n\t\tdomain-user/);
    assert.match(subBlock, /basic_auth \{\n\t\tsub-user/);
    assert.match(subBlock, /handle_path \/api\/\*/);
    assert.match(subBlock, /reverse_proxy sub-upstream:9090/);
  });

  test('maps UI HTTP versions and writes current trust pool syntax', () => {
    const config = generateCaddyfile({
      general: { enabled: true },
      domains: [{ id: 'd1', enabled: true, fromDomain: 'example.com' }],
      handlers: [{
        id: 'h1',
        enabled: true,
        reverse: 'd1',
        handleDirective: 'reverse_proxy',
        toDomain: ['localhost'],
        toPort: '8443',
        httpTls: true,
        http_tls_trusted_ca_certs: 'ca.pem',
        http_version: 'h1 h2 h3 h2c',
        http_keepalive: 30,
        lb_try_duration: '10.0',
        health_timeout: '2.5',
        passive_health_unhealthy_latency: '1.25',
        to_path: '/internal'
      }]
    }, '/certs');

    assert.match(config, /rewrite \/internal/);
    assert.match(config, /tls_trust_pool file \/certs\/ca\.pem/);
    assert.match(config, /versions 1\.1 2 3 h2c/);
    assert.match(config, /keepalive 30s/);
    assert.match(config, /lb_try_duration 10\.0s/);
    assert.match(config, /health_timeout 2\.5s/);
    assert.match(config, /unhealthy_latency 1\.25s/);
  });

  test('uses Caddy automatic HTTPS for ACME and ignores custom certificates', () => {
    const config = generateCaddyfile({
      general: { enabled: true, tls_email: 'admin@example.com' },
      domains: [{
        id: 'd1',
        enabled: true,
        fromDomain: 'example.com',
        acme: true,
        customCert: 'custom.pem'
      }],
      handlers: []
    }, '/certs');

    const domainBlock = blockFor(config, 'https://example.com:443');

    assert.match(config, /\temail admin@example\.com/);
    assert.doesNotMatch(domainBlock, /\ttls internal/);
    assert.doesNotMatch(domainBlock, /custom\.pem/);
  });

  test('falls back to explicit TLS when automatic certificate management is disabled', () => {
    const config = generateCaddyfile({
      general: { enabled: true, auto_https: 'disable_certs' },
      domains: [{
        id: 'd1',
        enabled: true,
        fromDomain: 'example.com',
        acme: true,
        customCert: 'fallback.pem'
      }],
      handlers: []
    }, '/certs');

    const domainBlock = blockFor(config, 'https://example.com:443');

    assert.match(config, /\tauto_https disable_certs/);
    assert.match(domainBlock, /\ttls \/certs\/fallback\.pem \/certs\/fallback\.key \{/);
  });

  test('does not emit TLS automation for HTTP-only domains', () => {
    const config = generateCaddyfile({
      general: { enabled: true },
      domains: [{
        id: 'd1',
        enabled: true,
        fromDomain: 'example.com',
        disableTls: true,
        acme: true,
        customCert: 'custom.pem'
      }],
      handlers: []
    }, '/certs');

    const domainBlock = blockFor(config, 'http://example.com:80');

    assert.doesNotMatch(domainBlock, /\ttls /);
    assert.doesNotMatch(domainBlock, /custom\.pem/);
  });

  test('honors layer4 sequence ordering', () => {
    const config = generateCaddyfile({
      general: { enabled: false, enable_layer4: true },
      layer4: [{
        id: 'later',
        enabled: true,
        sequence: '20',
        protocol: 'tcp',
        fromPort: '2000',
        toDomain: ['later.local'],
        toPort: '2000'
      }, {
        id: 'earlier',
        enabled: true,
        sequence: '10',
        protocol: 'tcp',
        fromPort: '1000',
        toDomain: ['earlier.local'],
        toPort: '1000'
      }]
    });

    assert.ok(config.indexOf('tcp/:1000') < config.indexOf('tcp/:2000'));
  });

  test('groups layer4 routes by listener and emits domain matchers', () => {
    const config = generateCaddyfile({
      general: { enabled: false, enable_layer4: true },
      layer4: [{
        id: 'imap_lab',
        enabled: true,
        sequence: '10',
        protocol: 'tcp',
        fromPort: '993',
        matchers: 'tlssni',
        fromDomain: ['imap.lab.example.com'],
        toDomain: ['172.16.16.5'],
        toPort: '993'
      }, {
        id: 'imap_prod',
        enabled: true,
        sequence: '20',
        protocol: 'tcp',
        fromPort: '993',
        matchers: 'tlssni',
        fromDomain: ['imap.example.com'],
        toDomain: ['192.168.225.204'],
        toPort: '993'
      }, {
        id: 'http_route',
        enabled: true,
        sequence: '30',
        protocol: 'tcp',
        fromPort: '80',
        matchers: 'http',
        fromDomain: ['app.example.com'],
        toDomain: ['127.0.0.1'],
        toPort: '8080'
      }]
    });

    assert.strictEqual((config.match(/\n\t\ttcp\/:993 \{/g) || []).length, 1);
    const imapsBlock = blockFor(config, 'tcp/:993');

    assert.match(imapsBlock, /@l4_imap_lab tls sni imap\.lab\.example\.com/);
    assert.match(imapsBlock, /route @l4_imap_lab \{/);
    assert.match(imapsBlock, /proxy tcp\/172\.16\.16\.5:993/);
    assert.match(imapsBlock, /@l4_imap_prod tls sni imap\.example\.com/);
    assert.match(imapsBlock, /route @l4_imap_prod \{/);
    assert.match(imapsBlock, /proxy tcp\/192\.168\.225\.204:993/);

    const httpBlock = blockFor(config, 'tcp/:80');
    assert.match(httpBlock, /@l4_http_route http host app\.example\.com/);
  });
});
