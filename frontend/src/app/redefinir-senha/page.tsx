"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth-layout";
import { Alert, Button, Input, Spinner } from "@/components/ui";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useSession();
  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";
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
      await api("/auth/reset-password", { method: "POST", body: { email, token, newPassword: password } });
      await refresh();
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível redefinir a senha");
    } finally {
      setLoading(false);
    }
  }

  if (!token || !email) {
    return (
      <AuthLayout title="Link inválido">
        <Alert>Este link de recuperação está incompleto. Solicite um novo em &quot;Esqueci minha senha&quot;.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Nova senha" subtitle={`Definindo nova senha para ${email}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Input label="Nova senha" name="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label="Confirmar senha" name="confirm" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" size="lg" loading={loading}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  );
}
