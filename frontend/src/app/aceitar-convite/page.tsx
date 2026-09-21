"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth-layout";
import { Alert, Button, Input, Spinner } from "@/components/ui";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh, setFamilyId } = useSession();
  const inviteId = params.get("invite") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("As senhas não conferem");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ familyId: string }>("/auth/accept-invite", { method: "POST", body: { inviteId, password } });
      setFamilyId(res.familyId);
      await refresh();
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível aceitar o convite");
    } finally {
      setLoading(false);
    }
  }

  if (!inviteId) {
    return (
      <AuthLayout title="Convite inválido">
        <Alert>Este link de convite está incompleto. Peça ao titular da família para enviar um novo convite.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Aceitar convite"
      subtitle="Crie sua senha para acessar o controle da família. Se você já tem conta com este e-mail, informe a senha atual."
      footer={
        <Link href="/login" className="font-medium text-brand hover:underline">
          Já tenho conta, entrar
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Senha" name="password" type="password" autoComplete="new-password" minLength={8} required hint="Mínimo de 8 caracteres" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label="Confirmar senha" name="confirm" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" size="lg" loading={loading}>
          Entrar na família
        </Button>
      </form>
    </AuthLayout>
  );
}
