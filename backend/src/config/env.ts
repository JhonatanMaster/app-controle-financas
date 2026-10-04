import { z } from "zod";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Valida uma URL publica e devolve so a origem normalizada, sem barra no final.
 * O zod sozinho aceitaria um endereco sem as barras depois do protocolo, que o navegador nunca
 * casaria no cabecalho de CORS, entao a checagem de protocolo e feita aqui.
 */
function publicUrl(field: string) {
  return z.string().transform((value, ctx) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} precisa ser uma URL completa, por exemplo https://app.seudominio.com`,
      });
      return z.NEVER;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} precisa começar com https:// ou http://, recebido "${value}"`,
      });
      return z.NEVER;
    }

    if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} precisa usar https fora de localhost, porque o cookie de sessão depende de TLS`,
      });
      return z.NEVER;
    }

    return url.origin;
  });
}

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z
  .object({
    PORT: z.coerce.number().default(4000),
    FRONTEND_ORIGIN: publicUrl("FRONTEND_ORIGIN"),
    COOKIE_SECRET: z.string().min(16),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    COOKIE_DOMAIN: optionalString,
    RESEND_API_KEY: optionalString,
    RESEND_FROM_EMAIL: z.string().default("Controle Finanças <no-reply@localhost>"),
    APP_BASE_URL: publicUrl("APP_BASE_URL"),
  })
  // Sem Resend o e-mail vai para o log, o que so faz sentido rodando local
  .superRefine((config, ctx) => {
    if (!config.RESEND_API_KEY && config.APP_BASE_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY é obrigatória quando o app roda em https, senão nenhum e-mail sai de fato",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
  console.error(`Configuração inválida no .env\n${details.join("\n")}`);
  process.exit(1);
}

export const env = parsed.data;
