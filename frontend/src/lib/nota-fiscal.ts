import type { FiscalNote, PurchaseItem } from "./types";

/** Chave em blocos de quatro, como vem impressa no cupom, para conferir de olho */
export function formatarChave(chave: string) {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatarCnpj(cnpj: string) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function nomeDoModelo(modelo: FiscalNote["model"]) {
  return modelo === 55 ? "NF-e" : "NFC-e";
}

const UFS: Record<number, string> = {
  11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO",
  21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA",
  31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC", 43: "RS",
  50: "MS", 51: "MT", 52: "GO", 53: "DF",
};

export function siglaDaUf(codigo: number | null) {
  return codigo === null ? null : (UFS[codigo] ?? null);
}

/** Mesmo calculo da API, para avisar da chave errada antes de enviar, inclusive sem sinal */
function digitoVerificador(primeiros43: string) {
  let soma = 0;
  let peso = 2;
  for (let i = primeiros43.length - 1; i >= 0; i--) {
    soma += Number(primeiros43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Tira a chave do texto lido no QR Code. Na versao 2 ela e o primeiro campo do parametro p, na
 * versao 1 vem em chNFe. Se o texto nao for URL, devolve como veio.
 */
export function chaveDoQrCode(texto: string) {
  try {
    const url = new URL(texto.trim());
    return url.searchParams.get("p")?.split("|")[0] ?? url.searchParams.get("chNFe") ?? texto;
  } catch {
    return texto;
  }
}

/**
 * Confere o que foi digitado no campo da nota.
 * @returns Mensagem de erro, ou null quando esta vazio ou valido.
 */
export function erroDaNotaInformada(texto: string): string | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  if (!/^[\d\s.]+$/.test(limpo)) return "Use só números: a chave de 44 dígitos ou o número da nota";
  const digitos = limpo.replace(/\D/g, "");
  if (digitos.length === 44) {
    return digitoVerificador(digitos.slice(0, 43)) === Number(digitos[43]) ? null : "Chave inválida. Confira os 44 números.";
  }
  if (digitos.length >= 1 && digitos.length <= 9 && Number(digitos) > 0) return null;
  return `A chave tem 44 números, e foram digitados ${digitos.length}`;
}

/**
 * Portal onde a nota pode ser consultada pela chave. A consulta pede captcha, entao o app copia a
 * chave e abre o portal para a pessoa colar. SP e o endereco impresso no proprio cupom; a NFe tem
 * portal nacional; para NFCe de outros estados o endereco muda por UF e vai uma busca.
 */
export function portalDeConsulta(nota: Pick<FiscalNote, "model" | "uf_code">) {
  if (nota.model === 55) {
    return "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=";
  }
  if (nota.uf_code === 35) return "https://www.nfce.fazenda.sp.gov.br/consulta";
  const uf = siglaDaUf(nota.uf_code) ?? "";
  return `https://www.google.com/search?q=${encodeURIComponent(`consulta NFC-e SEFAZ ${uf} chave de acesso`)}`;
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
