import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth-context.js";
import { replyWithDbError } from "../lib/db-errors.js";
import {
  buscarPaginaDaNota,
  descreverCausa,
  ErroDeConsulta,
  interpretarPaginaDaNota,
  interpretarQrCode,
  limparHtmlParaGuardar,
  type NotaLida,
} from "../lib/nfce.js";

const importSchema = z.object({
  // O texto lido do QR Code, a URL colada ou a chave de 44 digitos digitada
  conteudo: z.string().trim().min(44).max(2000),
  // Quando a SEFAZ esta fora do ar a pessoa pode registrar a nota so com o que a chave traz e
  // informar o valor depois
  apenasChave: z.boolean().default(false),
});

// Cada importacao com QR Code faz o servidor consultar a SEFAZ, entao o limite protege tanto o
// portal do estado quanto a reputacao do IP do servidor
const LIMITE_IMPORTACAO = { max: 15, timeWindow: "1 minute" };

/** Forma de pagamento resumida que vai para a compra; o detalhe de cada uma fica na nota */
function formaPrincipal(pagamentos: NotaLida["payments"]): string | null {
  if (pagamentos.length === 0) return null;
  const nomes = [...new Set(pagamentos.map((p) => p.method))];
  return nomes.join(" + ").slice(0, 60);
}

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
          const pagina = await buscarPaginaDaNota(lido.url);
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
              { host: lido.url.hostname, causa: descreverCausa(err.cause ?? err) },
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
}
