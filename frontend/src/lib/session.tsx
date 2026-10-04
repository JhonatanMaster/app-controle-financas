"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api";
import type { Me, Membership } from "./types";

type SessionState = {
  me: Me | null;
  loading: boolean;
  family: Membership | null;
  setFamilyId: (id: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);
const FAMILY_KEY = "cf.familyId";
const ME_KEY = "cf.me";

/**
 * Ultimo /auth/me conhecido, usado quando a API nao responde. Nao guarda token nenhum, a sessao
 * continua apenas nos cookies httpOnly, e so e descartado quando a API confirma que a sessao
 * acabou. Assim abrir o app sem rede nao joga o usuario de volta para o login.
 */
function lerMeSalvo(): Me | null {
  try {
    const bruto = localStorage.getItem(ME_KEY);
    return bruto ? (JSON.parse(bruto) as Me) : null;
  } catch {
    return null;
  }
}

function salvarMe(me: Me | null) {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch {
    // storage indisponivel
  }
}

/**
 * Busca o perfil e decide o que vale como sessao. Fica fora do componente para a carga inicial e
 * o refresh tratarem cada tipo de falha do mesmo jeito.
 *
 * @returns O perfil, ou null quando nao ha mais sessao.
 */
async function carregarMe(): Promise<Me | null> {
  try {
    // O proprio api() renova a sessao e repete a chamada quando o access token expirou
    return await api<Me>("/auth/me");
  } catch (err) {
    // Um 401 aqui ja passou pela renovacao, entao a sessao acabou de fato. Qualquer outra falha e
    // rede ou servidor fora, e nesse caso o app segue com o ultimo perfil conhecido, porque ele e
    // usado no mercado, com sinal ruim
    if (err instanceof ApiError && err.status === 401) return null;
    return lerMeSalvo();
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [familyId, setFamilyIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(FAMILY_KEY);
    } catch {
      return null;
    }
  });

  const aplicarMe = useCallback((valor: Me | null) => {
    setMe(valor);
    salvarMe(valor);
  }, []);

  const refresh = useCallback(async () => {
    const perfil = await carregarMe();
    aplicarMe(perfil);
    setLoading(false);
  }, [aplicarMe]);

  useEffect(() => {
    let ignore = false;
    carregarMe().then((perfil) => {
      if (ignore) return;
      aplicarMe(perfil);
      setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [aplicarMe]);

  const setFamilyId = useCallback((id: string) => {
    setFamilyIdState(id);
    try {
      localStorage.setItem(FAMILY_KEY, id);
    } catch {
      // storage indisponivel
    }
  }, []);

  const family = useMemo(() => {
    if (!me || me.families.length === 0) return null;
    return me.families.find((f) => f.family_id === familyId) ?? me.families[0];
  }, [me, familyId]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    aplicarMe(null);
  }, [aplicarMe]);

  const value = useMemo(
    () => ({ me, loading, family, setFamilyId, refresh, logout }),
    [me, loading, family, setFamilyId, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession precisa estar dentro de SessionProvider");
  return ctx;
}
