export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

const TOKEN_KEY = "bs_token";
const TOKEN_EVENT = "bs_token_changed";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event(TOKEN_EVENT));
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
  const baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
  const url = baseUrl && path.startsWith("/api") ? `${baseUrl}${path}` : path;

  const headers = new Headers(init?.headers);
  const reqBody = init?.body;
  const isForm = typeof FormData !== "undefined" && reqBody instanceof FormData;
  if (!headers.has("Content-Type") && reqBody && !isForm) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiError(0, "No se puede conectar con la API. Verifica que el backend esté corriendo y el proxy Vite apunte al host correcto.");
  }
  const contentType = res.headers.get("content-type") || "";

  let respBody: unknown = null;
  if (contentType.includes("application/json")) {
    respBody = await res.json();
  } else {
    respBody = await res.text();
  }

  if (!res.ok) {
    const detail =
      typeof respBody === "object" && respBody && "detail" in respBody && typeof (respBody as { detail: unknown }).detail === "string"
        ? (respBody as { detail: string }).detail
        : `Error ${res.status}`;
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, detail);
  }

  return respBody as T;
}
