import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth-context.js";

const createStockItemSchema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1).default("un"),
  minQuantity: z.number().nonnegative(),
  idealQuantity: z.number().nonnegative(),
});

const updateStockItemSchema = z.object({
  name: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  minQuantity: z.number().nonnegative().optional(),
  idealQuantity: z.number().nonnegative().optional(),
});

const consumeSchema = z.object({
  quantity: z.number().positive(),
});

function mapPgError(reply: any, error: { code?: string; message: string }) {
  if (error.code === "42501") {
    return reply.code(403).send({ error: "Voce nao tem permissao para esta acao" });
  }
  if (error.code === "23514") {
    return reply.code(400).send({ error: "Quantidade invalida (estoque nao pode ficar negativo, ou minimo maior que ideal)" });
  }
  return reply.code(400).send({ error: error.message });
}

export async function stockRoutes(app: FastifyInstance) {
  app.get("/families/:familyId/stock-items", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const { data, error } = await ctx.supabase
      .from("stock_items")
      .select("*")
      .eq("family_id", familyId)
      .order("name", { ascending: true });

    if (error) return mapPgError(reply, error);
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
      .order("name", { ascending: true });

    if (error) return mapPgError(reply, error);
    return reply.send({ items: data });
  });

  app.post("/families/:familyId/stock-items", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = createStockItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos", details: parsed.error.flatten() });
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
      })
      .select()
      .single();

    if (error) return mapPgError(reply, error);
    return reply.code(201).send({ item: data });
  });

  app.patch("/families/:familyId/stock-items/:itemId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { itemId } = request.params as { familyId: string; itemId: string };

    const parsed = updateStockItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.unit !== undefined) patch.unit = parsed.data.unit;
    if (parsed.data.minQuantity !== undefined) patch.min_quantity = parsed.data.minQuantity;
    if (parsed.data.idealQuantity !== undefined) patch.ideal_quantity = parsed.data.idealQuantity;

    const { data, error } = await ctx.supabase
      .from("stock_items")
      .update(patch)
      .eq("id", itemId)
      .select()
      .single();

    if (error) return mapPgError(reply, error);
    return reply.send({ item: data });
  });

  app.delete("/families/:familyId/stock-items/:itemId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { itemId } = request.params as { familyId: string; itemId: string };

    const { error } = await ctx.supabase.from("stock_items").delete().eq("id", itemId);
    if (error) return mapPgError(reply, error);
    return reply.send({ ok: true });
  });

  // Registra que abriu um pacote. O trigger no banco decrementa o estoque atual
  app.post("/families/:familyId/stock-items/:itemId/consume", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { itemId } = request.params as { familyId: string; itemId: string };

    const parsed = consumeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
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

    if (error) return mapPgError(reply, error);

    const { data: item } = await ctx.supabase
      .from("stock_items")
      .select("*")
      .eq("id", itemId)
      .single();

    return reply.code(201).send({ event: data, item });
  });
}
