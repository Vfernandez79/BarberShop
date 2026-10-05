import { Navigate, Route, Routes } from "react-router-dom";

import AdminBarbersPage from "./pages/AdminBarbersPage";
import AdminClientsPage from "./pages/AdminClientsPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminServicesPage from "./pages/AdminServicesPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import BookingPage from "./pages/BookingPage";
import BookingSessionPage from "./pages/BookingSessionPage";
import HomePage from "./pages/HomePage";
import MyBookingsPage from "./pages/MyBookingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/session" element={<BookingSessionPage />} />
      <Route path="/booking" element={<BookingPage />} />
      <Route path="/my-bookings" element={<MyBookingsPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/settings" element={<AdminSettingsPage />} />
      <Route path="/admin/barbers" element={<AdminBarbersPage />} />
      <Route path="/admin/services" element={<AdminServicesPage />} />
      <Route path="/admin/clients" element={<AdminClientsPage />} />
      <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
