// Up-to-two-letter initials from a person's name: "Ada Lovelace" → "AL",
// "Ada" → "AD"-ish ("A"). Empty/blank → "?".
export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.split(" ").map((p) => p[0]).filter(Boolean);
  return parts.slice(0, 2).join("").toUpperCase() || "?";
}

// Initials from a label that may be an EMAIL: "ada@x.com" → "AD",
// "ada.lovelace@x.com" → "AL". Falls back to the first two characters.
export function initialsFromLabel(label: string): string {
  const local = label.split("@")[0];
  const parts = local.split(/[.\s_-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase() || "?";
}

// Compact USD for the money badge and stats: $0, $1,234, $12.4k, $1.2m.
export function fmtUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "$—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (abs >= 10_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
