import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
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
import { sendAccountExistsEmail, sendPasswordRecoveryEmail, sendSignupConfirmationEmail } from "../lib/resend.js";
import { passwordSchema } from "../lib/password.js";

// A senha nao vem no cadastro. Ela e criada depois, na tela aberta pelo link do email, para que so
// quem controla a caixa de entrada consiga definir a senha da conta
const signupSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().min(1).max(80),
});

const completeSignupSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: passwordSchema,
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

/**
 * Limites por IP nas rotas que um atacante usa sem precisar de conta. Login e recuperacao de senha
 * sao os alvos classicos, um para adivinhar senha e o outro para disparar email em massa pelo
 * Resend, gastando a cota e a reputacao do dominio. Os valores folgam para quem erra a senha
 * algumas vezes de verdade.
 */
const LIMITES = {
  login: { max: 10, timeWindow: "5 minutes" },
  cadastro: { max: 5, timeWindow: "1 hour" },
  conclusao: { max: 10, timeWindow: "15 minutes" },
  recuperacao: { max: 5, timeWindow: "1 hour" },
  redefinicao: { max: 10, timeWindow: "15 minutes" },
  convite: { max: 10, timeWindow: "15 minutes" },
  renovacao: { max: 30, timeWindow: "1 minute" },
};

function firstError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Dados inválidos";
}

function normalizarEmail(email: string) {
  return email.trim().toLowerCase();
}

function jaExiste(error: AuthError) {
  return error.code === "email_exists" || error.message?.toLowerCase().includes("already");
}

function linkDeConclusao(token: string, email: string) {
  return `${env.APP_BASE_URL}/confirmar-cadastro?token=${token}&email=${encodeURIComponent(email)}`;
}

function linkDeRedefinicao(token: string, email: string) {
  return `${env.APP_BASE_URL}/redefinir-senha?token=${token}&email=${encodeURIComponent(email)}`;
}

type MetadadosDoCadastro = { display_name?: string; family_name?: string };

/**
 * Cria a familia do cadastro quando a pessoa ainda nao participa de nenhuma. Serve a conclusao do
 * cadastro e tambem a redefinicao de senha, porque se a conclusao falhar depois de consumir o link,
 * o caminho que sobra para a pessoa e pedir uma nova senha, e a familia nao pode ficar perdida.
 *
 * @returns O id da familia em que a pessoa ficou, ou null quando nao havia familia a criar.
 */
async function garantirFamilia(request: FastifyRequest, userSupabase: SupabaseClient, userId: string, metadados: MetadadosDoCadastro) {
  const { data: atuais } = await userSupabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", userId)
    .eq("status", "ativo")
    .limit(1);

  if (atuais && atuais.length > 0) return atuais[0].family_id as string;
  if (!metadados.family_name) return null;

  const { data: family, error } = await userSupabase
    .from("families")
    .insert({ name: metadados.family_name, owner_user_id: userId })
    .select("id")
    .single();

  if (error || !family) {
    request.log.error(error);
    throw new Error("Não foi possível criar a família");
  }

  if (metadados.display_name) {
    await userSupabase
      .from("family_members")
      .update({ display_name: metadados.display_name })
      .eq("family_id", family.id)
      .eq("user_id", userId);
  }

  return family.id as string;
}

