"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useFamilyData } from "@/lib/use-family-data";
import type { PurchaseSummary, ShoppingListItem } from "@/lib/types";
import { formatBRL, formatDate, formatQty } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Input, PageTitle, Spinner } from "@/components/ui";

export default function ComprasPage() {
  const router = useRouter();
  const shopping = useFamilyData("/shopping-list", (raw) => (raw as { items: ShoppingListItem[] }).items);
  const purchases = useFamilyData("/purchases", (raw) => (raw as { purchases: PurchaseSummary[] }).purchases);
  const familyId = purchases.familyId;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAvulsa, setShowAvulsa] = useState(false);

  const openPurchase = purchases.data?.find((p) => !p.finalized_at);
  const history = purchases.data?.filter((p) => p.finalized_at) ?? [];

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
            {shopping.data.map((it) => (
              <div key={it.stock_item_id} className="flex items-center justify-between px-4 py-3">
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
        {purchases.loading ? (
          <Spinner />
        ) : history.length === 0 ? (
          <Empty title="Nenhuma compra finalizada ainda" />
        ) : (
          <Card className="divide-y divide-line p-0">
            {history.map((p) => (
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
        )}
      </section>
    </>
  );
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
