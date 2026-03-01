const path = require('path');

function formatDuration(val) {
  if (!val) return val;
  const strVal = val.toString().trim();
  if (/^\d+$/.test(strVal)) return strVal + 's';
  return strVal;
}

function generateCaddyfile(config, certsDir = './certs') {
  let sb = '';

  // Global options
  sb += '{\n';
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
    for (const l4 of config.layer4) {
      if (!l4.enabled) continue;

      let listenPort = l4.fromPort;
      if (!listenPort) listenPort = '443';

      sb += `\t\t:${listenPort} {\n`;
      if (l4.matchers && l4.matchers !== 'any') {
        sb += '\t\t\tmatch {\n';
        sb += `\t\t\t\t${l4.matchers}`;
        if (l4.fromDomain && l4.fromDomain.length > 0) {
          sb += ' ' + l4.fromDomain.join(' ');
        }
        sb += '\n\t\t\t}\n';
      }

      // Upstreams
      if (l4.toDomain && l4.toDomain.length > 0) {
        sb += '\t\t\tproxy';
        for (const to of l4.toDomain) {
          sb += ` ${to}:${l4.toPort}`;
        }
        sb += ' {\n';
        if (l4.proxyProtocol === 'v1' || l4.proxyProtocol === 'v2') {
          sb += `\t\t\t\tproxy_protocol ${l4.proxyProtocol}\n`;
        }
        if (l4.lb_policy) {
          sb += `\t\t\t\tlb_policy ${l4.lb_policy}\n`;
        }
        if (l4.passive_health_fail_duration) {
          sb += `\t\t\t\tpassive_health_fail_duration ${formatDuration(l4.passive_health_fail_duration)}\n`;
        }
        if (l4.passive_health_max_fails) {
          sb += `\t\t\t\tpassive_health_max_fails ${parseInt(l4.passive_health_max_fails, 10)}\n`;
        }
        sb += '\t\t\t}\n';
      }

      if (l4.terminateTls) {
        sb += '\t\t\ttls\n';
      }
      if (l4.originate_tls === 'tls') {
        sb += '\t\t\ttls_client\n';
      } else if (l4.originate_tls === 'tls_insecure_skip_verify') {
        sb += '\t\t\ttls_client {\n\t\t\t\tinsecure_skip_verify\n\t\t\t}\n';
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

  // Pre-group subdomains
  const subdomainsByDomain = {};
  const subdomainsById = {};
  if (config.subdomains) {
    for (const sub of config.subdomains) {
      if (sub.enabled) {
        subdomainsById[sub.id] = sub;
        if (sub.reverse) {
          if (!subdomainsByDomain[sub.reverse]) {
            subdomainsByDomain[sub.reverse] = [];
          }
          subdomainsByDomain[sub.reverse].push(sub);
        }
      }
    }
  }

  // Pre-group handlers by domain.id
  const handlersByDomain = {};
  if (config.handlers) {
    for (const handler of config.handlers) {
      if (handler.enabled) {
        // Handlers can be linked to a domain directly via handler.reverse
        // OR indirectly via handler.subdomain. We map them by the final domain ID.
        let domainId = null;
        if (handler.reverse) {
          domainId = handler.reverse;
        } else if (handler.subdomain) {
          const sub = subdomainsById[handler.subdomain];
          if (sub && sub.reverse) {
            domainId = sub.reverse;
          }
        }

        if (domainId) {
          if (!handlersByDomain[domainId]) {
            handlersByDomain[domainId] = [];
          }
          handlersByDomain[domainId].push(handler);
        }
      }
    }
  }

  // Reverse Proxy Domains
  if (config.domains) {
    for (const domain of config.domains) {
      if (!domain.enabled) continue;

      // Find subdomains for this domain
      const domainSubdomains = subdomainsByDomain[domain.id] || [];

      // Determine site addresses
      const siteAddrs = [];
      let port = domain.fromPort;
      if (!port) {
        port = domain.disableTls ? '80' : '443';
      }

      let baseAddr = domain.fromDomain;
      if (!baseAddr.startsWith('http://') && !baseAddr.startsWith('https://')) {
        baseAddr = domain.disableTls ? `http://${baseAddr}` : `https://${baseAddr}`;
      }
      siteAddrs.push(`${baseAddr}:${port}`);

      for (const sub of domainSubdomains) {
        let subAddr = `${sub.fromDomain}.${domain.fromDomain}`;
        if (!subAddr.startsWith('http://') && !subAddr.startsWith('https://')) {
          subAddr = domain.disableTls ? `http://${subAddr}` : `https://${subAddr}`;
        }
        siteAddrs.push(`${subAddr}:${port}`);
      }

      sb += siteAddrs.join(', ') + ' {\n';

      // Domain TLS settings
      if (domain.disableTls) {
        // Handled by http:// prefix
      } else if (domain.customCert) {
        // Ensure path formatting uses forward slashes, even on Windows, to make Caddyfile happy
        const certPath = path.join(certsDir, domain.customCert).replace(/\\/g, '/');
        const keyPath = path.join(certsDir, domain.customCert.replace(/\.pem$/, '') + '.key').replace(/\\/g, '/');
        sb += `\ttls ${certPath} ${keyPath} {\n`;
        if (domain.client_auth_mode) {
           sb += `\t\tclient_auth {\n\t\t\tmode ${domain.client_auth_mode}\n`;
           if (domain.client_auth_trust_pool) {
             const trustPath = path.join(certsDir, domain.client_auth_trust_pool).replace(/\\/g, '/');
             sb += `\t\t\ttrusted_ca_cert ${trustPath}\n`;
           }
           sb += `\t\t}\n`;
        }
        sb += `\t}\n`;
      } else {
        sb += '\ttls internal {\n'; // Auto HTTPS disabled by default in our app without ACME
        if (domain.client_auth_mode) {
           sb += `\t\tclient_auth {\n\t\t\tmode ${domain.client_auth_mode}\n`;
           if (domain.client_auth_trust_pool) {
             const trustPath = path.join(certsDir, domain.client_auth_trust_pool).replace(/\\/g, '/');
             sb += `\t\t\ttrusted_ca_cert ${trustPath}\n`;
           }
           sb += `\t\t}\n`;
        }
        sb += `\t}\n`;
      }

      // Access Log
      if (domain.accessLog) {
        sb += '\tlog {\n';
        sb += `\t\toutput file ${logsDir}/${domain.fromDomain}.log {\n`;
        sb += `\t\t\troll_size ${rollSize}MiB\n`;
        sb += `\t\t\troll_keep ${rollKeep}\n`;
        sb += '\t\t}\n';
        sb += '\t}\n';
      }

      // Domain Access Lists
      if (domain.accesslist) {
        for (const alID of domain.accesslist) {
          const al = accessLists[alID];
          if (al && al.clientIps && al.clientIps.length > 0) {
            const matcherName = `@al_${al.id}`;
            const matcherType = al.request_matcher === 'remote_ip' ? 'remote_ip' : 'client_ip';

            sb += `\t${matcherName} {\n`;
            sb += `\t\t${matcherType} ${al.clientIps.join(' ')}\n`;
            sb += '\t}\n';

            let abortCmd = `abort`;
            if (al.http_response_code) {
               abortCmd = `respond ${al.http_response_code}`;
               if (al.http_response_message) {
                  abortCmd = `respond "${al.http_response_message}" ${al.http_response_code}`;
               }
            }

            if (al.invert) {
              sb += `\t${abortCmd} ${matcherName}\n`;
            } else {
              sb += `\t${abortCmd} not ${matcherName}\n`;
            }
          }
        }
      }

      // Domain Basic Auth
      if (domain.basicauth) {
        for (const baID of domain.basicauth) {
          const ba = basicAuths[baID];
          if (ba) {
            sb += '\tbasicauth {\n';
            sb += `\t\t${ba.basicauthuser} ${ba.basicauthpass}\n`;
            sb += '\t}\n';
          }
        }
      }

      // Handlers for this Domain
      const domainHandlers = handlersByDomain[domain.id];
      if (domainHandlers) {
        for (const handler of domainHandlers) {
          // Subdomain check
          let isSubdomainMatch = false;
          if (handler.subdomain) {
            const sub = subdomainsById[handler.subdomain];
            if (sub && sub.reverse === domain.id) {
              isSubdomainMatch = true;
            }
            if (!isSubdomainMatch) continue;
          }

          // Construct handler matchers
          let matcherStr = '';
          if (handler.handlePath) {
            if (handler.handleType === 'handle_path') {
              matcherStr = ` ${handler.handlePath}/*`;
            } else {
              matcherStr = ` ${handler.handlePath}`;
            }
          }

          let directive = handler.handleDirective || 'reverse_proxy';

          if (handler.handleType === 'handle_path') {
            sb += `\thandle_path${matcherStr} {\n`;
          } else {
            sb += `\thandle${matcherStr} {\n`;
          }

          // Handler Access Lists
          if (handler.accesslist) {
            for (const alID of handler.accesslist) {
              const al = accessLists[alID];
              if (al && al.clientIps && al.clientIps.length > 0) {
                const matcherName = `@al_h_${al.id}`;
                const matcherType = al.request_matcher === 'remote_ip' ? 'remote_ip' : 'client_ip';

                sb += `\t\t${matcherName} {\n`;
                sb += `\t\t\t${matcherType} ${al.clientIps.join(' ')}\n`;
                sb += '\t\t}\n';

                let abortCmd = `abort`;
                if (al.http_response_code) {
                   abortCmd = `respond ${al.http_response_code}`;
                   if (al.http_response_message) {
                      abortCmd = `respond "${al.http_response_message}" ${al.http_response_code}`;
                   }
                }

                if (al.invert) {
                  sb += `\t\t${abortCmd} ${matcherName}\n`;
                } else {
                  sb += `\t\t${abortCmd} not ${matcherName}\n`;
                }
              }
            }
          }

          // Handler Basic Auth
          if (handler.basicauth) {
            for (const baID of handler.basicauth) {
              const ba = basicAuths[baID];
              if (ba) {
                sb += '\t\tbasicauth {\n';
                sb += `\t\t\t${ba.basicauthuser} ${ba.basicauthpass}\n`;
                sb += '\t\t}\n';
              }
            }
          }

          // Handler Headers (pre-proxy setup)
          if (handler.header) {
            for (const hID of handler.header) {
              const h = headersMap[hID];
              if (h) {
                const dir = h.headerUpDown || 'header_up';
                if (directive !== 'reverse_proxy') {
                  const action = h.headerValue ? 'set' : '-';
                  if (action === '-') {
                    sb += `\t\theader -${h.headerType}\n`;
                  } else {
                    sb += `\t\theader ${h.headerType} ${h.headerValue}\n`;
                  }
                }
              }
            }
          }

          // Upstreams
          if (directive === 'reverse_proxy') {
            sb += '\t\treverse_proxy';
            if (handler.toDomain) {
              for (const to of handler.toDomain) {
                sb += ` ${to}:${handler.toPort}`;
              }
            }
            sb += ' {\n';

            // Headers for proxy
            if (handler.header) {
              for (const hID of handler.header) {
                const h = headersMap[hID];
                if (h) {
                  const action = h.headerValue ? 'set' : '-';
                  const dir = h.headerUpDown;
                  if (dir === 'header_down') {
                    if (action === '-') {
                      sb += `\t\t\theader_down -${h.headerType}\n`;
                    } else {
                      sb += `\t\t\theader_down ${h.headerType} ${h.headerValue}\n`;
                    }
                  } else {
                    if (action === '-') {
                      sb += `\t\t\theader_up -${h.headerType}\n`;
                    } else {
                      sb += `\t\t\theader_up ${h.headerType} ${h.headerValue}\n`;
                    }
                  }
                }
              }
            }

            // Transport
            if (handler.ntlm) {
              sb += '\t\t\ttransport http_ntlm {\n';
              if (handler.httpTls) {
                sb += '\t\t\t\ttls\n';
                if (handler.http_tls_insecure_skip_verify) {
                  sb += '\t\t\t\ttls_insecure_skip_verify\n';
                }
              }
              sb += '\t\t\t}\n';
            } else {
              let needsTransport = false;
              let transportBlock = '\t\t\ttransport http {\n';
              if (handler.httpTls) {
                needsTransport = true;
                transportBlock += '\t\t\t\ttls\n';
                if (handler.http_tls_insecure_skip_verify) {
                  transportBlock += '\t\t\t\ttls_insecure_skip_verify\n';
                }
                if (handler.http_tls_server_name) {
                  transportBlock += `\t\t\t\ttls_server_name ${handler.http_tls_server_name}\n`;
                }
                if (handler.http_tls_trusted_ca_certs) {
                  const caPath = path.join(certsDir, handler.http_tls_trusted_ca_certs).replace(/\\/g, '/');
                  transportBlock += `\t\t\t\ttls_trusted_ca_certs ${caPath}\n`;
                }
              }
              if (handler.http_version) {
                 needsTransport = true;
                 transportBlock += `\t\t\t\tversions ${handler.http_version}\n`;
              }
              if (handler.http_keepalive) {
                 needsTransport = true;
                 transportBlock += `\t\t\t\tkeepalive ${handler.http_keepalive}\n`;
              }
              transportBlock += '\t\t\t}\n';
              if (needsTransport) sb += transportBlock;
            }

            // Load Balancing
            if (handler.lb_policy) sb += `\t\t\tlb_policy ${handler.lb_policy}\n`;
            if (handler.lb_retries) sb += `\t\t\tlb_retries ${parseInt(handler.lb_retries, 10)}\n`;
            if (handler.lb_try_duration) sb += `\t\t\tlb_try_duration ${formatDuration(handler.lb_try_duration)}\n`;
            if (handler.lb_try_interval) sb += `\t\t\tlb_try_interval ${formatDuration(handler.lb_try_interval)}\n`;

            // Active Health Checks
            if (handler.health_uri) sb += `\t\t\thealth_uri ${handler.health_uri}\n`;
            if (handler.health_port) sb += `\t\t\thealth_port ${handler.health_port}\n`;
            if (handler.health_interval) sb += `\t\t\thealth_interval ${formatDuration(handler.health_interval)}\n`;
            if (handler.health_timeout) sb += `\t\t\thealth_timeout ${formatDuration(handler.health_timeout)}\n`;
            if (handler.health_status) sb += `\t\t\thealth_status ${handler.health_status}\n`;
            if (handler.health_body) sb += `\t\t\thealth_body "${handler.health_body}"\n`;
            if (handler.health_passes) sb += `\t\t\thealth_passes ${parseInt(handler.health_passes, 10)}\n`;
            if (handler.health_fails) sb += `\t\t\thealth_fails ${parseInt(handler.health_fails, 10)}\n`;
            if (handler.health_follow_redirects) sb += `\t\t\thealth_follow_redirects\n`;

            // Passive Health Checks
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

      sb += '}\n\n';
    }
  }

  return sb;
}

module.exports = { generateCaddyfile };