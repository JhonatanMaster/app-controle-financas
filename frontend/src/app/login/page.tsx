"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth-layout";
import { Alert, Button, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/auth/login", { method: "POST", body: { email, password } });
      await refresh();
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse o controle da sua casa."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/criar-conta" className="font-medium text-brand hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="E-mail" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Senha" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="text-right text-sm">
          <Link href="/recuperar-senha" className="text-brand hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" size="lg" loading={loading}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
