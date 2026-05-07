// PageGeneral.jsx — General configuration tab
const PageGeneral = ({ state, setState }) => {
  const upd = (k, v) => setState({ ...state, [k]: v });
  return (
    <div className="col gap-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">General Settings</h1>
          <p className="page-sub">Global Caddy configuration: ports, timeouts, ACME, HTTP versions. These apply to every site managed by this hub.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3 className="card-title"><IconCog size={16}/> Server</h3></div>
        <div className="card-body">
          <div className="form-grid">
            <label className="checkbox">
              <input type="checkbox" checked={state.enabled} onChange={e => upd('enabled', e.target.checked)}/>
              Enable Caddy Configuration
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={state.l4} onChange={e => upd('l4', e.target.checked)}/>
              Enable Layer 4 Configuration
            </label>
            <div className="field">
              <div className="field-label">HTTP Port</div>
              <input className="input" value={state.httpPort} onChange={e => upd('httpPort', e.target.value)}/>
            </div>
            <div className="field">
              <div className="field-label">HTTPS Port</div>
              <input className="input" value={state.httpsPort} onChange={e => upd('httpsPort', e.target.value)}/>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3 className="card-title"><IconLog size={16}/> Logging</h3></div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <div className="field-label">Log Level</div>
              <select className="select" value={state.logLevel} onChange={e => upd('logLevel', e.target.value)}>
                <option value="">Default (INFO)</option>
                <option>DEBUG</option><option>INFO</option><option>WARN</option><option>ERROR</option>
              </select>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={state.logCreds} onChange={e => upd('logCreds', e.target.checked)}/>
              Log Credentials <span className="muted" style={{fontSize:11, marginLeft:6}}>(?)</span>
            </label>
            <div className="field">
              <div className="field-label">Log Roll Size (MB)</div>
              <input type="number" className="input" value={state.rollSize} onChange={e => upd('rollSize', e.target.value)}/>
              <div className="field-help">Max size of a log file before rotation.</div>
            </div>
            <div className="field">
              <div className="field-label">Rotated Files to Keep</div>
              <input type="number" className="input" value={state.rollKeep} onChange={e => upd('rollKeep', e.target.value)}/>
              <div className="field-help">Max number of rotated files to keep.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3 className="card-title"><IconShield size={16}/> TLS &amp; ACME</h3></div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <div className="field-label">TLS Email</div>
              <input className="input" value={state.tlsEmail} onChange={e => upd('tlsEmail', e.target.value)} placeholder="admin@example.com"/>
              <div className="field-help">Email used for the ACME account.</div>
            </div>
            <div className="field">
              <div className="field-label">ACME CA</div>
              <select className="select" value={state.acmeCA} onChange={e => upd('acmeCA', e.target.value)}>
                <option value="">Caddy Default</option>
                <option value="le-prod">Let's Encrypt Production</option>
                <option value="le-stg">Let's Encrypt Staging</option>
              </select>
            </div>
            <div className="field">
              <div className="field-label">Certificate Key Type</div>
              <select className="select" value={state.keyType} onChange={e => upd('keyType', e.target.value)}>
                <option value="rsa2048">RSA 2048 (Exchange compatible)</option>
                <option value="rsa4096">RSA 4096</option>
                <option value="p256">ECDSA P-256</option>
                <option value="p384">ECDSA P-384</option>
                <option value="ed25519">Ed25519</option>
              </select>
            </div>
            <div className="field">
              <div className="field-label">Auto HTTPS</div>
              <select className="select" value={state.autoHttps} onChange={e => upd('autoHttps', e.target.value)}>
                <option value="">On (Default)</option>
                <option value="off">Off</option>
                <option value="disable_redirects">Disable Redirects</option>
                <option value="disable_certs">Disable Certs</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3 className="card-title"><IconActivity size={16}/> HTTP &amp; Timeouts</h3></div>
        <div className="card-body">
          <div className="form-grid cols-3">
            <div className="field">
              <div className="field-label">Read Body</div>
              <input className="input" placeholder="10s"/>
            </div>
            <div className="field">
              <div className="field-label">Read Header</div>
              <input className="input" placeholder="10s"/>
            </div>
            <div className="field">
              <div className="field-label">Write</div>
              <input className="input" placeholder="10s"/>
            </div>
            <div className="field">
              <div className="field-label">Idle</div>
              <input className="input" placeholder="2m"/>
            </div>
            <div className="field" style={{gridColumn:'span 2'}}>
              <div className="field-label">HTTP Versions</div>
              <div className="row gap-2">
                {['h1','h2','h3','h2c'].map(v => (
                  <label key={v} className="checkbox" style={{padding:'6px 12px',background:'var(--gray-3)',border:'1px solid var(--gray-5)',borderRadius:4}}>
                    <input type="checkbox" defaultChecked={v==='h1'||v==='h2'}/> {v}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PageGeneral });
