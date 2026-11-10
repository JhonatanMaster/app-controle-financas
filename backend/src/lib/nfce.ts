/**
 * Leitura de notas fiscais de consumidor (NFCe) e de NFe pela chave de acesso ou pelo QR Code.
 *
 * O QR Code da NFCe traz a URL da consulta publica da SEFAZ do estado, com a chave e um hash que
 * dispensa captcha. A pagina segue o leiaute nacional da consulta resumida (o mesmo XSLT do ENCAT
 * em SP, PR, MG, RS e outros), e e dela que saem itens, total e forma de pagamento.
 *
 * Quem busca a pagina nao e a API. A SEFAZ SP recusa conexoes de IPs de datacenter, entao a busca
 * e feita pelo servico comunica sefaz, que roda numa internet residencial no Brasil (ver
 * relay-sefaz.ts). Aqui ficam a validacao da chave e a leitura da pagina que ele devolve.
 */

// ========== Chave de acesso

/** Codigos IBGE das UFs, que abrem a chave de acesso */
const UF_POR_CODIGO: Record<number, string> = {
  11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO",
  21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA",
  31: "MG", 32: "ES", 33: "RJ", 35: "SP",
  41: "PR", 42: "SC", 43: "RS",
  50: "MS", 51: "MT", 52: "GO", 53: "DF",
};

export type DadosDaChave = {
  chave: string;
  codigoUf: number;
  uf: string;
  /** Ano e mes de emissao, no formato AAAA-MM */
  anoMes: string;
  cnpjEmitente: string;
  modelo: 55 | 65;
  serie: number;
  numero: number;
};

/**
 * Digito verificador da chave, modulo 11 com pesos de 2 a 9 da direita para a esquerda, como no
 * manual de orientacao do contribuinte. Barra chave digitada errado antes de qualquer consulta.
 */
