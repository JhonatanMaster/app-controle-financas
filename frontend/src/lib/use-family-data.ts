"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";
import { comCacheDaFamilia } from "./offline-cache";
import { EVENTO_SINCRONIZADO } from "./sync";
import { useSession } from "./session";

/**
 * Busca um recurso dentro do escopo da familia ativa e expoe reload() para recarregar.
 * Sem rede, mostra a ultima resposta guardada no aparelho e sinaliza que veio do cache.
 */
export function useFamilyData<T>(path: string, pick: (raw: unknown) => T) {
  const { family } = useSession();
  const familyId = family?.family_id;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origemCache, setOrigemCache] = useState(false);
  const [version, setVersion] = useState(0);
  const [loadedVersion, setLoadedVersion] = useState(-1);

  useEffect(() => {
    if (!familyId) return;
    let ignore = false;

    (async () => {
      try {
        const { valor, doCache } = await comCacheDaFamilia(familyId, path);
        if (ignore) return;
        setData(pick(valor));
        setOrigemCache(doCache);
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof ApiError ? err.message : "Falha ao carregar");
      } finally {
        if (!ignore) setLoadedVersion(version);
      }
    })();

    return () => {
      ignore = true;
    };
    // pick e estavel por convencao (funcao inline pura) e nao entra nas deps de proposito
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, path, version]);

  const reload = useCallback(async () => {
    setVersion((v) => v + 1);
  }, []);

  // Quando a fila envia uma alteracao, a tela busca de novo para mostrar o estado do servidor
  useEffect(() => {
    window.addEventListener(EVENTO_SINCRONIZADO, reload);
    return () => window.removeEventListener(EVENTO_SINCRONIZADO, reload);
  }, [reload]);

  return { data, error, loading: loadedVersion !== version, reload, familyId, origemCache };
}
