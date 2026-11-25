export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 28 22" aria-hidden="true">
      <rect x="0" y="1" width="9" height="4" fill="currentColor" />
      <rect x="0" y="9" width="15" height="4" fill="currentColor" />
      <rect x="0" y="17" width="26" height="4" fill="var(--vermilion)" />
    </svg>
  );
}

export function Header() {
  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <a className="brand" href="#top" aria-label="Tilt, back to top">
          <Mark />
          <span>Tilt</span>
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#observation">Observation</a>
          <a href="#experiment">Experiment</a>
          <a href="#method">Method</a>
          <a href="#results">Results</a>
          <a href="#log">Log</a>
        </nav>
      </div>
    </header>
  );
}