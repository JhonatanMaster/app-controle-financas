import { formatDate } from "./format";

export type GroupBy = "semana" | "mes" | "periodo";

/**
 * Converte AAAA-MM-DD em Date local. `new Date("2026-09-28")` seria lido como UTC
 * e cairia no dia anterior em fusos negativos, como o do Brasil.
 */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toIsoDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** Segunda feira da semana da data informada */
export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const weekday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - weekday);
  return result;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

const DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const MES_ANO = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short" });

/** Chave e rotulo do periodo a que a compra pertence */
export function periodOf(purchaseDateIso: string, groupBy: Exclude<GroupBy, "periodo">) {
  const date = parseIsoDate(purchaseDateIso);

  if (groupBy === "mes") {
    const start = startOfMonth(date);
    const label = MES_ANO.format(start);
    return { key: toIsoDate(start), label: label.charAt(0).toUpperCase() + label.slice(1) };
  }

  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { key: toIsoDate(start), label: `${DIA_MES.format(start)} a ${DIA_MES.format(end)}` };
}

export function monthLabel(date: Date) {
  return MES_CURTO.format(date).replace(".", "");
}

/** Rotulo do intervalo escolhido no filtro de periodo especifico */
export function periodRangeLabel(from: string, to: string) {
  if (from && to) return `${formatDate(from)} a ${formatDate(to)}`;
  if (from) return `A partir de ${formatDate(from)}`;
  if (to) return `Até ${formatDate(to)}`;
  return "Todo o período";
}

/**
 * Grupo a que um registro pertence conforme o filtro escolhido. No periodo especifico todos os
 * registros caem no mesmo grupo, que e o proprio intervalo.
 */
export function grupoDoRegistro(dataIso: string, groupBy: GroupBy, from: string, to: string) {
  if (groupBy === "periodo") return { key: "periodo", label: periodRangeLabel(from, to) };
  return periodOf(dataIso, groupBy);
}

/**
 * Soma por mes dos ultimos meses, incluindo o atual, para o grafico de barras. Registros sem valor
 * entram na contagem mas nao somam.
 */
export function custoDosUltimosMeses<T>(
  itens: T[],
  dataDe: (item: T) => string,
  valorDe: (item: T) => number | null,
  quantidade = 3,
) {
  const base = startOfMonth(new Date());
  const voltas = Array.from({ length: quantidade }, (_, i) => quantidade - 1 - i);

  return voltas.map((back) => {
    const inicio = addMonths(base, -back);
    const key = toIsoDate(inicio);
    const doMes = itens.filter((item) => toIsoDate(startOfMonth(parseIsoDate(dataDe(item)))) === key);
    return {
      key,
      label: monthLabel(inicio),
      total: doMes.reduce((acc, item) => acc + (valorDe(item) ?? 0), 0),
      count: doMes.length,
    };
  });
}
