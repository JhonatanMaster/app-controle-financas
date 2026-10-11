/**
 * Bloqueio de login por conta depois de senhas erradas seguidas.
 *
 * O limite por IP, feito pelo plugin de rate limit, nao basta contra quem tenta a senha de uma
 * conta especifica a partir de varios enderecos. Aqui a contagem e por email, e depois de
 * MAXIMO_FALHAS erros a conta fica bloqueada por BLOQUEIO_MS, mesmo para a senha certa, senao o
 * bloqueio nao serviria para nada. Um acerto zera a contagem.
 *
 * O estado mora na memoria do processo. Reiniciar o backend libera os bloqueios, o que e aceitavel
 * para um app com uma unica instancia, e evita depender do banco a cada tentativa de login.
 */

export const MAXIMO_FALHAS = 5;
export const BLOQUEIO_MS = 5 * 60 * 1000;
// Falhas espalhadas no tempo nao sao ataque. Depois deste intervalo sem errar, a contagem recomeca
const JANELA_DAS_FALHAS_MS = 15 * 60 * 1000;

type Registro = { falhas: number; primeiraFalhaEm: number; bloqueadoAte: number };

const registros = new Map<string, Registro>();

function chaveDo(email: string) {
  return email.trim().toLowerCase();
}

/**
 * @returns Quantos milissegundos faltam para a conta ser liberada, ou zero se ela nao esta bloqueada.
 */
export function tempoDeBloqueio(email: string, agora = Date.now()): number {
  const registro = registros.get(chaveDo(email));
  if (!registro || registro.bloqueadoAte <= agora) return 0;
  return registro.bloqueadoAte - agora;
}

/**
 * Conta uma senha errada e bloqueia a conta ao atingir o maximo.
 *
 * @returns Quantos milissegundos de bloqueio comecaram agora, ou zero se ainda nao bloqueou.
 */
export function registrarFalha(email: string, agora = Date.now()): number {
  const chave = chaveDo(email);
  const anterior = registros.get(chave);
  const recomecar = !anterior || anterior.bloqueadoAte > 0 || agora - anterior.primeiraFalhaEm > JANELA_DAS_FALHAS_MS;
  const registro: Registro = recomecar ? { falhas: 0, primeiraFalhaEm: agora, bloqueadoAte: 0 } : anterior;

  registro.falhas += 1;
  if (registro.falhas >= MAXIMO_FALHAS) {
    registro.bloqueadoAte = agora + BLOQUEIO_MS;
  }
  registros.set(chave, registro);
  return registro.bloqueadoAte > 0 ? BLOQUEIO_MS : 0;
}

export function registrarSucesso(email: string) {
  registros.delete(chaveDo(email));
}

/** Tentativas que ainda restam antes do bloqueio, para avisar a pessoa antes que ele aconteca */
export function tentativasRestantes(email: string): number {
  const registro = registros.get(chaveDo(email));
  if (!registro || registro.bloqueadoAte > 0) return MAXIMO_FALHAS;
  return Math.max(0, MAXIMO_FALHAS - registro.falhas);
}

// Varre de tempos em tempos o que ja expirou, para o mapa nao crescer com emails que nunca voltam.
// O unref deixa o processo encerrar normalmente mesmo com o timer ativo
setInterval(() => {
  const agora = Date.now();
  for (const [chave, registro] of registros) {
    const bloqueioVencido = registro.bloqueadoAte > 0 && registro.bloqueadoAte <= agora;
    const falhasVencidas = registro.bloqueadoAte === 0 && agora - registro.primeiraFalhaEm > JANELA_DAS_FALHAS_MS;
    if (bloqueioVencido || falhasVencidas) registros.delete(chave);
  }
}, 60 * 1000).unref();
