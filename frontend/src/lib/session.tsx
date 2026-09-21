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

  const refresh = useCallback(async () => {
    try {
      const data = await api<Me>("/auth/me");
      setMe(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    api<Me>("/auth/me")
      .then((data) => {
        if (!ignore) setMe(data);
      })
      .catch(() => {
        if (!ignore) setMe(null);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

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
    setMe(null);
  }, []);

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
