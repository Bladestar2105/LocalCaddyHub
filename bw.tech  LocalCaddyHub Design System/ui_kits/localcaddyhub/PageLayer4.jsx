// PageLayer4.jsx — Layer 4 routes (TCP/UDP, SNI, etc)
const PageLayer4 = ({ rows, openModal }) => (
  <div className="col gap-4">
    <div className="page-head">
      <div>
        <h1 className="page-title">Layer 4 Routes</h1>
        <p className="page-sub">Raw TCP/UDP routing — SNI-based switching, STARTTLS, port forwarding. Powered by <span className="mono">caddy-l4</span>.</p>
      </div>
      <button className="btn btn-success" onClick={() => openModal('layer4')}><IconPlus size={14}/> Add Route</button>
    </div>
    <div className="card">
      <table className="table">
        <thead><tr><th style={{width:40}}>En</th><th>Seq</th><th>Protocol</th><th>Listen</th><th>Matcher</th><th>SNI/Host</th><th>Upstream</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.map((r,i) => (
          <tr key={i}>
            <td><input type="checkbox" defaultChecked={r.enabled}/></td>
            <td className="mono">{r.seq}</td>
            <td><span className="badge muted">{r.protocol}</span></td>
            <td className="mono">{r.listen}</td>
            <td className="mono muted">{r.matcher}</td>
            <td className="mono">{r.sni}</td>
            <td className="mono" style={{color:'var(--blue-10)'}}>{r.upstream}</td>
            <td><span className={`badge ${r.status === 'running' ? 'success' : 'muted'}`}><span className="dot"/>{r.status}</span></td>
            <td className="actions"><div className="row gap-2" style={{justifyContent:'flex-end'}}><button className="icon-btn"><IconEdit size={14}/></button><button className="icon-btn" style={{color:'#FF7B7F'}}><IconTrash size={14}/></button></div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  </div>
);
Object.assign(window, { PageLayer4 });
