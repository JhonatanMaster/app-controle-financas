"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui";

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/**
 * O detector nativo do navegador (Chrome e Edge no Android) le mais rapido e gasta menos bateria.
 * Onde ele nao existe, como no Safari, o jsQR decodifica os quadros do video num canvas.
 */
async function criarDetector(): Promise<(fonte: HTMLVideoElement | HTMLImageElement, canvas: HTMLCanvasElement) => Promise<string | null>> {
  const Nativo = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Nativo) {
    try {
      const detector = new Nativo({ formats: ["qr_code"] });
      return async (fonte) => {
        const achados = await detector.detect(fonte);
        return achados[0]?.rawValue ?? null;
      };
    } catch {
      // Alguns navegadores expoem a classe sem suportar qr_code, e ai segue para o jsQR
    }
  }

  const { default: jsQR } = await import("jsqr");
  return async (fonte, canvas) => {
    const largura = fonte instanceof HTMLVideoElement ? fonte.videoWidth : fonte.naturalWidth;
    const altura = fonte instanceof HTMLVideoElement ? fonte.videoHeight : fonte.naturalHeight;
    if (!largura || !altura) return null;

    // Reduz imagens grandes, porque o QR do cupom ocupa boa parte do quadro e decodificar 12
    // megapixels por quadro travaria o celular
    const escala = Math.min(1, 1024 / Math.max(largura, altura));
    canvas.width = Math.round(largura * escala);
    canvas.height = Math.round(altura * escala);
    const contexto = canvas.getContext("2d", { willReadFrequently: true });
    if (!contexto) return null;
    contexto.drawImage(fonte, 0, 0, canvas.width, canvas.height);
    const imagem = contexto.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(imagem.data, imagem.width, imagem.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
  };
}

function mensagemDeErroDaCamera(erro: unknown) {
  const nome = erro instanceof DOMException ? erro.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "O acesso à câmera foi negado. Libere a câmera para este site nas configurações do navegador, ou use uma foto do QR Code.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Nenhuma câmera encontrada neste aparelho. Use uma foto do QR Code ou digite a chave.";
  }
  return "Não foi possível abrir a câmera. Use uma foto do QR Code ou digite a chave.";
}

/**
 * Le o QR Code do cupom pela camera traseira. Para assim que encontra um codigo e devolve o texto
 * lido, que na NFCe e a URL da consulta publica da SEFAZ.
 */
export function LeitorQrCode({ onLido }: { onLido: (texto: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onLidoRef = useRef(onLido);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(true);
  const [lendoFoto, setLendoFoto] = useState(false);

  useEffect(() => {
    onLidoRef.current = onLido;
  }, [onLido]);

  useEffect(() => {
    let parado = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        // Fora de HTTPS o navegador nem expoe a camera
        setErro("Este navegador não liberou a câmera. Ela só funciona em conexão segura (https). Use uma foto do QR Code ou digite a chave.");
        setIniciando(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        setErro(mensagemDeErroDaCamera(err));
        setIniciando(false);
        return;
      }
      if (parado) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setIniciando(false);

      const detectar = await criarDetector();

      // Cinco tentativas por segundo bastam para o QR parado na frente da camera e poupam bateria
      const tentar = async () => {
        if (parado) return;
        try {
          const texto = video.readyState >= 2 ? await detectar(video, canvas) : null;
          if (texto && !parado) {
            parado = true;
            stream?.getTracks().forEach((t) => t.stop());
            onLidoRef.current(texto);
            return;
          }
        } catch {
          // Um quadro ruim nao interrompe a leitura
        }
        timer = setTimeout(tentar, 200);
      };
      tentar();
    })();

    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Quando a camera nao abre, ou o QR esta amassado, uma foto com mais resolucao costuma resolver
  async function lerFoto(arquivo: File) {
    setLendoFoto(true);
    setErro(null);
    const url = URL.createObjectURL(arquivo);
    try {
      const imagem = new Image();
      imagem.src = url;
      await imagem.decode();
      const detectar = await criarDetector();
      const texto = canvasRef.current ? await detectar(imagem, canvasRef.current) : null;
      if (texto) onLidoRef.current(texto);
      else setErro("Não encontrei um QR Code nesta foto. Tente aproximar e deixar o código nítido.");
    } catch {
      setErro("Não consegui abrir esta imagem.");
    } finally {
      URL.revokeObjectURL(url);
      setLendoFoto(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Imagem da câmera" />
        {/* Moldura so como guia visual, a leitura acontece no quadro inteiro */}
        <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" aria-hidden />
        {iniciando ? (
          <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white">Abrindo a câmera…</p>
        ) : !erro ? (
          <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white">Aponte para o QR Code do cupom</p>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {erro ? <Alert>{erro}</Alert> : null}

      <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-2">
        {lendoFoto ? "Lendo a foto…" : "Usar uma foto do QR Code"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={lendoFoto}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (arquivo) lerFoto(arquivo);
          }}
        />
      </label>
    </div>
  );
}
