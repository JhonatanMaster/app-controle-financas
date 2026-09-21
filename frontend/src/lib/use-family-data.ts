"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useSession } from "./session";

/**
 * Busca `/families/:familyId${path}` para a familia ativa e expoe reload().
 */
export function useFamilyData<T>(path: string, pick: (raw: unknown) => T) {
  const { family } = useSession();
  const familyId = family?.family_id;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [loadedVersion, setLoadedVersion] = useState(-1);

  useEffect(() => {
    if (!familyId) return;
    let ignore = false;

    (async () => {
      try {
        const raw = await api(`/families/${familyId}${path}`);
        if (ignore) return;
        setData(pick(raw));
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

  return { data, error, loading: loadedVersion !== version, reload, familyId };
}
