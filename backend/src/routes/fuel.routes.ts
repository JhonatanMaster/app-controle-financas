import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth-context.js";
import { replyWithDbError } from "../lib/db-errors.js";

const fillSchema = z.object({
  // Gerado no aparelho quando o registro pode ir para a fila offline. Reenviar com o mesmo id cai no
  // 409 da chave primaria, em vez de registrar o abastecimento duas vezes
  id: z.string().uuid().optional(),
  fillDate: z.string().date(),
  fuelType: z.enum(["alcool", "gasolina"]),
  value: z.number().positive().max(100_000),
  stationName: z.string().trim().min(1).max(120).nullable().optional(),
});

const settingsSchema = z.object({
  shared: z.boolean(),
});

export async function fuelRoutes(app: FastifyInstance) {
  // Devolve os abastecimentos visiveis para quem pediu. O RLS ja separa o que cada um ve, entao a
  // rota so monta o contexto: se a familia compartilha e quem e o titular, e o nome de quem lancou
  app.get("/families/:familyId/fuel", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const [familyResult, membersResult, fillsResult] = await Promise.all([
      ctx.supabase
        .from("families")
        .select("abastecimentos_compartilhados")
        .eq("id", familyId)
        .single(),
      ctx.supabase
        .from("family_members")
        .select("user_id, display_name, invited_email, role")
        .eq("family_id", familyId)
        .eq("status", "ativo"),
      ctx.supabase
        .from("fuel_fills")
        .select("id, created_by, fill_date, fuel_type, value, station_name, created_at")
        .eq("family_id", familyId)
        .order("fill_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

    if (familyResult.error) return replyWithDbError(request, reply, familyResult.error);
    if (membersResult.error) return replyWithDbError(request, reply, membersResult.error);
    if (fillsResult.error) return replyWithDbError(request, reply, fillsResult.error);

    const members = membersResult.data ?? [];
    const meuMembro = members.find((m) => m.user_id === ctx.userId);
    const nomes = new Map(members.map((m) => [m.user_id, m.display_name ?? m.invited_email]));

    return reply.send({
      shared: familyResult.data.abastecimentos_compartilhados,
      isTitular: meuMembro?.role === "titular",
      userId: ctx.userId,
      userName: meuMembro ? (meuMembro.display_name ?? meuMembro.invited_email) : null,
      fills: fillsResult.data.map((fill) => ({
        id: fill.id,
        created_by: fill.created_by,
        author_name: nomes.get(fill.created_by) ?? null,
        fill_date: fill.fill_date,
        fuel_type: fill.fuel_type,
        value: fill.value,
        station_name: fill.station_name,
        created_at: fill.created_at,
      })),
    });
  });

  app.post("/families/:familyId/fuel", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = fillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const { data, error } = await ctx.supabase
      .from("fuel_fills")
      .insert({
        id: body.id,
        family_id: familyId,
        created_by: ctx.userId,
        fill_date: body.fillDate,
        fuel_type: body.fuelType,
        value: body.value,
        station_name: body.stationName?.trim() || null,
      })
      .select("id, created_by, fill_date, fuel_type, value, station_name, created_at")
      .single();

    if (error) return replyWithDbError(request, reply, error);
    return reply.code(201).send({ fill: data });
  });

  // O RLS so libera o proprio registro, entao apagar o de outra pessoa cai no 404 e nao apaga nada
  app.delete("/families/:familyId/fuel/:fillId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { fillId } = request.params as { familyId: string; fillId: string };

    const { error } = await ctx.supabase
      .from("fuel_fills")
      .delete()
      .eq("id", fillId)
      .select("id")
      .single();

    if (error) return replyWithDbError(request, reply, error);
    return reply.send({ ok: true });
  });

  // So o titular muda o compartilhamento. O RLS da tabela families ja barra os demais, mas a checagem
  // aqui devolve 403 claro, em vez de um 404 que nao explica nada
  app.patch("/families/:familyId/fuel/settings", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos" });
    }

    const { data: membro, error: membroError } = await ctx.supabase
      .from("family_members")
      .select("role")
      .eq("family_id", familyId)
      .eq("user_id", ctx.userId)
      .eq("status", "ativo")
      .maybeSingle();

    if (membroError) return replyWithDbError(request, reply, membroError);
    if (membro?.role !== "titular") {
      return reply.code(403).send({ error: "Somente o titular pode alterar o compartilhamento" });
    }

    const { data, error } = await ctx.supabase
      .from("families")
      .update({ abastecimentos_compartilhados: parsed.data.shared })
      .eq("id", familyId)
      .select("abastecimentos_compartilhados")
      .single();

    if (error) return replyWithDbError(request, reply, error);
    return reply.send({ shared: data.abastecimentos_compartilhados });
  });
}
