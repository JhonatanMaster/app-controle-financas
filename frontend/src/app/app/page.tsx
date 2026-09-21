"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { useFamilyData } from "@/lib/use-family-data";
import type { PurchaseSummary, ShoppingListItem } from "@/lib/types";
import { formatBRL, formatDate, formatQty } from "@/lib/format";
import { Badge, Button, Card, Empty, PageTitle, Spinner } from "@/components/ui";

export default function DashboardPage() {
  const { me, family } = useSession();
  const shopping = useFamilyData("/shopping-list", (raw) => (raw as { items: ShoppingListItem[] }).items);
  const purchases = useFamilyData("/purchases", (raw) => (raw as { purchases: PurchaseSummary[] }).purchases);

  const openPurchase = purchases.data?.find((p) => !p.finalized_at);
  const pendingValue = purchases.data?.filter((p) => p.finalized_at && p.value_status === "pendente") ?? [];

  return (
    <>
      <PageTitle title={`Olá, ${family?.display_name ?? me?.email?.split("@")[0] ?? ""}`} subtitle={family?.families?.name} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted">Carrinho automático</p>
              <p className="mt-1 text-3xl font-semibold text-ink">{shopping.loading ? "…" : shopping.data?.length ?? 0}</p>
              <p className="text-xs text-muted">itens no mínimo</p>
            </div>
            <Link href="/app/compras">
              <Button size="sm" variant="secondary">
                Ver carrinho
              </Button>
            </Link>
          </div>
        </Card>

        <Card>
          <p className="text-sm text-muted">Compra em andamento</p>
          {purchases.loading ? (
            <p className="mt-1 text-3xl font-semibold text-ink">…</p>
          ) : openPurchase ? (
            <>
              <p className="mt-1 text-lg font-semibold text-ink">{formatDate(openPurchase.purchase_date)}</p>
              <p className="text-xs text-muted">{openPurchase.purchase_items?.[0]?.count ?? 0} itens no carrinho</p>
              <Link href={`/app/compras/${openPurchase.id}`} className="mt-3 inline-block">
                <Button size="sm">Continuar no mercado</Button>
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1 text-lg font-semibold text-ink">Nenhuma</p>
              <Link href="/app/compras" className="mt-3 inline-block">
                <Button size="sm" variant="secondary">
                  Iniciar compra
                </Button>
              </Link>
            </>
          )}
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-ink">Itens que precisam de reposição</h2>
        {shopping.loading ? (
          <Spinner />
        ) : !shopping.data || shopping.data.length === 0 ? (
          <Empty title="Estoque em dia" description="Nenhum item atingiu a quantidade mínima." />
        ) : (
          <Card className="divide-y divide-line p-0">
            {shopping.data.slice(0, 6).map((it) => (
              <div key={it.stock_item_id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium text-ink">{it.name}</p>
                  <p className="text-xs text-muted">
                    Tem {formatQty(it.current_quantity)} {it.unit} · ideal {formatQty(it.ideal_quantity)}
                  </p>
                </div>
                <Badge tone="warn">comprar {formatQty(it.suggested_quantity)}</Badge>
              </div>
            ))}
          </Card>
        )}
      </section>

      {pendingValue.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-ink">Compras sem valor informado</h2>
          <Card className="divide-y divide-line p-0">
            {pendingValue.map((p) => (
              <Link key={p.id} href={`/app/compras/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
                <div>
                  <p className="font-medium text-ink">{formatDate(p.purchase_date)}</p>
                  <p className="text-xs text-muted">{p.type === "avulsa" ? "Compra avulsa" : "Reposição"} · {p.purchase_items?.[0]?.count ?? 0} itens</p>
                </div>
                <span className="text-sm text-brand">{formatBRL(p.total_value)} · adicionar</span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </>
  );
}
