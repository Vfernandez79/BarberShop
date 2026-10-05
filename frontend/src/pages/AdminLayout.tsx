import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";

import { ApiError, apiFetch, setToken } from "../lib/api";
import "./admin.css";

type DebugDb =
  | {
      dialect: "sqlite";
      url: string;
      pid: number;
      cwd: string;
      started_at: string;
      api_prefix: string;
      db_auto_create: boolean;
    }
  | {
      dialect: "mssql+pyodbc" | "unknown";
      azure_server: string | null;
      azure_database: string | null;
      pid: number;
      cwd: string;
      started_at: string;
      api_prefix: string;
      db_auto_create: boolean;
    };

function Icon({ name }: { name: "dashboard" | "barbers" | "services" | "clients" | "settings" | "plus" | "exit" | "book" | "menu" }) {
  const common = { className: "adminNavIcon", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "menu") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }
  if (name === "exit") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M21 3v18" />
      </svg>
    );
  }
  if (name === "book") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 19a2 2 0 0 0 2 2h14" />
        <path d="M6 3h14v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        <path d="M8 7h8" />
        <path d="M8 11h8" />
      </svg>
    );
  }
  if (name === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 13h7V4H4v9z" />
        <path d="M13 20h7V11h-7v9z" />
        <path d="M13 4h7v5h-7V4z" />
        <path d="M4 20h7v-5H4v5z" />
      </svg>
    );
  }
  if (name === "barbers") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 4l16 16" />
        <path d="M7 7l-3 3 4 4 3-3" />
        <path d="M17 17l3-3-4-4-3 3" />
      </svg>
    );
  }
  if (name === "services") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M7 7h10" />
        <path d="M7 12h10" />
        <path d="M7 17h10" />
      </svg>
    );
  }
  if (name === "clients") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M12 2l9 4v6c0 5-3.8 9.4-9 10-5.2-.6-9-5-9-10V6l9-4z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export default function AdminLayout({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const nav = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dbInfo, setDbInfo] = useState<DebugDb | null>(null);
  const [dbInfoError, setDbInfoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await apiFetch<DebugDb>("/api/admin/debug/db");
        if (!cancelled) setDbInfo(info);
      } catch (err) {
        if (cancelled) return;
        setDbInfoError(err instanceof ApiError ? err.detail : "Error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dbLabel = useMemo(() => {
    if (!dbInfo) return null;
    if (dbInfo.dialect === "sqlite") return "sqlite";
    if (dbInfo.dialect === "mssql+pyodbc") return `mssql (${dbInfo.azure_database ?? "?"})`;
    return "unknown";
  }, [dbInfo]);

  return (
    <div className="adminRoot">
      {sidebarOpen ? <div className="adminBackdrop" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`adminSidebar${sidebarOpen ? " isOpen" : ""}`}>
        <div className="adminBrand">
          <div className="adminBrandMark">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4l16 16" />
              <path d="M7 7l-3 3 4 4 3-3" />
              <path d="M17 17l3-3-4-4-3 3" />
            </svg>
          </div>
          <div className="adminBrandText">
            <div className="adminBrandTitle">BARBER</div>
            <div className="adminBrandSub">STUDIO</div>
          </div>
        </div>

        <nav className="adminNav" onClick={() => setSidebarOpen(false)}>
          <NavLink to="/admin/settings" className={({ isActive }) => `adminNavLink${isActive ? " isActive" : ""}`}>
            <Icon name="dashboard" />
            Dashboard
          </NavLink>
          <NavLink to="/admin/barbers" className={({ isActive }) => `adminNavLink${isActive ? " isActive" : ""}`}>
            <Icon name="barbers" />
            Barberos
          </NavLink>
          <NavLink to="/admin/services" className={({ isActive }) => `adminNavLink${isActive ? " isActive" : ""}`}>
            <Icon name="services" />
            Servicios
          </NavLink>
          <NavLink to="/admin/clients" className={({ isActive }) => `adminNavLink${isActive ? " isActive" : ""}`}>
            <Icon name="clients" />
            Clientes
          </NavLink>
        </nav>

        <div className="adminSidebarFooter">
          <div className="adminFooterRow">
            <Link className="adminButton adminButtonPrimary" to="/session">
              <Icon name="book" />
              Página de Reservas
            </Link>
          </div>
          <div className="adminMeta">{dbLabel ? `API DB: ${dbLabel}` : dbInfoError ? `API DB: ${dbInfoError}` : "API DB: ..."}</div>
          <div className="adminFooterRow">
            <button
              type="button"
              className="adminButton"
              onClick={() => {
                setToken(null);
                nav("/admin/login");
              }}
            >
              <Icon name="exit" />
              Salir
            </button>
          </div>
        </div>
      </aside>

      <div className="adminMain">
        <header className="adminTopbar">
          <button type="button" className="adminHamburger" onClick={() => setSidebarOpen((x) => !x)}>
            <Icon name="menu" />
          </button>
          <div className="adminTitleBlock">
            <div className="adminTitle">{title}</div>
            {subtitle ? <div className="adminSubtitle">{subtitle}</div> : null}
          </div>
          <div className="adminTopbarActions">
            {actions}
            <Link className="adminButton adminButtonPrimary" to="/session">
              <Icon name="plus" />
              Nueva Cita
            </Link>
          </div>
        </header>
        <main className="adminContent">
          <div className="adminContainer">{children}</div>
        </main>
      </div>
    </div>
  );
}
