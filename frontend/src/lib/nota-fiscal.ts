import type { FiscalNote, PurchaseItem } from "./types";

/** Chave em blocos de quatro, como vem impressa no cupom, para conferir de olho */
export function formatarChave(chave: string) {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatarCnpj(cnpj: string) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function nomeDoModelo(modelo: FiscalNote["model"]) {
  return modelo === 65 ? "NFC-e" : "NF-e";
}

const UFS: Record<number, string> = {
  11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO",
  21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA",
  31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC", 43: "RS",
  50: "MS", 51: "MT", 52: "GO", 53: "DF",
};

export function siglaDaUf(codigo: number) {
  return UFS[codigo] ?? String(codigo);
}

/** Itens vendidos a peso, em que a quantidade e fracionada e o preco e por quilo ou litro */
export function vendidoAPeso(unidade: string | null | undefined) {
  return !!unidade && /^(kg|g|l|lt|ml)$/i.test(unidade.trim());
}

/** Unidade como a pessoa espera ler, "kg" minusculo e o resto como o mercado cadastrou */
export function unidadeLegivel(unidade: string | null | undefined) {
  if (!unidade) return "un";
  const limpa = unidade.trim();
  return vendidoAPeso(limpa) ? limpa.toLowerCase() : limpa.toUpperCase() === "UN" ? "un" : limpa;
}

/** Quantidade com tres casas para peso (0,815 kg) e sem casas para unidade */
export function quantidadeLegivel(item: Pick<PurchaseItem, "quantity" | "unit">) {
  if (vendidoAPeso(item.unit)) {
    return item.quantity.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  return item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/**
 * Baixa a pagina original da nota como arquivo HTML. Ela foi guardada sem scripts, entao abre no
 * navegador como a pessoa viu no portal da SEFAZ.
 */
export function baixarHtml(nomeDoArquivo: string, html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
