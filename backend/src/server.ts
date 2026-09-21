import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { env } from "./config/env.js";
import { authRoutes } from "./routes/auth.routes.js";
import { familiesRoutes } from "./routes/families.routes.js";
import { stockRoutes } from "./routes/stock.routes.js";
import { purchasesRoutes } from "./routes/purchases.routes.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.FRONTEND_ORIGIN,
  credentials: true,
});

await app.register(cookie, {
  secret: env.COOKIE_SECRET,
});

// Aceita POST com content type JSON e corpo vazio (ex. logout, finalize sem valor)
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  if (typeof body !== "string" || body.trim() === "") {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.get("/health", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(familiesRoutes);
await app.register(stockRoutes);
await app.register(purchasesRoutes);

app.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error(error);
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(statusCode).send({
    error: statusCode === 500 ? "Erro interno" : error.message,
  });
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
