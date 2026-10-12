/**
 * Acesso cru ao IndexedDB do navegador, com duas stores, cache para leituras guardadas e outbox
 * para escritas feitas sem sinal. Quem chama deve tratar falhas, porque o storage pode estar
 * indisponivel em janelas privadas ou com dados do site bloqueados.
 */

const NOME_BANCO = "controle-financas";
const VERSAO_BANCO = 1;
const STORE_CACHE = "cache";
const STORE_OUTBOX = "outbox";

export type Operacao = {
  seq?: number;
  familyId: string;
  purchaseId: string | null;
  method: "PATCH" | "POST" | "DELETE";
  path: string;
  body: unknown;
  criadoEm: string;
  /** Como a operacao aparece na tela antes de chegar ao servidor */
  previa?: unknown;
};

let bancoPromise: Promise<IDBDatabase> | null = null;

function abrirBanco(): Promise<IDBDatabase> {
  if (!bancoPromise) {
    bancoPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: "seq", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Sem isso uma falha pontual ficaria presa para sempre na promise rejeitada
    bancoPromise.catch(() => {
      bancoPromise = null;
    });
  }
  return bancoPromise;
}

function executar<T>(store: string, modo: IDBTransactionMode, operacao: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrirBanco().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, modo);
        const req = operacao(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function lerCache<T>(chave: string): Promise<T | null> {
  return executar<T | undefined>(STORE_CACHE, "readonly", (s) => s.get(chave)).then((valor) => valor ?? null);
}

export function gravarCache(chave: string, valor: unknown): Promise<void> {
  return executar(STORE_CACHE, "readwrite", (s) => s.put(valor, chave)).then(() => undefined);
}

export function adicionarOperacao(operacao: Operacao): Promise<number> {
  return executar<IDBValidKey>(STORE_OUTBOX, "readwrite", (s) => s.add(operacao)).then((seq) => Number(seq));
}

/**
 * @returns As operacoes pendentes, na ordem em que foram feitas.
 */
export function listarOperacoes(): Promise<Operacao[]> {
  return executar<Operacao[]>(STORE_OUTBOX, "readonly", (s) => s.getAll());
}

export function removerOperacao(seq: number): Promise<void> {
  return executar(STORE_OUTBOX, "readwrite", (s) => s.delete(seq)).then(() => undefined);
}

/**
 * Apaga o cache e a outbox. Usado ao sair da conta para nenhum dado ficar no aparelho.
 */
export async function limparDadosOffline(): Promise<void> {
  await Promise.all([executar(STORE_CACHE, "readwrite", (s) => s.clear()), executar(STORE_OUTBOX, "readwrite", (s) => s.clear())]);
}
