"use client";

import { useEffect } from "react";
import { sincronizar, useEstadoSincronizacao } from "@/lib/sync";
import { listarOperacoes } from "@/lib/offline-db";

const INTERVALO_TENTATIVA_MS = 30_000;

/**
 * Registra o service worker e reenvia a fila quando a rede volta. Nao renderiza nada.
 * O service worker so vai para producao, porque em desenvolvimento ele serviria arquivos antigos.
 */
export function Sincronizacao() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    sincronizar();
    const aoVoltarRede = () => sincronizar();
    window.addEventListener("online", aoVoltarRede);

    // Sem evento confiavel de rede, uma tentativa periodica cobre o caso de sinal intermitente
    const timer = window.setInterval(() => {
      listarOperacoes()
        .then((ops) => {
          if (ops.length > 0) sincronizar();
        })
        .catch(() => undefined);
    }, INTERVALO_TENTATIVA_MS);

    return () => {
      window.removeEventListener("online", aoVoltarRede);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}

/**
 * Faixa no topo do app avisando quando o aparelho esta sem sinal, quantas alteracoes esperam
 * envio e se alguma foi recusada pelo servidor.
 */
export function BannerSincronizacao() {
  const { pendentes, offline, falha, limparFalha } = useEstadoSincronizacao();

  if (!offline && pendentes === 0 && !falha) return null;

  if (falha) {
    return (
      <div role="alert" className="flex items-start justify-between gap-3 bg-red-50 px-4 py-2 text-sm text-red-800">
        <span>Uma alteração foi recusada pelo servidor: {falha}</span>
        <button type="button" onClick={limparFalha} className="shrink-0 font-medium underline">
          Entendi
        </button>
      </div>
    );
  }

  const texto = offline
    ? `Sem sinal. ${pendentes > 0 ? `${pendentes} alteração(ões) esperando envio.` : "Você pode continuar usando o app."}`
    : `${pendentes} alteração(ões) aguardando envio.`;

  return <div className="bg-brand-soft px-4 py-2 text-sm text-brand-dark">{texto}</div>;
}
