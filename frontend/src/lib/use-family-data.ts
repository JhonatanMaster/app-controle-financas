"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";
import { comCacheDaFamilia } from "./offline-cache";
import { EVENTO_SINCRONIZADO } from "./sync";
import { useSession } from "./session";

/** Cada resultado guarda de onde veio, para nunca aparecer na tela de outro recurso */
type Resultado<T> = { chave: string; valor: T; doCache: boolean };

/**
 * Busca um recurso dentro do escopo da familia ativa e expoe reload() para recarregar.
 * Sem rede, mostra a ultima resposta guardada no aparelho e sinaliza que veio do cache.
 *
 * So a primeira carga de cada recurso conta como loading. Uma nova busca depois de uma acao
 * mantem o dado atual na tela ate o novo chegar, porque trocar a lista por um spinner desmonta
 * tudo, a pagina encolhe e o navegador volta ao topo. Essa busca em andamento aparece em
 * atualizando, para quem quiser sinalizar.
 */
export function useFamilyData<T>(path: string, pick: (raw: unknown) => T) {
  const { family } = useSession();
  const familyId = family?.family_id;
  const chave = familyId ? `${familyId}:${path}` : null;

  const [resultado, setResultado] = useState<Resultado<T> | null>(null);
  const [falha, setFalha] = useState<{ chave: string; mensagem: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [concluida, setConcluida] = useState<{ chave: string; version: number } | null>(null);

  useEffect(() => {
    if (!familyId || !chave) return;
    let ignore = false;

    (async () => {
      try {
        const { valor, doCache } = await comCacheDaFamilia(familyId, path);
        if (ignore) return;
        setResultado({ chave, valor: pick(valor), doCache });
        setFalha(null);
      } catch (err) {
        if (ignore) return;
        setFalha({ chave, mensagem: err instanceof ApiError ? err.message : "Falha ao carregar" });
      } finally {
        if (!ignore) setConcluida({ chave, version });
      }
    })();

    return () => {
      ignore = true;
    };
    // pick e estavel por convencao (funcao inline pura) e nao entra nas deps de proposito
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, path, chave, version]);

  const reload = useCallback(async () => {
    setVersion((v) => v + 1);
  }, []);

  /**
   * Aplica uma mudanca na tela antes de o servidor confirmar, para a acao responder na hora. O
   * reload seguinte traz o valor real, e corrige a tela se o servidor tiver recusado.
   */
  const atualizarLocal = useCallback(
    (transformar: (atual: T) => T) => {
      setResultado((atual) => (atual && atual.chave === chave ? { ...atual, valor: transformar(atual.valor) } : atual));
    },
    [chave],
  );

  // Quando a fila envia uma alteracao, a tela busca de novo para mostrar o estado do servidor
  useEffect(() => {
    window.addEventListener(EVENTO_SINCRONIZADO, reload);
    return () => window.removeEventListener(EVENTO_SINCRONIZADO, reload);
  }, [reload]);

  const data = resultado && resultado.chave === chave ? resultado.valor : null;
  const error = falha && falha.chave === chave ? falha.mensagem : null;
  const buscando = !concluida || concluida.chave !== chave || concluida.version !== version;

  return {
    data,
    error,
    loading: buscando && data === null,
    atualizando: buscando && data !== null,
    reload,
    atualizarLocal,
    familyId,
    origemCache: resultado && resultado.chave === chave ? resultado.doCache : false,
  };
}
