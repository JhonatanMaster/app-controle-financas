"use client";

import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useFamilyData } from "@/lib/use-family-data";
import { executarOuEnfileirar, useOperacoesPorCaminho } from "@/lib/sync";
import { aplicarFilaCombustivel } from "@/lib/combustivel-offline";
import type { FuelFill, FuelResponse, FuelType } from "@/lib/types";
import { formatBRL, formatDate } from "@/lib/format";
import { custoDosUltimosMeses, grupoDoRegistro, periodRangeLabel, toIsoDate, type GroupBy } from "@/lib/periods";
import { MonthlyCostChart } from "@/components/monthly-cost-chart";
import { Alert, Badge, Button, Card, Empty, Input, InputMoeda, PageTitle, Select, Spinner } from "@/components/ui";

const ROTULO_COMBUSTIVEL: Record<FuelType, string> = {
  gasolina: "Gasolina",
  alcool: "Álcool",
};

const UNIDADE_ABASTECIMENTO = { singular: "abastecimento", plural: "abastecimentos" };

export default function CombustivelPage() {
  const fuel = useFamilyData("/fuel", (raw) => raw as FuelResponse);
  const familyId = fuel.familyId;
  const dados = fuel.data;
  // Registros e exclusoes feitos sem sinal entram por cima da lista que veio do servidor
  const operacoes = useOperacoesPorCaminho(familyId ? `/families/${familyId}/fuel` : undefined);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [groupBy, setGroupBy] = useState<GroupBy>("mes");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pessoa, setPessoa] = useState("todos");
  const [showChart, setShowChart] = useState(false);

  const todos = useMemo(
    () => (dados ? aplicarFilaCombustivel(dados.fills, operacoes, { id: dados.userId, nome: dados.userName }) : []),
    [dados, operacoes],
  );

  // Pessoas que aparecem na lista, para o filtro. So existe quando os registros sao compartilhados
  const pessoas = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const fill of todos) nomes.set(fill.created_by, fill.author_name ?? "Sem nome");
    return [...nomes.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [todos]);

  // Filtro de pessoa vale para a lista e para o grafico, como o de periodo vale so para a lista
  const daPessoa = useMemo(
    () => (pessoa === "todos" ? todos : todos.filter((f) => f.created_by === pessoa)),
    [todos, pessoa],
  );

  const filtrados = useMemo(() => {
    if (groupBy !== "periodo") return daPessoa;
    return daPessoa.filter((f) => (!from || f.fill_date >= from) && (!to || f.fill_date <= to));
  }, [daPessoa, groupBy, from, to]);

  // Mesma estrutura do historico de Compras, agrupando por semana, mes ou intervalo escolhido
  const grupos = useMemo(() => {
    const buckets = new Map<string, { label: string; items: FuelFill[]; total: number }>();

    for (const fill of filtrados) {
      const { key, label } = grupoDoRegistro(fill.fill_date, groupBy, from, to);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { label, items: [], total: 0 };
        buckets.set(key, bucket);
      }
      bucket.items.push(fill);
      bucket.total += fill.value;
    }

    return [...buckets.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, bucket]) => ({ key, ...bucket }));
  }, [filtrados, groupBy, from, to]);

  const custoMensal = useMemo(
    () => custoDosUltimosMeses(daPessoa, (f) => f.fill_date, (f) => f.value),
    [daPessoa],
  );

  async function alterarCompartilhamento(shared: boolean) {
    if (!familyId) return;
    setError(null);
    try {
      await api(`/families/${familyId}/fuel/settings`, { method: "PATCH", body: { shared } });
      fuel.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao alterar o compartilhamento");
    }
  }

  async function excluir(fill: FuelFill) {
    if (!familyId || !confirm("Excluir este abastecimento?")) return;
    setError(null);
    setSaving(true);
    try {
      await executarOuEnfileirar({
        purchaseId: null,
        familyId,
        method: "DELETE",
        path: `/families/${familyId}/fuel/${fill.id}`,
        body: undefined,
      });
      fuel.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle title="Combustível" subtitle="Abastecimentos de cada carro da família." />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {dados ? (
        <Card className="mb-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Compartilhar com a família</p>
              <p className="text-xs text-muted">
                {dados.shared
                  ? "Todos da família veem os abastecimentos de todos."
                  : "Individual: cada um vê somente os próprios abastecimentos."}
              </p>
            </div>
            {dados.isTitular ? (
              <Button size="sm" variant="secondary" onClick={() => alterarCompartilhamento(!dados.shared)}>
                {dados.shared ? "Tornar individual" : "Compartilhar"}
              </Button>
            ) : (
              <Badge tone={dados.shared ? "brand" : "neutral"}>{dados.shared ? "Compartilhado" : "Individual"}</Badge>
            )}
          </div>
          {!dados.isTitular ? <p className="mt-2 text-xs text-muted">Somente o titular da conta pode alterar essa opção.</p> : null}
        </Card>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Novo abastecimento</h2>
          <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Fechar" : "+ Registrar"}
          </Button>
        </div>
        {showForm && familyId ? (
          <FuelForm
            familyId={familyId}
            usuario={{ id: dados?.userId ?? "", nome: dados?.userName ?? null }}
            onDone={() => {
              setShowForm(false);
              fuel.reload();
            }}
          />
        ) : (
          <p className="text-sm text-muted">Registre o valor de cada abastecimento, o tipo de combustível e o posto.</p>
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

          {dados?.shared && pessoas.length > 1 ? (
            <Select label="Pessoa" name="pessoa" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="todos">Todos da família</option>
              {pessoas.map(([id, nome]) => (
                <option key={id} value={id}>
                  {id === dados.userId ? `${nome} (eu)` : nome}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        {fuel.loading ? (
          <Spinner />
        ) : grupos.length === 0 ? (
          <Empty
            title={groupBy === "periodo" && (from || to) ? "Nenhum abastecimento neste período" : "Nenhum abastecimento registrado"}
            description={groupBy === "periodo" && (from || to) ? periodRangeLabel(from, to) : undefined}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {grupos.map((grupo) => (
              <div key={grupo.key}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">{grupo.label}</h3>
                  <span className="text-sm font-semibold text-ink tabular-nums">{formatBRL(grupo.total)}</span>
                </div>
                <Card className="divide-y divide-line p-0">
                  {grupo.items.map((fill) => {
                    const meu = dados?.userId === fill.created_by;
                    return (
                      <div key={fill.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-ink">{formatDate(fill.fill_date)}</p>
                            <Badge tone={fill.fuel_type === "gasolina" ? "brand" : "ok"}>{ROTULO_COMBUSTIVEL[fill.fuel_type]}</Badge>
                          </div>
                          <p className="truncate text-xs text-muted">
                            {fill.station_name ?? "Posto não informado"}
                            {dados?.shared ? ` · ${meu ? "você" : fill.author_name ?? "Sem nome"}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <p className="font-semibold text-ink tabular-nums">{formatBRL(fill.value)}</p>
                          {meu ? (
                            <button
                              type="button"
                              onClick={() => excluir(fill)}
                              disabled={saving}
                              className="text-xs text-red-600 hover:underline disabled:opacity-50"
                            >
                              Excluir
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
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
            <p className="mb-3 text-xs text-muted">Soma dos abastecimentos registrados</p>
            <MonthlyCostChart data={custoMensal} unidade={UNIDADE_ABASTECIMENTO} />
          </Card>
        ) : null}
      </section>
    </>
  );
}

function FuelForm({
  familyId,
  usuario,
  onDone,
}: {
  familyId: string;
  usuario: { id: string; nome: string | null };
  onDone: () => void;
}) {
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [fuelType, setFuelType] = useState<FuelType>("gasolina");
  const [value, setValue] = useState<number | null>(null);
  const [station, setStation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (value === null || value <= 0) {
      setError("Informe um valor maior que zero");
      return;
    }

    setLoading(true);
    try {
      // O id nasce aqui para que reenviar o registro depois de uma queda de sinal nao o duplique
      const id = crypto.randomUUID();
      const stationName = station.trim() || null;
      await executarOuEnfileirar({
        purchaseId: null,
        familyId,
        method: "POST",
        path: `/families/${familyId}/fuel`,
        body: { id, fillDate: date, fuelType, value, stationName },
        // Como o registro aparece na lista enquanto ainda esta na fila
        previa: {
          id,
          created_by: usuario.id,
          author_name: usuario.nome,
          fill_date: date,
          fuel_type: fuelType,
          value,
          station_name: stationName,
          created_at: new Date().toISOString(),
        } satisfies FuelFill,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao registrar o abastecimento");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data" name="fillDate" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          <InputMoeda label="Valor" name="value" required value={value} onValueChange={setValue} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Combustível" name="fuelType" value={fuelType} onChange={(e) => setFuelType(e.target.value as FuelType)}>
            <option value="gasolina">Gasolina</option>
            <option value="alcool">Álcool</option>
          </Select>
          <Input label="Posto (opcional)" name="station" placeholder="Ex.: Shell Av. Brasil" value={station} onChange={(e) => setStation(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            Registrar abastecimento
          </Button>
        </div>
      </form>
    </Card>
  );
}
