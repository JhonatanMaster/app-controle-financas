"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatBRL } from "@/lib/format";
import { LeitorQrCode } from "@/components/leitor-qrcode";
import { Alert, Button, Input } from "@/components/ui";

type Resultado = { purchaseId: string; status: "importada" | "so_chave"; itens: number; totalValue: number | null };

type Falha =
  | { tipo: "repetida"; mensagem: string; purchaseId: string }
  | { tipo: "sefaz"; mensagem: string; conteudo: string }
  | { tipo: "erro"; mensagem: string };

/**
 * Registra uma compra a partir da nota fiscal. A pessoa le o QR Code do cupom pela camera, por foto,
 * ou digita os 44 numeros da chave. A API consulta a SEFAZ e devolve a compra ja com itens, total e
 * forma de pagamento.
 */
export function ImportarNotaDialog({
  familyId,
  onClose,
  onImportada,
}: {
  familyId: string;
  onClose: () => void;
  onImportada: (purchaseId: string) => void;
}) {
  const [modo, setModo] = useState<"camera" | "chave">("camera");
  const [chave, setChave] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [concluida, setConcluida] = useState<Resultado | null>(null);
  // Remonta o leitor para ler de novo depois de uma falha
  const [leitura, setLeitura] = useState(0);

  async function importar(conteudo: string, apenasChave = false) {
    setFalha(null);
    setEnviando(true);
    try {
      const res = await api<Resultado>(`/families/${familyId}/fiscal-notes/import`, {
        method: "POST",
        body: { conteudo, apenasChave },
      });
      setConcluida(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.data?.purchaseId === "string") {
        setFalha({ tipo: "repetida", mensagem: err.message, purchaseId: err.data.purchaseId });
      } else if (err instanceof ApiError && err.data?.podeRegistrarSoChave) {
        setFalha({ tipo: "sefaz", mensagem: err.message, conteudo });
      } else {
        setFalha({
          tipo: "erro",
          mensagem: err instanceof ApiError ? err.message : "Sem conexão. Ler a nota precisa de internet, porque os dados vêm da SEFAZ.",
        });
      }
    } finally {
      setEnviando(false);
    }
  }

  const chaveDigitada = chave.replace(/\D/g, "");

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="importar-nota-titulo"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="importar-nota-titulo" className="text-lg font-semibold text-ink">
              Registrar pela nota fiscal
            </h2>
            <p className="mt-1 text-sm text-muted">Os itens, o total e a forma de pagamento vêm direto da SEFAZ.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar">
            ✕
          </Button>
        </div>

        {concluida ? (
          <div className="flex flex-col gap-4">
            <Alert tone="info">
              {concluida.status === "importada" ? (
                <>
                  Nota lida com {concluida.itens} {concluida.itens === 1 ? "item" : "itens"}, total de{" "}
                  <strong>{formatBRL(concluida.totalValue)}</strong>.
                </>
              ) : (
                <>Nota registrada só pela chave. Informe o valor da compra na próxima tela.</>
              )}
            </Alert>
            <Button size="lg" onClick={() => onImportada(concluida.purchaseId)}>
              Ver a compra
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2 rounded-xl bg-surface-2 p-1 text-sm">
              {(["camera", "chave"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setModo(m);
                    setFalha(null);
                  }}
                  className={`flex-1 rounded-lg py-2 font-medium transition ${modo === m ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
                >
                  {m === "camera" ? "Ler QR Code" : "Digitar chave"}
                </button>
              ))}
            </div>

            {falha ? (
              <div className="flex flex-col gap-2">
                <Alert>{falha.mensagem}</Alert>
                {falha.tipo === "repetida" ? (
                  <Button variant="secondary" onClick={() => onImportada(falha.purchaseId)}>
                    Abrir a compra desta nota
                  </Button>
                ) : null}
                {falha.tipo === "sefaz" ? (
                  <Button variant="secondary" loading={enviando} onClick={() => importar(falha.conteudo, true)}>
                    Registrar só com a chave
                  </Button>
                ) : null}
                {modo === "camera" ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFalha(null);
                      setLeitura((n) => n + 1);
                    }}
                  >
                    Ler outro QR Code
                  </Button>
                ) : null}
              </div>
            ) : null}

            {enviando ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                <p className="text-sm text-muted">Consultando a nota na SEFAZ…</p>
              </div>
            ) : modo === "camera" ? (
              !falha ? <LeitorQrCode key={leitura} onLido={(texto) => importar(texto)} /> : null
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  importar(chaveDigitada);
                }}
              >
                <Input
                  label="Chave de acesso"
                  name="chave"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="44 números, abaixo do QR Code"
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  hint={`${chaveDigitada.length} de 44 números`}
                />
                <p className="text-xs text-muted">
                  Só com a chave a SEFAZ não libera os itens sem captcha, então a compra entra com o CNPJ da loja, o
                  número da nota e o mês, e você informa o valor. Pelo QR Code tudo é preenchido sozinho.
                </p>
                <Button type="submit" disabled={chaveDigitada.length !== 44}>
                  Registrar nota
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
