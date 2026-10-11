import { api, ApiError } from "./api";
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

/**
 * Busca um recurso da familia com cache. A chave sai sempre daqui porque telas diferentes leem o
 * mesmo dado, como a lista de itens que serve ao estoque e ao formulario da compra, e so dividem
 * o que foi guardado se a chave for identica.
 *
 * @param caminho Trecho da rota depois de /families/:familyId, por exemplo /stock-items.
 */
export function comCacheDaFamilia<T>(familyId: string, caminho: string) {
  return comCache<T>(`${familyId}:${caminho}`, () => api<T>(`/families/${familyId}${caminho}`));
}

/** Listas que o formulario de adicionar item precisa para funcionar sem sinal */
export const LISTA_ITENS_DO_ESTOQUE = "/stock-items";
export const LISTA_GRUPOS = "/stock-groups";

/**
 * Guarda no aparelho as listas que a compra usa sem sinal. Sem isto elas so eram guardadas ao
 * abrir a tela de estoque ou o proprio formulario com rede, e o caso comum e o contrario, montar
 * o carrinho ja no mercado, onde o sinal falha. Sem rede a busca so le o que ja havia, entao
 * chamar a qualquer momento e seguro.
 */
export function preaquecerListasDaCompra(familyId: string): void {
  for (const caminho of [LISTA_ITENS_DO_ESTOQUE, LISTA_GRUPOS]) {
    comCacheDaFamilia(familyId, caminho).catch(() => undefined);
  }
}
