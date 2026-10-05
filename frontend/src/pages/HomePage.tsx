import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>BarberShop</h1>
      <p>Demo funcional: administración + reservas por slots.</p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <Link to="/session">Página cliente (reservar)</Link>
        <Link to="/admin/login">Admin (login)</Link>
      </div>
    </div>
  );
}
