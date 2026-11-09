"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatBRL, formatDateTime } from "@/lib/format";
import {
  baixarHtml,
  formatarChave,
  formatarCnpj,
  nomeDoModelo,
  quantidadeLegivel,
  siglaDaUf,
  unidadeLegivel,
} from "@/lib/nota-fiscal";
import type { FiscalNote, PurchaseItem } from "@/lib/types";
import { Alert, Badge, Button, Card } from "@/components/ui";

/** Resumo da nota no detalhe da compra, com os atalhos para ver a nota completa e baixar */
export function NotaFiscalCard({
  familyId,
  nota,
  itens,
  onExcluida,
}: {
  familyId: string;
  nota: FiscalNote;
  itens: PurchaseItem[];
  onExcluida: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  async function excluir() {
    setErro(null);
    setExcluindo(true);
    try {
      await api(`/families/${familyId}/fiscal-notes/${nota.id}`, { method: "DELETE" });
      onExcluida();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Sem conexão. Excluir a nota precisa de internet.");
      setExcluindo(false);
    }
  }

  async function baixar() {
    setErro(null);
    setBaixando(true);
    try {
      const res = await api<{ accessKey: string; html: string }>(`/families/${familyId}/fiscal-notes/${nota.id}/html`);
      baixarHtml(`${nomeDoModelo(nota.model)}-${res.accessKey}.html`, res.html);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Sem conexão para baixar a nota agora");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Card className="mb-5">
      <button type="button" onClick={() => setAberta(true)} className="block w-full text-left" aria-label="Ver a nota fiscal completa">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone="brand">{nomeDoModelo(nota.model)}</Badge>
              {nota.status === "so_chave" ? <Badge tone="warn">só a chave</Badge> : null}
            </div>
            <p className="mt-2 truncate font-medium text-ink">{nota.issuer_name ?? (nota.issuer_cnpj ? `CNPJ ${formatarCnpj(nota.issuer_cnpj)}` : "Emitente")}</p>
            <p className="text-xs text-muted">
              {nota.number ? `Nº ${nota.number}` : null}
              {nota.series ? ` · série ${nota.series}` : null}
              {nota.issued_at ? ` · ${formatDateTime(nota.issued_at)}` : null}
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-brand-dark">Ver nota ›</span>
        </div>
        {nota.payments.length > 0 ? (
          <p className="mt-2 text-sm text-ink">
            <span className="text-muted">Pagamento: </span>
            {nota.payments.map((p) => p.method).join(" + ")}
          </p>
        ) : null}
      </button>

      {erro ? <div className="mt-3"><Alert>{erro}</Alert></div> : null}

      {confirmandoExclusao ? (
        // Confirmacao no proprio card, porque excluir leva a compra junto e nao tem como desfazer
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">
            Excluir esta nota? A compra registrada por ela também será excluída
            {itens.length > 0 ? `, com ${itens.length === 1 ? "o item" : `os ${itens.length} itens`} e o valor` : ""}. Não dá para
            desfazer.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmandoExclusao(false)} disabled={excluindo}>
              Manter
            </Button>
            <Button size="sm" variant="danger" onClick={excluir} loading={excluindo}>
              Excluir nota e compra
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={() => setAberta(true)}>
            Ver nota completa
          </Button>
          {nota.status === "importada" ? (
            <Button size="sm" variant="ghost" onClick={baixar} loading={baixando}>
              Baixar
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="ml-auto text-red-700 hover:bg-red-50" onClick={() => setConfirmandoExclusao(true)}>
            Excluir
          </Button>
        </div>
      )}

      {aberta ? <NotaFiscalDialog familyId={familyId} nota={nota} itens={itens} onClose={() => setAberta(false)} onBaixar={baixar} baixando={baixando} /> : null}
    </Card>
  );
}

/**
 * A nota inteira em duas vistas. O resumo e montado com os dados guardados e funciona sem rede. A
 * pagina original e a que a SEFAZ devolveu, exibida num iframe sem permissao de script.
 */
function NotaFiscalDialog({
  familyId,
  nota,
  itens,
  onClose,
  onBaixar,
  baixando,
}: {
  familyId: string;
  nota: FiscalNote;
  itens: PurchaseItem[];
  onClose: () => void;
  onBaixar: () => void;
  baixando: boolean;
}) {
  const [vista, setVista] = useState<"resumo" | "original">("resumo");
  const [html, setHtml] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (vista !== "original" || html !== null) return;
    let ignorar = false;
    api<{ html: string }>(`/families/${familyId}/fiscal-notes/${nota.id}/html`)
      .then((res) => !ignorar && setHtml(res.html))
      .catch((err) => !ignorar && setErro(err instanceof ApiError ? err.message : "Sem conexão para abrir a página original"));
    return () => {
      ignorar = true;
    };
  }, [vista, html, familyId, nota.id]);

  useEffect(() => {
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [onClose]);

  const somaDosItens = itens.reduce((acc, it) => acc + (it.total_price ?? 0), 0);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nota fiscal"
        className="flex max-h-[94vh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
            {(["resumo", "original"] as const).map((v) => (
              <button
                key={v}
                type="button"
                disabled={v === "original" && nota.status !== "importada"}
                onClick={() => setVista(v)}
                className={`rounded-lg px-3 py-1.5 font-medium transition disabled:opacity-40 ${vista === v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {v === "resumo" ? "Resumo" : "Página da SEFAZ"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar">
            ✕
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {vista === "original" ? (
            erro ? (
              <div className="p-5"><Alert>{erro}</Alert></div>
            ) : html === null ? (
              <div className="flex justify-center py-16">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
              </div>
            ) : (
              // sandbox vazio bloqueia script, formulario e navegacao; o HTML ja foi guardado limpo,
              // e esta e a segunda barreira
              <iframe title="Nota fiscal na SEFAZ" sandbox="" srcDoc={html} className="h-[75vh] w-full bg-white" />
            )
          ) : (
            <div className="px-5 py-4 text-sm">
              <div className="text-center">
                <p className="font-semibold text-ink">{nota.issuer_name ?? "Emitente não informado"}</p>
                {nota.issuer_cnpj ? <p className="text-xs text-muted">CNPJ {formatarCnpj(nota.issuer_cnpj)}</p> : null}
                {nota.issuer_address ? <p className="text-xs text-muted">{nota.issuer_address}</p> : null}
              </div>

              {nota.status === "so_chave" ? (
                <div className="mt-4">
                  <Alert tone="info">
                    Esta nota foi registrada só pela chave, então os itens não vieram da SEFAZ. Para ver o cupom completo, consulte a chave
                    no portal da SEFAZ do estado ({siglaDaUf(nota.uf_code)}).
                  </Alert>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-line border-y border-line">
                  {itens.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{item.item_name}</p>
                        <p className="text-xs text-muted">
                          {quantidadeLegivel(item)} {unidadeLegivel(item.unit)}
                          {item.unit_price !== null ? ` × ${formatBRL(item.unit_price)}` : null}
                          {item.product_code ? ` · cód. ${item.product_code}` : null}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums text-ink">{formatBRL(item.total_price ?? null)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="mt-4 flex flex-col gap-1.5">
                {nota.items_count !== null ? <Linha rotulo="Quantidade de itens" valor={String(nota.items_count)} /> : null}
                {nota.discount_value ? <Linha rotulo="Descontos" valor={formatBRL(nota.discount_value)} /> : null}
                <Linha rotulo="Valor a pagar" valor={formatBRL(nota.total_value)} destaque />
                {nota.payments.map((p, i) => (
                  <Linha key={i} rotulo={p.method} valor={formatBRL(p.value)} />
                ))}
              </dl>
              {nota.status === "importada" && nota.total_value !== null && Math.abs(somaDosItens - nota.total_value - (nota.discount_value ?? 0)) > 0.02 ? (
                <p className="mt-2 text-xs text-muted">A soma dos itens ({formatBRL(somaDosItens)}) difere do total por descontos ou acréscimos da nota.</p>
              ) : null}

              <dl className="mt-5 flex flex-col gap-1.5 border-t border-line pt-4 text-xs">
                <Linha rotulo="Modelo" valor={`${nomeDoModelo(nota.model)} · ${siglaDaUf(nota.uf_code)}`} />
                {nota.number ? <Linha rotulo="Número e série" valor={`${nota.number} / ${nota.series ?? "?"}`} /> : null}
                {nota.issued_at ? <Linha rotulo="Emissão" valor={formatDateTime(nota.issued_at)} /> : null}
                {nota.authorization_protocol ? <Linha rotulo="Protocolo" valor={nota.authorization_protocol} /> : null}
              </dl>
              <p className="mt-3 text-xs text-muted">Chave de acesso</p>
              <p className="font-mono text-xs tracking-tight text-ink">{formatarChave(nota.access_key)}</p>
            </div>
          )}
        </div>

        {nota.status === "importada" ? (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p className="text-xs text-muted">O arquivo abre no navegador e pode ser salvo em PDF pela impressão.</p>
            <Button size="sm" variant="secondary" onClick={onBaixar} loading={baixando}>
              Baixar nota
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={destaque ? "font-semibold text-ink" : "text-muted"}>{rotulo}</dt>
      <dd className={`tabular-nums ${destaque ? "text-lg font-semibold text-ink" : "text-ink"}`}>{valor}</dd>
    </div>
  );
}
