import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch } from "../lib/api";
import { formatPhone } from "../lib/phone";
import ClientLayout from "./ClientLayout";

type Barber = { id: string; display_name: string; has_photo: boolean; timezone: string; is_bookable: boolean };
type Service = { id: string; name: string; duration_min: number; price_cents: number; requires_payment: boolean; is_active: boolean };
type PaymentMethod = { id: number; name: string; iva_percent: number };

type AvailabilityResponse = { date: string; slot_minutes: number; available_start_times: string[] };
type SettingsResponse = { slot_minutes: number; booking_horizon_days: number; min_notice_minutes: number; currency: string };
type BookingClient = { email: string; full_name: string | null; phone: string | null };

const BOOKING_EMAIL_KEY = "bs_booking_email";
const BOOKING_TOKEN_KEY = "bs_booking_token";
const BOOKING_GUEST_NAME_KEY = "bs_booking_guest_full_name";
const BOOKING_GUEST_PHONE_KEY = "bs_booking_guest_phone";

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function isoToHHMM(iso: string): string {
  if (!iso.includes("T")) return iso;
  return iso.split("T")[1].slice(0, 5);
}

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS_ES = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];

function parseIsoDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo - 1, d);
}

function dateToIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

function clampIso(iso: string, minIso?: string, maxIso?: string): boolean {
  if (!iso) return false;
  if (minIso && iso < minIso) return false;
  if (maxIso && iso > maxIso) return false;
  return true;
}

