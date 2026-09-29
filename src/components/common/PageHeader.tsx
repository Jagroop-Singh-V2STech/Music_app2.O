import type { ReactNode } from "react";

interface PageHeaderProps { eyebrow?: string; title: string; subtitle?: ReactNode; hue?: number; art?: ReactNode; children?: ReactNode; compact?: boolean }

export function PageHeader({ eyebrow, title, subtitle, hue = 250, art, children, compact = false }: PageHeaderProps) {
  return (
    <header className={`page-header ${art ? "with-art" : ""} ${compact ? "compact" : ""}`} style={{ "--hue": hue } as React.CSSProperties}>
      {art}
      <div className="page-header-copy">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
