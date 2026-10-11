"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordChecklist } from "@/components/password-checklist";
import { isPasswordValid, PASSWORD_MIN_LENGTH } from "@/lib/password";
import { Alert, Button, Input, Spinner } from "@/components/ui";

export default function ConfirmSignupPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ConfirmSignupForm />
    </Suspense>
  );
}

/**
 * Segundo passo do cadastro, aberto pelo link do email. Chegar aqui ja prova que a pessoa controla
 * a caixa de entrada, e so entao ela escolhe a senha, que confirma a conta e cria a familia.
 */
function ConfirmSignupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh, setFamilyId } = useSession();
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
      const res = await api<{ familyId: string | null }>("/auth/complete-signup", { method: "POST", body: { email, token, password } });
      if (res.familyId) setFamilyId(res.familyId);
      await refresh();
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível concluir o cadastro");
      setLoading(false);
    }
  }

  if (!token || !email) {
    return (
      <AuthLayout title="Link inválido">
        <div className="flex flex-col gap-4">
          <Alert>Este link de cadastro está incompleto. Peça um novo para receber outro e-mail.</Alert>
          <Link href="/criar-conta" className="text-sm font-medium text-brand hover:underline">
            Voltar ao cadastro
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crie sua senha" subtitle={`Último passo do cadastro de ${email}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <div>
          <Input
            label="Senha"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordChecklist value={password} />
        </div>
        <Input
          label="Confirmar senha"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" size="lg" loading={loading} disabled={!isPasswordValid(password)}>
          Concluir cadastro
        </Button>
      </form>
    </AuthLayout>
  );
}
