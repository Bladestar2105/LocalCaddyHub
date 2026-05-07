// PageCerts.jsx — Certificates: upload, ACME, PFX export
const PageCerts = ({ certs }) => (
  <div className="col gap-5">
    <div className="page-head">
      <div>
        <h1 className="page-title">Certificates</h1>
        <p className="page-sub">Upload custom <span className="mono">.pem</span> / <span className="mono">.key</span>, manage ACME-issued certificates, or export PFX bundles for Windows.</p>
      </div>
    </div>

    <div className="kpi-grid">
      <div className="kpi"><div className="kpi-label">Active</div><div className="kpi-value">12</div><div className="kpi-foot"><span className="badge success" style={{padding:'1px 6px'}}><span className="dot"/>Healthy</span></div></div>
      <div className="kpi"><div className="kpi-label">Expiring &lt; 30d</div><div className="kpi-value" style={{color:'var(--brand-amber)'}}>2</div><div className="kpi-foot"><span style={{color:'var(--brand-amber)'}}>Renewal pending</span></div></div>
      <div className="kpi"><div className="kpi-label">ACME issued</div><div className="kpi-value">9</div><div className="kpi-foot">Let's Encrypt</div></div>
      <div className="kpi"><div className="kpi-label">Custom uploads</div><div className="kpi-value">3</div><div className="kpi-foot">in <span className="mono">./certs/</span></div></div>
    </div>

    <div className="card">
      <div className="card-head">
        <h3 className="card-title"><IconShield size={16}/> Caddy-managed ACME</h3>
        <div className="row gap-2">
          <button className="btn btn-secondary btn-sm"><IconDownload size={14}/> Download .tar.gz</button>
          <button className="btn btn-warning btn-sm"><IconReload size={14}/> Renew all as RSA</button>
          <button className="btn btn-primary btn-sm"><IconPlus size={14}/> Request Certificates</button>
        </div>
      </div>
      <table className="table">
        <thead><tr><th>Domain</th><th>Issuer</th><th>Key</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>{certs.map((c,i) => (
          <tr key={i}>
            <td className="mono" style={{color:'var(--fg)'}}>{c.domain}</td>
            <td className="muted">{c.issuer}</td>
            <td><span className="badge muted">{c.key}</span></td>
            <td className="mono">{c.expires}</td>
            <td><span className={`badge ${c.expiring ? 'warning' : 'success'}`}><span className="dot"/>{c.expiring ? 'Expiring' : 'Healthy'}</span></td>
            <td className="actions"><button className="btn btn-secondary btn-sm">Renew</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>

    <div className="card">
      <div className="card-head"><h3 className="card-title"><IconDownload size={16}/> Windows PFX Export</h3></div>
      <div className="card-body">
        <div className="form-grid cols-3">
          <div className="field"><div className="field-label">Cert/Key Pair</div><select className="select"><option>bw.tech (Let's Encrypt)</option><option>helpdesk.bw-tech.de</option></select></div>
          <div className="field"><div className="field-label">PFX Password</div><input type="password" className="input" placeholder="••••••••"/></div>
          <div className="field" style={{justifyContent:'flex-end'}}><button className="btn btn-primary"><IconDownload size={14}/> Download PFX</button></div>
        </div>
      </div>
    </div>
  </div>
);
Object.assign(window, { PageCerts });
