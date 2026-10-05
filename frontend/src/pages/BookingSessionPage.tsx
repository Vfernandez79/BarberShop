import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch } from "../lib/api";
import { getFirebaseAuth } from "../lib/firebase";
import { formatPhone } from "../lib/phone";
import ClientLayout from "./ClientLayout";
import { GoogleAuthProvider, OAuthProvider, FacebookAuthProvider, signInWithPopup } from "firebase/auth";

const BOOKING_EMAIL_KEY = "bs_booking_email";
const BOOKING_TOKEN_KEY = "bs_booking_token";
const BOOKING_GUEST_NAME_KEY = "bs_booking_guest_full_name";
const BOOKING_GUEST_PHONE_KEY = "bs_booking_guest_phone";

export default function BookingSessionPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"landing" | "guest" | "existing">("landing");
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState(() => localStorage.getItem(BOOKING_GUEST_NAME_KEY) ?? "");
  const [email, setEmail] = useState(() => localStorage.getItem(BOOKING_EMAIL_KEY) ?? "");
  const [phoneDigits, setPhoneDigits] = useState(() => {
    const existing = localStorage.getItem(BOOKING_GUEST_PHONE_KEY) ?? "";
    const digits = existing.replace(/\D+/g, "");
    return digits.startsWith("56") ? digits.slice(2) : digits;
  });

  const formattedPhone = useMemo(() => {
    const digits = phoneDigits.replace(/\D+/g, "").slice(0, 9);
    const withCountry = `56${digits}`;
    return formatPhone(withCountry);
  }, [phoneDigits]);

  function goGuest() {
    setError(null);
    setMode("guest");
  }

  async function onSubmitGuest(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const name = fullName.trim();
    const mail = email.trim().toLowerCase();
    const digits = phoneDigits.replace(/\D+/g, "").slice(0, 9);

    if (!name) return setError("Nombre completo es requerido");
    if (!mail) return setError("Correo electrónico es requerido");
    if (digits.length < 8) return setError("Teléfono es requerido");

    try {
      localStorage.setItem(BOOKING_EMAIL_KEY, mail);
      localStorage.setItem(BOOKING_GUEST_NAME_KEY, name);
      localStorage.setItem(BOOKING_GUEST_PHONE_KEY, formatPhone(`56${digits}`));

      const exists = await apiFetch<{ email: string; exists: boolean }>(`/api/booking/client/exists?email=${encodeURIComponent(mail)}`);
      if (exists.exists) {
        setMode("existing");
        return;
      }

      const resp = await apiFetch<{ ok: boolean; booking_token: string; email: string }>("/api/booking/session/guest", {
        method: "POST",
        body: JSON.stringify({ email: mail }),
      });
      localStorage.setItem(BOOKING_EMAIL_KEY, resp.email);
      localStorage.setItem(BOOKING_TOKEN_KEY, resp.booking_token);
      nav("/booking");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function startNewBookingFromExisting() {
    setError(null);
    const mail = (localStorage.getItem(BOOKING_EMAIL_KEY) ?? "").trim().toLowerCase();
    if (!mail) return setError("Correo electrónico es requerido");
    try {
      const resp = await apiFetch<{ ok: boolean; booking_token: string; email: string }>("/api/booking/session/guest", {
        method: "POST",
        body: JSON.stringify({ email: mail }),
      });
      localStorage.setItem(BOOKING_EMAIL_KEY, resp.email);
      localStorage.setItem(BOOKING_TOKEN_KEY, resp.booking_token);
      nav("/booking");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function loginWithProvider(provider: "google" | "facebook" | "apple") {
    setError(null);
    try {
      const auth = getFirebaseAuth();
      const p =
        provider === "google"
          ? new GoogleAuthProvider()
          : provider === "facebook"
            ? new FacebookAuthProvider()
            : new OAuthProvider("apple.com");

      const result = await signInWithPopup(auth, p);
      const mail = (result.user.email || "").trim().toLowerCase();
      if (!mail) return setError("Tu cuenta no tiene correo electrónico");
      const idToken = await result.user.getIdToken();
      const resp = await apiFetch<{ ok: boolean; booking_token: string; email: string }>("/api/booking/session/firebase", {
        method: "POST",
        body: JSON.stringify({ id_token: idToken }),
      });
      localStorage.setItem(BOOKING_EMAIL_KEY, resp.email);
      localStorage.setItem(BOOKING_TOKEN_KEY, resp.booking_token);
      if (result.user.displayName) localStorage.setItem(BOOKING_GUEST_NAME_KEY, result.user.displayName);
      nav("/booking");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <ClientLayout title="Sesión" subtitle="Inicia sesión para reservar" showNav={false} showActions={false}>
      <div className="clientAuthWrap">
        <div className="clientAuthCard">
          {mode === "landing" ? (
            <div style={{ display: "grid", gap: 16, placeItems: "center", textAlign: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 26 }}>Iniciar sesión para reservar en línea</div>
              {error ? <div className="clientError" style={{ width: "100%", maxWidth: 520 }}>{error}</div> : null}
              <div className="clientProvidersRow">
                <button type="button" className="clientProviderButton" aria-label="Google" onClick={() => loginWithProvider("google")}>
                  <div className="clientProviderIcon">G</div>
                </button>
                <button type="button" className="clientProviderButton" aria-label="Facebook" onClick={() => loginWithProvider("facebook")}>
                  <div className="clientProviderIcon">f</div>
                </button>
                <button type="button" className="clientProviderButton" aria-label="Apple" onClick={() => loginWithProvider("apple")}>
                  <div className="clientProviderIcon"></div>
                </button>
              </div>
              <div className="clientOrRow">
                <div className="clientOrLine" />
                <div className="clientOrText">o</div>
                <div className="clientOrLine" />
              </div>
              <button type="button" className="clientLinkButton" onClick={() => setMode("guest")}>
                Crear perfil
              </button>
              <button type="button" className="clientButtonPrimary clientWideButton" onClick={goGuest}>
                Continuar como invitado
              </button>
            </div>
          ) : mode === "existing" ? (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" className="clientBackButton" onClick={() => setMode("guest")} aria-label="Volver">
                  ←
                </button>
                <div style={{ fontWeight: 900, fontSize: 18 }}>Ya tienes un perfil</div>
              </div>
              {error ? <div className="clientError">{error}</div> : null}
              <div style={{ color: "rgba(255,255,255,0.78)" }}>
                Detectamos que el correo <b>{(localStorage.getItem(BOOKING_EMAIL_KEY) ?? "").trim().toLowerCase()}</b> ya existe como cliente.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="clientButtonPrimary" onClick={startNewBookingFromExisting}>
                  Nueva reserva
                </button>
                <button type="button" onClick={() => nav("/my-bookings")}>
                  Mis reservas
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" className="clientBackButton" onClick={() => setMode("landing")} aria-label="Volver">
                  ←
                </button>
                <div style={{ fontWeight: 900, fontSize: 18 }}>Tus datos</div>
              </div>

              {error ? <div className="clientError">{error}</div> : null}

              <form onSubmit={onSubmitGuest} className="clientGuestForm">
                <label className="clientField">
                  <div className="clientFieldLabel">Nombre completo *</div>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre Apellido" />
                </label>
                <label className="clientField">
                  <div className="clientFieldLabel">Teléfono *</div>
                  <div className="clientPhoneRow">
                    <select disabled value="+56">
                      <option value="+56">+56</option>
                    </select>
                    <input
                      value={formattedPhone.replace(/^56\s?/, "").trim()}
                      onChange={(e) => setPhoneDigits(e.target.value)}
                      placeholder="9 1234 5678"
                      inputMode="numeric"
                      autoComplete="tel"
                      pattern="[0-9 ]*"
                    />
                  </div>
                </label>
                <label className="clientField">
                  <div className="clientFieldLabel">Correo electrónico *</div>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@correo.com" inputMode="email" />
                </label>
                <button type="submit" className="clientButtonPrimary" style={{ width: 160 }}>
                  Confirmar
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </ClientLayout>
  );
}
