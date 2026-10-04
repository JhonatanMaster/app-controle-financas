import type { FastifyReply, FastifyRequest } from "fastify";
import type { PostgrestError } from "@supabase/supabase-js";

type ErrorOverrides = Partial<Record<string, string>>;

/**
 * Traduz erros do Postgres e do PostgREST em respostas HTTP.
 *
 * A mensagem crua do banco nunca chega ao cliente, porque expoe nomes de tabela,
 * constraint e detalhes de schema. A excecao e o codigo P0001, levantado pelos nossos
 * proprios triggers com texto escrito para o usuario final.
 *
 * @param overrides - Mensagens especificas da rota por codigo de erro, quando a generica
 * nao diz o suficiente (ex. qual regra de estoque foi violada).
 */
export function replyWithDbError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: PostgrestError,
  overrides: ErrorOverrides = {},
) {
  const custom = overrides[error.code];

  switch (error.code) {
    case "42501":
      return reply.code(403).send({ error: custom ?? "Você não tem permissão para esta ação" });
    case "23505":
      return reply.code(409).send({ error: custom ?? "Já existe um registro com esses dados" });
    case "23503":
    case "23514":
      return reply.code(400).send({ error: custom ?? "Os dados informados violam uma regra de consistência" });
    case "22P02":
      return reply.code(400).send({ error: custom ?? "Identificador inválido" });
    case "PGRST116":
      return reply.code(404).send({ error: custom ?? "Registro não encontrado" });
    case "P0001":
      return reply.code(400).send({ error: error.message });
    default:
      request.log.error(error);
      return reply.code(500).send({ error: "Erro interno" });
  }
}
