"use client";

import { formatBRL } from "@/lib/format";

export type MonthlyCost = {
  key: string;
  label: string;
  total: number;
  purchases: number;
};

const PLOT_HEIGHT = 168;
const BAR_WIDTH = 24;
const LABEL_BAND = 22;

/**
 * Serie unica, entao uma cor so e sem legenda. O titulo do bloco ja diz o que esta plotado
 * e o valor fica escrito no topo de cada barra, sem depender do tooltip.
 */
export function MonthlyCostChart({ data }: { data: MonthlyCost[] }) {
  const max = Math.max(...data.map((d) => d.total), 0);
  const scaleTop = niceCeil(max);

  return (
    <figure className="m-0">
      <div className="flex items-end justify-around gap-4" style={{ height: PLOT_HEIGHT + LABEL_BAND }}>
        {data.map((month) => {
          const ratio = scaleTop === 0 ? 0 : month.total / scaleTop;
          const barHeight = Math.max(month.total > 0 ? 3 : 0, Math.round(ratio * (PLOT_HEIGHT - 24)));

          return (
            <div key={month.key} className="group flex h-full flex-1 flex-col items-center justify-end">
              <span className="mb-1.5 text-xs font-medium text-ink tabular-nums">{formatBRL(month.total)}</span>
              <div
                className="rounded-t bg-brand transition-opacity group-hover:opacity-80"
                style={{ width: BAR_WIDTH, height: barHeight }}
                title={`${month.label}: ${formatBRL(month.total)} em ${month.purchases} ${month.purchases === 1 ? "compra" : "compras"}`}
              />
              <div className="mt-2 h-px w-full bg-line" />
              <span className="mt-1.5 text-xs capitalize text-muted">{month.label}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** Arredonda o topo da escala para um numero limpo, para as alturas nao ficarem arbitrarias */
function niceCeil(value: number) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}