function digitoVerificador(primeiros43: string): number {
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
 * Valida e decompoe a chave de acesso de 44 digitos.
 * @param entrada - Chave com ou sem espacos, como aparece impressa no cupom.
 * @returns Os campos da chave, ou null se ela nao for uma chave valida de NFe ou NFC-e.
 */
export function decodificarChave(entrada: string): DadosDaChave | null {
  const chave = entrada.replace(/\D/g, "");
  if (chave.length !== 44) return null;
  if (digitoVerificador(chave.slice(0, 43)) !== Number(chave[43])) return null;

  const codigoUf = Number(chave.slice(0, 2));
  const uf = UF_POR_CODIGO[codigoUf];
  const modelo = Number(chave.slice(20, 22));
  if (!uf || (modelo !== 55 && modelo !== 65)) return null;

  const mes = Number(chave.slice(4, 6));
  if (mes < 1 || mes > 12) return null;

  return {
    chave,
    codigoUf,
    uf,
    anoMes: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`,
    cnpjEmitente: chave.slice(6, 20),
    modelo,
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34)),
  };
}

// ========== QR Code

export type ConteudoDoQrCode =
  | { tipo: "url"; url: URL; chave: DadosDaChave }
  | { tipo: "chave"; chave: DadosDaChave };

/**
 * Interpreta o texto lido do QR Code, ou digitado pela pessoa.
 *
 * Na versao 2 do QR Code a chave e o primeiro campo do parametro p, separado por barra vertical.
 * Na versao 1, ainda impressa por alguns emissores, ela vem no parametro chNFe.
 */
export function interpretarQrCode(texto: string): ConteudoDoQrCode | null {
  const limpo = texto.trim();

  let url: URL | null = null;
  try {
    url = new URL(limpo);
  } catch {
    // Nao e URL, pode ser so a chave
  }

  if (!url) {
    const chave = decodificarChave(limpo);
    return chave ? { tipo: "chave", chave } : null;
  }

  const candidata = url.searchParams.get("p")?.split("|")[0] ?? url.searchParams.get("chNFe") ?? "";
  const chave = decodificarChave(candidata);
  if (!chave) return null;
  return { tipo: "url", url, chave };
}

/**
 * A API busca a URL que veio no QR Code, entao sem esta trava um QR Code forjado faria o servidor
 * acessar qualquer endereco, inclusive da rede interna. Toda SEFAZ e portal estadual fica em gov.br.
 */
export function urlDeConsultaPermitida(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return host.endsWith(".gov.br");
}

/**
 * Chave contida na URL do QR Code. Na versao 2 ela e o primeiro campo do parametro p, separado
 * por barra vertical. Na versao 1, ainda impressa por alguns emissores, vem no parametro chNFe.
 */
function chaveDaUrl(texto: string): string | null {
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    return null;
  }
  return url.searchParams.get("p")?.split("|")[0] ?? url.searchParams.get("chNFe");
}

// ========== Entrada da pessoa

export type NotaInformada =
  | { tipo: "chave"; dados: DadosDaChave }
  | { tipo: "numero"; numero: number };

/**
 * Interpreta o que a pessoa digitou ou o app leu do QR Code.
 * @returns A nota, ou uma mensagem de erro pronta para o usuario.
 */
export function interpretarNotaInformada(texto: string): NotaInformada | { erro: string } {
  const limpo = texto.trim();
  const daUrl = chaveDaUrl(limpo);
  if (daUrl !== null) {
    const dados = decodificarChave(daUrl);
    return dados ? { tipo: "chave", dados } : { erro: "O QR Code não traz uma chave de nota fiscal válida" };
  }

  // So digitos, espacos e pontos, como a chave e o numero aparecem impressos no cupom
  if (!/^[\d\s.]+$/.test(limpo)) {
    return { erro: "Informe a chave de acesso (44 números) ou o número da nota" };
  }
  const digitos = limpo.replace(/\D/g, "");

  if (digitos.length === 44) {
    const dados = decodificarChave(digitos);
    return dados ? { tipo: "chave", dados } : { erro: "Chave de acesso inválida. Confira os 44 números." };
  }
  // O numero da nota tem no maximo nove digitos. Mais que isso e chave incompleta
  if (digitos.length >= 1 && digitos.length <= 9 && Number(digitos) > 0) {
    return { tipo: "numero", numero: Number(digitos) };
  }
  return { erro: `A chave de acesso tem 44 números, e foram informados ${digitos.length}` };
}

// ========== Pagina devolvida pela SEFAZ

export class ErroDeConsulta extends Error {}

/**
 * Bytes da pagina em texto. Varios portais ainda servem ISO 8859 1, e ler como UTF 8 estragaria os
 * acentos dos produtos.
 */
export function decodificarPagina(bytes: Uint8Array, contentType: string | null): string {
  const doCabecalho = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1];
  const inicio = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const doMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(inicio)?.[1];
  const charset = (doCabecalho ?? doMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ========== Interpretacao da pagina

export type ItemDaNota = {
  name: string;
  productCode: string | null;
  quantity: number;
  /** Como o mercado cadastrou, por exemplo kg, UN, FR, L */
  unit: string;
  unitPrice: number;
  totalPrice: number;
};

export type PagamentoDaNota = { method: string; value: number };

export type NotaLida = {
  issuerName: string | null;
  issuerCnpj: string | null;
  issuerAddress: string | null;
  items: ItemDaNota[];
  itemsCount: number | null;
  totalValue: number | null;
  discountValue: number | null;
  payments: PagamentoDaNota[];
  number: number | null;
  series: number | null;
  /** Data e hora da emissao em ISO 8601 com o fuso de Brasilia */
  issuedAt: string | null;
  authorizationProtocol: string | null;
  accessKey: string | null;
};

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä",
  eacute: "é", egrave: "è", ecirc: "ê", iacute: "í", oacute: "ó", ocirc: "ô", otilde: "õ",
  uacute: "ú", uuml: "ü", ccedil: "ç",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Eacute: "É", Ecirc: "Ê", Iacute: "Í",
  Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Uacute: "Ú", Ccedil: "Ç", ordm: "º", ordf: "ª",
};

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (inteira, nome: string) => {
    if (nome[0] === "#") {
      const codigo = nome[1].toLowerCase() === "x" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[nome] ?? inteira;
  });
}

/** HTML em texto corrido, com um espaco entre o conteudo de cada tag */
export function htmlParaTexto(html: string): string {
  const semCodigo = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return decodificarEntidades(semCodigo.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Numero no formato brasileiro, com ponto de milhar e virgula decimal */
export function numeroBr(texto: string | undefined | null): number | null {
  if (!texto) return null;
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

const NUMERO = String.raw`(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)`;

/** Texto de dentro do primeiro elemento com a classe ou o id pedido */
function textoDoElemento(html: string, atributo: "class" | "id", valor: string): string | null {
  const padrao = new RegExp(
    `<(\\w+)[^>]*\\b${atributo}=["'][^"']*\\b${valor}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`,
    "i",
  );
  const achado = padrao.exec(html);
  return achado ? htmlParaTexto(achado[2]) : null;
}

/**
 * Itens pela estrutura da consulta resumida, uma linha da tabela tabResult por item. E o caminho
 * preferido porque nao depende da ordem em que o texto aparece.
 */
function itensPelaTabela(html: string): ItemDaNota[] {
  const linhas = [...html.matchAll(/<tr[^>]*\bid=["']Item\s*\+\s*\d+["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  const itens: ItemDaNota[] = [];

  for (const [, linha] of linhas) {
    const nome = textoDoElemento(linha, "class", "txtTit");
    const codigo = textoDoElemento(linha, "class", "RCod");
    const quantidade = textoDoElemento(linha, "class", "Rqtd");
    const unidade = textoDoElemento(linha, "class", "RUN");
    const unitario = textoDoElemento(linha, "class", "RvlUnit");
    const total = textoDoElemento(linha, "class", "valor");

    const item = montarItem(
      nome,
      codigo?.replace(/[()]/g, "").replace(/C[óo]digo:/i, ""),
      quantidade?.replace(/Qtde\.?:/i, ""),
      unidade?.replace(/UN:/i, ""),
      unitario?.replace(/Vl\.?\s*Unit\.?:/i, ""),
      total,
    );
    if (item) itens.push(item);
  }
  return itens;
}

/**
 * Itens pelo texto corrido, para portais que montam a mesma informacao com outra marcacao. Cada
 * item termina no valor total, entao o nome do proximo comeca logo depois dele.
 */
function itensPeloTexto(texto: string): ItemDaNota[] {
  const inicio = texto.search(/\S+[^()]*\(C[óo]digo:/i);
  const fim = texto.search(/Qtd\.? total de itens/i);
  if (inicio < 0) return [];
  const trecho = texto.slice(inicio, fim > inicio ? fim : undefined);

  const padrao = new RegExp(
    String.raw`\s*(.+?)\s*\(\s*C[óo]digo:\s*([^)]*?)\s*\)\s*Qtde\.?:\s*${NUMERO}\s*UN:\s*(\S+)\s*Vl\.?\s*Unit\.?:\s*${NUMERO}\s*Vl\.?\s*Total\s*${NUMERO}`,
    "gi",
  );

  const itens: ItemDaNota[] = [];
  for (const m of trecho.matchAll(padrao)) {
    let nome = m[1];
    // O primeiro nome vem colado ao cabecalho do emitente, que termina no endereco com a UF
    if (itens.length === 0) {
      const fimDoEndereco = [...nome.matchAll(/,\s*[A-Z]{2}\s+/g)].pop();
      if (fimDoEndereco?.index !== undefined) nome = nome.slice(fimDoEndereco.index + fimDoEndereco[0].length);
    }
    const item = montarItem(nome, m[2], m[3], m[4], m[5], m[6]);
    if (item) itens.push(item);
  }
  return itens;
}

function montarItem(
  nome: string | null | undefined,
  codigo: string | null | undefined,
  quantidade: string | null | undefined,
  unidade: string | null | undefined,
  unitario: string | null | undefined,
  total: string | null | undefined,
): ItemDaNota | null {
  const nomeLimpo = nome?.replace(/\s+/g, " ").trim();
  const qtd = numeroBr(quantidade);
  const vlUnit = numeroBr(unitario);
  const vlTotal = numeroBr(total);
  if (!nomeLimpo || qtd === null || qtd <= 0 || vlTotal === null) return null;

  return {
    name: nomeLimpo.slice(0, 200),
    productCode: codigo?.trim() ? codigo.trim().slice(0, 60) : null,
    quantity: qtd,
    unit: (unidade?.trim() || "UN").slice(0, 10),
    unitPrice: vlUnit ?? Math.round((vlTotal / qtd) * 100) / 100,
    totalPrice: vlTotal,
  };
}

/**
 * Formas de pagamento entre o cabecalho "Forma de pagamento" e o troco. Cada forma e um rotulo
 * seguido do valor pago, e uma nota pode ter mais de uma (parte no cartao e parte no Pix).
 */
function pagamentosDoTexto(texto: string): PagamentoDaNota[] {
  const inicio = /Forma de pagamento:?\s*(?:Valor pago R\$:?)?/i.exec(texto);
  if (!inicio) return [];
  const resto = texto.slice(inicio.index + inicio[0].length);
  const fim = resto.search(/Troco|Informa[çc][õo]es gerais|EMISS[ÃA]O/i);
  const trecho = fim >= 0 ? resto.slice(0, fim) : resto.slice(0, 300);

  const pagamentos: PagamentoDaNota[] = [];
  for (const m of trecho.matchAll(new RegExp(String.raw`([^\d][^]*?)\s+${NUMERO}(?=\s|$)`, "g"))) {
    // Alguns portais trazem o codigo numerico do meio de pagamento antes do nome
    const metodo = m[1].replace(/^\s*\d{2}\s*-\s*/, "").trim();
    const valor = numeroBr(m[2]);
    if (metodo && valor !== null && valor > 0) pagamentos.push({ method: metodo.slice(0, 60), value: valor });
  }
  return pagamentos;
}

/**
 * Le a pagina da consulta publica e devolve o que da para aproveitar. Campos que o portal nao
 * trouxer voltam nulos, e quem chama decide se a leitura serve.
 */
export function interpretarPaginaDaNota(html: string): NotaLida {
  const texto = htmlParaTexto(html);

  let items = itensPelaTabela(html);
  if (items.length === 0) items = itensPeloTexto(texto);

  const cnpj = /CNPJ:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i.exec(texto)?.[1].replace(/\D/g, "") ?? null;

  // O nome do emitente fica no topo da pagina, no elemento u20. Sem ele, o nome e o texto que vem
  // logo antes do CNPJ
  let issuerName = textoDoElemento(html, "id", "u20");
  if (!issuerName) {
    const antesDoCnpj = /([A-ZÀ-Ú0-9][^:]{2,120}?)\s+CNPJ:/.exec(texto)?.[1];
    issuerName = antesDoCnpj ? antesDoCnpj.replace(/^.*(?:NFC-?e|Consulta[^A-Z]*)/i, "").trim() : null;
  }

  // Na consulta resumida o endereco e o segundo bloco com a classe text, depois do CNPJ
  const blocosDeTexto = [...html.matchAll(/<div[^>]*class=["'][^"']*\btext\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map((m) =>
    htmlParaTexto(m[1]),
  );
  const issuerAddress =
    blocosDeTexto.find((b) => b && !/CNPJ/i.test(b) && /,/.test(b))?.replace(/\s*,\s*/g, ", ").replace(/(, )+/g, ", ") ?? null;

  const emissao = /N[úu]mero:\s*(\d+)\s*S[ée]rie:\s*(\d+)\s*Emiss[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2}(?::\d{2})?)?/i.exec(texto);
  // A pagina mostra o horario local do emitente sem fuso. Brasilia cobre a maior parte do pais, e
  // para a compra o que importa e o dia
  const issuedAt = emissao
    ? `${emissao[5]}-${emissao[4]}-${emissao[3]}T${(emissao[6] ?? "00:00:00").padEnd(8, ":00")}-03:00`
    : null;

  const chaveImpressa = /Chave de acesso:?\s*((?:\d[\s.]*){44})/i.exec(texto)?.[1].replace(/\D/g, "") ?? null;

  return {
    issuerName: issuerName ? issuerName.slice(0, 200) : null,
    issuerCnpj: cnpj && cnpj.length === 14 ? cnpj : null,
    issuerAddress: issuerAddress ? issuerAddress.slice(0, 300) : null,
    items,
    itemsCount: numeroBr(/Qtd\.? total de itens:?\s*(\d+)/i.exec(texto)?.[1]),
    totalValue: numeroBr(new RegExp(String.raw`Valor a pagar R\$:?\s*${NUMERO}`, "i").exec(texto)?.[1]),
    discountValue: numeroBr(new RegExp(String.raw`Descontos R\$:?\s*${NUMERO}`, "i").exec(texto)?.[1]),
    payments: pagamentosDoTexto(texto),
    number: emissao ? Number(emissao[1]) : null,
    series: emissao ? Number(emissao[2]) : null,
    issuedAt,
    authorizationProtocol: /Protocolo de Autoriza[çc][ãa]o:?\s*(\d{10,20})/i.exec(texto)?.[1] ?? null,
    accessKey: chaveImpressa && chaveImpressa.length === 44 ? chaveImpressa : null,
  };
}

/**
 * Tira da pagina tudo que executa codigo antes de guardar. Ela e exibida depois num iframe sem
 * permissao de script e baixada como arquivo, e nos dois casos so o conteudo visual interessa.
 */
export function limparHtmlParaGuardar(html: string, urlBase: string): string {
  const limpo = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<(iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2")
    .replace(/<base\b[^>]*>/gi, "");

  // Com a base, o CSS e as imagens do portal continuam carregando quando a pagina e aberta fora dele
  const base = `<base href="${urlBase.replace(/"/g, "&quot;")}">`;
  return /<head[^>]*>/i.test(limpo) ? limpo.replace(/<head[^>]*>/i, (m) => `${m}${base}`) : `${base}${limpo}`;
}
