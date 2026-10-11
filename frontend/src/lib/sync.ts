import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { adicionarOperacao, listarOperacoes, removerOperacao, type Operacao } from "./offline-db";

/** Disparado quando a fila muda, para telas e banner atualizarem o que mostram */
export const EVENTO_FILA = "cf:fila";
/** Disparado quando o servidor recebeu uma alteracao, para as telas buscarem os dados de novo */
export const EVENTO_SINCRONIZADO = "cf:sincronizado";

let rodando = false;
let pedidoNovo = false;
let ultimaFalha: string | null = null;

function avisar(nome: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(nome));
}

/** Quando o erro nao vem da API, a requisicao nem chegou a uma resposta, ou seja, nao ha rede */
function semResposta(err: unknown) {
  return !(err instanceof ApiError);
}

export type NovaOperacao = Omit<Operacao, "seq" | "criadoEm">;

/**
 * Executa uma alteracao no servidor. Se nao houver nada pendente e a rede responder, vai direto.
 * Sem rede, ou com a fila ja existente, entra no fim dela para nao furar a ordem.
 *
 * Resposta 409 conta como sucesso. Nos casos usados aqui ela so aparece quando a operacao ja foi
 * aplicada numa tentativa anterior, cuja resposta se perdeu, por exemplo finalizar duas vezes.
 *
 * @throws ApiError quando o servidor recusa a alteracao com uma regra de negocio.
 */
export async function executarOuEnfileirar(op: NovaOperacao): Promise<void> {
  const pendentes = await listarOperacoes().catch(() => [] as Operacao[]);

  if (pendentes.length === 0) {
    try {
      await api(op.path, { method: op.method, body: op.body });
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return;
      if (!semResposta(err)) throw err;
    }
  }

  await adicionarOperacao({ ...op, criadoEm: new Date().toISOString() });
  avisar(EVENTO_FILA);
  void sincronizar();
}

/**
 * Envia a fila inteira, na ordem. Chamadas feitas durante um envio viram uma nova passada, para
 * nenhuma operacao ficar parada esperando o proximo gatilho.
 */
export async function sincronizar(): Promise<void> {
  if (rodando) {
    pedidoNovo = true;
    return;
  }
  rodando = true;
  try {
    do {
      pedidoNovo = false;
      await esvaziarFila();
    } while (pedidoNovo);
  } finally {
    rodando = false;
    avisar(EVENTO_FILA);
  }
}

async function esvaziarFila(): Promise<void> {
  for (;;) {
    const [proxima] = await listarOperacoes().catch(() => [] as Operacao[]);
    if (!proxima) return;

    try {
      await api(proxima.path, { method: proxima.method, body: proxima.body });
      ultimaFalha = null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Ja aplicada antes, nada a fazer
      } else if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401) {
        // Recusa definitiva, reenviar nao muda o resultado. Sai da fila e fica avisado
        ultimaFalha = err.message;
      } else {
        // Sem rede, erro do servidor ou sessao expirada. Fica na fila para a proxima tentativa
        return;
      }
    }

    await removerOperacao(proxima.seq as number);
    avisar(EVENTO_SINCRONIZADO);
    avisar(EVENTO_FILA);
  }
}

export type EstadoSincronizacao = {
  pendentes: number;
  offline: boolean;
  falha: string | null;
  limparFalha: () => void;
};

/**
 * Estado da fila para o banner do app. Atualiza sempre que a fila muda ou a rede oscila.
 */
export function useEstadoSincronizacao(): EstadoSincronizacao {
  const [pendentes, setPendentes] = useState(0);
  const [offline, setOffline] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => {
    function atualizar() {
      listarOperacoes()
        .then((ops) => setPendentes(ops.length))
        .catch(() => undefined);
      setFalha(ultimaFalha);
      setOffline(!navigator.onLine);
    }
    atualizar();
    window.addEventListener(EVENTO_FILA, atualizar);
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener(EVENTO_FILA, atualizar);
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  return {
    pendentes,
    offline,
    falha,
    limparFalha: () => {
      ultimaFalha = null;
      setFalha(null);
    },
  };
}

/**
 * Operacoes ainda nao enviadas de uma compra, na ordem em que foram feitas.
 */
export function useOperacoesDaCompra(purchaseId: string | undefined): Operacao[] {
  const [operacoes, setOperacoes] = useState<Operacao[]>([]);

  useEffect(() => {
    if (!purchaseId) return;
    function atualizar() {
      listarOperacoes()
        .then((lista) => setOperacoes(lista.filter((op) => op.purchaseId === purchaseId)))
        .catch(() => undefined);
    }
    atualizar();
    window.addEventListener(EVENTO_FILA, atualizar);
    return () => window.removeEventListener(EVENTO_FILA, atualizar);
  }, [purchaseId]);

  return operacoes;
}
