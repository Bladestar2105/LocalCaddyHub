const path = require('path');
const { formatDuration } = require('./utils');

function generateCaddyfile(config, certsDir = './certs') {
  let sb = '';
  const automaticCertsDisabled = ['off', 'disable_certs'].includes(config.general && config.general.auto_https);

  // Global options
  sb += '{\n';
  sb += '\torder coraza_waf first\n';
  if (config.general.http_port) {
    sb += `\thttp_port ${config.general.http_port}\n`;
  }
  if (config.general.https_port) {
    sb += `\thttps_port ${config.general.https_port}\n`;
  }
  const rollSize = config.general.log_roll_size_mb || 10;
  const rollKeep = config.general.log_roll_keep || 7;
  const logsDir = path.join(process.cwd(), 'data', 'logs').replace(/\\/g, '/');

  if (config.general.log_level) {
    sb += '\tlog {\n';
    sb += `\t\toutput file ${logsDir}/caddy-global.log {\n`;
    sb += `\t\t\troll_size ${rollSize}MiB\n`;
    sb += `\t\t\troll_keep ${rollKeep}\n`;
    sb += '\t\t}\n';
    sb += `\t\tlevel ${config.general.log_level}\n`;
    sb += '\t}\n';
  }

  if (config.general.auto_https) {
    sb += `\tauto_https ${config.general.auto_https}\n`;
  }

  if (config.general.tls_email) {
    sb += `\temail ${config.general.tls_email}\n`;
  }

  if (config.general.http_versions || config.general.timeout_read_body || config.general.timeout_read_header || config.general.timeout_write || config.general.timeout_idle || config.general.log_credentials) {
    sb += '\tservers {\n';
    if (config.general.http_versions) {
      sb += `\t\tprotocols ${config.general.http_versions}\n`;
    }
    if (config.general.log_credentials) {
      sb += `\t\tlog_credentials\n`;
    }
    if (config.general.timeout_read_body || config.general.timeout_read_header || config.general.timeout_write || config.general.timeout_idle) {
      sb += '\t\ttimeouts {\n';
      if (config.general.timeout_read_body) sb += `\t\t\tread_body ${formatDuration(config.general.timeout_read_body)}\n`;
      if (config.general.timeout_read_header) sb += `\t\t\tread_header ${formatDuration(config.general.timeout_read_header)}\n`;
      if (config.general.timeout_write) sb += `\t\t\twrite ${formatDuration(config.general.timeout_write)}\n`;
      if (config.general.timeout_idle) sb += `\t\t\tidle ${formatDuration(config.general.timeout_idle)}\n`;
      sb += '\t\t}\n';
    }
    sb += '\t}\n';
  }

  // Layer 4 configuration
  if (config.general.enable_layer4 && config.layer4 && config.layer4.length > 0) {
    sb += '\tlayer4 {\n';
    const layer4Routes = config.layer4
      .map((route, index) => ({ route, index }))
      .filter(item => item.route.enabled)
      .sort((a, b) => {
        const aSeq = Number.parseFloat(a.route.sequence);
        const bSeq = Number.parseFloat(b.route.sequence);
        const aHasSeq = Number.isFinite(aSeq);
        const bHasSeq = Number.isFinite(bSeq);
        if (aHasSeq && bHasSeq) return aSeq - bSeq || a.index - b.index;
        if (aHasSeq) return -1;
        if (bHasSeq) return 1;
        return a.index - b.index;
      })
      .map(item => ({
        ...item.route,
        _index: item.index,
        _protocol: item.route.protocol || 'tcp',
        _listenPort: item.route.fromPort || '443'
      }));

    const listeners = new Map();
    for (const route of layer4Routes) {
      const key = `${route._protocol}/:${route._listenPort}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(route);
    }

    function layer4MatcherExpression(l4) {
      const matcher = l4.matchers || 'any';
      if (matcher === 'any') return '';
      const values = Array.isArray(l4.fromDomain) ? l4.fromDomain.filter(Boolean) : [];

      if (matcher === 'tlssni' || matcher === 'tls_sni') {
        return values.length ? `tls sni ${values.join(' ')}` : 'tls';
      }
      if (matcher === 'http') {
        return values.length ? `http host ${values.join(' ')}` : 'http';
      }

      return [matcher, ...values].join(' ');
    }

    function layer4MatcherName(l4) {
      const raw = String(l4.id || `route_${l4._index}`);
      return `@l4_${raw.replace(/[^A-Za-z0-9_]/g, '_')}`;
    }

    function writeLayer4Route(l4) {
      const matcherExpr = layer4MatcherExpression(l4);
      const hasMatcher = Boolean(matcherExpr);
      let matcherName = '';
      if (hasMatcher) {
        matcherName = layer4MatcherName(l4);
        sb += `\t\t\t${matcherName}`;
        if (l4.invert_matchers) {
          sb += ` not`;
        }
        sb += ` ${matcherExpr}\n\n`;

        sb += `\t\t\troute ${matcherName} {\n`;
        sb += `\t\t\t\tsubroute {\n`;
      } else {
        sb += `\t\t\troute {\n`;
      }

      let indent = hasMatcher ? '\t\t\t\t\t' : '\t\t\t\t';

      let hasRemoteIp = l4.remote_ip && l4.remote_ip.length > 0;
      if (hasRemoteIp) {
        sb += `${indent}@allowed_ips remote_ip ${l4.remote_ip.join(' ')}\n`;
        sb += `${indent}route @allowed_ips {\n`;
        indent += '\t';
      }

      // Handlers run in definition order inside the selected layer4 route.
      if (l4.starttls) {
        sb += `${indent}starttls\n`;
      }

      if (l4.terminateTls || l4.starttls) {
        if (l4.customCert) {
          const certPath = path.join(certsDir, l4.customCert).replace(/\\/g, '/');
          const keyPath = path.join(certsDir, l4.customCert.replace(/\.pem$/, '') + '.key').replace(/\\/g, '/');
          sb += `${indent}custom_tls ${certPath} ${keyPath} {\n`;
          if (l4.default_sni) {
            sb += `${indent}\tdefault_sni ${l4.default_sni}\n`;
          }
          sb += `${indent}}\n`;
        } else {
          let tlsString = 'tls';

          if (l4.default_sni) {
            sb += `${indent}${tlsString} {\n`;
            sb += `${indent}\tconnection_policy {\n`;
            sb += `${indent}\t\tdefault_sni ${l4.default_sni}\n`;
            // Explicitly allow TLS 1.2 and CBC ciphers to support older SMTP clients like checktls.com
            sb += `${indent}\t\tciphers TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384 TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256 TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256 TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA\n`;
            sb += `${indent}\t}\n`;
            sb += `${indent}}\n`;
          } else {
            sb += `${indent}${tlsString}\n`;
          }
        }
      }

      if (l4.starttls) {
        sb += `${indent}drop220\n`;
      }

      // Upstreams
      if (l4.toDomain && l4.toDomain.length > 0) {
        let hasTlsClient = (l4.originate_tls === 'tls' || l4.originate_tls === 'tls_insecure_skip_verify');
        let isStartTlsUpstream = (l4.originate_tls === 'starttls' || l4.originate_tls === 'starttls_insecure_skip_verify');

        if (isStartTlsUpstream) {
          sb += `${indent}upstream_starttls {\n`;
          sb += `${indent}\tupstream`;
          for (const to of l4.toDomain) {
            sb += ` ${l4._protocol}/${to}:${l4.toPort}`;
          }
          sb += `\n`;
          if (l4.originate_tls === 'starttls_insecure_skip_verify') {
            sb += `${indent}\tinsecure_skip_verify\n`;
          }
          sb += `${indent}}\n`;
          // The proxy handler is no longer needed since upstream_starttls does the proxying and internal load balancing.
        } else if (hasTlsClient) {
          sb += `${indent}proxy {\n`;
          sb += `${indent}\tupstream`;
          for (const to of l4.toDomain) {
            sb += ` ${l4._protocol}/${to}:${l4.toPort}`;
          }
          sb += ' {\n';
          sb += `${indent}\t\ttls\n`;
          if (l4.originate_tls === 'tls_insecure_skip_verify') {
            sb += `${indent}\t\ttls_insecure_skip_verify\n`;
          }
          sb += `${indent}\t}\n`;

          if (l4.lb_policy) {
            sb += `${indent}\tlb_policy ${l4.lb_policy}\n`;
          }
          if (l4.passive_health_fail_duration) {
            sb += `${indent}\tfail_duration ${formatDuration(l4.passive_health_fail_duration)}\n`;
          }
          if (l4.passive_health_max_fails) {
            sb += `${indent}\tmax_fails ${parseInt(l4.passive_health_max_fails, 10)}\n`;
          }
          if (l4.proxyProtocol === 'v1' || l4.proxyProtocol === 'v2') {
            sb += `${indent}\tproxy_protocol ${l4.proxyProtocol}\n`;
          }
          sb += `${indent}}\n`;
        } else {
          sb += `${indent}proxy`;
          for (const to of l4.toDomain) {
            sb += ` ${l4._protocol}/${to}:${l4.toPort}`;
          }
          sb += ' {\n';

          if (l4.lb_policy) {
            sb += `${indent}\tlb_policy ${l4.lb_policy}\n`;
          }
          if (l4.passive_health_fail_duration) {
            sb += `${indent}\tfail_duration ${formatDuration(l4.passive_health_fail_duration)}\n`;
          }
          if (l4.passive_health_max_fails) {
            sb += `${indent}\tmax_fails ${parseInt(l4.passive_health_max_fails, 10)}\n`;
          }
          if (l4.proxyProtocol === 'v1' || l4.proxyProtocol === 'v2') {
            sb += `${indent}\tproxy_protocol ${l4.proxyProtocol}\n`;
          }
          sb += `${indent}}\n`;
        }
      }

      if (hasRemoteIp) {
        // close route @allowed_ips
        indent = indent.slice(0, -1);
        sb += `${indent}}\n`;
      }

      if (hasMatcher) {
        sb += `\t\t\t\t}\n`;
        sb += `\t\t\t}\n`;
      } else {
        sb += `\t\t\t}\n`;
      }
    }

    for (const [listener, routes] of listeners.entries()) {
      sb += `\t\t${listener} {\n`;
      for (const route of routes) {
        writeLayer4Route(route);
      }
      sb += '\t\t}\n';
    }
    sb += '\t}\n';
  }
  sb += '}\n\n';

  if (!config.general.enabled) {
    return sb; // Return early if General is disabled
  }

  // Helper maps for relations
  const accessLists = {};
  if (config.accessLists) {
    for (const al of config.accessLists) {
      accessLists[al.id] = al;
    }
  }

  const basicAuths = {};
  if (config.basicAuths) {
    for (const ba of config.basicAuths) {
      basicAuths[ba.id] = ba;
    }
  }

  const headersMap = {};
  if (config.headers) {
    for (const h of config.headers) {
      headersMap[h.id] = h;
    }
  }

  function caddyQuote(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function certPath(filename) {
    return path.join(certsDir, filename).replace(/\\/g, '/');
  }

  function keyPathForCert(filename) {
    return certPath(filename.replace(/\.pem$/, '') + '.key');
  }

  function writeClientAuth(settings, indent) {
    if (!settings.client_auth_mode) return '';

    let out = `${indent}client_auth {\n`;
    out += `${indent}\tmode ${settings.client_auth_mode}\n`;
    if (settings.client_auth_trust_pool) {
      out += `${indent}\ttrust_pool file ${certPath(settings.client_auth_trust_pool)}\n`;
    }
    out += `${indent}}\n`;
    return out;
  }

  function mergedTlsSettings(site, domain) {
    const useAcme = !automaticCertsDisabled && Boolean(site.acme || (site !== domain && domain.acme));
    return {
      acme: useAcme,
      customCert: useAcme ? '' : (site.customCert || domain.customCert || ''),
      client_auth_mode: site.client_auth_mode || domain.client_auth_mode || '',
      client_auth_trust_pool: site.client_auth_trust_pool || domain.client_auth_trust_pool || ''
    };
  }

  function writeTlsForSite(site, domain) {
    if (domain.disableTls) return;

    const tls = mergedTlsSettings(site, domain);
    if (tls.acme) {
      const clientAuth = writeClientAuth(tls, '\t\t');
      if (clientAuth) {
        sb += '\ttls {\n';
        sb += clientAuth;
        sb += '\t}\n';
      }
      return;
    }

    if (tls.customCert) {
      sb += `\ttls ${certPath(tls.customCert)} ${keyPathForCert(tls.customCert)} {\n`;
      sb += writeClientAuth(tls, '\t\t');
      sb += '\t}\n';
      return;
    }

    sb += '\ttls internal {\n';
    sb += writeClientAuth(tls, '\t\t');
    sb += '\t}\n';
  }

  function writeAccessRules(accessIds, indent, prefix) {
    if (!Array.isArray(accessIds) || accessIds.length === 0) return;

    for (const alID of accessIds) {
      const al = accessLists[alID];
      if (!al || !al.clientIps || al.clientIps.length === 0) continue;

      const matcherName = `@${prefix}_${al.id}`;
      const matcherType = al.request_matcher === 'remote_ip' ? 'remote_ip' : 'client_ip';
      const matcherExpr = al.invert
        ? `${matcherType} ${al.clientIps.join(' ')}`
        : `not ${matcherType} ${al.clientIps.join(' ')}`;

      sb += `${indent}${matcherName} ${matcherExpr}\n`;

      if (al.http_response_code) {
        if (al.http_response_message) {
          sb += `${indent}respond ${matcherName} ${caddyQuote(al.http_response_message)} ${al.http_response_code}\n`;
        } else {
          sb += `${indent}respond ${matcherName} ${al.http_response_code}\n`;
        }
      } else {
        sb += `${indent}abort ${matcherName}\n`;
      }
    }
  }

  function writeBasicAuths(authIds, indent) {
    if (!Array.isArray(authIds) || authIds.length === 0) return;

    for (const baID of authIds) {
      const ba = basicAuths[baID];
      if (!ba) continue;
      sb += `${indent}basic_auth {\n`;
      sb += `${indent}\t${ba.basicauthuser} ${ba.basicauthpass}\n`;
      sb += `${indent}}\n`;
    }
  }

  function mergeIdLists(baseIds, extraIds) {
    return [...new Set([...(baseIds || []), ...(extraIds || [])])];
  }

  function normalizeHandleMatcher(handler) {
    if (!handler.handlePath) return '';
    const handlePath = handler.handlePath.trim();
    if (!handlePath) return '';
    if (handler.handleType !== 'handle_path') return ` ${handlePath}`;
    if (handlePath.endsWith('*')) return ` ${handlePath}`;
    if (handlePath === '/') return ' /*';
    return ` ${handlePath.replace(/\/$/, '')}/*`;
  }

  function mapHttpTransportVersions(value) {
    const versions = Array.isArray(value) ? value : String(value || '').split(/\s+/);
    const mapped = versions
      .map(v => ({ h1: '1.1', h2: '2', h3: '3', h2c: 'h2c' }[v] || v))
      .filter(Boolean);
    return [...new Set(mapped)].join(' ');
  }

  function writeProxyHeader(header, indent) {
    if (!header || !header.headerType) return;
    const directive = header.headerUpDown === 'header_down' ? 'header_down' : 'header_up';
    if (header.headerValue && header.headerReplace) {
      sb += `${indent}${directive} ${header.headerType} ${caddyQuote(header.headerValue)} ${caddyQuote(header.headerReplace)}\n`;
    } else if (header.headerValue) {
      sb += `${indent}${directive} ${header.headerType} ${caddyQuote(header.headerValue)}\n`;
    } else {
      sb += `${indent}${directive} -${header.headerType}\n`;
    }
  }

  function writeProxyTransport(handler) {
    const transportName = handler.ntlm ? 'http_ntlm' : 'http';
    const tlsEnabled = Boolean(
      handler.httpTls ||
      handler.http_tls_insecure_skip_verify ||
      handler.http_tls_server_name ||
      handler.http_tls_trusted_ca_certs
    );
    const versions = mapHttpTransportVersions(handler.http_version);
    const keepalive = handler.http_keepalive ? formatDuration(handler.http_keepalive) : '';
    const needsTransport = handler.ntlm || tlsEnabled || versions || keepalive;

    if (!needsTransport) return;

    sb += `\t\t\ttransport ${transportName} {\n`;
    if (tlsEnabled) {
      sb += '\t\t\t\ttls\n';
      if (handler.http_tls_insecure_skip_verify) {
        sb += '\t\t\t\ttls_insecure_skip_verify\n';
      }
      if (handler.http_tls_server_name) {
        sb += `\t\t\t\ttls_server_name ${handler.http_tls_server_name}\n`;
      }
      if (handler.http_tls_trusted_ca_certs) {
        sb += `\t\t\t\ttls_trust_pool file ${certPath(handler.http_tls_trusted_ca_certs)}\n`;
      }
    }
    if (versions) {
      sb += `\t\t\t\tversions ${versions}\n`;
    }
    if (keepalive) {
      sb += `\t\t\t\tkeepalive ${keepalive}\n`;
    }
    sb += '\t\t\t}\n';
  }

  function writeHandlers(handlers) {
    if (!handlers || handlers.length === 0) return;

    for (const handler of handlers) {
      const matcherStr = normalizeHandleMatcher(handler);
      const directive = handler.handleDirective || 'reverse_proxy';

      if (handler.handleType === 'handle_path') {
        sb += `\thandle_path${matcherStr} {\n`;
      } else {
        sb += `\thandle${matcherStr} {\n`;
      }

      if (handler.waf_enabled) {
        sb += '\t\tcoraza_waf {\n';
        sb += '\t\t\tload_owasp_crs\n';
        sb += '\t\t\tdirectives `\n';
        sb += '\t\t\t\tInclude @coraza.conf-recommended\n';
        sb += '\t\t\t\tInclude @crs-setup.conf.example\n';
        sb += '\t\t\t\tInclude @owasp_crs/*.conf\n';
        sb += '\t\t\t\tSecRuleEngine On\n';
        sb += '\t\t\t`\n';
        sb += '\t\t}\n';
      }

      writeAccessRules(handler.accesslist, '\t\t', `al_h_${handler.id}`);
      writeBasicAuths(handler.basicauth, '\t\t');

      if (directive === 'reverse_proxy') {
        sb += '\t\treverse_proxy';
        if (handler.toDomain) {
          for (const to of handler.toDomain) {
            sb += ` ${to}:${handler.toPort}`;
          }
        }
        sb += ' {\n';

        if (handler.to_path) {
          sb += `\t\t\trewrite ${handler.to_path}\n`;
        }

        if (handler.header) {
          for (const hID of handler.header) {
            writeProxyHeader(headersMap[hID], '\t\t\t');
          }
        }

        writeProxyTransport(handler);

        if (handler.lb_policy) sb += `\t\t\tlb_policy ${handler.lb_policy}\n`;
        if (handler.lb_retries) sb += `\t\t\tlb_retries ${parseInt(handler.lb_retries, 10)}\n`;
        if (handler.lb_try_duration) sb += `\t\t\tlb_try_duration ${formatDuration(handler.lb_try_duration)}\n`;
        if (handler.lb_try_interval) sb += `\t\t\tlb_try_interval ${formatDuration(handler.lb_try_interval)}\n`;

        if (handler.health_uri) sb += `\t\t\thealth_uri ${handler.health_uri}\n`;
        if (handler.health_port) sb += `\t\t\thealth_port ${handler.health_port}\n`;
        if (handler.health_interval) sb += `\t\t\thealth_interval ${formatDuration(handler.health_interval)}\n`;
        if (handler.health_timeout) sb += `\t\t\thealth_timeout ${formatDuration(handler.health_timeout)}\n`;
        if (handler.health_status) sb += `\t\t\thealth_status ${handler.health_status}\n`;
        if (handler.health_body) sb += `\t\t\thealth_body ${caddyQuote(handler.health_body)}\n`;
        if (handler.health_passes) sb += `\t\t\thealth_passes ${parseInt(handler.health_passes, 10)}\n`;
        if (handler.health_fails) sb += `\t\t\thealth_fails ${parseInt(handler.health_fails, 10)}\n`;
        if (handler.health_follow_redirects) sb += '\t\t\thealth_follow_redirects\n';
        if (handler.health_headers && handler.health_headers.length > 0) {
          sb += '\t\t\thealth_headers {\n';
          for (const hID of handler.health_headers) {
            const h = headersMap[hID];
            if (!h || !h.headerType || !h.headerValue) continue;
            sb += `\t\t\t\t${h.headerType} ${caddyQuote(h.headerValue)}\n`;
          }
          sb += '\t\t\t}\n';
        }

        if (handler.passive_health_fail_duration) sb += `\t\t\tfail_duration ${formatDuration(handler.passive_health_fail_duration)}\n`;
        if (handler.passive_health_max_fails) sb += `\t\t\tmax_fails ${parseInt(handler.passive_health_max_fails, 10)}\n`;
        if (handler.passive_health_unhealthy_status) sb += `\t\t\tunhealthy_status ${handler.passive_health_unhealthy_status}\n`;
        if (handler.passive_health_unhealthy_latency) sb += `\t\t\tunhealthy_latency ${formatDuration(handler.passive_health_unhealthy_latency)}\n`;
        if (handler.passive_health_unhealthy_request_count) sb += `\t\t\tunhealthy_request_count ${parseInt(handler.passive_health_unhealthy_request_count, 10)}\n`;

        sb += '\t\t}\n';
      } else if (directive === 'redir') {
        const to = handler.toDomain && handler.toDomain.length > 0 ? handler.toDomain[0] : '';
        const status = handler.redir_status || '301';
        sb += `\t\tredir ${to} ${status}\n`;
      }

      sb += '\t}\n';
    }
  }

  function siteAddress(host, domain) {
    let port = domain.fromPort;
    if (!port) {
      port = domain.disableTls ? '80' : '443';
    }

    let addr = host;
    if (!addr.startsWith('http://') && !addr.startsWith('https://')) {
      addr = domain.disableTls ? `http://${addr}` : `https://${addr}`;
    }
    return `${addr}:${port}`;
  }

  function writeSiteBlock(address, site, domain, handlers) {
    sb += `${address} {\n`;
    writeTlsForSite(site, domain);

    if (site === domain && domain.accessLog) {
      sb += '\tlog {\n';
      sb += `\t\toutput file ${logsDir}/${domain.fromDomain}.log {\n`;
      sb += `\t\t\troll_size ${rollSize}MiB\n`;
      sb += `\t\t\troll_keep ${rollKeep}\n`;
      sb += '\t\t}\n';
      sb += '\t}\n';
    }

    const accessIds = site === domain ? site.accesslist : mergeIdLists(domain.accesslist, site.accesslist);
    const authIds = site === domain ? site.basicauth : mergeIdLists(domain.basicauth, site.basicauth);
    writeAccessRules(accessIds, '\t', site === domain ? 'al_domain' : `al_sub_${site.id}`);
    writeBasicAuths(authIds, '\t');
    writeHandlers(handlers);
    sb += '}\n\n';
  }

  // Pre-group subdomains
  const subdomainsByDomain = {};
  if (config.subdomains) {
    for (const sub of config.subdomains) {
      if (sub.enabled) {
        if (sub.reverse) {
          if (!subdomainsByDomain[sub.reverse]) {
            subdomainsByDomain[sub.reverse] = [];
          }
          subdomainsByDomain[sub.reverse].push(sub);
        }
      }
    }
  }

  // Pre-group handlers by their final site.
  const handlersByDomain = {};
  const handlersBySubdomain = {};
  if (config.handlers) {
    for (const handler of config.handlers) {
      if (!handler.enabled) continue;

      if (handler.subdomain) {
        if (!handlersBySubdomain[handler.subdomain]) {
          handlersBySubdomain[handler.subdomain] = [];
        }
        handlersBySubdomain[handler.subdomain].push(handler);
      } else if (handler.reverse) {
        if (!handlersByDomain[handler.reverse]) {
          handlersByDomain[handler.reverse] = [];
        }
        handlersByDomain[handler.reverse].push(handler);
      }
    }
  }

  // Reverse Proxy Domains
  if (config.domains) {
    for (const domain of config.domains) {
      if (!domain.enabled) continue;

      writeSiteBlock(siteAddress(domain.fromDomain, domain), domain, domain, handlersByDomain[domain.id] || []);

      for (const sub of subdomainsByDomain[domain.id] || []) {
        const subHost = `${sub.fromDomain}.${domain.fromDomain}`;
        writeSiteBlock(siteAddress(subHost, domain), sub, domain, handlersBySubdomain[sub.id] || []);
      }
    }
  }

  return sb;
}

module.exports = { generateCaddyfile };
