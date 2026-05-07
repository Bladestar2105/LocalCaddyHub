// PageReverseProxy.jsx — Domains/Subdomains/Handlers/Access/BasicAuth/Headers
const PageReverseProxy = ({ data, setData, openModal }) => {
  const [tab, setTab] = React.useState('domains');
  const subtabs = [
    { id: 'domains',     label: 'Domains',     count: data.domains.length },
    { id: 'subdomains',  label: 'Subdomains',  count: data.subdomains.length },
    { id: 'handlers',    label: 'Handlers',    count: data.handlers.length },
    { id: 'accesslists', label: 'Access Lists',count: data.accesslists.length },
    { id: 'basicauth',   label: 'Basic Auth',  count: data.basicauth.length },
    { id: 'headers',     label: 'Headers',     count: data.headers.length },
  ];

  return (
    <div className="col gap-4">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reverse Proxy</h1>
          <p className="page-sub">Layer-7 routing — domains, subdomains, path handlers, header rewrites, access controls. Changes take effect after Apply.</p>
        </div>
        <button className="btn btn-success" onClick={() => openModal(tab)}>
          <IconPlus size={14}/> Add {subtabs.find(s=>s.id===tab).label.replace(/s$/,'')}
        </button>
      </div>

      <div className="subtabs">
        {subtabs.map(s => (
          <div key={s.id} className={`subtab ${tab===s.id?'active':''}`} onClick={() => setTab(s.id)}>
            {s.label}
            <span className="muted mono" style={{marginLeft:6, fontSize:11}}>{s.count}</span>
          </div>
        ))}
      </div>

      {tab === 'domains' && <TableDomains rows={data.domains}/>}
      {tab === 'subdomains' && <TableSubdomains rows={data.subdomains}/>}
      {tab === 'handlers' && <TableHandlers rows={data.handlers}/>}
      {tab === 'accesslists' && <TableAccessLists rows={data.accesslists}/>}
      {tab === 'basicauth' && <TableBasicAuth rows={data.basicauth}/>}
      {tab === 'headers' && <TableHeaders rows={data.headers}/>}
    </div>
  );
};

const RowActions = () => (
  <div className="row gap-2" style={{justifyContent:'flex-end'}}>
    <button className="icon-btn" title="Edit"><IconEdit size={14}/></button>
    <button className="icon-btn" title="Delete" style={{color:'#FF7B7F'}}><IconTrash size={14}/></button>
  </div>
);

const StatusBadge = ({ status }) => {
  const map = {
    running: { cls:'success', label:'Running' },
    reload:  { cls:'warning', label:'Reload' },
    stopped: { cls:'danger',  label:'Stopped' },
    pending: { cls:'info',    label:'Pending' },
  };
  const m = map[status] || map.pending;
  return <span className={`badge ${m.cls}`}><span className="dot"/>{m.label}</span>;
};

