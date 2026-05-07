// PageStats.jsx + Modal + AuthScreen
const PageStats = ({ stats }) => (
  <div className="col gap-5">
    <div className="page-head">
      <div>
        <h1 className="page-title">Stats</h1>
        <p className="page-sub">Runtime metrics from Caddy's admin API.</p>
      </div>
      <button className="btn btn-secondary btn-sm"><IconReload size={14}/> Refresh</button>
    </div>
    <div className="kpi-grid">
      {stats.map((s, i) => (
        <div key={i} className="kpi">
          <div className="kpi-label">{s.label}</div>
          <div className="kpi-value">{s.value}</div>
          <div className="kpi-foot"><span className={`badge ${s.delta>=0?'success':'danger'}`} style={{padding:'1px 6px'}}>{s.delta>=0?'+':''}{s.delta}%</span> vs 1h ago</div>
        </div>
      ))}
    </div>
  </div>
);

const Modal = ({ title, onClose, onSave, children }) => (
  <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <div className="modal-head">
        <h3 className="modal-title">{title}</h3>
        <button className="icon-btn" onClick={onClose}><IconClose size={16}/></button>
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={onSave}>Save</button>
      </div>
    </div>
  </div>
);

const AuthScreen = ({ onLogin }) => {
  const [u, setU] = React.useState('admin');
  const [p, setP] = React.useState('');
  const [show2fa, setShow2fa] = React.useState(false);
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <svg width="36" height="36" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="12" fill="#0B1521"/>
            <g stroke="#3D8BFF" strokeWidth="3" fill="#0B1521">
              <circle cx="20" cy="22" r="6"/><circle cx="44" cy="22" r="6"/><circle cx="20" cy="44" r="6"/><circle cx="44" cy="44" r="6"/></g>
            <g stroke="#2EBFA5" strokeWidth="3">
              <line x1="26" y1="22" x2="38" y2="22"/><line x1="26" y1="44" x2="38" y2="44"/>
              <line x1="20" y1="28" x2="20" y2="38"/><line x1="44" y1="28" x2="44" y2="38"/></g>
          </svg>
          <div>
            <div style={{font:'700 16px var(--font-sans)',color:'var(--fg)'}}>LocalCaddyHub</div>
            <div style={{font:'600 11px var(--font-sans)',letterSpacing:'.06em',textTransform:'uppercase',color:'var(--blue-10)'}}>by BW.Tech</div>
          </div>
        </div>
        <h2 className="auth-title">Welcome back</h2>
        <p className="auth-sub">Sign in to manage your Caddy instance.</p>
        <form onSubmit={(e) => { e.preventDefault(); show2fa ? onLogin?.() : setShow2fa(true); }} className="col gap-4">
          <div className="field"><div className="field-label">Username</div><input className="input" value={u} onChange={e=>setU(e.target.value)} autoComplete="username"/></div>
          <div className="field"><div className="field-label">Password</div><input className="input" type="password" value={p} onChange={e=>setP(e.target.value)} autoComplete="current-password"/></div>
          {show2fa && <div className="field"><div className="field-label">2FA Code</div><input className="input mono" placeholder="123456" autoComplete="one-time-code"/></div>}
          <button type="submit" className="btn btn-primary" style={{padding:'12px 14px',justifyContent:'center'}}>{show2fa ? 'Verify & Sign in' : 'Sign in'}</button>
        </form>
        <div className="row between mt-4">
          <span className="muted" style={{fontSize:12}}>Default: admin / admin</span>
          <select className="select" style={{width:'auto',padding:'4px 8px',fontSize:12}}><option>EN</option><option>DE</option></select>
        </div>
      </div>
    </div>
  );
};
Object.assign(window, { PageStats, Modal, AuthScreen });
