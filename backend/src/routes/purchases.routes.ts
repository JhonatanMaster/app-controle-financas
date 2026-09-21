import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth-context.js";

const createPurchaseSchema = z.object({
  type: z.enum(["reposicao", "avulsa"]).default("reposicao"),
  purchaseDate: z.string().date().optional(),
  notes: z.string().optional(),
  // Compra avulsa simplificada informa so data e valor, sem itens
  totalValue: z.number().nonnegative().optional(),
  // Quando true e type reposicao, ja popula o carrinho com a shopping_list
  fromShoppingList: z.boolean().default(true),
});

const addItemSchema = z.object({
  stockItemId: z.string().uuid().optional(),
  itemName: z.string().min(1).optional(),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().nonnegative().optional(),
});

const updateItemSchema = z.object({
  quantity: z.number().nonnegative(),
});

const finalizeSchema = z.object({
  totalValue: z.number().nonnegative().optional(),
});

const setValueSchema = z.object({
  totalValue: z.number().nonnegative(),
});

const splitSchema = z.object({
  personId: z.string().uuid(),
  amount: z.number().nonnegative(),
});

function mapPgError(reply: any, error: { code?: string; message: string }) {
  if (error.code === "42501") {
    return reply.code(403).send({ error: "Voce nao tem permissao para esta acao" });
  }
  if (error.code === "P0001") {
    return reply.code(400).send({ error: error.message });
  }
  return reply.code(400).send({ error: error.message });
}

