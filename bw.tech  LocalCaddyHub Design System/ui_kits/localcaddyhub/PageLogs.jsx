// PageLogs.jsx — Live log viewer with filters
const PageLogs = ({ lines }) => (
  <div className="col gap-4">
    <div className="page-head">
      <div>
        <h1 className="page-title">Live Logs</h1>
        <p className="page-sub">Tail the active Caddy log file. Filter by level, status, method, IP, or path.</p>
      </div>
      <div className="row gap-2">
        <button className="btn btn-secondary btn-sm">Clear</button>
        <button className="btn btn-primary btn-sm"><IconPlay size={14}/> Start Tailing</button>
      </div>
    </div>

    <div className="card">
      <div className="card-body">
        <div className="form-grid cols-3" style={{gap:'12px 16px'}}>
          <div className="field"><div className="field-label">Log File</div>
            <select className="select"><option>access.log (current)</option><option>error.log</option></select></div>
          <div className="field"><div className="field-label">Level</div>
            <select className="select"><option>All</option><option>ERROR</option><option>WARN</option><option>INFO</option><option>DEBUG</option></select></div>
          <div className="field"><div className="field-label">Method</div>
            <select className="select"><option>All</option><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></select></div>
          <div className="field"><div className="field-label">Status</div><input className="input" placeholder="404, 5xx"/></div>
          <div className="field"><div className="field-label">Client IP</div><input className="input" placeholder="192.168.1.1"/></div>
          <div className="field"><div className="field-label">Path / Search</div><input className="input" placeholder="/api"/></div>
        </div>
      </div>
    </div>

    <div className="log-pane">
      {lines.map((l, i) => (
        <div className="log-line" key={i}>
          <span className="ts">{l.ts}</span>
          <span className={`lvl ${l.lvl.toLowerCase()}`}>{l.lvl}</span>
          <span><span style={{color:'var(--blue-10)'}}>{l.method}</span> <span style={{color:'var(--fg)'}}>{l.path}</span> <span style={{color:l.status>=500?'#FF7B7F':l.status>=400?'var(--brand-amber)':'var(--teal-10)'}}>{l.status}</span> <span style={{color:'var(--fg-muted)'}}>· {l.ip} · {l.dur}</span></span>
        </div>
      ))}
    </div>
  </div>
);
Object.assign(window, { PageLogs });
