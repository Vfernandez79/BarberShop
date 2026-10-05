import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { apiFetch, ApiError } from "../lib/api";
import { useRequireAuth } from "../lib/useRequireAuth";
import AdminLayout from "./AdminLayout";

type Service = {
  id: string;
  name: string;
  duration_min: number;
  price_cents: number;
  requires_payment: boolean;
  is_active: boolean;
};

export default function AdminServicesPage() {
  useRequireAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDurationMin, setEditDurationMin] = useState(30);
  const [editPriceCents, setEditPriceCents] = useState(5000);
  const [editRequiresPayment, setEditRequiresPayment] = useState(false);

  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [priceCents, setPriceCents] = useState(5000);
  const [requiresPayment, setRequiresPayment] = useState(false);

  async function load() {
    setError(null);
    try {
      const items = await apiFetch<Service[]>("/api/admin/services");
      setServices(items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch<Service>("/api/admin/services", {
        method: "POST",
        body: JSON.stringify({
          name,
          duration_min: durationMin,
          price_cents: priceCents,
          requires_payment: requiresPayment,
        }),
      });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function toggleActive(s: Service) {
    setError(null);
    try {
      await apiFetch<Service>(`/api/admin/services/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !s.is_active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function toggleRequiresPayment(s: Service) {
    setError(null);
    try {
      await apiFetch<Service>(`/api/admin/services/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ requires_payment: !s.requires_payment }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  function startEdit(s: Service) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditDurationMin(s.duration_min);
    setEditPriceCents(s.price_cents);
    setEditRequiresPayment(s.requires_payment);
  }

  async function onSaveEdit(serviceId: string) {
    setError(null);
    try {
      await apiFetch<Service>(`/api/admin/services/${serviceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          duration_min: editDurationMin,
          price_cents: editPriceCents,
          requires_payment: editRequiresPayment,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function onDelete(serviceId: string) {
    const ok = confirm("¿Desactivar este servicio?");
    if (!ok) return;
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/services/${serviceId}`, { method: "DELETE" });
      if (editingId === serviceId) setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  return (
    <AdminLayout title="Servicios" subtitle="Catálogo de servicios">
      {error ? <div className="adminError">{error}</div> : null}

      <div className="adminCard">
        <div className="adminCardHeader">
          <div className="adminCardTitle">Crear servicio</div>
        </div>
        <form onSubmit={onCreate} className="adminFormGrid">
          <div className="adminGrid2">
            <input className="adminInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
            <input className="adminInput" type="number" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} placeholder="Min" />
          </div>
          <div className="adminGrid2">
            <input
              className="adminInput"
              type="number"
              value={priceCents}
              onChange={(e) => setPriceCents(Number(e.target.value))}
              placeholder="Precio (cents)"
            />
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px", color: "rgba(255,255,255,0.78)" }}>
              <input type="checkbox" checked={requiresPayment} onChange={(e) => setRequiresPayment(e.target.checked)} />
              Requiere pago
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="adminButton adminButtonPrimary" style={{ minWidth: 140 }}>
              Crear
            </button>
          </div>
        </form>
      </div>

      <div className="adminCard">
        <div className="adminCardHeader">
          <div className="adminCardTitle">Listado</div>
        </div>
        <div className="adminTableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Duración</th>
                <th>Precio</th>
                <th>Pago</th>
                <th>Activo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>{editingId === s.id ? <input className="adminInput" value={editName} onChange={(e) => setEditName(e.target.value)} /> : s.name}</td>
                  <td>
                    {editingId === s.id ? (
                      <input
                        className="adminInput"
                        type="number"
                        value={editDurationMin}
                        onChange={(e) => setEditDurationMin(Number(e.target.value))}
                        style={{ width: 120 }}
                      />
                    ) : (
                      `${s.duration_min} min`
                    )}
                  </td>
                  <td>
                    {editingId === s.id ? (
                      <input
                        className="adminInput"
                        type="number"
                        value={editPriceCents}
                        onChange={(e) => setEditPriceCents(Number(e.target.value))}
                        style={{ width: 140 }}
                      />
                    ) : (
                      s.price_cents
                    )}
                  </td>
                  <td>
                    {editingId === s.id ? (
                      <label style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,0.78)" }}>
                        <input type="checkbox" checked={editRequiresPayment} onChange={(e) => setEditRequiresPayment(e.target.checked)} />
                        Requiere pago
                      </label>
                    ) : (
                      <button type="button" className="adminButton" onClick={() => toggleRequiresPayment(s)}>
                        {s.requires_payment ? "Sí" : "No"}
                      </button>
                    )}
                  </td>
                  <td>
                    <button type="button" className="adminButton" onClick={() => toggleActive(s)}>
                      {s.is_active ? "Sí" : "No"}
                    </button>
                  </td>
                  <td>
                    {editingId === s.id ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="adminButton adminButtonPrimary" onClick={() => onSaveEdit(s.id)}>
                          Guardar
                        </button>
                        <button type="button" className="adminButton" onClick={() => setEditingId(null)}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="adminButton" onClick={() => startEdit(s)}>
                          Editar
                        </button>
                        <button type="button" className="adminButton adminButtonDanger" onClick={() => onDelete(s.id)}>
                          Eliminar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
