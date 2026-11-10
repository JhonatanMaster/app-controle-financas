"use client";

import { useState } from "react";
import { chaveDoQrCode, erroDaNotaInformada, formatarChave } from "@/lib/nota-fiscal";
import { LeitorQrCode } from "@/components/leitor-qrcode";
import { Button, Input } from "@/components/ui";

/**
 * Campo da nota fiscal, que aceita a chave de 44 numeros ou so o numero da nota. O QR Code do cupom
 * traz a chave, entao ler pela camera evita digitar os 44 numeros. Nada e consultado na SEFAZ.
 */
export function CampoNotaFiscal({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (valor: string) => void;
  autoFocus?: boolean;
}) {
  const [lendo, setLendo] = useState(false);
  const erro = erroDaNotaInformada(value);
  const digitos = value.replace(/\D/g, "").length;

  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Nota fiscal (opcional)"
        name="notaFiscal"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Chave de 44 números ou número da nota"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={erro ?? undefined}
        hint={!erro && digitos > 9 ? `${digitos} de 44 números` : undefined}
      />
      <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setLendo((v) => !v)}>
        {lendo ? "Fechar câmera" : "Ler a chave pelo QR Code do cupom"}
      </Button>
      {lendo ? (
        <LeitorQrCode
          onLido={(texto) => {
            onChange(formatarChave(chaveDoQrCode(texto).replace(/\D/g, "")));
            setLendo(false);
          }}
        />
      ) : null}
    </div>
  );
}
