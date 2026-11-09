const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  /** Corpo da resposta de erro, para rotas que devolvem mais que a mensagem (ex. o id de um registro repetido) */
  data: Record<string, unknown> | null;
  constructor(status: number, message: string, data: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type Options = Omit<RequestInit, "body"> & { body?: unknown };

async function rawFetch(path: string, options: Options = {}) {
  const { body, headers, ...rest } = options;
  return fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Rotas que abrem ou encerram a sessao, onde um 401 e resposta final. Tentar renovar nelas daria
 * laco. Todas as outras, inclusive /auth/me, podem ser repetidas depois do refresh, e e justamente
 * o /auth/me que decide se o app mostra a tela de login ao abrir.
 */
const ROTAS_SEM_REFRESH = [
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/signup-family",
  "/auth/accept-invite",
  "/auth/forgot-password",
  "/auth/reset-password",
];

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = rawFetch("/auth/refresh", { method: "POST" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  let res = await rawFetch(path, options);

  if (res.status === 401 && !ROTAS_SEM_REFRESH.some((rota) => path.startsWith(rota))) {
    const ok = await tryRefresh();
    if (ok) res = await rawFetch(path, options);
  }

  if (!res.ok) {
    let message = "Erro inesperado";
    let data: Record<string, unknown> | null = null;
    try {
      data = await res.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // resposta sem corpo JSON
    }
    throw new ApiError(res.status, message, data);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
