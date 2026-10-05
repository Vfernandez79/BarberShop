import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import "./client.css";

function Mark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l16 16" />
      <path d="M7 7l-3 3 4 4 3-3" />
      <path d="M17 17l3-3-4-4-3 3" />
    </svg>
  );
}

export default function ClientLayout({
  title,
  subtitle,
  actions,
  showNav = true,
  showActions = true,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  showNav?: boolean;
  showActions?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="clientRoot">
      <header className="clientTopbar">
        <Link className="clientBrand" to="/">
          <div className="clientBrandMark">
            <Mark />
          </div>
          <div className="clientBrandText">
            <div className="clientBrandTitle">BARBER</div>
            <div className="clientBrandSub">STUDIO</div>
          </div>
        </Link>
        {showNav ? (
          <nav className="clientNav">
            <Link className="clientNavLink" to="/session">
              Reservar
            </Link>
            <Link className="clientNavLink" to="/my-bookings">
              Mis reservas
            </Link>
          </nav>
        ) : null}
        <div className="clientTitleBlock">
          <div className="clientTitle">{title}</div>
          {subtitle ? <div className="clientSubtitle">{subtitle}</div> : null}
        </div>
        {showActions ? <div className="clientTopbarActions">{actions}</div> : null}
      </header>
      <main className="clientContent">
        <div className="clientContainer">{children}</div>
      </main>
    </div>
  );
}
