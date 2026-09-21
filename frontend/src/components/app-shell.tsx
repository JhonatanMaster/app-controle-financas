"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";
import { Spinner } from "./ui";

const NAV = [
  { href: "/app", label: "Início", icon: HomeIcon },
  { href: "/app/estoque", label: "Estoque", icon: BoxIcon },
  { href: "/app/compras", label: "Compras", icon: CartIcon },
  { href: "/app/familia", label: "Família", icon: UsersIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, loading, family, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [loading, me, router]);

  if (loading || !me) return <Spinner />;

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface px-4 py-6 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive(href) ? "bg-brand-soft text-brand-dark" : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-surface-2 p-3 text-xs">
          <p className="truncate font-medium text-ink">{family?.families?.name ?? "Sem família"}</p>
          <p className="truncate text-muted">{me.email}</p>
          <button onClick={() => logout().then(() => router.replace("/login"))} className="mt-2 text-brand hover:underline">
            Sair
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur md:hidden">
          <Brand compact />
          <span className="max-w-[50%] truncate text-xs text-muted">{family?.families?.name}</span>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface/95 backdrop-blur md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                isActive(href) ? "text-brand" : "text-muted"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">CF</span>
      {!compact ? <span className="text-lg font-semibold text-ink">Controle Finanças</span> : null}
    </div>
  );
}

type IconProps = { className?: string };

function HomeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function BoxIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}
function CartIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.5 12h11L21 7H6" />
    </svg>
  );
}
function UsersIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.5a5 5 0 0 1 6 5" />
    </svg>
  );
}
