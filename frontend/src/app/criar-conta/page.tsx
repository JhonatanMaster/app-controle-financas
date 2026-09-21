"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth-layout";
import { Alert, Button, Input } from "@/components/ui";

export default function SignupPage() {
  const router = useRouter();
  const { refresh, setFamilyId } = useSession();
  const [form, setForm] = useState({ displayName: "", familyName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ family: { id: string } }>("/auth/signup-family", { method: "POST", body: form });
      setFamilyId(res.family.id);
      await refresh();
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a conta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Você será o titular da família e poderá convidar outros membros por e-mail."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Seu nome" name="displayName" required value={form.displayName} onChange={update("displayName")} />
        <Input label="Nome da família / casa" name="familyName" placeholder="Ex.: Família Silva" required value={form.familyName} onChange={update("familyName")} />
        <Input label="E-mail" name="email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} />
        <Input label="Senha" name="password" type="password" autoComplete="new-password" minLength={8} required hint="Mínimo de 8 caracteres" value={form.password} onChange={update("password")} />
        <Button type="submit" size="lg" loading={loading}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
