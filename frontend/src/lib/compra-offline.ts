import type { PurchaseDetail, PurchaseItem } from "./types";
import type { Operacao } from "./offline-db";

/**
 * Aplica sobre a compra vinda do servidor as operacoes que ainda nao chegaram la, para a tela
 * mostrar o que a pessoa ja fez. Quando a operacao for enviada, a lista e buscada de novo e a
 * sobreposicao some sozinha.
 *
 * Cada efeito e idempotente, porque a mesma operacao pode ja estar no servidor quando a fila
 * ainda a guarda, por exemplo se a resposta se perdeu. Quantidade e valor absoluto, item so entra
 * se o id ainda nao existe e finalizar so preenche a data uma vez.
 */
export function aplicarFila(compra: PurchaseDetail, operacoes: Operacao[]): PurchaseDetail {
  let atual: PurchaseDetail = { ...compra, purchase_items: [...compra.purchase_items] };

  for (const op of operacoes) {
    if (op.method === "PATCH" && op.path.includes("/items/")) {
      const itemId = op.path.split("/items/")[1];
      const { quantity } = op.body as { quantity: number };
      atual.purchase_items =
        quantity === 0
          ? atual.purchase_items.filter((item) => item.id !== itemId)
          : atual.purchase_items.map((item) => (item.id === itemId ? { ...item, quantity } : item));
    } else if (op.method === "POST" && op.path.endsWith("/items") && op.previa) {
      const previa = op.previa as PurchaseItem;
      if (!atual.purchase_items.some((item) => item.id === previa.id)) {
        atual.purchase_items = [...atual.purchase_items, previa];
      }
    } else if (op.method === "POST" && op.path.endsWith("/finalize")) {
      const { totalValue } = (op.body ?? {}) as { totalValue?: number };
      atual = {
        ...atual,
        finalized_at: atual.finalized_at ?? op.criadoEm,
        ...(totalValue !== undefined ? { total_value: totalValue, value_status: "definido" as const } : {}),
      };
    }
  }

  return atual;
}
