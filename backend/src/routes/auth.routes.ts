import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { supabaseAdmin, supabaseAuthClient, supabaseForUser } from "../lib/supabase.js";
import {
  clearSessionCookies,
  getRefreshToken,
  requireAuth,
  resolveAuth,
  setSessionCookies,
} from "../lib/auth-context.js";
import { sendPasswordRecoveryEmail } from "../lib/resend.js";
import { passwordSchema } from "../lib/password.js";

const signupSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  displayName: z.string().min(1),
  familyName: z.string().min(1),
});

// No login nao validamos forca, so presenca, para nao travar quem ja tem conta
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const acceptInviteSchema = z.object({
  inviteId: z.string().uuid(),
  password: passwordSchema,
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  newPassword: passwordSchema,
});

function firstError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Dados inválidos";
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup-family", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstError(parsed.error) });
    }
    const { email, password, displayName, familyName } = parsed.data;

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });

    if (createError || !created.user) {
      if (createError?.message?.toLowerCase().includes("already")) {
        return reply.code(409).send({ error: "Já existe uma conta com este e-mail" });
      }
      request.log.error(createError);
      return reply.code(500).send({ error: "Não foi possível criar a conta" });
    }

    const { data: signedIn, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signedIn.session) {
      request.log.error(signInError);
      return reply.code(500).send({ error: "Conta criada, mas não foi possível iniciar a sessão" });
    }

    const userSupabase = supabaseForUser(signedIn.session.access_token);

    const { data: family, error: familyError } = await userSupabase
      .from("families")
      .insert({ name: familyName, owner_user_id: created.user.id })
      .select()
      .single();

    if (familyError || !family) {
      request.log.error(familyError);
      return reply.code(500).send({ error: "Conta criada, mas não foi possível criar a família" });
    }

    await userSupabase
      .from("family_members")
      .update({ display_name: displayName })
      .eq("family_id", family.id)
      .eq("user_id", created.user.id);

    setSessionCookies(request, reply, signedIn.session);

    return reply.code(201).send({
      user: { id: created.user.id, email, displayName },
      family,
    });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos" });
    }

    const { data, error } = await supabaseAuthClient.auth.signInWithPassword(parsed.data);

    if (error || !data.session) {
      return reply.code(401).send({ error: "E-mail ou senha inválidos" });
    }

    setSessionCookies(request, reply, data.session);
    return reply.send({ user: { id: data.user.id, email: data.user.email } });
  });

  app.post("/auth/logout", async (request, reply) => {
    // resolveAuth em vez de requireAuth porque sair sem sessao valida tambem precisa responder ok,
    // e um 401 aqui tentaria responder duas vezes a mesma requisicao
    const ctx = await resolveAuth(request, reply).catch(() => null);
    if (ctx) {
      await ctx.supabase.auth.signOut();
    }
    clearSessionCookies(reply);
    return reply.send({ ok: true });
  });

  app.get("/auth/me", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;

    const { data: memberships, error } = await ctx.supabase
      .from("family_members")
      .select("family_id, role, display_name, families(name)")
      .eq("user_id", ctx.userId)
      .eq("status", "ativo");

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "Falha ao carregar os dados do usuário" });
    }

    return reply.send({
      id: ctx.userId,
      email: ctx.email,
      families: memberships,
    });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const refreshToken = getRefreshToken(request);
    if (!refreshToken) {
      return reply.code(401).send({ error: "Sem sessão para renovar" });
    }

    const { data, error } = await supabaseAuthClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      clearSessionCookies(reply);
      return reply.code(401).send({ error: "Não foi possível renovar a sessão" });
    }

    setSessionCookies(request, reply, data.session);
    return reply.send({ ok: true });
  });

  app.post("/auth/accept-invite", async (request, reply) => {
    const parsed = acceptInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstError(parsed.error) });
    }
    const { inviteId, password } = parsed.data;

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("family_members")
      .select("id, family_id, invited_email, status, display_name")
      .eq("id", inviteId)
      .eq("status", "convidado")
      .maybeSingle();

    if (inviteError || !invite) {
      return reply.code(404).send({ error: "Convite inválido ou já utilizado" });
    }

    const email = invite.invited_email;

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    let session;

    if (createError) {
      if (!createError.message?.toLowerCase().includes("already")) {
        request.log.error(createError);
        return reply.code(500).send({ error: "Não foi possível criar a conta" });
      }
      const { data: signedIn, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError || !signedIn.session) {
        return reply.code(401).send({
          error: "Já existe uma conta com este e-mail e a senha informada não confere. Faça login normalmente.",
        });
      }
      session = signedIn.session;
    } else {
      const { data: signedIn, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError || !signedIn.session) {
        request.log.error(signInError);
        return reply.code(500).send({ error: "Conta criada, mas não foi possível iniciar a sessão" });
      }
      session = signedIn.session;
    }

    const userSupabase = supabaseForUser(session.access_token);
    const { error: linkError } = await userSupabase
      .from("family_members")
      .update({ user_id: session.user.id, status: "ativo", joined_at: new Date().toISOString() })
      .eq("id", inviteId);

    if (linkError) {
      request.log.error(linkError);
      return reply.code(500).send({ error: "Não foi possível vincular o convite à conta" });
    }

    setSessionCookies(request, reply, session);
    return reply.send({ ok: true, familyId: invite.family_id });
  });

  app.post("/auth/forgot-password", async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos" });
    }

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
    });

    // Nao revelamos se o e-mail existe ou nao (evita enumeracao de contas).
    if (!error && data?.properties?.hashed_token) {
      const resetUrl = `${env.APP_BASE_URL}/redefinir-senha?token=${data.properties.hashed_token}&email=${encodeURIComponent(parsed.data.email)}`;
      await sendPasswordRecoveryEmail({ to: parsed.data.email, recoveryUrl: resetUrl }).catch((err) => request.log.error(err));
    }

    return reply.send({ ok: true });
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstError(parsed.error) });
    }
    const { email, token, newPassword } = parsed.data;

    const { data, error } = await supabaseAuthClient.auth.verifyOtp({
      type: "recovery",
      token_hash: token,
      email,
    });

    if (error || !data.session) {
      return reply.code(400).send({ error: "Link de recuperação inválido ou expirado" });
    }

    const userSupabase = supabaseForUser(data.session.access_token);
    const { error: updateError } = await userSupabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      request.log.error(updateError);
      return reply.code(500).send({ error: "Não foi possível definir a nova senha" });
    }

    setSessionCookies(request, reply, data.session);
    return reply.send({ ok: true });
  });
}
