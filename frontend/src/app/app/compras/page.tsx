"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useFamilyData } from "@/lib/use-family-data";
import type { PurchaseSummary, ShoppingListItem } from "@/lib/types";
import { formatBRL, formatDate, formatQty } from "@/lib/format";
import { groupIntoSections, shouldShowHeaders } from "@/lib/group-items";
import {
  addMonths,
  monthLabel,
  parseIsoDate,
  periodOf,
  startOfMonth,
  toIsoDate,
  type GroupBy,
} from "@/lib/periods";
import { MonthlyCostChart } from "@/components/monthly-cost-chart";
import { Alert, Badge, Button, Card, Empty, Input, PageTitle, SectionHeader, Select, Spinner } from "@/components/ui";

export default function ComprasPage() {
  const router = useRouter();
  const shopping = useFamilyData("/shopping-list", (raw) => (raw as { items: ShoppingListItem[] }).items);
  const purchases = useFamilyData("/purchases", (raw) => (raw as { purchases: PurchaseSummary[] }).purchases);
  const familyId = purchases.familyId;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAvulsa, setShowAvulsa] = useState(false);

  const [groupBy, setGroupBy] = useState<GroupBy>("mes");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showChart, setShowChart] = useState(false);

  const openPurchase = purchases.data?.find((p) => !p.finalized_at);
  const allHistory = useMemo(() => purchases.data?.filter((p) => p.finalized_at) ?? [], [purchases.data]);

  const history = useMemo(() => {
    if (groupBy !== "periodo") return allHistory;
    return allHistory.filter((p) => (!from || p.purchase_date >= from) && (!to || p.purchase_date <= to));
  }, [allHistory, groupBy, from, to]);

  // Agrupa por semana ou mes; no periodo especifico o intervalo escolhido e o proprio grupo
  const historyPeriods = useMemo(() => {
    const buckets = new Map<string, { label: string; items: PurchaseSummary[]; total: number; pending: number }>();

    for (const purchase of history) {
      const { key, label } =
        groupBy === "periodo"
          ? { key: "periodo", label: periodRangeLabel(from, to) }
          : periodOf(purchase.purchase_date, groupBy);

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { label, items: [], total: 0, pending: 0 };
        buckets.set(key, bucket);
      }
      bucket.items.push(purchase);
      if (purchase.total_value !== null) bucket.total += purchase.total_value;
      else bucket.pending += 1;
    }

    return [...buckets.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, bucket]) => ({ key, ...bucket }));
  }, [history, groupBy, from, to]);

  const monthlyCost = useMemo(() => {
    const base = startOfMonth(new Date());
    return [2, 1, 0].map((back) => {
      const monthStart = addMonths(base, -back);
      const key = toIsoDate(monthStart);
      const monthPurchases = allHistory.filter((p) => toIsoDate(startOfMonth(parseIsoDate(p.purchase_date))) === key);
      return {
        key,
        label: monthLabel(monthStart),
        total: monthPurchases.reduce((acc, p) => acc + (p.total_value ?? 0), 0),
        purchases: monthPurchases.length,
      };
    });
  }, [allHistory]);
  const shoppingSections = useMemo(
    () =>
      groupIntoSections(shopping.data ?? [], (it) => ({
        id: it.group_id,
        name: it.group_name,
        sortOrder: it.group_sort_order,
      })),
    [shopping.data],
  );

  async function startPurchase() {
    if (!familyId) return;
    setError(null);
    setStarting(true);
    try {
      const res = await api<{ purchase: { id: string } }>(`/families/${familyId}/purchases`, {
        method: "POST",
        body: { type: "reposicao", fromShoppingList: true },
      });
      router.push(`/app/compras/${res.purchase.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao iniciar compra");
      setStarting(false);
    }
  }

  return (
    <>
      <PageTitle title="Compras" subtitle="Carrinho montado automaticamente pelo estoque." />

      {error ? <div className="mb-4"><Alert>{error}</Alert></div> : null}

      {openPurchase ? (
        <Card className="mb-6 border-brand/40 bg-brand-soft/40">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-brand-dark">Compra em andamento</p>
              <p className="text-xs text-muted">
                {formatDate(openPurchase.purchase_date)} · {openPurchase.purchase_items?.[0]?.count ?? 0} itens
              </p>
            </div>
            <Link href={`/app/compras/${openPurchase.id}`}>
              <Button size="sm">Continuar</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Carrinho automático</h2>
          {!openPurchase ? (
            <Button size="sm" onClick={startPurchase} loading={starting} disabled={!shopping.data || shopping.data.length === 0}>
              Ir ao mercado
            </Button>
          ) : null}
        </div>
        {shopping.loading ? (
          <Spinner />
        ) : !shopping.data || shopping.data.length === 0 ? (
          <Empty title="Nada para comprar" description="Quando algum item do estoque atingir o mínimo, ele aparece aqui." />
        ) : (
          <Card className="divide-y divide-line p-0">
            {shoppingSections.map((section) => (
              <div key={section.key}>
                {shouldShowHeaders(shoppingSections) ? <SectionHeader>{section.label}</SectionHeader> : null}
                {section.items.map((it) => (
                  <div key={it.stock_item_id} className="flex items-center justify-between border-t border-line px-4 py-3">
                    <div>
                      <p className="font-medium text-ink">{it.name}</p>
                      <p className="text-xs text-muted">
                        tem {formatQty(it.current_quantity)} · ideal {formatQty(it.ideal_quantity)} {it.unit}
                      </p>
                    </div>
                    <span className="text-lg font-semibold text-ink">
                      {formatQty(it.suggested_quantity)} <span className="text-xs font-normal text-muted">{it.unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Compra avulsa</h2>
          <Button size="sm" variant="secondary" onClick={() => setShowAvulsa((v) => !v)}>
            {showAvulsa ? "Fechar" : "+ Registrar"}
          </Button>
        </div>
        {showAvulsa && familyId ? (
          <AvulsaForm
            familyId={familyId}
            onDone={(id, detailed) => {
              setShowAvulsa(false);
              if (detailed) router.push(`/app/compras/${id}`);
              else purchases.reload();
            }}
          />
        ) : (
          <p className="text-sm text-muted">Alguém passou no mercado fora da lista? Registre aqui só o valor, ou detalhe os itens.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-ink">Histórico</h2>

        <div className="mb-4 flex flex-col gap-3">
          <Select label="Agrupar por" name="groupBy" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="semana">Semana</option>
            <option value="mes">Mês</option>
            <option value="periodo">Período específico</option>
          </Select>

          {groupBy === "periodo" ? (
            <div className="grid grid-cols-2 gap-3">
              <Input label="De" name="from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              <Input label="Até" name="to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
          ) : null}
        </div>

        {purchases.loading ? (
          <Spinner />
        ) : historyPeriods.length === 0 ? (
          <Empty
            title={groupBy === "periodo" && (from || to) ? "Nenhuma compra neste período" : "Nenhuma compra finalizada ainda"}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {historyPeriods.map((period) => (
              <div key={period.key}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold capitalize text-ink">{period.label}</h3>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-ink tabular-nums">{formatBRL(period.total)}</span>
                    {period.pending > 0 ? (
                      <p className="text-xs text-muted">
                        {period.pending} sem valor informado
                      </p>
                    ) : null}
                  </div>
                </div>
                <Card className="divide-y divide-line p-0">
                  {period.items.map((p) => (
                    <Link key={p.id} href={`/app/compras/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-ink">{formatDate(p.purchase_date)}</p>
                          {p.type === "avulsa" ? <Badge>avulsa</Badge> : null}
                        </div>
                        <p className="text-xs text-muted">{p.purchase_items?.[0]?.count ?? 0} itens</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-ink">{formatBRL(p.total_value)}</p>
                        {p.value_status === "pendente" ? <Badge tone="warn">sem valor</Badge> : p.rateio_status === "fechado" ? <Badge tone="ok">rateado</Badge> : null}
                      </div>
                    </Link>
                  ))}
                </Card>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-ink">Gastos por mês</h2>
        <Select
          label="Gráfico"
          name="showChart"
          value={showChart ? "sim" : "nao"}
          onChange={(e) => setShowChart(e.target.value === "sim")}
        >
          <option value="nao">Não mostrar</option>
          <option value="sim">Custo dos últimos 3 meses</option>
        </Select>

        {showChart ? (
          <Card className="mt-3">
            <p className="text-sm font-medium text-ink">Custo dos últimos 3 meses</p>
            <p className="mb-3 text-xs text-muted">Soma das compras com valor informado</p>
            <MonthlyCostChart data={monthlyCost} />
          </Card>
        ) : null}
      </section>
    </>
  );
}

