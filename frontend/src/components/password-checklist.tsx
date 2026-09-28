"use client";

import { PASSWORD_RULES } from "@/lib/password";

export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="mt-2 grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
      {PASSWORD_RULES.map((rule) => {
        const done = rule.test(value);
        return (
          <li key={rule.id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ${
                done ? "border-emerald-500 bg-emerald-500 text-white" : "border-line bg-surface-2 text-transparent"
              }`}
            >
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6.3 4.8 8.6 9.5 3.6" />
              </svg>
            </span>
            <span className={`transition-colors duration-200 ${done ? "text-ink" : "text-muted"}`}>
              {rule.label}
              <span className="sr-only">{done ? ", requisito atendido" : ", requisito pendente"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
