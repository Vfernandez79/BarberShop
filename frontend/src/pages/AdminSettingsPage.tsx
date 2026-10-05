import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ApiError, apiFetch } from "../lib/api";
import { useRequireAuth } from "../lib/useRequireAuth";
import AdminLayout from "./AdminLayout";

type Settings = { slot_minutes: number; booking_horizon_days: number; min_notice_minutes: number; currency: string };

export default function AdminSettingsPage() {
  useRequireAuth();
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Settings | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await apiFetch<Settings>("/api/settings");
      setS(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setError(null);
    try {
      const updated = await apiFetch<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) });
      setS(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  return (
    <AdminLayout title="Dashboard" subtitle="Configuración general">
      {error ? <div className="adminError">{error}</div> : null}
      <div className="adminCard">
        {!s ? (
          <div style={{ color: "rgba(255,255,255,0.72)" }}>Cargando...</div>
        ) : (
          <form onSubmit={onSave} className="adminFormGrid" style={{ maxWidth: 680 }}>
            <div className="adminFormRow">
              <div style={{ color: "rgba(255,255,255,0.72)" }}>slot_minutes</div>
              <input className="adminInput" type="number" value={s.slot_minutes} onChange={(e) => setS({ ...s, slot_minutes: Number(e.target.value) })} />
            </div>
            <div className="adminFormRow">
              <div style={{ color: "rgba(255,255,255,0.72)" }}>booking_horizon_days</div>
              <input
                className="adminInput"
                type="number"
                value={s.booking_horizon_days}
                onChange={(e) => setS({ ...s, booking_horizon_days: Number(e.target.value) })}
              />
            </div>
            <div className="adminFormRow">
              <div style={{ color: "rgba(255,255,255,0.72)" }}>min_notice_minutes</div>
              <input
                className="adminInput"
                type="number"
                value={s.min_notice_minutes}
                onChange={(e) => setS({ ...s, min_notice_minutes: Number(e.target.value) })}
              />
            </div>
            <div className="adminFormRow">
              <div style={{ color: "rgba(255,255,255,0.72)" }}>currency</div>
              <input className="adminInput" value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="adminButton adminButtonPrimary">
                Guardar
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminLayout>
  );
}
