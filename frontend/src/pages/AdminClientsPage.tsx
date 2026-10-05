import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ApiError, apiFetch } from "../lib/api";
import { formatPhone } from "../lib/phone";
import { useRequireAuth } from "../lib/useRequireAuth";
import AdminLayout from "./AdminLayout";

type Client = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};

export default function AdminClientsPage() {
  useRequireAuth();
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  async function load() {
    setError(null);
    try {
      const items = await apiFetch<Client[]>("/api/admin/clients");
      setClients(items);
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
      await apiFetch<Client>("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify({
          email,
          full_name: fullName,
          phone: phone ? phone : null,
        }),
      });
      setEmail("");
      setFullName("");
      setPhone("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  function startEdit(c: Client) {
    setEditingId(c.id);
    setEditFullName(c.full_name ?? "");
    setEditPhone(c.phone ?? "");
  }

  async function saveEdit(clientId: string) {
    setError(null);
    try {
      await apiFetch<Client>(`/api/admin/clients/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({ full_name: editFullName, phone: editPhone ? editPhone : null }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function toggleActive(c: Client) {
    setError(null);
    try {
      await apiFetch<Client>(`/api/admin/clients/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function onDelete(c: Client) {
    const ok = confirm("¿Desactivar este cliente?");
    if (!ok) return;
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/clients/${c.id}`, { method: "DELETE" });
      if (editingId === c.id) setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  return (
    <AdminLayout title="Clientes" subtitle="Gestión y edición de clientes">
      {error ? <div className="adminError">{error}</div> : null}

      <div className="adminCard">
        <div className="adminCardHeader">
          <div className="adminCardTitle">Crear cliente</div>
        </div>
        <form onSubmit={onCreate} className="adminFormGrid" style={{ maxWidth: 920 }}>
          <div className="adminGrid2">
            <input className="adminInput" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
            <input className="adminInput" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre completo" />
          </div>
          <div className="adminGrid2">
            <input
              className="adminInput"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="Teléfono (opcional)"
              inputMode="numeric"
              autoComplete="tel"
              pattern="[0-9 ]*"
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="adminButton adminButtonPrimary" style={{ width: "100%" }}>
                Crear
              </button>
            </div>
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
                <th>Email</th>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Activo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>
                    {editingId === c.id ? (
                      <input className="adminInput" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
                    ) : (
                      c.full_name ?? ""
                    )}
                  </td>
                  <td>
                    {editingId === c.id ? (
                      <input
                        className="adminInput"
                        value={editPhone}
                        onChange={(e) => setEditPhone(formatPhone(e.target.value))}
                        inputMode="numeric"
                        autoComplete="tel"
                        pattern="[0-9 ]*"
                      />
                    ) : (
                      c.phone ?? ""
                    )}
                  </td>
                  <td>
                    <button type="button" className="adminButton" onClick={() => toggleActive(c)}>
                      {c.is_active ? "Sí" : "No"}
                    </button>
                  </td>
                  <td>
                    {editingId === c.id ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="adminButton adminButtonPrimary" onClick={() => saveEdit(c.id)}>
                          Guardar
                        </button>
                        <button type="button" className="adminButton" onClick={() => setEditingId(null)}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="adminButton" onClick={() => startEdit(c)}>
                          Editar
                        </button>
                        <button type="button" className="adminButton adminButtonDanger" onClick={() => onDelete(c)}>
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
