import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { supabaseAuthClient, supabaseForUser } from "./supabase.js";

const ACCESS_COOKIE = "sb_access_token";
const REFRESH_COOKIE = "sb_refresh_token";

// Teto que o Chrome aplica a qualquer cookie persistente, pedir mais seria truncado do mesmo
// jeito. A ideia e que o app so volte a pedir login depois de muito tempo sem uso.
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export type AuthContext = {
  supabase: ReturnType<typeof supabaseForUser>;
  userId: string;
  email: string;
};

/**
 * Renovacoes em andamento, indexadas pelo refresh token. O refresh token do Supabase e de uso
 * unico, entao duas requisicoes simultaneas renovando com o mesmo token fariam uma delas falhar
 * e perder a sessao. Compartilhando a promessa, a primeira renovacao atende todas.
 */
const renovacoesEmCurso = new Map<string, Promise<Session | null>>();

function renovarSessao(refreshToken: string): Promise<Session | null> {
  const emCurso = renovacoesEmCurso.get(refreshToken);
  if (emCurso) return emCurso;

  const promessa = supabaseAuthClient.auth
    .refreshSession({ refresh_token: refreshToken })
    .then(({ data, error }) => (error ? null : (data.session ?? null)))
    .catch(() => null)
    .finally(() => {
      renovacoesEmCurso.delete(refreshToken);
    });

  renovacoesEmCurso.set(refreshToken, promessa);
  return promessa;
}

async function contextoDoAccessToken(accessToken: string): Promise<AuthContext | null> {
  const supabase = supabaseForUser(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user || !data.user.email) return null;

  return { supabase, userId: data.user.id, email: data.user.email };
}

/**
 * Resolve a sessao da requisicao sem responder nada. Quando o access token expirou, usa o refresh
 * token para renovar e ja regrava os cookies, de forma que o usuario nao precise logar de novo so
 * porque passou mais de uma hora desde a ultima visita.
 *
 * @returns O contexto autenticado, ou null quando nao ha sessao recuperavel.
 */
export async function resolveAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const accessToken = request.cookies[ACCESS_COOKIE];

  if (accessToken) {
    const contexto = await contextoDoAccessToken(accessToken);
    if (contexto) return contexto;
  }

  const refreshToken = request.cookies[REFRESH_COOKIE];
  if (!refreshToken) return null;

  const session = await renovarSessao(refreshToken);

  if (!session) {
    clearSessionCookies(reply);
    return null;
  }

  setSessionCookies(request, reply, session);
  return contextoDoAccessToken(session.access_token);
}

/**
 * Igual ao resolveAuth, mas responde 401 quando nao ha sessao, para as rotas que exigem login.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const contexto = await resolveAuth(request, reply);

  if (!contexto) {
    reply.code(401).send({ error: "Sessão expirada, entre novamente" });
    return null;
  }

  return contexto;
}

/**
 * O cookie de sessao pertence ao dominio da API, mas quem dispara as chamadas e o frontend.
 * Com os dois no mesmo dominio registravel, caso de app.dominio.com e api.app.dominio.com, o
 * navegador trata a chamada como same site e manda um cookie Lax normalmente. Em dominios
 * diferentes o Lax seria descartado em toda requisicao e a sessao cairia a cada carga de pagina,
 * entao ali o cookie precisa de SameSite None, que por sua vez exige TLS.
 */
function politicaDeSite(request: FastifyRequest) {
  const dominioRegistravel = (host: string) => host.split(".").slice(-2).join(".");
  const apiHost = request.hostname;
  const frontendHost = new URL(env.FRONTEND_ORIGIN).hostname;
  const mesmoSite =
    apiHost === frontendHost || dominioRegistravel(apiHost) === dominioRegistravel(frontendHost);
  const https = env.APP_BASE_URL.startsWith("https://");

  if (mesmoSite || !https) return { sameSite: "lax" as const, secure: https };
  return { sameSite: "none" as const, secure: true };
}

export function setSessionCookies(
  request: FastifyRequest,
  reply: FastifyReply,
  session: Session,
) {
  const commonOptions = {
    httpOnly: true,
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/",
    ...politicaDeSite(request),
  };

  reply.setCookie(ACCESS_COOKIE, session.access_token, {
    ...commonOptions,
    maxAge: session.expires_in,
  });

  if (session.refresh_token) {
    reply.setCookie(REFRESH_COOKIE, session.refresh_token, {
      ...commonOptions,
      maxAge: REFRESH_MAX_AGE_SECONDS,
    });
  }
}

export function clearSessionCookies(reply: FastifyReply) {
  const options = { path: "/", domain: env.COOKIE_DOMAIN || undefined };
  reply.clearCookie(ACCESS_COOKIE, options);
  reply.clearCookie(REFRESH_COOKIE, options);
}

export function getRefreshToken(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE];
}
