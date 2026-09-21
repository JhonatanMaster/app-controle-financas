import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../lib/auth-context.js";
import { sendFamilyInviteEmail } from "../lib/resend.js";

const inviteSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).optional(),
});

const personSchema = z.object({
  name: z.string().min(1),
  linkedMemberId: z.string().uuid().optional(),
});

function mapPgError(reply: any, error: { code?: string; message: string }) {
  if (error.code === "42501") {
    return reply.code(403).send({ error: "Voce nao tem permissao para esta acao" });
  }
  return reply.code(400).send({ error: error.message });
}

export async function familiesRoutes(app: FastifyInstance) {
  app.get("/families/:familyId/members", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const { data, error } = await ctx.supabase
      .from("family_members")
      .select("id, invited_email, display_name, role, status, invited_at, joined_at")
      .eq("family_id", familyId)
      .order("invited_at", { ascending: true });

    if (error) return mapPgError(reply, error);
    return reply.send({ members: data });
  });

  app.post("/families/:familyId/invites", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }

    const { data: family, error: familyError } = await ctx.supabase
      .from("families")
      .select("name")
      .eq("id", familyId)
      .single();

    if (familyError || !family) {
      return reply.code(404).send({ error: "Familia nao encontrada" });
    }

    const { data: member, error } = await ctx.supabase
      .from("family_members")
      .insert({
        family_id: familyId,
        invited_email: parsed.data.email,
        display_name: parsed.data.displayName,
        role: "membro",
        status: "convidado",
      })
      .select()
      .single();

    if (error) return mapPgError(reply, error);

    const inviteUrl = `${env.APP_BASE_URL}/aceitar-convite?invite=${member.id}`;
    try {
      await sendFamilyInviteEmail({ to: parsed.data.email, familyName: family.name, inviteUrl });
    } catch (err) {
      // Sem e-mail o convite e inalcancavel, entao desfaz para o titular poder tentar de novo
      request.log.error(err);
      await ctx.supabase.from("family_members").delete().eq("id", member.id);
      return reply.code(502).send({ error: "Nao foi possivel enviar o e-mail de convite. Tente novamente." });
    }

    return reply.code(201).send({ member });
  });

  app.delete("/families/:familyId/members/:memberId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { memberId } = request.params as { familyId: string; memberId: string };

    const { error } = await ctx.supabase.from("family_members").delete().eq("id", memberId);
    if (error) return mapPgError(reply, error);
    return reply.send({ ok: true });
  });

  app.get("/families/:familyId/people", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const { data, error } = await ctx.supabase
      .from("people")
      .select("id, name, linked_member_id, created_at")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true });

    if (error) return mapPgError(reply, error);
    return reply.send({ people: data });
  });

  app.post("/families/:familyId/people", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = personSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }

    const { data, error } = await ctx.supabase
      .from("people")
      .insert({
        family_id: familyId,
        name: parsed.data.name,
        linked_member_id: parsed.data.linkedMemberId ?? null,
      })
      .select()
      .single();

    if (error) return mapPgError(reply, error);
    return reply.code(201).send({ person: data });
  });

  app.delete("/families/:familyId/people/:personId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { personId } = request.params as { familyId: string; personId: string };

    const { error } = await ctx.supabase.from("people").delete().eq("id", personId);
    if (error) return mapPgError(reply, error);
    return reply.send({ ok: true });
  });
}