async function entrarComSenhaNova(request: FastifyRequest, email: string, password: string) {
  const { data, error } = await supabaseAuthClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    request.log.error(error);
    return null;
  }
  return data.session;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup-family", { config: { rateLimit: LIMITES.cadastro } }, async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstError(parsed.error) });
    }
    const { displayName, familyName } = parsed.data;
    const email = normalizarEmail(parsed.data.email);

    // A conta nasce sem senha e sem confirmacao, e o login fica recusado ate o link ser usado
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { display_name: displayName, family_name: familyName },
    });

    if (createError && !jaExiste(createError)) {
      request.log.error(createError);
      return reply.code(500).send({ error: "Não foi possível iniciar o cadastro" });
    }

    // Gerar o link devolve o usuario, e e assim que se sabe se a conta ja estava ativa. Cada link
    // novo invalida o anterior, entao so o email mais recente funciona
    const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError || !link.properties?.hashed_token || !link.user) {
      request.log.error(linkError);
      return reply.code(500).send({ error: "Não foi possível iniciar o cadastro" });
    }

    try {
      if (link.user.email_confirmed_at) {
        const { data: recuperacao } = await supabaseAdmin.auth.admin.generateLink({ type: "recovery", email });
        if (recuperacao?.properties?.hashed_token) {
          await sendAccountExistsEmail({ to: email, recoveryUrl: linkDeRedefinicao(recuperacao.properties.hashed_token, email) });
        }
      } else {
        // Cadastro pendente de antes. Vale o nome e a familia desta tentativa
        if (createError) {
          await supabaseAdmin.auth.admin.updateUserById(link.user.id, {
            user_metadata: { display_name: displayName, family_name: familyName },
          });
        }
        await sendSignupConfirmationEmail({
          to: email,
          displayName,
          familyName,
          confirmUrl: linkDeConclusao(link.properties.hashed_token, email),
        });
      }
    } catch (err) {
      request.log.error(err);
      return reply.code(502).send({ error: "Não foi possível enviar o e-mail. Tente novamente em instantes." });
    }

    // Mesma resposta exista a conta ou nao, para o cadastro nao servir para descobrir quais emails
    // ja tem conta. Quem ja tem fica sabendo pela propria caixa de entrada
    return reply.code(202).send({ ok: true });
  });

  app.post("/auth/complete-signup", { config: { rateLimit: LIMITES.conclusao } }, async (request, reply) => {
    const parsed = completeSignupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstError(parsed.error) });
    }
    const { token, password } = parsed.data;
    const email = normalizarEmail(parsed.data.email);
    const linkInvalido = "Este link de cadastro é inválido, expirou ou já foi usado. Peça um novo em Criar conta.";

    const { data, error } = await supabaseAuthClient.auth.verifyOtp({ token_hash: token, type: "magiclink" });
    // O token diz de quem e a conta. O email do endereco so serve para a tela, e precisa bater
    if (error || !data.session || !data.user || normalizarEmail(data.user.email ?? "") !== email) {
      return reply.code(400).send({ error: linkInvalido });
    }

    // Mesmo caminho da redefinicao de senha. A senha vai pela API administrativa, com o link ja
    // verificado, e a sessao vem de um login novo, porque trocar a senha encerra a aberta pelo link
    const { error: senhaError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password });
    if (senhaError) {
      request.log.error(senhaError);
      return reply.code(500).send({ error: "Não foi possível definir a senha" });
    }

    const sessao = await entrarComSenhaNova(request, email, password);
    if (!sessao) {
      return reply.code(500).send({ error: "Senha criada, mas não foi possível entrar. Faça login com ela." });
    }

    let familyId: string | null;
    try {
      familyId = await garantirFamilia(request, supabaseForUser(sessao.access_token), data.user.id, data.user.user_metadata ?? {});
    } catch {
      return reply.code(500).send({ error: "Senha criada, mas não foi possível criar a família. Entre com sua senha para tentar de novo." });
    }

    setSessionCookies(request, reply, sessao);
    return reply.code(201).send({ ok: true, familyId });
  });

  app.post("/auth/login", { config: { rateLimit: LIMITES.login } }, async (request, reply) => {
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

  app.post("/auth/refresh", { config: { rateLimit: LIMITES.renovacao } }, async (request, reply) => {
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

  app.post("/auth/accept-invite", { config: { rateLimit: LIMITES.convite } }, async (request, reply) => {
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

    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError && !jaExiste(createError)) {
      request.log.error(createError);
      return reply.code(500).send({ error: "Não foi possível criar a conta" });
    }

    let { data: signedIn, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({ email, password });

    if (createError && (signInError || !signedIn.session)) {
      // Pode ser um cadastro iniciado e nunca concluido, que ainda nao tem senha. O convite chegou
      // pelo mesmo email, o que ja prova que a pessoa e dona dele, entao ele pode definir a senha
      // e ativar a conta. Uma conta ja ativa segue exigindo a propria senha
      const { data: link } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
      if (!link?.user || link.user.email_confirmed_at) {
        return reply.code(401).send({
          error: "Já existe uma conta com este e-mail e a senha informada não confere. Faça login normalmente.",
        });
      }
      await supabaseAdmin.auth.admin.updateUserById(link.user.id, { password, email_confirm: true });
      ({ data: signedIn, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({ email, password }));
    }

    if (signInError || !signedIn.session) {
      request.log.error(signInError);
      return reply.code(500).send({ error: "Conta criada, mas não foi possível iniciar a sessão" });
    }
    const session = signedIn.session;

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

  app.post("/auth/forgot-password", { config: { rateLimit: LIMITES.recuperacao } }, async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos" });
    }
    const email = normalizarEmail(parsed.data.email);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "recovery", email });

    if (!error && data?.properties?.hashed_token && data.user) {
      try {
        if (data.user.email_confirmed_at) {
          await sendPasswordRecoveryEmail({ to: email, recoveryUrl: linkDeRedefinicao(data.properties.hashed_token, email) });
        } else {
          // Cadastro nunca concluido nao tem senha a redefinir. A pessoa recebe de novo o link de
          // concluir o cadastro, que cria a senha e a familia
          const { data: link } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
          const metadados: MetadadosDoCadastro = data.user.user_metadata ?? {};
          if (link?.properties?.hashed_token) {
            await sendSignupConfirmationEmail({
              to: email,
              displayName: metadados.display_name ?? "",
              familyName: metadados.family_name ?? "",
              confirmUrl: linkDeConclusao(link.properties.hashed_token, email),
            });
          }
        }
      } catch (err) {
        request.log.error(err);
      }
    }

    // Mesma resposta exista o email ou nao, para nao revelar quais contas existem
    return reply.send({ ok: true });
  });

  app.post("/auth/reset-password", { config: { rateLimit: LIMITES.redefinicao } }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstError(parsed.error) });
    }
    const { token, newPassword } = parsed.data;
    const email = normalizarEmail(parsed.data.email);

    const { data, error } = await supabaseAuthClient.auth.verifyOtp({ type: "recovery", token_hash: token });

    if (error || !data.session || !data.user || normalizarEmail(data.user.email ?? "") !== email) {
      return reply.code(400).send({ error: "Link de recuperação inválido ou expirado" });
    }

    // O cliente com o token no cabecalho nao tem sessao propria, e o updateUser dele falhava sempre
    // com Auth session missing, deixando a recuperacao sem funcionar. Com o link ja verificado, a
    // senha e gravada pela API administrativa
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password: newPassword });

    if (updateError) {
      request.log.error(updateError);
      return reply.code(500).send({ error: "Não foi possível definir a nova senha" });
    }

    // Trocar a senha encerra todas as sessoes da conta, inclusive a que o link acabou de abrir,
    // entao a sessao que vale e a de um login novo com a senha recem criada
    const sessao = await entrarComSenhaNova(request, email, newPassword);
    if (!sessao) {
      return reply.send({ ok: true, entrar: true });
    }

    await garantirFamilia(request, supabaseForUser(sessao.access_token), data.user.id, data.user.user_metadata ?? {}).catch((err) =>
      request.log.error(err),
    );

    setSessionCookies(request, reply, sessao);
    return reply.send({ ok: true });
  });
}
