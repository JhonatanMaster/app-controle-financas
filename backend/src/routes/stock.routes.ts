import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth-context.js";
import { replyWithDbError } from "../lib/db-errors.js";
import { groupBelongsToFamily } from "../lib/stock-groups.js";

const createStockItemSchema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1).default("un"),
  minQuantity: z.number().nonnegative(),
  idealQuantity: z.number().nonnegative(),
  groupId: z.string().uuid().nullable().optional(),
});

const updateStockItemSchema = z.object({
  name: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  minQuantity: z.number().nonnegative().optional(),
  idealQuantity: z.number().nonnegative().optional(),
  groupId: z.string().uuid().nullable().optional(),
});

const consumeSchema = z.object({
  quantity: z.number().positive(),
});

const createGroupSchema = z.object({
  name: z.string().min(1),
});

const ITEM_SELECT = "*, stock_groups(id, name, sort_order)";

const STOCK_DB_ERRORS = {
  "23514": "Quantidade inválida: o estoque não pode ficar negativo nem o mínimo passar do ideal",
  "23505": "Já existe um grupo com esse nome",
};

export async function stockRoutes(app: FastifyInstance) {
  app.get("/families/:familyId/stock-groups", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const { data, error } = await ctx.supabase
      .from("stock_groups")
      .select("id, name, sort_order")
      .eq("family_id", familyId)
      .order("sort_order", { ascending: true });

    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);
    return reply.send({ groups: data });
  });

  // Grupo criado pela pessoa entra no fim da ordem do mercado
  app.post("/families/:familyId/stock-groups", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = createGroupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Informe o nome do grupo" });
    }

    const { data: last } = await ctx.supabase
      .from("stock_groups")
      .select("sort_order")
      .eq("family_id", familyId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await ctx.supabase
      .from("stock_groups")
      .insert({
        family_id: familyId,
        name: parsed.data.name.trim(),
        sort_order: (last?.sort_order ?? 0) + 1,
      })
      .select("id, name, sort_order")
      .single();

    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);
    return reply.code(201).send({ group: data });
  });

  app.get("/families/:familyId/stock-items", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const { data, error } = await ctx.supabase
      .from("stock_items")
      .select(ITEM_SELECT)
      .eq("family_id", familyId)
      .order("name", { ascending: true });

    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);
    return reply.send({ items: data });
  });

  app.get("/families/:familyId/shopping-list", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const { data, error } = await ctx.supabase
      .from("shopping_list")
      .select("*")
      .eq("family_id", familyId)
      .order("group_sort_order", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true });

    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);
    return reply.send({ items: data });
  });

  app.post("/families/:familyId/stock-items", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = createStockItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos", details: parsed.error.flatten() });
    }

    if (parsed.data.groupId && !(await groupBelongsToFamily(ctx.supabase, familyId, parsed.data.groupId))) {
      return reply.code(400).send({ error: "Grupo inválido para esta família" });
    }

    const { data, error } = await ctx.supabase
      .from("stock_items")
      .insert({
        family_id: familyId,
        name: parsed.data.name,
        unit: parsed.data.unit,
        min_quantity: parsed.data.minQuantity,
        ideal_quantity: parsed.data.idealQuantity,
        current_quantity: parsed.data.idealQuantity,
        group_id: parsed.data.groupId ?? null,
      })
      .select(ITEM_SELECT)
      .single();

    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);
    return reply.code(201).send({ item: data });
  });

  app.patch("/families/:familyId/stock-items/:itemId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId, itemId } = request.params as { familyId: string; itemId: string };

    const parsed = updateStockItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos" });
    }

    if (parsed.data.groupId && !(await groupBelongsToFamily(ctx.supabase, familyId, parsed.data.groupId))) {
      return reply.code(400).send({ error: "Grupo inválido para esta família" });
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.unit !== undefined) patch.unit = parsed.data.unit;
    if (parsed.data.minQuantity !== undefined) patch.min_quantity = parsed.data.minQuantity;
    if (parsed.data.idealQuantity !== undefined) patch.ideal_quantity = parsed.data.idealQuantity;
    if (parsed.data.groupId !== undefined) patch.group_id = parsed.data.groupId;

    const { data, error } = await ctx.supabase
      .from("stock_items")
      .update(patch)
      .eq("id", itemId)
      .select(ITEM_SELECT)
      .single();

    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);
    return reply.send({ item: data });
  });

  app.delete("/families/:familyId/stock-items/:itemId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { itemId } = request.params as { familyId: string; itemId: string };

    const { error } = await ctx.supabase.from("stock_items").delete().eq("id", itemId);
    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);
    return reply.send({ ok: true });
  });

  // Registra que abriu um pacote. O trigger no banco decrementa o estoque atual
  app.post("/families/:familyId/stock-items/:itemId/consume", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { itemId } = request.params as { familyId: string; itemId: string };

    const parsed = consumeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos" });
    }

    const { data, error } = await ctx.supabase
      .from("stock_consumption_events")
      .insert({
        family_id: (request.params as { familyId: string }).familyId,
        stock_item_id: itemId,
        quantity: parsed.data.quantity,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) return replyWithDbError(request, reply, error, STOCK_DB_ERRORS);

    const { data: item } = await ctx.supabase
      .from("stock_items")
      .select(ITEM_SELECT)
      .eq("id", itemId)
      .single();

    return reply.code(201).send({ event: data, item });
  });
}
