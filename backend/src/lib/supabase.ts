import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

/**
 * Client sem sessao, usado so para os passos de auth (signUp/signInWithPassword/refresh)
 * que nao dependem de um usuario ja autenticado.
 */
export const supabaseAuthClient: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/**
 * Client por request, autenticado com o access token do proprio usuario.
 * Mantem o RLS como a fonte real de isolamento por familia, pois qualquer query feita com
 * este client so enxerga o que as policies permitirem para aquele usuario.
 */
export function supabaseForUser(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Client com service_role key, que ignora RLS. Uso restrito as operacoes administrativas de auth
 * (criar usuario no convite/signup, gerar link de recuperacao de senha) onde ainda nao existe
 * uma sessao de usuario para autenticar a chamada. Nunca usar para ler/escrever dados de negocio.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
