"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useFamilyData } from "@/lib/use-family-data";
import type { PurchaseDetail, PurchaseItem, StockItem } from "@/lib/types";
import { formatBRL, formatDate, formatQty } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Input, PageTitle, Spinner } from "@/components/ui";

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: purchase, loading, error: loadError, reload, familyId } = useFamilyData(`/purchases/${id}`, (raw) => (raw as { purchase: PurchaseDetail }).purchase);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const error = actionError ?? loadError;
  const setError = setActionError;

  async function changeQty(item: PurchaseItem, delta: number) {
    if (!familyId) return;
    const next = Math.max(0, item.quantity + delta);
    setBusy(item.id);
    setError(null);
    try {
      await api(`/families/${familyId}/purchases/${id}/items/${item.id}`, { method: "PATCH", body: { quantity: next } });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao atualizar");
    } finally {
      setBusy(null);
    }
  }

  async function cancelPurchase() {
    if (!familyId || !confirm("Cancelar esta compra? Os itens do carrinho serão descartados.")) return;
    try {
      await api(`/families/${familyId}/purchases/${id}`, { method: "DELETE" });
      router.replace("/app/compras");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao cancelar");
    }
  }

  if (loading && !purchase) return <Spinner />;
  if (!purchase) return <Alert>{error ?? "Compra não encontrada"}</Alert>;

  const isOpen = !purchase.finalized_at;
  const total = purchase.purchase_items.reduce((acc, it) => acc + it.quantity, 0);

  return (
    <>
      <PageTitle
        title={isOpen ? "No mercado" : `Compra de ${formatDate(purchase.purchase_date)}`}
        subtitle={
          isOpen
            ? "Conforme colocar no carrinho físico, ajuste com + e −."
            : `${purchase.type === "avulsa" ? "Compra avulsa" : "Reposição"} · ${purchase.purchase_items.length} itens`
        }
        action={
          isOpen ? (
            <Button size="sm" variant="ghost" onClick={cancelPurchase}>
              Cancelar
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => router.push("/app/compras")}>
              Voltar
            </Button>
          )
        }
      />

      {error ? <div className="mb-4"><Alert>{error}</Alert></div> : null}

      {!isOpen ? (
        <Card className="mb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">Valor da compra</p>
              <p className="text-2xl font-semibold text-ink">{formatBRL(purchase.total_value)}</p>
            </div>
            {purchase.value_status === "pendente" ? <Badge tone="warn">valor pendente</Badge> : purchase.rateio_status === "fechado" ? <Badge tone="ok">rateio fechado</Badge> : null}
          </div>
          {purchase.value_status === "pendente" && familyId ? (
            <SetValueForm familyId={familyId} purchaseId={purchase.id} onDone={reload} />
          ) : null}
        </Card>
      ) : null}

      {purchase.purchase_items.length === 0 ? (
        <Empty
          title="Carrinho vazio"
          description={isOpen ? "Adicione itens do estoque ou itens avulsos." : "Esta compra foi registrada só com o valor."}
          action={isOpen ? <Button onClick={() => setShowAdd(true)}>Adicionar item</Button> : undefined}
        />
      ) : (
        <Card className="divide-y divide-line p-0">
          {purchase.purchase_items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{item.item_name}</p>
                <p className="text-xs text-muted">
                  {item.stock_items ? `estoque: ${formatQty(item.stock_items.current_quantity)} · ideal ${formatQty(item.stock_items.ideal_quantity)} ${item.stock_items.unit}` : "item avulso"}
                </p>
              </div>
              {isOpen ? (
                <div className="flex items-center gap-2">
                  <QtyButton label="−" onClick={() => changeQty(item, -1)} disabled={busy === item.id} />
                  <span className="w-8 text-center text-lg font-semibold text-ink">{formatQty(item.quantity)}</span>
                  <QtyButton label="+" onClick={() => changeQty(item, 1)} disabled={busy === item.id} primary />
                </div>
              ) : (
                <span className="text-lg font-semibold text-ink">
                  {formatQty(item.quantity)} <span className="text-xs font-normal text-muted">{item.stock_items?.unit ?? "un"}</span>
                </span>
              )}
            </div>
          ))}
        </Card>
      )}

      {isOpen && familyId ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Fechar" : "+ Adicionar item"}
            </Button>
          </div>
          {showAdd ? (
            <div className="mt-3">
              <AddItemForm
                familyId={familyId}
                purchaseId={purchase.id}
                existingStockIds={purchase.purchase_items.map((i) => i.stock_item_id).filter(Boolean) as string[]}
                onDone={() => {
                  setShowAdd(false);
                  reload();
                }}
              />
            </div>
          ) : null}

          <div className="fixed inset-x-0 bottom-16 z-10 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mt-8 md:border-0 md:bg-transparent md:p-0">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted">Total no carrinho</p>
                <p className="text-lg font-semibold text-ink">{formatQty(total)} itens</p>
              </div>
              <Button size="lg" onClick={() => setShowFinalize(true)} disabled={purchase.purchase_items.length === 0}>
                Finalizar compra
              </Button>
            </div>
          </div>

          {showFinalize ? (
            <FinalizeDialog
              familyId={familyId}
              purchaseId={purchase.id}
              onClose={() => setShowFinalize(false)}
              onDone={() => {
                setShowFinalize(false);
                reload();
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function QtyButton({ label, onClick, disabled, primary }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 w-10 items-center justify-center rounded-full text-xl font-semibold transition active:scale-95 disabled:opacity-50 ${
        primary ? "bg-brand text-white hover:bg-brand-dark" : "bg-surface-2 text-ink hover:bg-line"
      }`}
    >
      {label}
    </button>
  );
}

function AddItemForm({ familyId, purchaseId, existingStockIds, onDone }: { familyId: string; purchaseId: string; existingStockIds: string[]; onDone: () => void }) {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [mode, setMode] = useState<"estoque" | "avulso">("estoque");
  const [stockItemId, setStockItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ items: StockItem[] }>(`/families/${familyId}/stock-items`).then((r) => setStock(r.items)).catch(() => undefined);
  }, [familyId]);

  const available = stock.filter((s) => !existingStockIds.includes(s.id));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const quantity = Number(qty.replace(",", "."));
    if (Number.isNaN(quantity) || quantity <= 0) {
      setError("Quantidade inválida");
      return;
    }
    setLoading(true);
    try {
      const body = mode === "estoque" ? { stockItemId, quantity } : { itemName: itemName.trim(), quantity };
      await api(`/families/${familyId}/purchases/${purchaseId}/items`, { method: "POST", body });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao adicionar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex gap-2 rounded-xl bg-surface-2 p-1 text-sm">
          {(["estoque", "avulso"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-lg py-2 font-medium transition ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
              {m === "estoque" ? "Do estoque" : "Item avulso"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_88px] gap-3">
          {mode === "estoque" ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Item</span>
              <select
                required
                value={stockItemId}
                onChange={(e) => setStockItemId(e.target.value)}
                className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Selecione…</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.unit})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Input label="Nome" name="itemName" placeholder="Ex.: Refrigerante" required value={itemName} onChange={(e) => setItemName(e.target.value)} />
          )}
          <Input label="Qtd" name="qty" type="number" inputMode="decimal" min={0} step="any" required value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            Adicionar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function FinalizeDialog({ familyId, purchaseId, onClose, onDone }: { familyId: string; purchaseId: string; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"valor" | "depois" | null>(null);

  async function finalize(withValue: boolean) {
    setError(null);
    const body: Record<string, unknown> = {};
    if (withValue) {
      const v = Number(value.replace(",", "."));
      if (Number.isNaN(v) || v < 0) {
        setError("Informe um valor válido");
        return;
      }
      body.totalValue = v;
    }
    setLoading(withValue ? "valor" : "depois");
    try {
      await api(`/families/${familyId}/purchases/${purchaseId}/finalize`, { method: "POST", body });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao finalizar");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-ink">Passou no caixa?</h2>
        <p className="mt-1 text-sm text-muted">O estoque será atualizado com o que está no carrinho. Informe o valor pago ou adicione depois.</p>
        {error ? <div className="mt-3"><Alert>{error}</Alert></div> : null}
        <div className="mt-4">
          <Input label="Valor total (R$)" name="total" type="number" inputMode="decimal" step="0.01" min={0} placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Button size="lg" onClick={() => finalize(true)} loading={loading === "valor"} disabled={loading === "depois"}>
            Finalizar com valor
          </Button>
          <Button size="lg" variant="secondary" onClick={() => finalize(false)} loading={loading === "depois"} disabled={loading === "valor"}>
            Adicionar valor depois
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Voltar ao carrinho
          </Button>
        </div>
      </div>
    </div>
  );
}

function SetValueForm({ familyId, purchaseId, onDone }: { familyId: string; purchaseId: string; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(value.replace(",", "."));
    if (Number.isNaN(v) || v < 0) {
      setError("Informe um valor válido");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api(`/families/${familyId}/purchases/${purchaseId}/value`, { method: "PATCH", body: { totalValue: v } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar valor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2">
      <div className="flex-1">
        <Input label="Informar valor agora (R$)" name="value" type="number" inputMode="decimal" step="0.01" min={0} required value={value} onChange={(e) => setValue(e.target.value)} error={error ?? undefined} />
      </div>
      <Button type="submit" loading={loading}>
        Salvar
      </Button>
    </form>
  );
}
