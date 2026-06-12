export function Header({ title, subtitle, onBack, action }) {
  return (
    <header className="header">
      <div className="header-start">
        {onBack ? (
          <button type="button" className="icon-button" onClick={onBack} aria-label="Go back">
            ←
          </button>
        ) : (
          <div className="header-spacer" />
        )}
      </div>
      <div className="header-center">
        <p className="header-eyebrow">{subtitle}</p>
        <h1 className="header-title">{title}</h1>
      </div>
      <div className="header-end">{action ?? <div className="header-spacer" />}</div>
    </header>
  )
}
