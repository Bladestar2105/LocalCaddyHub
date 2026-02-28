const path = require('path');

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
  if (config.general.log_level) {
    sb += '\tlog {\n';
    sb += `\t\tlevel ${config.general.log_level}\n`;
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
        sb += '\t\t\t}\n';
      }

      if (l4.terminateTls) {
        sb += '\t\t\ttls\n';
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

  // Reverse Proxy Domains
  if (config.domains) {
    for (const domain of config.domains) {
      if (!domain.enabled) continue;

      // Find subdomains for this domain
      const domainSubdomains = [];
      if (config.subdomains) {
        for (const sub of config.subdomains) {
          if (sub.enabled && sub.reverse === domain.id) {
            domainSubdomains.push(sub);
          }
        }
      }

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
        sb += `\ttls ${certPath} ${keyPath}\n`;
      } else {
        sb += '\ttls internal\n'; // Auto HTTPS disabled by default in our app without ACME
      }

      // Access Log
      if (domain.accessLog) {
        sb += '\tlog\n';
      }

      // Domain Access Lists
      if (domain.accesslist) {
        for (const alID of domain.accesslist) {
          const al = accessLists[alID];
          if (al && al.clientIps && al.clientIps.length > 0) {
            const matcherName = `@al_${al.id}`;
            sb += `\t${matcherName} {\n`;
            sb += `\t\tremote_ip ${al.clientIps.join(' ')}\n`;
            sb += '\t}\n';
            if (al.invert) {
              sb += `\tabort ${matcherName}\n`;
            } else {
              sb += `\tabort not ${matcherName}\n`;
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
      if (config.handlers) {
        for (const handler of config.handlers) {
          if (!handler.enabled || (handler.reverse !== domain.id && !handler.subdomain)) {
            continue;
          }

          // Subdomain check
          let isSubdomainMatch = false;
          if (handler.subdomain) {
            for (const sub of domainSubdomains) {
              if (handler.subdomain === sub.id) {
                isSubdomainMatch = true;
                break;
              }
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
                sb += `\t\t${matcherName} {\n`;
                sb += `\t\t\tremote_ip ${al.clientIps.join(' ')}\n`;
                sb += '\t\t}\n';
                if (al.invert) {
                  sb += `\t\tabort ${matcherName}\n`;
                } else {
                  sb += `\t\tabort not ${matcherName}\n`;
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
              }
              sb += '\t\t\t}\n';
            } else if (handler.httpTls) {
              sb += '\t\t\ttransport http {\n';
              sb += '\t\t\t\ttls\n';
              sb += '\t\t\t}\n';
            }

            // Load Balancing
            if (handler.lb_policy) sb += `\t\t\tlb_policy ${handler.lb_policy}\n`;
            if (handler.lb_retries) sb += `\t\t\tlb_retries ${handler.lb_retries}\n`;
            if (handler.lb_try_duration) sb += `\t\t\tlb_try_duration ${handler.lb_try_duration}\n`;
            if (handler.lb_try_interval) sb += `\t\t\tlb_try_interval ${handler.lb_try_interval}\n`;

            // Health Checks
            if (handler.health_uri) sb += `\t\t\thealth_uri ${handler.health_uri}\n`;
            if (handler.health_port) sb += `\t\t\thealth_port ${handler.health_port}\n`;
            if (handler.health_interval) sb += `\t\t\thealth_interval ${handler.health_interval}\n`;
            if (handler.health_timeout) sb += `\t\t\thealth_timeout ${handler.health_timeout}\n`;

            sb += '\t\t}\n';
          } else if (directive === 'redir') {
            const to = handler.toDomain && handler.toDomain.length > 0 ? handler.toDomain[0] : '';
            sb += `\t\tredir ${to}\n`;
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