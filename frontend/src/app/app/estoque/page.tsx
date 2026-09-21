"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useFamilyData } from "@/lib/use-family-data";
import type { StockItem } from "@/lib/types";
import { formatQty } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Input, PageTitle, Spinner } from "@/components/ui";

export default function EstoquePage() {
  const { data, loading, error, reload, familyId } = useFamilyData("/stock-items", (raw) => (raw as { items: StockItem[] }).items);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function consume(item: StockItem) {
    if (!familyId) return;
    setActionError(null);
    try {
      await api(`/families/${familyId}/stock-items/${item.id}/consume`, { method: "POST", body: { quantity: 1 } });
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Falha ao registrar consumo");
    }
  }

  async function remove(item: StockItem) {
    if (!familyId) return;
    if (!confirm(`Excluir "${item.name}" do estoque?`)) return;
    setActionError(null);
    try {
      await api(`/families/${familyId}/stock-items/${item.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  return (
    <>
      <PageTitle
        title="Estoque"
        subtitle="Registre o que abriu; ao atingir o mínimo o item vai para o carrinho."
        action={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            + Item
          </Button>
        }
      />

      {actionError ? <div className="mb-4"><Alert>{actionError}</Alert></div> : null}

      {showForm ? (
        <div className="mb-5">
          <StockItemForm
            familyId={familyId!}
            item={editing}
            onDone={() => {
              setShowForm(false);
              setEditing(null);
              reload();
            }}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        </div>
      ) : null}

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data || data.length === 0 ? (
        <Empty
          title="Nenhum item cadastrado"
          description='Cadastre os itens da despensa com quantidade mínima e ideal. Ex.: "Arroz (pct)": mínimo 1, ideal 3.'
          action={<Button onClick={() => setShowForm(true)}>Cadastrar primeiro item</Button>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((item) => {
            const low = item.current_quantity <= item.min_quantity;
            return (
              <Card key={item.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-ink">{item.name}</p>
                    {low ? <Badge tone="warn">no carrinho</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    mín {formatQty(item.min_quantity)} · ideal {formatQty(item.ideal_quantity)} {item.unit}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <button
                      className="text-brand hover:underline"
                      onClick={() => {
                        setEditing(item);
                        setShowForm(true);
                      }}
                    >
                      Editar
                    </button>
                    <button className="text-muted hover:text-red-600 hover:underline" onClick={() => remove(item)}>
                      Excluir
                    </button>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <span className={`text-2xl font-semibold ${low ? "text-amber-600" : "text-ink"}`}>{formatQty(item.current_quantity)}</span>
                  <Button size="sm" variant="secondary" onClick={() => consume(item)} disabled={item.current_quantity <= 0}>
                    Abri 1
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function StockItemForm({ familyId, item, onDone, onCancel }: { familyId: string; item: StockItem | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: item?.name ?? "",
    unit: item?.unit ?? "un",
    minQuantity: item ? String(item.min_quantity) : "1",
    idealQuantity: item ? String(item.ideal_quantity) : "3",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const min = Number(form.minQuantity.replace(",", "."));
    const ideal = Number(form.idealQuantity.replace(",", "."));
    if (Number.isNaN(min) || Number.isNaN(ideal)) {
      setError("Quantidades inválidas");
      return;
    }
    if (ideal < min) {
      setError("A quantidade ideal precisa ser maior ou igual à mínima");
      return;
    }
    setLoading(true);
    try {
      const body = { name: form.name.trim(), unit: form.unit.trim() || "un", minQuantity: min, idealQuantity: ideal };
      if (item) {
        await api(`/families/${familyId}/stock-items/${item.id}`, { method: "PATCH", body });
      } else {
        await api(`/families/${familyId}/stock-items`, { method: "POST", body });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <p className="font-medium text-ink">{item ? "Editar item" : "Novo item de estoque"}</p>
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Nome" name="name" placeholder="Ex.: Arroz" required value={form.name} onChange={update("name")} />
        <div className="grid grid-cols-3 gap-3">
          <Input label="Unidade" name="unit" placeholder="pct, kg, un" value={form.unit} onChange={update("unit")} />
          <Input label="Mínimo" name="minQuantity" type="number" inputMode="decimal" min={0} step="any" required value={form.minQuantity} onChange={update("minQuantity")} />
          <Input label="Ideal" name="idealQuantity" type="number" inputMode="decimal" min={0} step="any" required value={form.idealQuantity} onChange={update("idealQuantity")} />
        </div>
        {!item ? <p className="text-xs text-muted">O item começa com a quantidade ideal em estoque.</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