const TableDomains = ({ rows }) => (
  <div className="card">
    <table className="table">
      <thead><tr><th style={{width:40}}>En</th><th>Domain</th><th>Port</th><th>TLS</th><th>Status</th><th>Description</th><th></th></tr></thead>
      <tbody>{rows.map((r,i) => (
        <tr key={i}>
          <td><input type="checkbox" defaultChecked={r.enabled}/></td>
          <td><span className="row gap-2"><IconGlobe size={14} style={{color:'var(--fg-muted)'}}/><span className="mono" style={{color:'var(--fg)'}}>{r.domain}</span></span></td>
          <td className="mono">{r.port}</td>
          <td>{r.tls === 'le' ? <span className="badge info"><IconShield size={10}/>Let's Encrypt</span> : r.tls === 'custom' ? <span className="badge muted">Custom .pem</span> : <span className="muted">—</span>}</td>
          <td><StatusBadge status={r.status}/></td>
          <td className="muted">{r.desc}</td>
          <td className="actions"><RowActions/></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

const TableSubdomains = ({ rows }) => (
  <div className="card">
    <table className="table">
      <thead><tr><th style={{width:40}}>En</th><th>Subdomain</th><th>Parent</th><th>TLS</th><th>Description</th><th></th></tr></thead>
      <tbody>{rows.map((r,i) => (
        <tr key={i}>
          <td><input type="checkbox" defaultChecked={r.enabled}/></td>
          <td><span className="row gap-2"><IconBranch size={14} style={{color:'var(--fg-muted)'}}/><span className="mono" style={{color:'var(--fg)'}}>{r.sub}</span></span></td>
          <td className="mono muted">{r.parent}</td>
          <td>{r.tls === 'le' ? <span className="badge info"><IconShield size={10}/>LE</span> : <span className="muted">—</span>}</td>
          <td className="muted">{r.desc}</td>
          <td className="actions"><RowActions/></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

const TableHandlers = ({ rows }) => (
  <div className="card">
    <table className="table">
      <thead><tr><th style={{width:40}}>En</th><th>Domain/Sub</th><th>Path</th><th>Upstream</th><th>Type</th><th></th></tr></thead>
      <tbody>{rows.map((r,i) => (
        <tr key={i}>
          <td><input type="checkbox" defaultChecked={r.enabled}/></td>
          <td className="mono">{r.host}</td>
          <td className="mono">{r.path}</td>
          <td className="mono"><span style={{color:'var(--blue-10)'}}>{r.upstream}</span></td>
          <td>{r.type === 'ntlm' ? <span className="badge info">NTLM</span> : <span className="badge muted">{r.type || 'http'}</span>}</td>
          <td className="actions"><RowActions/></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

const TableAccessLists = ({ rows }) => (
  <div className="card">
    <table className="table">
      <thead><tr><th>Name</th><th>Client IPs</th><th>Invert</th><th>Description</th><th></th></tr></thead>
      <tbody>{rows.map((r,i) => (
        <tr key={i}>
          <td><span className="row gap-2"><IconUsers size={14} style={{color:'var(--fg-muted)'}}/><strong style={{color:'var(--fg)'}}>{r.name}</strong></span></td>
          <td className="mono" style={{color:'var(--fg-2)'}}>{r.ips}</td>
          <td>{r.invert ? <span className="badge warning"><span className="dot"/>Inverted</span> : <span className="muted">—</span>}</td>
          <td className="muted">{r.desc}</td>
          <td className="actions"><RowActions/></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

const TableBasicAuth = ({ rows }) => (
  <div className="card">
    <table className="table">
      <thead><tr><th>User</th><th>Hash</th><th>Description</th><th></th></tr></thead>
      <tbody>{rows.map((r,i) => (
        <tr key={i}>
          <td><span className="row gap-2"><IconKey size={14} style={{color:'var(--fg-muted)'}}/><span className="mono" style={{color:'var(--fg)'}}>{r.user}</span></span></td>
          <td className="mono muted">{r.hash}</td>
          <td className="muted">{r.desc}</td>
          <td className="actions"><RowActions/></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

const TableHeaders = ({ rows }) => (
  <div className="card">
    <table className="table">
      <thead><tr><th>Type</th><th>Header</th><th>Value</th><th>Replace</th><th>Description</th><th></th></tr></thead>
      <tbody>{rows.map((r,i) => (
        <tr key={i}>
          <td>{r.type === 'request' ? <span className="badge info">Request</span> : <span className="badge success">Response</span>}</td>
          <td className="mono">{r.header}</td>
          <td className="mono" style={{color:'var(--fg-2)'}}>{r.value}</td>
          <td>{r.replace ? <span className="badge warning"><span className="dot"/>Yes</span> : <span className="muted">—</span>}</td>
          <td className="muted">{r.desc}</td>
          <td className="actions"><RowActions/></td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

Object.assign(window, { PageReverseProxy });
