"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFamilyData } from "@/lib/use-family-data";
import type { FamilyMember } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, PageTitle, Spinner } from "@/components/ui";

export default function FamiliaPage() {
  const router = useRouter();
  const { me, family, setFamilyId, logout } = useSession();
  const members = useFamilyData("/members", (raw) => (raw as { members: FamilyMember[] }).members);
  const familyId = members.familyId;
  const isTitular = family?.role === "titular";
  const [actionError, setActionError] = useState<string | null>(null);

  async function removeMember(m: FamilyMember) {
    if (!familyId || !confirm(`Remover ${m.display_name ?? m.invited_email} da família?`)) return;
    setActionError(null);
    try {
      await api(`/families/${familyId}/members/${m.id}`, { method: "DELETE" });
      members.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Falha ao remover");
    }
  }

  return (
    <>
      <PageTitle title="Família" subtitle={family?.families?.name} />

      {me && me.families.length > 1 ? (
        <Card className="mb-5">
          <p className="mb-2 text-sm font-medium text-ink">Família ativa</p>
          <div className="flex flex-wrap gap-2">
            {me.families.map((f) => (
              <button
                key={f.family_id}
                onClick={() => setFamilyId(f.family_id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  f.family_id === family?.family_id ? "bg-brand text-white" : "bg-surface-2 text-ink hover:bg-line"
                }`}
              >
                {f.families?.name}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {actionError ? <div className="mb-4"><Alert>{actionError}</Alert></div> : null}

      {isTitular && familyId ? (
        <div className="mb-5">
          <InviteForm familyId={familyId} onDone={members.reload} />
        </div>
      ) : (
        <Alert tone="info">Só o titular da família pode convidar ou remover membros.</Alert>
      )}

      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold text-ink">Membros</h2>
        {members.loading ? (
          <Spinner />
        ) : members.error ? (
          <Alert>{members.error}</Alert>
        ) : (
          <Card className="divide-y divide-line p-0">
            {members.data?.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-ink">{m.display_name ?? m.invited_email}</p>
                    {m.role === "titular" ? <Badge tone="brand">titular</Badge> : null}
                    {m.status === "convidado" ? <Badge tone="warn">convite pendente</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted">{m.invited_email}</p>
                </div>
                {isTitular && m.role !== "titular" ? (
                  <button className="text-xs text-muted hover:text-red-600 hover:underline" onClick={() => removeMember(m)}>
                    Remover
                  </button>
                ) : null}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="mt-8 md:hidden">
        <Button variant="ghost" className="w-full" onClick={() => logout().then(() => router.replace("/login"))}>
          Sair da conta
        </Button>
      </section>
    </>
  );
}

function InviteForm({ familyId, onDone }: { familyId: string; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      await api(`/families/${familyId}/invites`, { method: "POST", body: { email, displayName: displayName || undefined } });
      setSuccess(`Convite enviado para ${email}.`);
      setEmail("");
      setDisplayName("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao enviar convite");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <p className="font-medium text-ink">Convidar membro</p>
        <p className="text-xs text-muted">A pessoa recebe um e-mail com link para criar a senha e acessar os dados desta família.</p>
        {error ? <Alert>{error}</Alert> : null}
        {success ? <Alert tone="info">{success}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Nome (opcional)" name="displayName" placeholder="Ex.: Maria" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Input label="E-mail" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            Enviar convite
          </Button>
        </div>
      </form>
    </Card>
  );
}
