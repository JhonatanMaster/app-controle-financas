import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth-context.js";
import { replyWithDbError } from "../lib/db-errors.js";
import { ErroDeConsulta, interpretarPaginaDaNota, interpretarQrCode, limparHtmlParaGuardar, type NotaLida } from "../lib/nfce.js";
import { ERRO_NOTA_REPETIDA, salvarNotaDaCompra, validarNotaInformada } from "../lib/notas-fiscais.js";
import { consultarViaRelay } from "../lib/relay-sefaz.js";

const importSchema = z.object({
  // O texto lido do QR Code, a URL colada ou a chave de 44 digitos digitada
  conteudo: z.string().trim().min(44).max(2000),
  // Quando a SEFAZ esta fora do ar a pessoa pode registrar a nota so com o que a chave traz e
  // informar o valor depois
  apenasChave: z.boolean().default(false),
});

// Cada importacao com QR Code vira uma consulta a SEFAZ pela internet de casa do servico comunica
// sefaz, entao o limite protege o portal do estado e a conexao de quem hospeda o servico
const LIMITE_IMPORTACAO = { max: 15, timeWindow: "1 minute" };

/** Forma de pagamento resumida que vai para a compra; o detalhe de cada uma fica na nota */
function formaPrincipal(pagamentos: NotaLida["payments"]): string | null {
  if (pagamentos.length === 0) return null;
  const nomes = [...new Set(pagamentos.map((p) => p.method))];
  return nomes.join(" + ").slice(0, 60);
}

const notaSchema = z.object({
  // Chave de acesso, URL do QR Code ou numero da nota. Nulo ou vazio remove a nota da compra
  notaFiscal: z.string().trim().max(2000).nullable(),
});

