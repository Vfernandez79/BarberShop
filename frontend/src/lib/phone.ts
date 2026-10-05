export function formatPhone(value: string): string {
  const digits = value.replace(/\D+/g, "");
  if (!digits) return "";

  if (digits.startsWith("56")) {
    const d = digits.slice(0, 11);
    const parts = [d.slice(0, 2), d.slice(2, 3), d.slice(3, 7), d.slice(7, 11)].filter((p) => p.length > 0);
    return parts.join(" ");
  }

  const d = digits.slice(0, 9);
  const parts = [d.slice(0, 1), d.slice(1, 5), d.slice(5, 9)].filter((p) => p.length > 0);
  return parts.join(" ");
}
