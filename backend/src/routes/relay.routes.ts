import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { aguardarTarefa, entregarResultado, relayConfigurado, tokenDoRelayValido } from "../lib/relay-sefaz.js";

// Abaixo dos 30 segundos em que proxies costumam derrubar conexoes ociosas
const ESPERA_LONG_POLLING_MS = 25_000;

// A pagina da SEFAZ vem em base64, ate 3 MB que viram cerca de 4 MB, acima do limite padrao de 1 MB
const LIMITE_DO_RESULTADO = 6 * 1024 * 1024;

// O token tem pelo menos 32 caracteres aleatorios, entao o limite so serve para nao deixar alguem
// martelando as rotas
const LIMITE_RELAY = { max: 120, timeWindow: "1 minute" };

const resultadoSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    urlFinal: z.string().max(2000),
    contentType: z.string().max(200).nullable(),
    corpoBase64: z.string().max(LIMITE_DO_RESULTADO),
  }),
  z.object({
    ok: z.literal(false),
    causa: z.string().max(2000).default("sem causa informada"),
    status: z.number().int().optional(),
  }),
]);

/**
 * Rotas usadas so pelo servico comunica sefaz, autenticado por um token compartilhado. Ficam
 * desligadas, respondendo 404, enquanto SEFAZ_RELAY_TOKEN nao estiver configurado.
 */
export async function relayRoutes(app: FastifyInstance) {
  // Publica e sem detalhe nenhum, so para o app decidir se mostra a leitura da nota pelo QR Code
  app.get("/relay/sefaz/status", async (_request, reply) => {
    return reply.send({ leituraAutomatica: relayConfigurado() });
  });

  app.get("/relay/sefaz/proxima", { config: { rateLimit: LIMITE_RELAY } }, async (request, reply) => {
    if (!relayConfigurado()) return reply.code(404).send({ error: "Não encontrado" });
    if (!tokenDoRelayValido(request.headers.authorization)) return reply.code(401).send({ error: "Token inválido" });

    const { tarefa, cancelar } = aguardarTarefa(ESPERA_LONG_POLLING_MS);
    // Se o servico cair durante a espera, a consulta nao pode ser entregue a uma conexao morta
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) cancelar();
    });

    const proxima = await tarefa;
    if (!proxima) return reply.code(204).send();
    return reply.send(proxima);
  });

  app.post(
    "/relay/sefaz/resultado/:id",
    { bodyLimit: LIMITE_DO_RESULTADO, config: { rateLimit: LIMITE_RELAY } },
    async (request, reply) => {
      if (!relayConfigurado()) return reply.code(404).send({ error: "Não encontrado" });
      if (!tokenDoRelayValido(request.headers.authorization)) return reply.code(401).send({ error: "Token inválido" });

      const { id } = request.params as { id: string };
      const parsed = resultadoSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Resultado inválido" });

      // Uma consulta que ja expirou do lado do app nao tem mais quem espere por ela
      if (!entregarResultado(id, parsed.data)) return reply.code(410).send({ error: "Consulta expirada" });
      return reply.code(204).send();
    },
  );
}
