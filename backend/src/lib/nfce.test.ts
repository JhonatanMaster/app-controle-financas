import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodificarChave,
  interpretarPaginaDaNota,
  interpretarQrCode,
  limparHtmlParaGuardar,
  urlDeConsultaPermitida,
} from "./nfce.js";

// Cupom real usado como modelo do leiaute, o mesmo do PDF de exemplo na raiz do projeto
const CHAVE = "35261101157555002239651100000796451632356135";

const ITENS: [string, string, string, string, string, string][] = [
  ["BATATA LAVADA EXTRA Kg", "1996", "0,81", "kg", "4,93", "3,99"],
  ["BISC BARRINHA RECH BAUDUCCO CHOC 104g", "956625", "1", "UN", "4,29", "4,29"],
  ["LIMAO TAHITI Kg", "2135", "0,39", "kg", "12,99", "5,07"],
  ["TORRADA BAUDUCCO INTEG L+P- 284g", "977145", "1", "UN", "8,99", "8,99"],
  ["SUCO NATURAL MAGUARY SELECA UV MAC 1,35L", "945932", "1", "UN", "15,99", "15,99"],
  ["LIMP FORNO DIABO VERDE 250g", "909653", "1", "FR", "18,59", "18,59"],
  ["FIGADO FGO CONG PERDIGAO 1Kg", "981551", "1", "UN", "5,9", "5,90"],
  ["BISC POLVILHO SELECT SALG 100g", "940287", "1", "UN", "4,65", "4,65"],
  ["BISC AGUA E SAL TRIUNFO 164g", "936078", "1", "UN", "2,85", "2,85"],
  ["AZEITE EX VIRGEM ANDORINHA VD 500ml", "964753", "1", "UN", "25,99", "25,99"],
  ["SH ELSEVE REPAR TOTAL 5 400ml", "990147", "1", "UN", "23,89", "23,89"],
  ["AROMAT LUXCAR GEL NEW FRESH NYTR 60g", "951127", "1", "UN", "8,99", "8,99"],
  ["PAPEL HIG SELECT FD LV24PG22un 30m", "940254", "1", "UN", "31,99", "31,99"],
];

/** Leiaute da consulta resumida da SEFAZ SP, com a marcacao do XSLT nacional */
const HTML_SP = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consulta</title>
<script>alert(1)</script></head><body onload="init()">
<div id="conteudo"><div class="txtCenter">
<div id="u20" class="txtTopo">TENDA ATACADO LTDA (ITU)</div>
<div class="text">CNPJ: 01.157.555/0022-39</div>
<div class="text">9 de Julho , 897 , , Padre Bento , ITU , SP</div>
</div>
<table id="tabResult" cellspacing="0" cellpadding="0">
${ITENS.map(
  ([nome, cod, qtd, un, unit, total], i) => `<tr id="Item + ${i + 1}"><td valign="top">
<span class="txtTit">${nome}</span><span class="RCod">(C&oacute;digo: ${cod} )</span><br />
<span class="Rqtd"><strong>Qtde.:</strong>${qtd}</span><span class="RUN"><strong>UN: </strong>${un}</span>
<span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;&nbsp;${unit}</span></td>
<td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">${total}</span></td></tr>`,
).join("\n")}
</table>
<div id="totalNota" class="txtRight">
<div id="linhaTotal"><label>Qtd. total de itens:</label><span class="totalNumb">13</span></div>
<div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">161,18</span></div>
<div id="linhaForma"><label>Forma de pagamento:</label><span class="totalNumb txtTitR">Valor pago R$:</span></div>
<div id="linhaTotal"><label class="tx">Vale Alimenta&ccedil;&atilde;o</label><span class="totalNumb">161,18</span></div>
<div id="linhaTotal"><label class="txtTroco">Troco </label><span class="totalNumb txtTroco">NaN</span></div>
</div>
<div id="infos"><h4>Informa&ccedil;&otilde;es gerais da Nota</h4><ul><li>
<strong>EMISS&Atilde;O NORMAL</strong><br/>
<strong>N&uacute;mero: </strong>79645<strong> S&eacute;rie: </strong>110<strong> Emiss&atilde;o: </strong>09/11/2026 18:58:48 - Via Consumidor<br/>
<strong>Protocolo de Autoriza&ccedil;&atilde;o: </strong>13526007729352538 09/11/2026 18:58:46
</li></ul>
<h4>Chave de acesso</h4><ul><li>Consulte pela Chave de Acesso em <a href="javascript:void(0)" onclick="x()">www.nfce.fazenda.sp.gov.br/consulta</a><br/>
<strong>Chave de acesso:</strong><br/><span class="chave">3526 1101 1575 5500 2239 6511 0000 0796 4516 3235 6135</span></li></ul>
</div></div></body></html>`;

test("decodifica a chave de acesso do cupom", () => {
  const dados = decodificarChave("3526 1101 1575 5500 2239 6511 0000 0796 4516 3235 6135");
  assert.deepEqual(dados, {
    chave: CHAVE,
    codigoUf: 35,
    uf: "SP",
    anoMes: "2026-11",
    cnpjEmitente: "01157555002239",
    modelo: 65,
    serie: 110,
    numero: 79645,
  });
});

test("recusa chave com digito verificador errado", () => {
  assert.equal(decodificarChave(CHAVE.slice(0, 43) + "0"), null);
  assert.equal(decodificarChave("123"), null);
});

test("extrai a chave do QR Code versao 2 e da versao 1", () => {
  const v2 = interpretarQrCode(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${CHAVE}|2|1|1|ABCDEF0123456789`);
  assert.equal(v2?.tipo, "url");
  assert.equal(v2?.chave.chave, CHAVE);

  const v1 = interpretarQrCode(`https://www.sefaz.mt.gov.br/nfce/consultanfce?chNFe=${CHAVE}&nVersao=100&tpAmb=1`);
  assert.equal(v1?.chave.chave, CHAVE);

  const soChave = interpretarQrCode(CHAVE);
  assert.equal(soChave?.tipo, "chave");

  assert.equal(interpretarQrCode("https://exemplo.com/qualquer"), null);
});

