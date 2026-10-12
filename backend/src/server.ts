import { readFileSync } from "node:fs";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { authRoutes } from "./routes/auth.routes.js";
import { familiesRoutes } from "./routes/families.routes.js";
import { stockRoutes } from "./routes/stock.routes.js";
import { purchasesRoutes } from "./routes/purchases.routes.js";
import { fuelRoutes } from "./routes/fuel.routes.js";

// Resolvido a partir do arquivo compilado, entao funciona tanto em src quanto em dist
const { version: APP_VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const app = Fastify({
  logger: true,
  // Por endereco e nao por contagem de saltos, que esta versao do Fastify recusa em silencio por nao
  // conseguir validar quem esta do outro lado da conexao
  trustProxy: env.TRUST_PROXY ?? false,
});

// Precisa vir antes de qualquer register. Cada rota guarda o tratador vigente no momento em que e
// criada, entao registrado depois ele nao valia para nenhuma, e a mensagem crua de qualquer excecao
// chegava ao cliente no formato padrao do Fastify
app.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error(error);
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(statusCode).send({
    error: statusCode === 500 ? "Erro interno" : error.message,
  });
});

await app.register(cors, {
  origin: env.FRONTEND_ORIGIN,
  credentials: true,
});

await app.register(cookie, {
  secret: env.COOKIE_SECRET,
});

// Desligado por padrao e ligado rota a rota, so onde ha algo a proteger. O objeto devolvido passa
// pelo setErrorHandler acima, que precisa do statusCode e da mensagem para responder como as demais
// rotas, no formato que o frontend le
await app.register(rateLimit, {
  global: false,
  errorResponseBuilder: () => ({
    statusCode: 429,
    message: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
  }),
});

// Aceita POST com content type JSON e corpo vazio (ex. logout, finalize sem valor)
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  if (typeof body !== "string" || body.trim() === "") {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(body));
  } catch {
    // Sem statusCode o tratador responderia 500, e o problema e do corpo enviado
    done(Object.assign(new Error("JSON inválido no corpo da requisição"), { statusCode: 400 }), undefined);
  }
});

// Permite conferir no servidor qual release esta no ar sem acessar o container
app.get("/health", async () => ({ ok: true, version: APP_VERSION }));

await app.register(authRoutes);
await app.register(familiesRoutes);
await app.register(stockRoutes);
await app.register(purchasesRoutes);
await app.register(fuelRoutes);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