export async function purchasesRoutes(app: FastifyInstance) {
  app.get("/families/:familyId/purchases", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };
    const { status } = request.query as { status?: "aberta" | "finalizada" };

    let query = ctx.supabase
      .from("purchases")
      .select("id, purchase_date, type, total_value, value_status, rateio_status, finalized_at, notes, created_at, purchase_items(count)")
      .eq("family_id", familyId)
      .order("purchase_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (status === "aberta") query = query.is("finalized_at", null);
    if (status === "finalizada") query = query.not("finalized_at", "is", null);

    const { data, error } = await query;
    if (error) return mapPgError(reply, error);
    return reply.send({ purchases: data });
  });

  app.get("/families/:familyId/purchases/:purchaseId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { purchaseId } = request.params as { familyId: string; purchaseId: string };

    const { data, error } = await ctx.supabase
      .from("purchases")
      .select(
        "*, purchase_items(id, stock_item_id, item_name, quantity, unit_price, stock_items(unit, ideal_quantity, current_quantity)), purchase_splits(id, person_id, amount, people(name))",
      )
      .eq("id", purchaseId)
      .single();

    if (error) return mapPgError(reply, error);
    return reply.send({ purchase: data });
  });

  app.post("/families/:familyId/purchases", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId } = request.params as { familyId: string };

    const parsed = createPurchaseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const hasValue = body.totalValue !== undefined;

    const { data: purchase, error } = await ctx.supabase
      .from("purchases")
      .insert({
        family_id: familyId,
        type: body.type,
        purchase_date: body.purchaseDate ?? new Date().toISOString().slice(0, 10),
        notes: body.notes ?? null,
        total_value: hasValue ? body.totalValue : null,
        value_status: hasValue ? "definido" : "pendente",
        finalized_at: hasValue && body.type === "avulsa" ? new Date().toISOString() : null,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) return mapPgError(reply, error);

    if (body.type === "reposicao" && body.fromShoppingList) {
      const { data: suggestions } = await ctx.supabase
        .from("shopping_list")
        .select("stock_item_id, name, suggested_quantity")
        .eq("family_id", familyId);

      if (suggestions && suggestions.length > 0) {
        await ctx.supabase.from("purchase_items").insert(
          suggestions.map((s) => ({
            purchase_id: purchase.id,
            stock_item_id: s.stock_item_id,
            item_name: s.name,
            quantity: s.suggested_quantity,
          })),
        );
      }
    }

    return reply.code(201).send({ purchase });
  });

  app.post("/families/:familyId/purchases/:purchaseId/items", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { purchaseId } = request.params as { familyId: string; purchaseId: string };

    const parsed = addItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }
    const body = parsed.data;

    let itemName = body.itemName;
    if (body.stockItemId) {
      const { data: stockItem } = await ctx.supabase
        .from("stock_items")
        .select("name")
        .eq("id", body.stockItemId)
        .single();
      itemName = itemName ?? stockItem?.name;
    }
    if (!itemName) {
      return reply.code(400).send({ error: "Informe stockItemId ou itemName" });
    }

    const { data, error } = await ctx.supabase
      .from("purchase_items")
      .insert({
        purchase_id: purchaseId,
        stock_item_id: body.stockItemId ?? null,
        item_name: itemName,
        quantity: body.quantity,
        unit_price: body.unitPrice ?? null,
      })
      .select()
      .single();

    if (error) return mapPgError(reply, error);
    return reply.code(201).send({ item: data });
  });

  // Botoes de mais e menos no mercado. Quantidade zero remove o item do carrinho
  app.patch("/families/:familyId/purchases/:purchaseId/items/:itemId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { itemId } = request.params as { familyId: string; purchaseId: string; itemId: string };

    const parsed = updateItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }

    if (parsed.data.quantity === 0) {
      const { error } = await ctx.supabase.from("purchase_items").delete().eq("id", itemId);
      if (error) return mapPgError(reply, error);
      return reply.send({ removed: true });
    }

    const { data, error } = await ctx.supabase
      .from("purchase_items")
      .update({ quantity: parsed.data.quantity })
      .eq("id", itemId)
      .select()
      .single();

    if (error) return mapPgError(reply, error);
    return reply.send({ item: data });
  });

  app.delete("/families/:familyId/purchases/:purchaseId/items/:itemId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { itemId } = request.params as { familyId: string; purchaseId: string; itemId: string };

    const { error } = await ctx.supabase.from("purchase_items").delete().eq("id", itemId);
    if (error) return mapPgError(reply, error);
    return reply.send({ ok: true });
  });

  // Passou no caixa. Com valor fica definido, sem valor fica pendente para adicionar depois.
  // O trigger no banco incrementa o estoque quando finalized_at e preenchido.
  app.post("/families/:familyId/purchases/:purchaseId/finalize", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { purchaseId } = request.params as { familyId: string; purchaseId: string };

    const parsed = finalizeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }

    const { data: current, error: currentError } = await ctx.supabase
      .from("purchases")
      .select("finalized_at")
      .eq("id", purchaseId)
      .single();

    if (currentError) return mapPgError(reply, currentError);
    if (current.finalized_at) {
      return reply.code(409).send({ error: "Compra ja finalizada" });
    }

    const hasValue = parsed.data.totalValue !== undefined;
    const patch: Record<string, unknown> = { finalized_at: new Date().toISOString() };
    if (hasValue) {
      patch.total_value = parsed.data.totalValue;
      patch.value_status = "definido";
    }

    const { data, error } = await ctx.supabase
      .from("purchases")
      .update(patch)
      .eq("id", purchaseId)
      .select()
      .single();

    if (error) return mapPgError(reply, error);
    return reply.send({ purchase: data });
  });

  // Fluxo adicionar depois. Define o valor de uma compra ja finalizada sem valor
  app.patch("/families/:familyId/purchases/:purchaseId/value", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { purchaseId } = request.params as { familyId: string; purchaseId: string };

    const parsed = setValueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }

    const { data, error } = await ctx.supabase
      .from("purchases")
      .update({ total_value: parsed.data.totalValue, value_status: "definido" })
      .eq("id", purchaseId)
      .select()
      .single();

    if (error) return mapPgError(reply, error);
    return reply.send({ purchase: data });
  });

  app.delete("/families/:familyId/purchases/:purchaseId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { purchaseId } = request.params as { familyId: string; purchaseId: string };

    const { data: current } = await ctx.supabase
      .from("purchases")
      .select("finalized_at")
      .eq("id", purchaseId)
      .single();

    if (current?.finalized_at) {
      return reply.code(409).send({ error: "Compra finalizada ja alimentou o estoque e nao pode ser excluida" });
    }

    const { error } = await ctx.supabase.from("purchases").delete().eq("id", purchaseId);
    if (error) return mapPgError(reply, error);
    return reply.send({ ok: true });
  });

  // Rateio, upsert da contribuicao de uma pessoa. Triggers no banco bloqueiam soma acima do total
  // e marcam rateio_status como fechado quando a soma iguala o total.
  app.put("/families/:familyId/purchases/:purchaseId/splits", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { purchaseId } = request.params as { familyId: string; purchaseId: string };

    const parsed = splitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados invalidos" });
    }

    if (parsed.data.amount === 0) {
      const { error } = await ctx.supabase
        .from("purchase_splits")
        .delete()
        .eq("purchase_id", purchaseId)
        .eq("person_id", parsed.data.personId);
      if (error) return mapPgError(reply, error);
    } else {
      const { error } = await ctx.supabase
        .from("purchase_splits")
        .upsert(
          { purchase_id: purchaseId, person_id: parsed.data.personId, amount: parsed.data.amount },
          { onConflict: "purchase_id,person_id" },
        );
      if (error) return mapPgError(reply, error);
    }

    const { data: purchase, error: purchaseError } = await ctx.supabase
      .from("purchases")
      .select("id, total_value, rateio_status, purchase_splits(id, person_id, amount, people(name))")
      .eq("id", purchaseId)
      .single();

    if (purchaseError) return mapPgError(reply, purchaseError);
    return reply.send({ purchase });
  });
}