test("so permite buscar paginas em portais gov.br", () => {
  assert.equal(urlDeConsultaPermitida(new URL("https://www.nfce.fazenda.sp.gov.br/qrcode?p=1")), true);
  assert.equal(urlDeConsultaPermitida(new URL("https://gov.br.atacante.com/x")), false);
  assert.equal(urlDeConsultaPermitida(new URL("http://169.254.169.254/latest")), false);
  assert.equal(urlDeConsultaPermitida(new URL("https://www.sefaz.sp.gov.br:8443/x")), false);
  assert.equal(urlDeConsultaPermitida(new URL("file:///etc/passwd")), false);
});

test("le itens, total, pagamento e cabecalho do leiaute da SEFAZ SP", () => {
  const nota = interpretarPaginaDaNota(HTML_SP);

  assert.equal(nota.issuerName, "TENDA ATACADO LTDA (ITU)");
  assert.equal(nota.issuerCnpj, "01157555002239");
  assert.equal(nota.issuerAddress, "9 de Julho, 897, Padre Bento, ITU, SP");
  assert.equal(nota.items.length, 13);
  assert.equal(nota.itemsCount, 13);
  assert.equal(nota.totalValue, 161.18);
  assert.deepEqual(nota.payments, [{ method: "Vale Alimentação", value: 161.18 }]);
  assert.equal(nota.number, 79645);
  assert.equal(nota.series, 110);
  assert.equal(nota.issuedAt, "2026-11-09T18:58:48-03:00");
  assert.equal(nota.authorizationProtocol, "13526007729352538");
  assert.equal(nota.accessKey, CHAVE);

  assert.deepEqual(nota.items[0], {
    name: "BATATA LAVADA EXTRA Kg",
    productCode: "1996",
    quantity: 0.81,
    unit: "kg",
    unitPrice: 4.93,
    totalPrice: 3.99,
  });
  assert.equal(nota.items[5].unit, "FR");
  assert.equal(nota.items[4].name, "SUCO NATURAL MAGUARY SELECA UV MAC 1,35L");

  const somaDosItens = nota.items.reduce((acc, it) => acc + it.totalPrice, 0);
  assert.equal(Math.round(somaDosItens * 100) / 100, 161.18);
});

test("le os itens pelo texto corrido quando o portal usa outra marcacao", () => {
  const texto = [
    "<p>TENDA ATACADO LTDA (ITU)</p><p>CNPJ: 01.157.555/0022-39</p><p>9 de Julho , 897 , , Padre Bento , ITU , SP</p>",
    ...ITENS.map(
      ([nome, cod, qtd, un, unit, total]) =>
        `<p>${nome} (Código: ${cod} ) Qtde.:${qtd} UN: ${un} Vl. Unit.: ${unit}</p><p>Vl. Total</p><p>${total}</p>`,
    ),
    "<p>Qtd. total de itens: 13</p><p>Valor a pagar R$: 161,18</p>",
    "<p>Forma de pagamento: Valor pago R$:</p><p>Cartão de Crédito 100,00</p><p>Pix 61,18</p><p>Troco 0,00</p>",
  ].join("");

  const nota = interpretarPaginaDaNota(texto);
  assert.equal(nota.items.length, 13);
  assert.equal(nota.items[0].name, "BATATA LAVADA EXTRA Kg");
  assert.equal(nota.items[2].quantity, 0.39);
  assert.equal(nota.items[12].totalPrice, 31.99);
  assert.equal(nota.totalValue, 161.18);
  assert.deepEqual(nota.payments, [
    { method: "Cartão de Crédito", value: 100 },
    { method: "Pix", value: 61.18 },
  ]);
});

test("guarda a pagina sem nada que execute codigo", () => {
  const limpo = limparHtmlParaGuardar(HTML_SP, "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaResumida.aspx");
  assert.doesNotMatch(limpo, /<script/i);
  assert.doesNotMatch(limpo, /\sonload=|\sonclick=/i);
  assert.doesNotMatch(limpo, /javascript:/i);
  assert.match(limpo, /<head><base href="https:\/\/www\.nfce\.fazenda\.sp\.gov\.br\//);
  assert.match(limpo, /BATATA LAVADA EXTRA Kg/);
});
