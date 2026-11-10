import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { decodificarPagina, ErroDeConsulta, urlDeConsultaPermitida } from "./nfce.js";

/**
 * Fila das consultas a SEFAZ atendidas pelo servico comunica sefaz.
 *
 * A SEFAZ SP recusa conexoes de IPs de datacenter, entao quem busca a pagina e um servico pequeno
 * rodando numa internet residencial no Brasil. Ele so faz conexoes de saida, o que dispensa porta
 * aberta, tunel e IP fixo: mantem uma requisicao aberta pedindo a proxima consulta (long polling),
 * busca a pagina e devolve o resultado em outra requisicao.
 *
 * O estado fica na memoria do processo, como o bloqueio de login. Com uma unica instancia da API
 * isso basta, e uma consulta perdida num reinicio so faz a pessoa ler o QR Code de novo.
 */

export type TarefaDoRelay = { id: string; url: string };

export type ResultadoDoRelay =
  | { ok: true; urlFinal: string; contentType: string | null; corpoBase64: string }
  | { ok: false; causa: string; status?: number };

type Pendente = TarefaDoRelay & { concluir: (resultado: ResultadoDoRelay) => void };

const TEMPO_DA_CONSULTA_MS = 35_000;
// O servico renova a espera a cada 25 segundos; sem contato por mais que isso ele esta desligado
const RELAY_AUSENTE_APOS_MS = 45_000;
const MAXIMO_NA_FILA = 20;

const fila: Pendente[] = [];
const emAndamento = new Map<string, Pendente>();
const relaysEsperando: ((tarefa: Pendente) => void)[] = [];
let ultimoContato = 0;

export function relayConfigurado() {
  return Boolean(env.SEFAZ_RELAY_TOKEN);
}

function relayAtivo() {
  return relaysEsperando.length > 0 || Date.now() - ultimoContato < RELAY_AUSENTE_APOS_MS;
}

/** Compara pelo hash para o tempo da comparacao nao revelar quantos caracteres do token bateram */
export function tokenDoRelayValido(cabecalho: string | undefined) {
  const esperado = env.SEFAZ_RELAY_TOKEN;
  if (!esperado || !cabecalho?.startsWith("Bearer ")) return false;
  const recebido = createHash("sha256").update(cabecalho.slice(7)).digest();
  return timingSafeEqual(recebido, createHash("sha256").update(esperado).digest());
}

/**
 * Chamado pela rota que o servico mantem aberta. Entrega a proxima consulta assim que houver uma,
 * ou null quando o tempo de espera acaba sem nenhuma.
 * @returns A promessa da tarefa e a funcao que cancela a espera quando a conexao cai antes.
 */
export function aguardarTarefa(esperaMs: number): { tarefa: Promise<TarefaDoRelay | null>; cancelar: () => void } {
  ultimoContato = Date.now();

  const proxima = fila.shift();
  if (proxima) {
    emAndamento.set(proxima.id, proxima);
    return { tarefa: Promise.resolve({ id: proxima.id, url: proxima.url }), cancelar: () => undefined };
  }

  let cancelar = () => undefined as void;
  const tarefa = new Promise<TarefaDoRelay | null>((resolve) => {
    const receber = (pendente: Pendente) => {
      clearTimeout(timer);
      emAndamento.set(pendente.id, pendente);
      resolve({ id: pendente.id, url: pendente.url });
    };
    const sair = () => {
      clearTimeout(timer);
      const posicao = relaysEsperando.indexOf(receber);
      if (posicao >= 0) relaysEsperando.splice(posicao, 1);
      ultimoContato = Date.now();
      resolve(null);
    };
    const timer = setTimeout(sair, esperaMs);
    cancelar = sair;
    relaysEsperando.push(receber);
  });
  return { tarefa, cancelar };
}

/** Resultado enviado pelo servico. Falso quando a consulta ja expirou ou nunca existiu */
export function entregarResultado(id: string, resultado: ResultadoDoRelay) {
  ultimoContato = Date.now();
  const pendente = emAndamento.get(id);
  if (!pendente) return false;
  emAndamento.delete(id);
  pendente.concluir(resultado);
  return true;
}

/**
 * Pede ao servico a pagina da consulta publica e espera a resposta.
 * @throws ErroDeConsulta com mensagem para o usuario; a causa tecnica vai em cause, para o log.
 */
export async function consultarViaRelay(url: URL): Promise<{ html: string; urlFinal: string }> {
  if (!relayConfigurado()) {
    throw new ErroDeConsulta("A leitura automática da nota não está configurada neste servidor.");
  }
  if (!relayAtivo()) {
    throw new ErroDeConsulta("O serviço que consulta a SEFAZ está desligado agora. Tente mais tarde ou registre só com a chave.", {
      cause: "nenhum servico comunica sefaz conectado",
    });
  }
  if (fila.length >= MAXIMO_NA_FILA) {
    throw new ErroDeConsulta("Muitas notas sendo consultadas agora. Tente de novo em instantes.");
  }

  const resultado = await new Promise<ResultadoDoRelay>((resolve) => {
    const id = randomUUID();
    const expirar = setTimeout(() => {
      const naFila = fila.findIndex((p) => p.id === id);
      if (naFila >= 0) fila.splice(naFila, 1);
      emAndamento.delete(id);
      resolve({ ok: false, causa: naFila >= 0 ? "nenhum servico pegou a consulta a tempo" : "o servico nao devolveu a pagina a tempo" });
    }, TEMPO_DA_CONSULTA_MS);

    const pendente: Pendente = {
      id,
      url: url.toString(),
      concluir: (r) => {
        clearTimeout(expirar);
        resolve(r);
      },
    };

    const relay = relaysEsperando.shift();
    if (relay) relay(pendente);
    else fila.push(pendente);
  });

  if (!resultado.ok) {
    throw new ErroDeConsulta("A SEFAZ não respondeu. Tente de novo em alguns minutos.", { cause: resultado.causa });
  }

  // O servico e confiavel, mas a pagina guardada usa este endereco como base, entao ele passa pela
  // mesma trava do QR Code
  let urlFinal: URL;
  try {
    urlFinal = new URL(resultado.urlFinal);
  } catch {
    throw new ErroDeConsulta("A SEFAZ devolveu um endereço inválido", { cause: resultado.urlFinal });
  }
  if (!urlDeConsultaPermitida(urlFinal)) {
    throw new ErroDeConsulta("A consulta foi redirecionada para fora da SEFAZ", { cause: resultado.urlFinal });
  }

  const bytes = Buffer.from(resultado.corpoBase64, "base64");
  return { html: decodificarPagina(bytes, resultado.contentType), urlFinal: urlFinal.toString() };
}
