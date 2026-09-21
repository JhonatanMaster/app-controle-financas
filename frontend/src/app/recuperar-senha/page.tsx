"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { AuthLayout } from "@/components/auth-layout";
import { Alert, Button, Input } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email } });
    } finally {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Informe seu e-mail e enviaremos um link para redefinir a senha."
      footer={
        <Link href="/login" className="font-medium text-brand hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {sent ? (
        <Alert tone="info">Se existir uma conta com este e-mail, você receberá o link em instantes. Verifique também a caixa de spam.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input label="E-mail" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="lg" loading={loading}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