function periodRangeLabel(from: string, to: string) {
  if (from && to) return `${formatDate(from)} a ${formatDate(to)}`;
  if (from) return `A partir de ${formatDate(from)}`;
  if (to) return `Até ${formatDate(to)}`;
  return "Todo o período";
}

function AvulsaForm({ familyId, onDone }: { familyId: string; onDone: (id: string, detailed: boolean) => void }) {
  const [mode, setMode] = useState<"simples" | "detalhada">("simples");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = { type: "avulsa", purchaseDate: date, notes: notes || undefined, fromShoppingList: false };
      if (mode === "simples") {
        const v = Number(value.replace(",", "."));
        if (Number.isNaN(v)) throw new Error("Valor inválido");
        body.totalValue = v;
      }
      const res = await api<{ purchase: { id: string } }>(`/families/${familyId}/purchases`, { method: "POST", body });
      onDone(res.purchase.id, mode === "detalhada");
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Falha ao registrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex gap-2 rounded-xl bg-surface-2 p-1 text-sm">
          {(["simples", "detalhada"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-2 font-medium transition ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
            >
              {m === "simples" ? "Só o valor" : "Detalhar itens"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data" name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          {mode === "simples" ? (
            <Input label="Valor (R$)" name="value" type="number" inputMode="decimal" step="0.01" min={0} required value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <div className="flex items-end text-xs text-muted">Você vai adicionar os itens na próxima tela.</div>
          )}
        </div>
        <Input label="Observação (opcional)" name="notes" placeholder="Ex.: compra do João no Extra" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            {mode === "simples" ? "Registrar compra" : "Continuar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
