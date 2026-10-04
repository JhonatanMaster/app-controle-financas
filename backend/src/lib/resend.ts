import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

async function send(params: { to: string; subject: string; html: string; link: string }) {
  const { link, ...message } = params;

  // Rodando local sem Resend o link vai para o log, para convite e senha continuarem testaveis
  if (!resend) {
    console.info(
      ["", "E-mail nao enviado, modo local sem RESEND_API_KEY", `  Para     ${message.to}`, `  Assunto  ${message.subject}`, `  Link     ${link}`, ""].join("\n"),
    );
    return "local";
  }

  const { data, error } = await resend.emails.send({ from: env.RESEND_FROM_EMAIL, ...message });
  // O SDK do Resend devolve o erro no retorno em vez de lancar
  if (error || !data) {
    throw new EmailDeliveryError(error?.message ?? "Falha desconhecida ao enviar e-mail");
  }
  return data.id;
}

export function sendFamilyInviteEmail(params: { to: string; familyName: string; inviteUrl: string }) {
  const { to, familyName, inviteUrl } = params;
  const family = escapeHtml(familyName);

  return send({
    to,
    link: inviteUrl,
    subject: `Convite para a família ${familyName} no Controle Finanças`,
    html: layout({
      title: "Você foi convidado",
      body: `Você recebeu acesso ao Controle Finanças da família <strong>${family}</strong>. Crie sua senha para ver o estoque da casa, a lista de compras e as despesas compartilhadas.`,
      action: { label: "Criar minha senha", url: inviteUrl },
      footer: "Se você não esperava este convite, basta ignorar este e-mail.",
    }),
  });
}

export function sendPasswordRecoveryEmail(params: { to: string; recoveryUrl: string }) {
  const { to, recoveryUrl } = params;

  return send({
    to,
    link: recoveryUrl,
    subject: "Redefinição de senha do Controle Finanças",
    html: layout({
      title: "Redefinir senha",
      body: "Recebemos um pedido para redefinir a senha da sua conta. O link abaixo expira em pouco tempo e só pode ser usado uma vez.",
      action: { label: "Escolher nova senha", url: recoveryUrl },
      footer: "Se não foi você que pediu, ignore este e-mail. Sua senha atual continua valendo.",
    }),
  });
}

/**
 * Tabela com estilos inline porque boa parte dos clientes de e-mail, Outlook e Gmail
 * incluidos, ignora folhas de estilo e layout com flexbox.
 */
function layout(params: { title: string; body: string; action: { label: string; url: string }; footer: string }) {
  const { title, body, action, footer } = params;

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif;color:#1b1f2e">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px">
      <tr>
        <td style="padding:32px">
          <p style="margin:0 0 4px;font-size:13px;color:#6b7189">Controle Finanças</p>
          <h1 style="margin:0 0 16px;font-size:20px">${title}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5">${body}</p>
          <a href="${action.url}" style="display:inline-block;padding:12px 20px;background:#5b3df5;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px">${action.label}</a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b7189">${footer}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
