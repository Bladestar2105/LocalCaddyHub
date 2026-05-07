// PageControl.jsx — Process Control + Raw Caddyfile
const PageControl = ({ caddyfile, running }) => (
  <div className="col gap-5">
    <div className="page-head">
      <div>
        <h1 className="page-title">Control &amp; Raw</h1>
        <p className="page-sub">Start, stop, reload the Caddy process; inspect the generated Caddyfile.</p>
      </div>
    </div>

    <div className="card">
      <div className="card-head">
        <h3 className="card-title"><IconActivity size={16}/> Process Control</h3>
        <span className={`badge ${running?'success':'danger'}`}><span className="dot"/>{running?'Running · pid 24817':'Stopped'}</span>
      </div>
      <div className="card-body">
        <div className="row gap-3">
          <button className="btn btn-success"><IconPlay size={14}/> Start</button>
          <button className="btn btn-danger"><IconStop size={14}/> Stop</button>
          <button className="btn btn-warning"><IconReload size={14}/> Reload</button>
        </div>
        <div className="statusbox success mt-4">
          <IconCheck size={16} style={{color:'var(--teal-9)'}}/>
          <div><strong>Configuration applied.</strong> Caddy reloaded successfully at 14:21:08 — 8 sites · 12 routes active.</div>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-head">
        <h3 className="card-title"><IconTerminal size={16}/> Raw Caddyfile</h3>
        <button className="btn btn-secondary btn-sm"><IconCopy size={14}/> Copy</button>
      </div>
      <div className="card-body" style={{padding:0}}>
        <pre style={{margin:0,padding:'18px 20px',background:'#02080F',color:'var(--fg-2)',font:'400 12.5px/1.6 var(--font-mono)',overflow:'auto',maxHeight:380}}>{caddyfile}</pre>
      </div>
    </div>
  </div>
);
Object.assign(window, { PageControl });