export async function fiscalNotesRoutes(app: FastifyInstance) {
  app.post(
    "/families/:familyId/fiscal-notes/import",
    { config: { rateLimit: LIMITE_IMPORTACAO } },
    async (request, reply) => {
      const ctx = await requireAuth(request, reply);
      if (!ctx) return;
      const { familyId } = request.params as { familyId: string };

      const parsed = importSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Leia o QR Code da nota ou informe a chave de acesso com 44 números" });
      }

      const lido = interpretarQrCode(parsed.data.conteudo);
      if (!lido) {
        return reply.code(400).send({
          error: "Não reconheci uma nota fiscal. Confira se é o QR Code do cupom ou se os 44 números da chave estão certos.",
        });
      }
      const { chave } = lido;

      // Antes de consultar a SEFAZ, para nao gastar uma consulta com nota repetida
      const { data: existente, error: erroExistente } = await ctx.supabase
        .from("fiscal_notes")
        .select("purchase_id")
        .eq("family_id", familyId)
        .eq("access_key", chave.chave)
        .maybeSingle();
      if (erroExistente) return replyWithDbError(request, reply, erroExistente);
      if (existente) {
        return reply.code(409).send({ error: "Esta nota já foi registrada", purchaseId: existente.purchase_id });
      }

      let nota: NotaLida | null = null;
      let html: string | null = null;
      let urlDaConsulta: string | null = lido.tipo === "url" ? lido.url.toString() : null;

      if (lido.tipo === "url" && !parsed.data.apenasChave) {
        try {
          const pagina = await consultarViaRelay(lido.url);
          urlDaConsulta = pagina.urlFinal;
          const interpretada = interpretarPaginaDaNota(pagina.html);
          // Uma pagina de outra nota, ou de erro do portal, nunca pode virar esta compra
          if (interpretada.accessKey && interpretada.accessKey !== chave.chave) {
            return reply.code(422).send({ error: "A SEFAZ devolveu uma nota diferente da lida no QR Code" });
          }
          if (interpretada.items.length === 0) {
            return reply.code(422).send({
              error: "A SEFAZ respondeu, mas não consegui ler os itens desta nota. Você pode registrar só com a chave.",
              podeRegistrarSoChave: true,
            });
          }
          nota = interpretada;
          html = limparHtmlParaGuardar(pagina.html, pagina.urlFinal);
        } catch (err) {
          if (err instanceof ErroDeConsulta) {
            request.log.warn(
              { host: lido.url.hostname, causa: String(err.cause ?? err.message) },
              "falha ao consultar a nota na SEFAZ",
            );
            return reply.code(502).send({ error: err.message, podeRegistrarSoChave: true });
          }
          throw err;
        }
      }

      const status = nota ? "importada" : "so_chave";
      const dataDaCompra = nota?.issuedAt?.slice(0, 10) ?? null;

      const { data: purchaseId, error } = await ctx.supabase.rpc("importar_nota_fiscal", {
        p_family_id: familyId,
        p_nota: {
          access_key: chave.chave,
          model: chave.modelo,
          status,
          uf_code: chave.codigoUf,
          series: nota?.series ?? chave.serie,
          number: nota?.number ?? chave.numero,
          issuer_name: nota?.issuerName ?? null,
          issuer_cnpj: nota?.issuerCnpj ?? chave.cnpjEmitente,
          issuer_address: nota?.issuerAddress ?? null,
          issued_at: nota?.issuedAt ?? null,
          purchase_date: dataDaCompra,
          total_value: nota?.totalValue ?? null,
          discount_value: nota?.discountValue ?? null,
          items_count: nota ? (nota.itemsCount ?? nota.items.length) : null,
          payments: nota?.payments ?? [],
          payment_method: nota ? formaPrincipal(nota.payments) : null,
          authorization_protocol: nota?.authorizationProtocol ?? null,
          consultation_url: urlDaConsulta?.slice(0, 1000) ?? null,
          source_html: html,
        },
        p_itens: (nota?.items ?? []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
          product_code: item.productCode,
        })),
      });

      if (error) return replyWithDbError(request, reply, error, { "23505": "Esta nota já foi registrada" });

      return reply.code(201).send({
        purchaseId,
        status,
        itens: nota?.items.length ?? 0,
        totalValue: nota?.totalValue ?? null,
      });
    },
  );

  // Para quando a pessoa leu o cupom errado. A compra nasceu da leitura da nota, entao sai junto com ela, e o
  // cascade leva itens, rateio e historico do valor. Diferente da exclusao comum de compra, aqui a
  // compra finalizada pode sair, porque itens vindos da nota nao abastecem o estoque
  app.delete("/families/:familyId/fiscal-notes/:noteId", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId, noteId } = request.params as { familyId: string; noteId: string };

    const { data: nota, error: erroNota } = await ctx.supabase
      .from("fiscal_notes")
      .select("purchase_id, status")
      .eq("family_id", familyId)
      .eq("id", noteId)
      .single();
    if (erroNota) return replyWithDbError(request, reply, erroNota, { PGRST116: "Nota não encontrada" });
    // A nota informada a mao fica numa compra registrada pela pessoa, e sai pelo editar sem levar a compra
    if (nota.status !== "importada") {
      return reply.code(400).send({ error: "Para tirar a nota desta compra, use Editar e Remover nota" });
    }

    // Defesa caso um item do estoque passe a ser associado a compra no futuro. Excluir aqui deixaria
    // o estoque com uma entrada que nao existe mais
    const { count, error: erroItens } = await ctx.supabase
      .from("purchase_items")
      .select("id", { count: "exact", head: true })
      .eq("purchase_id", nota.purchase_id)
      .not("stock_item_id", "is", null);
    if (erroItens) return replyWithDbError(request, reply, erroItens);
    if (count) {
      return reply.code(409).send({ error: "Esta compra já alimentou o estoque e não pode ser excluída" });
    }

    const { data: removidas, error } = await ctx.supabase
      .from("purchases")
      .delete()
      .eq("family_id", familyId)
      .eq("id", nota.purchase_id)
      .select("id");
    if (error) return replyWithDbError(request, reply, error);
    // O RLS nao da erro quando bloqueia um delete, so nao apaga nada
    if (!removidas || removidas.length === 0) {
      return reply.code(403).send({ error: "Você não tem permissão para excluir esta nota" });
    }
    return reply.send({ ok: true });
  });

  // A pagina original fica fora do detalhe da compra porque pesa dezenas de KB e so e usada quando
  // a pessoa pede para ver ou baixar a nota completa
  app.get("/families/:familyId/fiscal-notes/:noteId/html", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId, noteId } = request.params as { familyId: string; noteId: string };

    const { data, error } = await ctx.supabase
      .from("fiscal_notes")
      .select("access_key, source_html")
      .eq("family_id", familyId)
      .eq("id", noteId)
      .single();

    if (error) return replyWithDbError(request, reply, error, { PGRST116: "Nota não encontrada" });
    if (!data.source_html) {
      return reply.code(404).send({ error: "Esta nota foi registrada só pela chave, sem a página da SEFAZ" });
    }
    return reply.send({ accessKey: data.access_key, html: data.source_html });
  });

  // Fluxo editar. Informa, troca ou remove a nota de uma compra ja registrada
  app.put("/families/:familyId/purchases/:purchaseId/fiscal-note", async (request, reply) => {
    const ctx = await requireAuth(request, reply);
    if (!ctx) return;
    const { familyId, purchaseId } = request.params as { familyId: string; purchaseId: string };

    const parsed = notaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos" });
    }

    // Garante que a compra e desta familia antes de pendurar a nota nela
    const { error: erroCompra } = await ctx.supabase
      .from("purchases")
      .select("id")
      .eq("family_id", familyId)
      .eq("id", purchaseId)
      .single();
    if (erroCompra) return replyWithDbError(request, reply, erroCompra, { PGRST116: "Compra não encontrada" });

    const validacao = await validarNotaInformada(ctx.supabase, familyId, parsed.data.notaFiscal, purchaseId);
    if (!validacao.ok) return reply.code(validacao.status).send({ error: validacao.erro });

    const error = await salvarNotaDaCompra(ctx.supabase, {
      familyId,
      purchaseId,
      userId: ctx.userId,
      nota: validacao.nota,
    });
    if (error) return replyWithDbError(request, reply, error, ERRO_NOTA_REPETIDA);

    const { data, error: erroLeitura } = await ctx.supabase
      .from("fiscal_notes")
      .select("id, access_key, model, status, uf_code, series, number, issuer_cnpj, created_at")
      .eq("purchase_id", purchaseId)
      .maybeSingle();
    if (erroLeitura) return replyWithDbError(request, reply, erroLeitura);
    return reply.send({ fiscalNote: data });
  });
}
