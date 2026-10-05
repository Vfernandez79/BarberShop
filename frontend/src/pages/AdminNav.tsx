import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError, apiFetch, setToken } from "../lib/api";

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

export default function AdminNav() {
  const nav = useNavigate();
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

  const dbLabel =
    dbInfo?.dialect === "sqlite"
      ? "sqlite"
      : dbInfo?.dialect === "mssql+pyodbc"
        ? `mssql (${dbInfo.azure_database ?? "?"})`
        : dbInfo
          ? "unknown"
          : null;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
      <Link to="/">Home</Link>
      <Link to="/admin/settings">Settings</Link>
      <Link to="/admin/barbers">Barberos</Link>
      <Link to="/admin/services">Servicios</Link>
      <Link to="/admin/clients">Clientes</Link>
      {dbLabel ? <span style={{ color: "#555", fontSize: 12 }}>API DB: {dbLabel}</span> : null}
      {dbInfoError ? <span style={{ color: "crimson", fontSize: 12 }}>API DB: {dbInfoError}</span> : null}
      <button
        onClick={() => {
          setToken(null);
          nav("/admin/login");
        }}
        style={{ marginLeft: "auto" }}
      >
        Logout
      </button>
    </div>
  );
}

