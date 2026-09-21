import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = new Resend(env.RESEND_API_KEY);

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

async function send(params: { to: string; subject: string; html: string }) {
  const { data, error } = await resend.emails.send({ from: env.RESEND_FROM_EMAIL, ...params });
  // O SDK do Resend devolve o erro no retorno em vez de lancar
  if (error || !data) {
    throw new EmailDeliveryError(error?.message ?? "Falha desconhecida ao enviar e-mail");
  }
  return data.id;
}

export function sendFamilyInviteEmail(params: { to: string; familyName: string; inviteUrl: string }) {
  const { to, familyName, inviteUrl } = params;
  return send({
    to,
    subject: `Convite para a familia "${familyName}" no Controle Financas`,
    html: `
      <p>Voce foi convidado(a) para acessar o Controle Financas da familia <strong>${escapeHtml(familyName)}</strong>.</p>
      <p><a href="${inviteUrl}">Clique aqui para criar sua senha e acessar</a></p>
      <p>Se voce nao esperava este convite, pode ignorar este e-mail.</p>
    `,
  });
}

export function sendPasswordRecoveryEmail(params: { to: string; recoveryUrl: string }) {
  const { to, recoveryUrl } = params;
  return send({
    to,
    subject: "Recuperacao de senha no Controle Financas",
    html: `
      <p>Recebemos um pedido para redefinir sua senha.</p>
      <p><a href="${recoveryUrl}">Clique aqui para escolher uma nova senha</a></p>
      <p>Se voce nao pediu isso, pode ignorar este e-mail.</p>
    `,
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
