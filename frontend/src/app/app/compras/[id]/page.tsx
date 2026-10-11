"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { comCacheDaFamilia, LISTA_GRUPOS, LISTA_ITENS_DO_ESTOQUE } from "@/lib/offline-cache";
import { useFamilyData } from "@/lib/use-family-data";
import { executarOuEnfileirar, useOperacoesDaCompra } from "@/lib/sync";
import { aplicarFila } from "@/lib/compra-offline";
import type { PurchaseDetail, PurchaseItem, PurchaseValueChange, StockGroup, StockItem } from "@/lib/types";
import { formatBRL, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { groupIntoSections, shouldShowHeaders } from "@/lib/group-items";
import { Alert, Badge, Button, Card, Empty, Input, PageTitle, SectionHeader, Select, Spinner } from "@/components/ui";

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: compraServidor, loading, error: loadError, reload, familyId } = useFamilyData(`/purchases/${id}`, (raw) => (raw as { purchase: PurchaseDetail }).purchase);
  // Alteracoes feitas sem sinal ainda nao chegaram ao servidor, entao entram por cima dos dados
  const operacoes = useOperacoesDaCompra(id);
  const purchase = useMemo(() => (compraServidor ? aplicarFila(compraServidor, operacoes) : null), [compraServidor, operacoes]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const [editandoValor, setEditandoValor] = useState(false);
  const error = actionError ?? loadError;
  const setError = setActionError;

  async function changeQty(item: PurchaseItem, delta: number) {
    if (!familyId) return;
    const next = Math.max(0, item.quantity + delta);
    setBusy(item.id);
    setError(null);
    try {
      await executarOuEnfileirar({
        familyId,
        purchaseId: id,
        method: "PATCH",
        path: `/families/${familyId}/purchases/${id}/items/${item.id}`,
        body: { quantity: next },
      });
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
  // Item avulso guarda a propria secao, o item de estoque herda a dele
  const itemSections = groupIntoSections(purchase.purchase_items, (item) => {
    const group = item.stock_groups ?? item.stock_items?.stock_groups ?? null;
    return { id: group?.id ?? null, name: group?.name ?? null, sortOrder: group?.sort_order ?? null };
  });
  const showItemHeaders = shouldShowHeaders(itemSections);

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
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted">Valor da compra</p>
              <p className="text-2xl font-semibold text-ink">{formatBRL(purchase.total_value)}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {purchase.value_status === "pendente" ? <Badge tone="warn">valor pendente</Badge> : purchase.rateio_status === "fechado" ? <Badge tone="ok">rateio fechado</Badge> : null}
              {purchase.value_status === "definido" && familyId && !editandoValor ? (
                <Button size="sm" variant="secondary" onClick={() => setEditandoValor(true)}>
                  Editar valor
                </Button>
              ) : null}
            </div>
          </div>
          {familyId && (purchase.value_status === "pendente" || editandoValor) ? (
            <SetValueForm
              familyId={familyId}
              purchaseId={purchase.id}
              valorAtual={purchase.value_status === "definido" ? purchase.total_value : null}
              onCancel={editandoValor ? () => setEditandoValor(false) : undefined}
              onDone={() => {
                setEditandoValor(false);
                reload();
              }}
            />
          ) : null}
          <HistoricoDoValor alteracoes={purchase.purchase_value_changes ?? []} />
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
          {itemSections.map((section) => (
            <div key={section.key}>
              {showItemHeaders ? <SectionHeader>{section.label}</SectionHeader> : null}
              {section.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-t border-line px-4 py-3">
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

          {/* Reserva no fluxo a altura que a barra de total ocupa flutuando, senao ela cobre o fim
              da tela, que e justamente onde fica o formulario de adicionar item */}
          <div className="h-24 md:hidden" aria-hidden />

          <div className="fixed inset-x-0 bottom-[calc(4rem_+_env(safe-area-inset-bottom))] z-10 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mt-8 md:border-0 md:bg-transparent md:p-0">
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
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [mode, setMode] = useState<"estoque" | "avulso">("estoque");
  const [stockItemId, setStockItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Sem rede e sem nada guardado no aparelho, a lista nao tem de onde vir
  const [semListaDoEstoque, setSemListaDoEstoque] = useState(false);

  useEffect(() => {
    // O shell ja guarda estas listas ao abrir o app com rede, aqui so le ou atualiza
    comCacheDaFamilia<{ items: StockItem[] }>(familyId, LISTA_ITENS_DO_ESTOQUE)
      .then(({ valor }) => setStock(valor.items))
      .catch(() => setSemListaDoEstoque(true));
    comCacheDaFamilia<{ groups: StockGroup[] }>(familyId, LISTA_GRUPOS)
      .then(({ valor }) => setGroups(valor.groups))
      .catch(() => undefined);
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
      // O id nasce aqui para que reenviar a adicao depois de uma queda de sinal nao crie o item duas vezes
      const idItem = crypto.randomUUID();
      const selecionado = mode === "estoque" ? stock.find((s) => s.id === stockItemId) : undefined;
      const body =
        mode === "estoque"
          ? { id: idItem, stockItemId, quantity }
          : { id: idItem, itemName: itemName.trim(), quantity, groupId: groupId || null };
      // Como o item aparece na lista enquanto a alteracao ainda esta na fila
      const previa: PurchaseItem = selecionado
        ? {
            id: idItem,
            stock_item_id: selecionado.id,
            item_name: selecionado.name,
            quantity,
            unit_price: null,
            group_id: selecionado.group_id,
            stock_groups: null,
            stock_items: {
              unit: selecionado.unit,
              ideal_quantity: selecionado.ideal_quantity,
              current_quantity: selecionado.current_quantity,
              stock_groups: selecionado.stock_groups,
            },
          }
        : {
            id: idItem,
            stock_item_id: null,
            item_name: itemName.trim(),
            quantity,
            unit_price: null,
            group_id: groupId || null,
            stock_groups: groups.find((g) => g.id === groupId) ?? null,
            stock_items: null,
          };
      await executarOuEnfileirar({
        familyId,
        purchaseId,
        method: "POST",
        path: `/families/${familyId}/purchases/${purchaseId}/items`,
        body,
        previa,
      });
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
        {mode === "estoque" && semListaDoEstoque ? (
          <Alert tone="info">
            A lista do estoque ainda não foi guardada neste aparelho, e agora está sem sinal. Ela fica
            disponível depois de abrir o app uma vez com internet. Enquanto isso, adicione pelo nome em
            Item avulso.
          </Alert>
        ) : null}
        <div className="grid grid-cols-[1fr_88px] gap-3">
          {mode === "estoque" ? (
            <Select label="Item" name="stockItemId" required value={stockItemId} onChange={(e) => setStockItemId(e.target.value)}>
              <option value="">Selecione…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.unit})
                </option>
              ))}
            </Select>
          ) : (
            <Input label="Nome" name="itemName" placeholder="Ex.: Refrigerante" required value={itemName} onChange={(e) => setItemName(e.target.value)} />
          )}
          <Input label="Qtd" name="qty" type="number" inputMode="decimal" min={0} step="any" required value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {mode === "avulso" ? (
          <Select
            label="Grupo"
            name="groupId"
            value={groupId}
            hint="Define em que seção do mercado o item aparece nesta lista"
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">Sem grupo</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        ) : null}
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
      await executarOuEnfileirar({ familyId, purchaseId, method: "POST", path: `/families/${familyId}/purchases/${purchaseId}/finalize`, body });
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

/**
 * Informa o valor de uma compra que ainda nao tem, ou corrige o de uma que ja tem. As duas coisas
 * passam pela mesma rota, e o banco registra cada mudanca no historico do valor.
 */
function SetValueForm({
  familyId,
  purchaseId,
  valorAtual,
  onCancel,
  onDone,
}: {
  familyId: string;
  purchaseId: string;
  valorAtual: number | null;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const corrigindo = valorAtual !== null;
  const [value, setValue] = useState(corrigindo ? String(valorAtual) : "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(value.replace(",", "."));
    if (Number.isNaN(v) || v < 0) {
      setError("Informe um valor válido");
      return;
    }
    if (corrigindo && v === valorAtual) {
      setError("O valor é igual ao atual");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api(`/families/${familyId}/purchases/${purchaseId}/value`, { method: "PATCH", body: { totalValue: v } });
      onDone();
    } catch (err) {
      // Diferente dos itens, o valor nao entra na fila offline, porque a correcao pode esbarrar no
      // rateio e a pessoa precisa saber na hora se deu certo
      setError(err instanceof ApiError ? err.message : "Sem sinal agora. Salvar o valor precisa de internet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 basis-40">
        <Input
          label={corrigindo ? "Novo valor (R$)" : "Informar valor agora (R$)"}
          name="value"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          required
          autoFocus={corrigindo}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error ?? undefined}
        />
      </div>
      <div className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" loading={loading}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

/**
 * Lista do mais recente para o mais antigo cada vez que o valor foi informado ou corrigido, com o
 * valor anterior riscado, para ninguem precisar confiar de memoria no que estava antes.
 */
function HistoricoDoValor({ alteracoes }: { alteracoes: PurchaseValueChange[] }) {
  if (alteracoes.length === 0) return null;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Histórico do valor</p>
      <ul className="flex flex-col gap-2.5">
        {alteracoes.map((alteracao) => (
          <li key={alteracao.id} className="text-sm">
            {alteracao.old_value === null ? (
              <p className="text-ink">
                Informado <span className="font-semibold">{formatBRL(alteracao.new_value)}</span>
              </p>
            ) : (
              <p className="text-ink">
                <span className="text-muted line-through">{formatBRL(alteracao.old_value)}</span> corrigido para{" "}
                <span className="font-semibold">{formatBRL(alteracao.new_value)}</span>
              </p>
            )}
            <p className="text-xs text-muted">
              {alteracao.changed_by_name ?? "Alguém da família"} · {formatDateTime(alteracao.changed_at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
