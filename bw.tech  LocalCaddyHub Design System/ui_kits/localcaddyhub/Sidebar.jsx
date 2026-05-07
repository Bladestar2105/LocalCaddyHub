// Sidebar.jsx — primary nav for LocalCaddyHub admin
const Sidebar = ({ active, onNav, counts = {} }) => {
  const items = [
    { id: 'general',  label: 'General',           Icon: IconCog,      group: 'Configuration' },
    { id: 'rp',       label: 'Reverse Proxy',     Icon: IconArrows,   count: counts.rp },
    { id: 'layer4',   label: 'Layer 4',           Icon: IconNetwork,  count: counts.l4 },
    { id: 'certs',    label: 'Certificates',      Icon: IconShield,   count: counts.certs },
    { id: 'control',  label: 'Control & Raw',     Icon: IconTerminal, group: 'Operations' },
    { id: 'logs',     label: 'Live Logs',         Icon: IconLog },
    { id: 'stats',    label: 'Stats',             Icon: IconActivity },
  ];
  let lastGroup = null;
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <svg className="glyph" viewBox="0 0 64 64" fill="none">
          <rect width="64" height="64" rx="12" fill="#0B1521"/>
          <g stroke="#3D8BFF" strokeWidth="3" fill="#0B1521">
            <circle cx="20" cy="22" r="6"/><circle cx="44" cy="22" r="6"/>
            <circle cx="20" cy="44" r="6"/><circle cx="44" cy="44" r="6"/>
          </g>
          <g stroke="#2EBFA5" strokeWidth="3">
            <line x1="26" y1="22" x2="38" y2="22"/><line x1="26" y1="44" x2="38" y2="44"/>
            <line x1="20" y1="28" x2="20" y2="38"/><line x1="44" y1="28" x2="44" y2="38"/>
          </g>
        </svg>
        <div>
          <div className="name">LocalCaddyHub</div>
          <div className="sub">by BW.Tech</div>
        </div>
      </div>
      <nav className="nav">
        {items.map((it) => {
          const showHeader = it.group && it.group !== lastGroup;
          if (it.group) lastGroup = it.group;
          return (
            <React.Fragment key={it.id}>
              {showHeader && <div className="nav-section">{it.group}</div>}
              <div className={`nav-item ${active === it.id ? 'active' : ''}`} onClick={() => onNav?.(it.id)}>
                <it.Icon className="ico"/>
                <span>{it.label}</span>
                {it.count != null && <span className="badge">{it.count}</span>}
              </div>
            </React.Fragment>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <span className="pulse"></span>
        Caddy running · v2.7.6
      </div>
    </aside>
  );
};

Object.assign(window, { Sidebar });
