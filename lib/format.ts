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
