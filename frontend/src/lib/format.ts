export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return brl.format(value);
}

export function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Data e hora no fuso do aparelho, para registros com horario como o historico do valor */
export function formatDateTime(iso: string) {
  return dataHora.format(new Date(iso));
}

export function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}
