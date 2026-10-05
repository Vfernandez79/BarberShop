import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch } from "../lib/api";
import ClientLayout from "./ClientLayout";

type AppointmentItem = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  barber_name: string;
  service_name: string;
  duration_min: number;
  price_cents: number;
  payment_url: string | null;
};

function isoToReadable(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-CL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatMoney(cents: number, currency: string): string {
  try {
    const nf = new Intl.NumberFormat("es-CL", { style: "currency", currency });
    const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
    const factor = Math.pow(10, digits);
    return nf.format(cents / factor);
  } catch {
    return `${cents}`;
  }
}

const BOOKING_TOKEN_KEY = "bs_booking_token";
const BOOKING_EMAIL_KEY = "bs_booking_email";

function StatIcon({ name }: { name: "calendar" | "clock" | "check" | "x" }) {
  const common = { width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <path d="M3 10h18" />
        <path d="M4 6h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 8v4l3 2" />
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export default function MyBookingsPage() {
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("COP");

  const [email, setEmail] = useState(() => localStorage.getItem(BOOKING_EMAIL_KEY) ?? "");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [bookingToken, setBookingToken] = useState(() => localStorage.getItem(BOOKING_TOKEN_KEY) ?? "");

  const [items, setItems] = useState<AppointmentItem[] | null>(null);
  const [filter, setFilter] = useState<"future" | "past">("future");
  const [nowTs, setNowTs] = useState(0);

  const hasToken = useMemo(() => Boolean(bookingToken && email.trim()), [bookingToken, email]);
  const filteredItems = useMemo(() => {
    const now = nowTs;
    const isPast = (x: AppointmentItem) => {
      const t = new Date(x.start_at).getTime();
      if (Number.isNaN(t)) return false;
      return t < now;
    };
    return (items ?? [])
      .slice()
      .filter((x) => (filter === "past" ? isPast(x) : !isPast(x)))
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [items, filter, nowTs]);
  const stats = useMemo(() => {
    const total = items?.length ?? 0;
    const pending = (items ?? []).filter((x) => x.status === "PENDING").length;
    const confirmed = (items ?? []).filter((x) => x.status === "CONFIRMED").length;
    const cancelled = (items ?? []).filter((x) => x.status === "CANCELLED").length;
    const totalConfirmedMoney = (items ?? []).filter((x) => x.status === "CONFIRMED").reduce((acc, x) => acc + (x.price_cents || 0), 0);
    return { total, pending, confirmed, cancelled, totalConfirmedMoney };
  }, [items]);

  useEffect(() => {
    void (async () => {
      try {
        const s = await apiFetch<{ currency: string }>("/api/settings");
        setCurrency(s.currency);
      } catch {
        return;
      }
    })();
  }, []);

  useEffect(() => {
    setNowTs(Date.now());
  }, []);

  async function requestCode() {
    setError(null);
    const e = email.trim().toLowerCase();
    if (!e) return setError("Email es requerido");
    try {
      await apiFetch<{ ok: boolean }>("/api/booking/verify/request", { method: "POST", body: JSON.stringify({ email: e }) });
      setCodeRequested(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function confirmCode() {
    setError(null);
    const e = email.trim().toLowerCase();
    const c = code.trim();
    if (!e || !c) return setError("Email y código son requeridos");
    try {
      const resp = await apiFetch<{ ok: boolean; booking_token: string; email: string }>("/api/booking/verify/confirm", {
        method: "POST",
        body: JSON.stringify({ email: e, code: c }),
      });
      setEmail(resp.email);
      setBookingToken(resp.booking_token);
      localStorage.setItem(BOOKING_EMAIL_KEY, resp.email);
      localStorage.setItem(BOOKING_TOKEN_KEY, resp.booking_token);
      setCode("");
      setItems(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  const loadMyBookings = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<AppointmentItem[]>("/api/booking/appointments", { headers: { "X-Booking-Token": bookingToken } });
      setItems(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem(BOOKING_TOKEN_KEY);
        setBookingToken("");
        setItems(null);
      }
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }, [bookingToken]);

  useEffect(() => {
    if (!hasToken) return;
    void loadMyBookings();
  }, [hasToken, loadMyBookings]);

  return (
    <ClientLayout
      title="Mis reservas"
      subtitle="Dashboard de tus citas"
      actions={
        <button type="button" className="clientButtonPrimary" onClick={() => nav("/session")}>
          Nueva reserva
        </button>
      }
    >
      {error ? <div className="clientError">{error}</div> : null}

      {!hasToken ? (
        <div className="clientCard" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Verificación</div>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              Correo electrónico
              <input
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setCode("");
                  setCodeRequested(false);
                }}
                placeholder="cliente@correo.com"
                inputMode="email"
              />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" onClick={requestCode} disabled={!email.trim()}>
                Enviar código
              </button>
              {codeRequested ? <div style={{ color: "var(--client-text-dim)" }}>Revisa tu correo</div> : null}
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              Código de verificación
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric" />
            </label>
            <button type="button" className="clientButtonPrimary" onClick={confirmCode} disabled={!email.trim() || !code.trim()}>
              Verificar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="statGrid">
            <div className="statCard statCard--amber">
              <div>
                <div className="statLabel">Total Reservas</div>
                <div className="statValue">{stats.total}</div>
              </div>
              <div className="statIcon">
                <StatIcon name="calendar" />
              </div>
            </div>
            <div className="statCard statCard--blue">
              <div>
                <div className="statLabel">Pendientes</div>
                <div className="statValue">{stats.pending}</div>
              </div>
              <div className="statIcon">
                <StatIcon name="clock" />
              </div>
            </div>
            <div className="statCard statCard--green">
              <div>
                <div className="statLabel">Confirmadas</div>
                <div className="statValue">{stats.confirmed}</div>
              </div>
              <div className="statIcon">
                <StatIcon name="check" />
              </div>
            </div>
            <div className="statCard statCard--pink">
              <div>
                <div className="statLabel">Canceladas</div>
                <div className="statValue">{stats.cancelled}</div>
              </div>
              <div className="statIcon">
                <StatIcon name="x" />
              </div>
            </div>
          </div>

          <div className="clientCard">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ color: "var(--client-text-dim)" }}>
                <b>Email:</b> {email}
              </div>
              <div style={{ color: "var(--client-text-dim)" }}>
                <b>Total confirmado:</b> {formatMoney(stats.totalConfirmedMoney, currency)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className={filter === "future" ? "clientButtonPrimary" : ""} onClick={() => setFilter("future")}>
                  Futuras
                </button>
                <button type="button" className={filter === "past" ? "clientButtonPrimary" : ""} onClick={() => setFilter("past")}>
                  Pasadas
                </button>
              </div>
              <button type="button" onClick={loadMyBookings} style={{ marginLeft: "auto" }}>
                Actualizar
              </button>
            </div>
          </div>

          {items === null ? (
            <div style={{ color: "var(--client-text-dim)" }}>Cargando...</div>
          ) : filteredItems.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {filteredItems.map((x) => (
                <div key={x.id} className="clientCard">
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 900 }}>{x.service_name}</div>
                    <div style={{ color: "var(--client-text-dim)" }}>({x.duration_min} min)</div>
                    <div style={{ marginLeft: "auto", fontWeight: 800 }}>{x.status}</div>
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 6, color: "var(--client-text-dim)" }}>
                    <div>
                      <b>Barbero:</b> {x.barber_name}
                    </div>
                    <div>
                      <b>Día y hora:</b> {isoToReadable(x.start_at)}
                    </div>
                    <div>
                      <b>Precio:</b> {formatMoney(x.price_cents, currency)}
                    </div>
                  </div>
                  {x.payment_url ? (
                    <div style={{ marginTop: 12 }}>
                      <button type="button" className="clientButtonPrimary" onClick={() => (window.location.href = x.payment_url!)}>
                        Pagar
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--client-text-dim)" }}>
              {filter === "future" ? "No tienes reservas futuras." : "No tienes reservas pasadas."}
            </div>
          )}
        </>
      )}
    </ClientLayout>
  );
}
