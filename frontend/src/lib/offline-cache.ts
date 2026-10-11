import { ApiError } from "./api";
import { gravarCache, lerCache } from "./offline-db";

/**
 * Busca um dado na API e guarda a resposta no aparelho. Se a rede falhar, devolve a ultima
 * resposta guardada e marca a origem como cache. Erro HTTP da API nunca cai no cache, porque
 * ele diz algo real sobre o servidor, como sessao encerrada ou recurso apagado.
 *
 * @param chave Identificador do dado, que inclui a familia para nao misturar casas.
 * @param busca Funcao que chama a API.
 * @returns O dado e se ele veio do cache.
 * @throws O erro original quando a rede falha e nao existe nada guardado.
 */
export async function comCache<T>(chave: string, busca: () => Promise<T>): Promise<{ valor: T; doCache: boolean }> {
  try {
    const valor = await busca();
    // Guardar e so uma otimizacao, por isso nao espera nem deixa a falha subir
    gravarCache(chave, valor).catch(() => undefined);
    return { valor, doCache: false };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const salvo = await lerCache<T>(chave).catch(() => null);
    if (salvo === null) throw err;
    return { valor: salvo, doCache: true };
  }
}
