import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { apiFetch, ApiError } from "../lib/api";
import { useRequireAuth } from "../lib/useRequireAuth";
import AdminLayout from "./AdminLayout";

type Barber = { id: string; display_name: string; has_photo: boolean; timezone: string; is_bookable: boolean };
type Service = { id: string; name: string; duration_min: number; price_cents: number; requires_payment: boolean; is_active: boolean };
type Weekly = { id: string; weekday: number; start_time: string; end_time: string; is_active: boolean };
type ExceptionItem = { id: string; date: string; start_time: string | null; end_time: string | null; type: "BLOCK" | "OPEN"; reason: string | null };

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
];

function normalizeHHMM(value: string): string {
  const m = value.match(/^(\d{2}):(\d{2})/);
  if (!m) return value;
  return `${m[1]}:${m[2]}`;
}

export default function AdminBarbersPage() {
  useRequireAuth();
  const [error, setError] = useState<string | null>(null);

  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [weeklyWeekday, setWeeklyWeekday] = useState(1);
  const [weeklyStart, setWeeklyStart] = useState("09:00");
  const [weeklyEnd, setWeeklyEnd] = useState("18:00");
  const [weeklyEdits, setWeeklyEdits] = useState<Record<string, { weekday: number; start_time: string; end_time: string; is_active: boolean }>>({});

  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [exDate, setExDate] = useState("");
  const [exType, setExType] = useState<"BLOCK" | "OPEN">("BLOCK");
  const [exStart, setExStart] = useState<string>("");
  const [exEnd, setExEnd] = useState<string>("");
  const [exReason, setExReason] = useState("");

  const [editBarberName, setEditBarberName] = useState("");
  const [editBarberTimezone, setEditBarberTimezone] = useState("UTC");
  const [assignedServiceIds, setAssignedServiceIds] = useState<Set<string>>(new Set());

  const selectedBarber = useMemo(() => barbers.find((b) => b.id === selectedBarberId) ?? null, [barbers, selectedBarberId]);

  const loadBase = useCallback(async () => {
    setError(null);
    try {
      const [b, s] = await Promise.all([apiFetch<Barber[]>("/api/admin/barbers"), apiFetch<Service[]>("/api/admin/services")]);
      setBarbers(b);
      setServices(s.filter((x) => x.is_active));
      if (!selectedBarberId && b.length) setSelectedBarberId(b[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }, [selectedBarberId]);

  async function loadWeekly(barberId: string) {
    setError(null);
    try {
      const items = await apiFetch<Weekly[]>(`/api/admin/barbers/${barberId}/weekly`);
      setWeekly(items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function loadExceptions(barberId: string) {
    setError(null);
    try {
      const items = await apiFetch<ExceptionItem[]>(`/api/admin/barbers/${barberId}/exceptions`);
      setExceptions(items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function loadAssignedServices(barberId: string) {
    setError(null);
    try {
      const ids = await apiFetch<string[]>(`/api/admin/barbers/${barberId}/services`);
      setAssignedServiceIds(new Set(ids));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (selectedBarberId) {
      loadWeekly(selectedBarberId);
      loadExceptions(selectedBarberId);
      loadAssignedServices(selectedBarberId);
    }
  }, [selectedBarberId]);

  useEffect(() => {
    const next: Record<string, { weekday: number; start_time: string; end_time: string; is_active: boolean }> = {};
    for (const w of weekly) {
      next[w.id] = { weekday: w.weekday, start_time: normalizeHHMM(w.start_time), end_time: normalizeHHMM(w.end_time), is_active: w.is_active };
    }
    setWeeklyEdits(next);
  }, [weekly]);

  useEffect(() => {
    if (!selectedBarber) return;
    setEditBarberName(selectedBarber.display_name);
    setEditBarberTimezone(selectedBarber.timezone);
  }, [selectedBarber]);

  async function uploadPhoto(barberId: string, file: File) {
    setError(null);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      await apiFetch<{ ok: boolean }>(`/api/admin/barbers/${barberId}/photo`, { method: "PUT", body: fd });
      await loadBase();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function deletePhoto(barberId: string) {
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/barbers/${barberId}/photo`, { method: "DELETE" });
      await loadBase();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch<Barber>("/api/admin/barbers", {
        method: "POST",
        body: JSON.stringify({ display_name: displayName, timezone, email, password: password || undefined }),
      });
      setDisplayName("");
      setEmail("");
      setPassword("");
      await loadBase();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function toggleBookable(b: Barber) {
    setError(null);
    try {
      await apiFetch<Barber>(`/api/admin/barbers/${b.id}`, { method: "PATCH", body: JSON.stringify({ is_bookable: !b.is_bookable }) });
      await loadBase();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function onUpdateBarber() {
    if (!selectedBarberId) return;
    setError(null);
    try {
      await apiFetch<Barber>(`/api/admin/barbers/${selectedBarberId}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: editBarberName, timezone: editBarberTimezone }),
      });
      await loadBase();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function onDeleteBarber(barberId: string) {
    const ok = confirm("¿Eliminar (desactivar) este barbero? Se marcará como no bookable.");
    if (!ok) return;
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/barbers/${barberId}`, { method: "DELETE" });
      if (selectedBarberId === barberId) setSelectedBarberId(null);
      await loadBase();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function addServiceToBarber(serviceId: string) {
    if (!selectedBarberId) return;
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/barbers/${selectedBarberId}/services/${serviceId}`, { method: "POST" });
      setAssignedServiceIds((prev) => new Set([...prev, serviceId]));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function removeServiceFromBarber(serviceId: string) {
    if (!selectedBarberId) return;
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/barbers/${selectedBarberId}/services/${serviceId}`, { method: "DELETE" });
      setAssignedServiceIds((prev) => {
        const next = new Set(prev);
        next.delete(serviceId);
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function addWeekly(e: FormEvent) {
    e.preventDefault();
    if (!selectedBarberId) return;
    setError(null);
    try {
      await apiFetch<Weekly>(`/api/admin/barbers/${selectedBarberId}/weekly`, {
        method: "POST",
        body: JSON.stringify({ weekday: weeklyWeekday, start_time: weeklyStart, end_time: weeklyEnd, is_active: true }),
      });
      await loadWeekly(selectedBarberId);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function saveWeekly(weeklyId: string) {
    if (!selectedBarberId) return;
    const draft = weeklyEdits[weeklyId];
    if (!draft) return;
    setError(null);
    try {
      await apiFetch<Weekly>(`/api/admin/barbers/${selectedBarberId}/weekly/${weeklyId}`, {
        method: "PATCH",
        body: JSON.stringify({
          weekday: draft.weekday,
          start_time: draft.start_time,
          end_time: draft.end_time,
          is_active: draft.is_active,
        }),
      });
      await loadWeekly(selectedBarberId);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function deleteWeekly(w: Weekly) {
    if (!selectedBarberId) return;
    const ok = confirm("¿Eliminar este segmento de horario semanal?");
    if (!ok) return;
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/barbers/${selectedBarberId}/weekly/${w.id}`, { method: "DELETE" });
      await loadWeekly(selectedBarberId);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function addException(e: FormEvent) {
    e.preventDefault();
    if (!selectedBarberId) return;
    setError(null);
    try {
      await apiFetch<ExceptionItem>(`/api/admin/barbers/${selectedBarberId}/exceptions`, {
        method: "POST",
        body: JSON.stringify({
          date: exDate,
          type: exType,
          start_time: exStart ? exStart : null,
          end_time: exEnd ? exEnd : null,
          reason: exReason ? exReason : null,
        }),
      });
      setExReason("");
      await loadExceptions(selectedBarberId);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function deleteException(exId: string) {
    if (!selectedBarberId) return;
    const ok = confirm("¿Eliminar esta excepción?");
    if (!ok) return;
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/barbers/${selectedBarberId}/exceptions/${exId}`, { method: "DELETE" });
      await loadExceptions(selectedBarberId);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  return (
    <AdminLayout title="Barberos" subtitle="Gestión de barberos, horarios y excepciones">
      {error ? <div className="adminError">{error}</div> : null}

      <form onSubmit={onCreate} style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr 1fr 120px", gap: 8 }}>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nombre visible" />
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Timezone" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (opcional)" type="password" />
        <button type="submit">Crear</button>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16, marginTop: 16 }}>
        <div>
          <h3>Listado</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {barbers.map((b) => (
              <div key={b.id} style={{ border: "1px solid #ddd", padding: 10, borderRadius: 8 }}>
                <button
                  onClick={() => setSelectedBarberId(b.id)}
                  style={{ fontWeight: selectedBarberId === b.id ? 700 : 400, display: "block", width: "100%", textAlign: "left" }}
                >
                  {b.display_name}
                </button>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <span>{b.timezone}</span>
                  <button onClick={() => toggleBookable(b)} style={{ marginLeft: "auto" }}>
                    {b.is_bookable ? "Bookable" : "No bookable"}
                  </button>
                  <button onClick={() => onDeleteBarber(b.id)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3>Configuración</h3>
          {!selectedBarber ? (
            <div>Selecciona un barbero</div>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontWeight: 700 }}>Datos</div>
                <input value={editBarberName} onChange={(e) => setEditBarberName(e.target.value)} placeholder="Nombre visible" />
                <input value={editBarberTimezone} onChange={(e) => setEditBarberTimezone(e.target.value)} placeholder="Timezone" style={{ width: 140 }} />
                <button onClick={onUpdateBarber}>Guardar</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>Foto</div>
                {selectedBarber.has_photo ? (
                  <img
                    src={`/api/catalog/barbers/${selectedBarber.id}/photo`}
                    alt={selectedBarber.display_name}
                    style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", background: "rgba(255,255,255,0.12)" }}
                  />
                ) : (
                  <div style={{ width: 56, height: 56, borderRadius: 12, background: "rgba(255,255,255,0.12)" }} />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void uploadPhoto(selectedBarber.id, file);
                    e.target.value = "";
                  }}
                />
                {selectedBarber.has_photo ? <button onClick={() => deletePhoto(selectedBarber.id)}>Eliminar foto</button> : null}
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Asignar servicios a: {selectedBarber.display_name}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {services.map((s) => {
                    const checked = assignedServiceIds.has(s.id);
                    return (
                      <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) void addServiceToBarber(s.id);
                            else void removeServiceFromBarber(s.id);
                          }}
                        />
                        <span>{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Horario semanal</div>
                <form onSubmit={addWeekly} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label>
                    Día
                    <select value={weeklyWeekday} onChange={(e) => setWeeklyWeekday(Number(e.target.value))} style={{ width: 160, marginLeft: 8 }}>
                      {WEEKDAYS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Inicio
                    <input type="time" value={weeklyStart} onChange={(e) => setWeeklyStart(e.target.value)} style={{ width: 130, marginLeft: 8 }} />
                  </label>
                  <label>
                    Fin
                    <input type="time" value={weeklyEnd} onChange={(e) => setWeeklyEnd(e.target.value)} style={{ width: 130, marginLeft: 8 }} />
                  </label>
                  <button type="submit">Agregar</button>
                </form>

                <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th align="left">Día</th>
                      <th align="left">Inicio</th>
                      <th align="left">Fin</th>
                      <th align="left">Activo</th>
                      <th align="left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekly
                      .slice()
                      .sort((a, b) => {
                        if (a.weekday !== b.weekday) return a.weekday - b.weekday;
                        return a.start_time.localeCompare(b.start_time);
                      })
                      .map((w) => (
                      <tr key={w.id} style={{ borderTop: "1px solid #ddd" }}>
                        <td>
                          <select
                            value={weeklyEdits[w.id]?.weekday ?? w.weekday}
                            onChange={(e) =>
                              setWeeklyEdits((prev) => {
                                const base = prev[w.id] ?? { weekday: w.weekday, start_time: w.start_time, end_time: w.end_time, is_active: w.is_active };
                                return { ...prev, [w.id]: { ...base, weekday: Number(e.target.value) } };
                              })
                            }
                          >
                            {WEEKDAYS.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="time"
                            value={weeklyEdits[w.id]?.start_time ?? w.start_time}
                            onChange={(e) =>
                              setWeeklyEdits((prev) => {
                                const base = prev[w.id] ?? { weekday: w.weekday, start_time: w.start_time, end_time: w.end_time, is_active: w.is_active };
                                return { ...prev, [w.id]: { ...base, start_time: e.target.value } };
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="time"
                            value={weeklyEdits[w.id]?.end_time ?? w.end_time}
                            onChange={(e) =>
                              setWeeklyEdits((prev) => {
                                const base = prev[w.id] ?? { weekday: w.weekday, start_time: w.start_time, end_time: w.end_time, is_active: w.is_active };
                                return { ...prev, [w.id]: { ...base, end_time: e.target.value } };
                              })
                            }
                          />
                        </td>
                        <td>
                          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={weeklyEdits[w.id]?.is_active ?? w.is_active}
                              onChange={(e) =>
                                setWeeklyEdits((prev) => {
                                  const base = prev[w.id] ?? { weekday: w.weekday, start_time: w.start_time, end_time: w.end_time, is_active: w.is_active };
                                  return { ...prev, [w.id]: { ...base, is_active: e.target.checked } };
                                })
                              }
                            />
                            {(weeklyEdits[w.id]?.is_active ?? w.is_active) ? "Sí" : "No"}
                          </label>
                        </td>
                        <td>
                          <button type="button" onClick={() => saveWeekly(w.id)}>
                            Guardar
                          </button>
                          <button type="button" onClick={() => deleteWeekly(w)}>
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Excepciones</div>
                <form onSubmit={addException} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input value={exDate} onChange={(e) => setExDate(e.target.value)} placeholder="YYYY-MM-DD" style={{ width: 140 }} />
                  <select value={exType} onChange={(e) => setExType(e.target.value as "BLOCK" | "OPEN")}>
                    <option value="BLOCK">BLOCK</option>
                    <option value="OPEN">OPEN</option>
                  </select>
                  <input value={exStart} onChange={(e) => setExStart(e.target.value)} placeholder="Inicio (opcional HH:MM)" style={{ width: 180 }} />
                  <input value={exEnd} onChange={(e) => setExEnd(e.target.value)} placeholder="Fin (opcional HH:MM)" style={{ width: 170 }} />
                  <input value={exReason} onChange={(e) => setExReason(e.target.value)} placeholder="Motivo (opcional)" />
                  <button type="submit">Agregar</button>
                </form>

                <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th align="left">Fecha</th>
                      <th align="left">Tipo</th>
                      <th align="left">Rango</th>
                      <th align="left">Motivo</th>
                      <th align="left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.map((x) => (
                      <tr key={x.id} style={{ borderTop: "1px solid #ddd" }}>
                        <td>{x.date}</td>
                        <td>{x.type}</td>
                        <td>{x.start_time && x.end_time ? `${x.start_time} - ${x.end_time}` : "Todo el día"}</td>
                        <td>{x.reason ?? ""}</td>
                        <td>
                          <button onClick={() => deleteException(x.id)}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

