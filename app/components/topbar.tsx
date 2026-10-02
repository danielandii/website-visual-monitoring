export function Topbar({ crumbs, note }: { crumbs: string[]; note?: string }) {
  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((crumb, index) => (
          <span key={index} style={{ display: "contents" }}>
            {index > 0 ? <span>/</span> : null}
            <span className={index === crumbs.length - 1 ? "leaf" : ""}>{crumb}</span>
          </span>
        ))}
      </div>
      {note ? <div className="cadence-note">{note}</div> : null}
    </header>
  );
}
