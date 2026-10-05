import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch, setToken } from "../lib/api";
import "./admin.css";

export default function AdminLoginPage() {
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("admin@barbershop.local");
  const [password, setPassword] = useState("admin12345");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const resp = await apiFetch<{ access_token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(resp.access_token);
      nav("/admin/settings");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  return (
    <div className="adminAuthRoot">
      <div className="adminAuthCard">
        <div className="adminAuthHeader">
          <div className="adminBrandMark">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4l16 16" />
              <path d="M7 7l-3 3 4 4 3-3" />
              <path d="M17 17l3-3-4-4-3 3" />
            </svg>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <div className="adminAuthTitle">Admin</div>
            <div className="adminAuthSub">Acceso a panel de Barber Studio</div>
          </div>
        </div>
        {error ? <div className="adminError" style={{ marginBottom: 12 }}>{error}</div> : null}
        <form onSubmit={onSubmit} className="adminFormGrid">
          <input className="adminInput" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" inputMode="email" />
          <input className="adminInput" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
          <button type="submit" className="adminButton adminButtonPrimary">
            Ingresar
          </button>
        </form>
      </div>
    </div>
  );
}
