import type { FuelFill } from "./types";
import type { Operacao } from "./offline-db";

/**
 * Aplica sobre os abastecimentos vindos do servidor as operacoes que ainda estao na fila, para a
 * tela mostrar o que a pessoa ja registrou ou apagou sem sinal. Quando a fila envia cada operacao,
 * a lista e buscada de novo e a sobreposicao some sozinha.
 *
 * Cada efeito e idempotente, porque a operacao pode ja ter sido aplicada no servidor quando a fila
 * ainda a guarda, por exemplo se a resposta se perdeu. Registro so entra se o id ainda nao existe.
 */
export function aplicarFilaCombustivel(
  fills: FuelFill[],
  operacoes: Operacao[],
  usuario: { id: string; nome: string | null },
): FuelFill[] {
  let atual = [...fills];

  for (const op of operacoes) {
    if (op.method === "POST" && op.previa) {
      const previa = op.previa as FuelFill;
      if (!atual.some((fill) => fill.id === previa.id)) {
        atual = [...atual, { ...previa, created_by: usuario.id, author_name: usuario.nome }];
      }
    } else if (op.method === "DELETE") {
      const id = op.path.split("/").pop();
      atual = atual.filter((fill) => fill.id !== id);
    }
  }

  // Os pendentes entram no fim da lista, entao a ordem volta a ser a da tela: do mais recente
  return atual.sort((a, b) => b.fill_date.localeCompare(a.fill_date) || b.created_at.localeCompare(a.created_at));
}