function InlineCalendar(props: { valueIso: string; minIso?: string; maxIso?: string; strikeIso?: string; onChange: (iso: string) => void }) {
  const { valueIso, minIso, maxIso, strikeIso, onChange } = props;
  const [view, setView] = useState<Date>(() => startOfMonth(parseIsoDate(valueIso) ?? parseIsoDate(todayIso()) ?? new Date()));

  useEffect(() => {
    const selected = parseIsoDate(valueIso);
    if (!selected) return;
    const next = startOfMonth(selected);
    if (next.getFullYear() === view.getFullYear() && next.getMonth() === view.getMonth()) return;
    setView(next);
  }, [valueIso, view]);

  const grid = useMemo(() => {
    const first = startOfMonth(view);
    const mondayBasedWeekday = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayBasedWeekday);
    const days: Array<{ iso: string; day: number; inMonth: boolean; isToday: boolean; isSelected: boolean; disabled: boolean }> = [];
    const today = todayIso();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = dateToIso(d);
      const inMonth = d.getMonth() === view.getMonth();
      const isSelected = valueIso === iso;
      const isToday = iso === today;
      const disabled = !clampIso(iso, minIso, maxIso);
      days.push({ iso, day: d.getDate(), inMonth, isToday, isSelected, disabled });
    }
    return days;
  }, [view, valueIso, minIso, maxIso]);

  const monthLabel = `${MONTHS_ES[view.getMonth()]} de ${view.getFullYear()}`;

  return (
    <div style={{ width: "100%", border: "1px solid rgba(15,23,42,0.12)", borderRadius: 14, padding: 10, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, textTransform: "lowercase" }}>{monthLabel}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setView(addMonths(view, -1))}
            style={{ width: 36, height: 34, padding: 0, borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", background: "#fff" }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setView(addMonths(view, 1))}
            style={{ width: 36, height: 34, padding: 0, borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", background: "#fff" }}
          >
            ›
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEKDAYS_ES.map((w) => (
          <div key={w} style={{ fontSize: 11, color: "#555", textAlign: "center", fontWeight: 700 }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {grid.map((d) => (
          <button
            key={d.iso}
            type="button"
            onClick={() => onChange(d.iso)}
            disabled={d.disabled}
            style={{
              height: 34,
              padding: 0,
              borderRadius: 12,
              border:
                d.iso === strikeIso
                  ? "2px solid #ef4444"
                  : d.isSelected
                    ? "2px solid rgba(22,163,74,0.85)"
                    : d.isToday
                      ? "1px solid rgba(22,163,74,0.45)"
                      : "1px solid rgba(15,23,42,0.12)",
              background: d.iso === strikeIso ? "#ffe7ee" : d.isSelected ? "rgba(22,163,74,0.10)" : "#fff",
              color: d.iso === strikeIso ? "#0b0b0c" : d.inMonth ? "#0b0b0c" : "rgba(15,23,42,0.35)",
              fontWeight: d.isSelected ? 800 : 600,
              fontSize: 13,
              opacity: d.disabled ? 0.35 : 1,
              textDecoration: d.iso === strikeIso ? "line-through" : "none",
            }}
          >
            {d.day}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onChange("")}
          style={{ background: "transparent", border: "none", color: "#16a34a", padding: 0, fontWeight: 700 }}
        >
          Borrar
        </button>
        <button
          type="button"
          onClick={() => onChange(todayIso())}
          style={{ background: "transparent", border: "none", color: "#16a34a", padding: 0, fontWeight: 700 }}
        >
          Hoy
        </button>
      </div>
    </div>
  );
}

type Step = "barber" | "service" | "schedule" | "client" | "review" | "done";

export default function BookingPage() {
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);

  const [step, setStep] = useState<Step>("barber");
  const [barberId, setBarberId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [startAtIso, setStartAtIso] = useState<string>("");

  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [noSlotsDayIso, setNoSlotsDayIso] = useState<string>("");
  const [clientEmail, setClientEmail] = useState(() => localStorage.getItem(BOOKING_EMAIL_KEY) ?? "");
  const [bookingToken] = useState<string>(() => localStorage.getItem(BOOKING_TOKEN_KEY) ?? "");
  const [clientFullName, setClientFullName] = useState(() => localStorage.getItem(BOOKING_GUEST_NAME_KEY) ?? "");
  const [clientPhone, setClientPhone] = useState(() => localStorage.getItem(BOOKING_GUEST_PHONE_KEY) ?? "");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [showPaymentMethodError, setShowPaymentMethodError] = useState(false);
  const [bookingResult, setBookingResult] = useState<{ id: string; payment_url: string | null } | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const selectedBarber = useMemo(() => barbers.find((b) => b.id === barberId) ?? null, [barbers, barberId]);
  const selectedService = useMemo(() => services.find((s) => s.id === serviceId) ?? null, [services, serviceId]);
  const selectedPaymentMethod = useMemo(
    () => paymentMethods.find((p) => String(p.id) === String(paymentMethodId)) ?? null,
    [paymentMethods, paymentMethodId],
  );
  const currency = settings?.currency ?? "COP";
  const maxDay = settings ? addDaysIso(settings.booking_horizon_days) : undefined;

  const loadBase = useCallback(async () => {
    setError(null);
    try {
      const [b, s, p] = await Promise.all([
        apiFetch<Barber[]>("/api/catalog/barbers"),
        apiFetch<SettingsResponse>("/api/settings"),
        apiFetch<PaymentMethod[]>("/api/catalog/payment-methods"),
      ]);
      setBarbers(b);
      setSettings(s);
      setPaymentMethods(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }, []);

  async function loadServicesForBarber(bid: string) {
    setError(null);
    try {
      const s = await apiFetch<Service[]>(`/api/catalog/services?barber_id=${encodeURIComponent(bid)}`);
      setServices(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  async function loadAvailability(bid: string, sid: string, d: string) {
    setError(null);
    try {
      const a = await apiFetch<AvailabilityResponse>(
        `/api/availability?barber_id=${encodeURIComponent(bid)}&service_id=${encodeURIComponent(sid)}&day=${encodeURIComponent(d)}`,
      );
      setAvailability(a);
      setNoSlotsDayIso(a.available_start_times?.length ? "" : d);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  const loadClientFromDb = useCallback(async () => {
    try {
      const email = clientEmail.trim().toLowerCase();
      const path = bookingToken ? "/api/booking/client" : `/api/booking/client?email=${encodeURIComponent(email)}`;
      const data = await apiFetch<BookingClient>(path, { headers: bookingToken ? { "X-Booking-Token": bookingToken } : undefined });
      if (!clientEmail.trim()) setClientEmail(data.email);
      if (!clientFullName.trim() && data.full_name) setClientFullName(data.full_name);
      if (!clientPhone.trim() && data.phone) setClientPhone(data.phone);
    } catch {
      return;
    }
  }, [bookingToken, clientEmail, clientFullName, clientPhone]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!clientEmail.trim()) nav("/session", { replace: true });
  }, [clientEmail, nav]);

  useEffect(() => {
    if (!barberId) return;
    setServices([]);
    setServiceId("");
    setDay("");
    setStartAtIso("");
    setAvailability(null);
    setNoSlotsDayIso("");
    void loadServicesForBarber(barberId);
  }, [barberId]);

  useEffect(() => {
    if (!barberId || !serviceId || !day) return;
    void loadAvailability(barberId, serviceId, day);
  }, [barberId, serviceId, day]);

  useEffect(() => {
    if (step !== "client") return;
    if (!clientEmail.trim()) return;
    void loadClientFromDb();
  }, [step, clientEmail, loadClientFromDb]);

  async function confirmBooking() {
    setError(null);
    try {
      const resp = await apiFetch<{ id: string; payment_url: string | null }>("/api/appointments/book", {
        method: "POST",
        headers: bookingToken ? { "X-Booking-Token": bookingToken } : undefined,
        body: JSON.stringify({
          barber_id: barberId,
          service_id: serviceId,
          start_at: startAtIso,
          payment_method_id: paymentMethodId ? Number(paymentMethodId) : undefined,
          client_email: clientEmail,
          client_full_name: clientFullName,
          client_phone: clientPhone,
        }),
      });
      setBookingResult(resp);
      setStep("done");
      setShowConfirmation(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Error");
    }
  }

  const canGoService = Boolean(barberId);
  const canGoSchedule = Boolean(barberId && serviceId);
  const canGoClient = Boolean(barberId && serviceId && day && startAtIso);
  const canGoReviewBase = Boolean(canGoClient && clientFullName.trim() && clientEmail.trim() && clientPhone.trim());
  const canGoReview = Boolean(canGoReviewBase && paymentMethodId);

  const stepOrder: Step[] = ["barber", "service", "schedule", "client", "review", "done"];
  const stepIndex = stepOrder.indexOf(step);

  function canGoNext(current: Step): boolean {
    if (current === "barber") return canGoService;
    if (current === "service") return canGoSchedule;
    if (current === "schedule") return canGoClient;
    if (current === "client") return canGoReviewBase;
    if (current === "review") return canGoReview;
    return false;
  }

  function goBack() {
    setError(null);
    if (stepIndex <= 0) return nav("/session");
    setStep(stepOrder[stepIndex - 1]);
  }

  function goNext() {
    setError(null);
    if (!canGoNext(step)) return;
    if (step === "review") return;
    if (step === "client" && !paymentMethodId) {
      setShowPaymentMethodError(true);
      return;
    }
    setStep(stepOrder[Math.min(stepIndex + 1, stepOrder.length - 1)]);
  }

  function stepLabel(s: Step): string {
    if (s === "barber") return "Barbero";
    if (s === "service") return "Servicio";
    if (s === "schedule") return "Agenda";
    if (s === "client") return "Cliente";
    if (s === "review") return "Resumen";
    return "Listo";
  }

  return (
    <ClientLayout
      title="Reservar"
      subtitle="Reserva tu servicio en pocos pasos"
      showNav={false}
      showActions={false}
    >
      {showConfirmation && bookingResult ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setShowConfirmation(false)}
        >
          <div
            className="clientModalCard"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {selectedPaymentMethod?.name === "RedCompra" && bookingResult.payment_url ? "Reserva creada" : "Reserva confirmada"}
              </div>
              <button type="button" onClick={() => setShowConfirmation(false)} style={{ marginLeft: "auto" }}>
                Cerrar
              </button>
            </div>
            <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <div>
                {selectedPaymentMethod?.name === "RedCompra" && bookingResult.payment_url
                  ? "Tu reserva quedó registrada y está pendiente de pago."
                  : "Gracias por confirmar tu servicio."}
              </div>
              <div>Te enviamos un correo con el resumen y un archivo de calendario para agregarlo.</div>
              <div>
                <b>ID:</b> {bookingResult.id}
              </div>
              <div>
                <b>Barbero:</b> {selectedBarber?.display_name ?? "-"}
              </div>
              <div>
                <b>Servicio:</b> {selectedService ? `${selectedService.name} (${selectedService.duration_min} min)` : "-"}
              </div>
              <div>
                <b>Fecha:</b> {day || "-"} <b>Hora:</b> {startAtIso ? isoToHHMM(startAtIso) : "-"}
              </div>
              <div>
                <b>Cliente:</b> {clientFullName || "-"} <b>Tel:</b> {clientPhone || "-"}
              </div>
              <div>
                <b>Email:</b> {clientEmail || "-"}
              </div>
              <div>
                <b>Forma de pago:</b> {selectedPaymentMethod ? selectedPaymentMethod.name : "-"}
              </div>
            </div>
            <div className="clientModalActions">
              {selectedPaymentMethod?.name === "RedCompra" && bookingResult.payment_url ? (
                <button type="button" onClick={() => (window.location.href = bookingResult.payment_url!)}>
                  Ir a pagar
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {error ? <div className="clientError">{error}</div> : null}

      <div className="bookingGrid">
        <div className="bookingCol">
          <div className="clientCard">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {`Paso ${stepIndex + 1}: ${stepLabel(step)}`}
            </div>

            {step === "barber" ? (
              <div style={{ display: "grid", gap: 8 }}>
                {barbers.length ? (
                  barbers.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setBarberId(b.id);
                        setStep("service");
                      }}
                      className={`bookingChoiceButton${barberId === b.id ? " isSelected" : ""}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {b.has_photo ? (
                          <img
                            src={`/api/catalog/barbers/${b.id}/photo`}
                            alt={b.display_name}
                            style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", background: "rgba(255,255,255,0.12)" }}
                          />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
                        )}
                        <div style={{ display: "grid" }}>
                          <div style={{ fontWeight: 700 }}>{b.display_name}</div>
                          <div>{b.timezone}</div>
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div>No hay barberos disponibles</div>
                )}
              </div>
            ) : null}

            {step === "service" ? (
              <div style={{ display: "grid", gap: 8 }}>
                {services.length ? (
                  services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setServiceId(s.id);
                        setStep("schedule");
                      }}
                      className={`bookingChoiceButton${serviceId === s.id ? " isSelected" : ""}`}
                    >
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <span>{s.duration_min} min</span>
                        <span>{formatMoney(s.price_cents, currency)}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div>No hay servicios para este barbero</div>
                )}
              </div>
            ) : null}

            {step === "schedule" ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="bookingScheduleHeader">
                  <div className="bookingScheduleTitle">{selectedService?.name ?? "Agenda"}</div>
                  <div className="bookingScheduleMeta">
                    Zona horaria: {selectedBarber?.timezone ? selectedBarber.timezone : "Chile – Santiago"}
                  </div>
                  {day ? <div style={{ fontWeight: 800 }}>{day}</div> : <div style={{ fontWeight: 800 }}>Selecciona una fecha</div>}
                </div>

                <div className="bookingCalendarWrap" style={{ display: "grid", gap: 10 }}>
                  <InlineCalendar
                    valueIso={day}
                    minIso={todayIso()}
                    maxIso={maxDay}
                    strikeIso={noSlotsDayIso}
                    onChange={(iso) => {
                      setDay(iso);
                      setStartAtIso("");
                      setAvailability(null);
                      setNoSlotsDayIso("");
                    }}
                  />
                </div>

                {day && !availability ? <div>Cargando horarios...</div> : null}
                <div className="bookingSlotsGrid">
                  {availability?.available_start_times?.length ? (
                    availability.available_start_times.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setStartAtIso(t);
                          setStep("client");
                        }}
                        className={`clientSlotButton${startAtIso === t ? " isSelected" : ""}`}
                      >
                        {isoToHHMM(t)}
                      </button>
                    ))
                  ) : day && availability ? (
                    <div>No hay horarios disponibles</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === "client" ? (
              <div className="bookingFormSection" style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  Nombre completo
                  <input value={clientFullName} onChange={(e) => setClientFullName(e.target.value)} placeholder="Nombre Apellido" />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Teléfono (requerido)
                  <input
                    value={clientPhone}
                    onChange={(e) => setClientPhone(formatPhone(e.target.value))}
                    placeholder="56 9 1234 5678"
                    inputMode="numeric"
                    autoComplete="tel"
                    pattern="[0-9 ]*"
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Forma de pago (requerido)
                  <select
                    value={paymentMethodId}
                    onChange={(e) => {
                      setPaymentMethodId(e.target.value);
                      setShowPaymentMethodError(false);
                    }}
                  >
                    <option value="" disabled>
                      Selecciona una opción
                    </option>
                    {paymentMethods.map((pm) => (
                      <option key={pm.id} value={String(pm.id)}>
                        {pm.name}
                      </option>
                    ))}
                  </select>
                </label>
                {showPaymentMethodError && !paymentMethodId ? <div className="clientError">Debes seleccionar una forma de pago.</div> : null}
                <div>
                  <b>Correo verificado:</b> {clientEmail || "-"}
                </div>
              </div>
            ) : null}

            {step === "review" || step === "done" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div>
                    <b>Barbero:</b> {selectedBarber?.display_name ?? "-"}
                  </div>
                  <div>
                    <b>Servicio:</b> {selectedService ? `${selectedService.name} (${selectedService.duration_min} min)` : "-"}
                  </div>
                  <div>
                    <b>Precio:</b> {selectedService ? formatMoney(selectedService.price_cents, currency) : "-"}
                  </div>
                  <div>
                    <b>Fecha:</b> {day || "-"}
                  </div>
                  <div>
                    <b>Hora:</b> {startAtIso ? isoToHHMM(startAtIso) : "-"}
                  </div>
                  <div>
                    <b>Cliente:</b> {clientFullName || "-"}
                  </div>
                  <div>
                    <b>Teléfono:</b> {clientPhone || "-"}
                  </div>
                  <div>
                    <b>Forma de pago:</b> {selectedPaymentMethod ? selectedPaymentMethod.name : "-"}
                  </div>
                  <div>
                    <b>Email:</b> {clientEmail || "-"}
                  </div>
                </div>
                {step === "done" ? <div>Reserva creada: {bookingResult?.id}</div> : null}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {step !== "done" ? (
                <button type="button" onClick={goBack}>
                  Atrás
                </button>
              ) : null}
              {step === "client" ? (
                <button type="button" onClick={goNext} disabled={!canGoNext(step)}>
                  Siguiente
                </button>
              ) : null}
              {step === "review" ? (
                <button type="button" onClick={confirmBooking} disabled={!canGoReview}>
                  Confirmar reserva
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {step !== "review" ? (
          <div className="clientCard" style={{ height: "fit-content" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Resumen</div>
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <b>Barbero:</b> {selectedBarber?.display_name ?? "—"}
              </div>
              <div>
                <b>Servicio:</b>{" "}
                {selectedService ? `${selectedService.name} (${selectedService.duration_min} min) — ${formatMoney(selectedService.price_cents, currency)}` : "—"}
              </div>
              <div>
                <b>Fecha:</b> {day || "—"}
              </div>
              <div>
                <b>Hora:</b> {startAtIso ? isoToHHMM(startAtIso) : "—"}
              </div>
              <div>
                <b>Cliente:</b> {clientFullName || "—"}
              </div>
              <div>
                <b>Teléfono:</b> {clientPhone || "—"}
              </div>
              <div>
                <b>Forma de pago:</b> {selectedPaymentMethod ? selectedPaymentMethod.name : "—"}
              </div>
              <div>
                <b>Email:</b> {clientEmail || "—"}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ClientLayout>
  );
}
