import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { supabaseForUser } from "./supabase.js";

const ACCESS_COOKIE = "sb_access_token";
const REFRESH_COOKIE = "sb_refresh_token";

export type AuthContext = {
  supabase: ReturnType<typeof supabaseForUser>;
  userId: string;
  email: string;
};

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const accessToken = request.cookies[ACCESS_COOKIE];

  if (!accessToken) {
    reply.code(401).send({ error: "Nao autenticado" });
    return null;
  }

  const supabase = supabaseForUser(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user || !data.user.email) {
    reply.code(401).send({ error: "Sessao invalida ou expirada" });
    return null;
  }

  return { supabase, userId: data.user.id, email: data.user.email };
}

export function setSessionCookies(reply: FastifyReply, session: Session) {
  const commonOptions = {
    httpOnly: true,
    secure: env.APP_BASE_URL.startsWith("https://"),
    sameSite: "lax" as const,
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/",
  };

  reply.setCookie(ACCESS_COOKIE, session.access_token, {
    ...commonOptions,
    maxAge: session.expires_in,
  });

  if (session.refresh_token) {
    reply.setCookie(REFRESH_COOKIE, session.refresh_token, {
      ...commonOptions,
      maxAge: 60 * 60 * 24 * 30, // 30 dias
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
