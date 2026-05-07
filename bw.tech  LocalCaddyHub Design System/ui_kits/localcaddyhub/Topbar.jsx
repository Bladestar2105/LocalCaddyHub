// Topbar.jsx — top bar with breadcrumbs + apply/validate + global controls
const Topbar = ({ crumbs = [], lang, setLang, onApply, onValidate, applyState }) => (
  <div className="topbar">
    <div className="topbar-left">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {i === crumbs.length - 1 ? <strong>{c}</strong> : <span>{c}</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
    <div className="topbar-right">
      {applyState === 'pending' && (
        <span className="badge warning"><span className="dot"></span>Unsaved changes</span>
      )}
      {applyState === 'applied' && (
        <span className="badge success"><span className="dot"></span>Applied 4s ago</span>
      )}
      <button className="btn btn-secondary btn-sm" onClick={onValidate}>
        <IconCheck className="ico" size={14}/> Validate
      </button>
      <button className="btn btn-primary btn-sm" onClick={onApply}>
        <IconPlay className="ico" size={14}/> Apply Configuration
      </button>
      <div style={{width:1, height:24, background:'var(--gray-5)', margin:'0 6px'}}/>
      <div className="row gap-2">
        <IconLanguages size={16} style={{color:'var(--fg-muted)'}}/>
        <select className="select" style={{width:'auto', padding:'6px 8px', fontSize:12}}
                value={lang} onChange={e => setLang?.(e.target.value)}>
          <option value="en">EN</option>
          <option value="de">DE</option>
        </select>
      </div>
      <button className="icon-btn" title="2FA Settings"><IconLock size={16}/></button>
      <button className="icon-btn" title="Logout"><IconLogout size={16}/></button>
    </div>
  </div>
);

Object.assign(window, { Topbar });
