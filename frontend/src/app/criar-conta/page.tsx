"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AuthLayout } from "@/components/auth-layout";
import { Alert, Button, Input } from "@/components/ui";

/**
 * Primeiro passo do cadastro. A senha nao e pedida aqui, e sim na tela aberta pelo link enviado
 * por email, para que so quem controla a caixa de entrada consiga definir a senha da conta.
 */
export default function SignupPage() {
  const [form, setForm] = useState({ displayName: "", familyName: "", email: "" });
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/auth/signup-family", { method: "POST", body: form });
      setEnviadoPara(form.email.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível iniciar o cadastro");
    } finally {
      setLoading(false);
    }
  }

  const rodape = (
    <>
      Já tem conta?{" "}
      <Link href="/login" className="font-medium text-brand hover:underline">
        Entrar
      </Link>
    </>
  );

  if (enviadoPara) {
    return (
      <AuthLayout title="Verifique seu e-mail" footer={rodape}>
        <div className="flex flex-col gap-4">
          <Alert tone="info">
            Enviamos um link para <strong>{enviadoPara}</strong>. Abra o e-mail para criar sua senha e concluir o cadastro.
          </Alert>
          <p className="text-sm text-muted">
            O link expira em pouco tempo e só pode ser usado uma vez. Se não encontrar o e-mail, confira a pasta de spam.
          </p>
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={loading} onClick={() => onSubmit()}>
              Enviar de novo
            </Button>
            <Button variant="ghost" onClick={() => setEnviadoPara(null)}>
              Corrigir dados
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar conta" subtitle="Você será o titular da família e poderá convidar outros membros por e-mail." footer={rodape}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Seu nome" name="displayName" required maxLength={80} value={form.displayName} onChange={update("displayName")} />
        <Input label="Nome da família / casa" name="familyName" placeholder="Ex.: Família Silva" required maxLength={80} value={form.familyName} onChange={update("familyName")} />
        <Input label="E-mail" name="email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} hint="Você vai receber um link neste e-mail para criar sua senha." />
        <Button type="submit" size="lg" loading={loading}>
          Continuar
        </Button>
      </form>
    </AuthLayout>
  );
}
