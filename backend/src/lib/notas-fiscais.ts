import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { interpretarNotaInformada, type NotaInformada } from "./nfce.js";

export type ResultadoDaValidacao =
  | { ok: true; nota: NotaInformada | null }
  | { ok: false; status: 400 | 409; erro: string };

/**
 * Valida a nota antes de qualquer escrita. Na compra avulsa e no finalizar a compra e gravada
 * primeiro, entao uma chave invalida ou repetida descoberta depois deixaria a compra registrada e
 * a pessoa, ao tentar de novo, duplicaria o gasto.
 *
 * @param entrada - Chave, URL do QR Code ou numero. Vazio ou nulo significa sem nota.
 * @param compraAtual - Compra que esta recebendo a nota, para nao acusar a si mesma de repetida.
 */
export async function validarNotaInformada(
  supabase: SupabaseClient,
  familyId: string,
  entrada: string | null | undefined,
  compraAtual?: string,
): Promise<ResultadoDaValidacao> {
  if (!entrada || !entrada.trim()) return { ok: true, nota: null };

  const nota = interpretarNotaInformada(entrada);
  if ("erro" in nota) return { ok: false, status: 400, erro: nota.erro };

  if (nota.tipo === "chave") {
    const { data } = await supabase
      .from("fiscal_notes")
      .select("purchase_id")
      .eq("family_id", familyId)
      .eq("access_key", nota.dados.chave)
      .maybeSingle();
    if (data && data.purchase_id !== compraAtual) {
      return { ok: false, status: 409, erro: "Esta nota já está registrada em outra compra" };
    }
  }
  return { ok: true, nota };
}

/**
 * Grava, troca ou remove a nota de uma compra. Cada compra tem no maximo uma, e trocar de chave
 * para so o numero limpa os campos que vinham da chave.
 */
export async function salvarNotaDaCompra(
  supabase: SupabaseClient,
  params: { familyId: string; purchaseId: string; userId: string; nota: NotaInformada | null },
): Promise<PostgrestError | null> {
  const { familyId, purchaseId, userId, nota } = params;

  if (!nota) {
    const { error } = await supabase.from("fiscal_notes").delete().eq("purchase_id", purchaseId);
    return error;
  }

  const campos =
    nota.tipo === "chave"
      ? {
          access_key: nota.dados.chave,
          model: nota.dados.modelo,
          uf_code: nota.dados.codigoUf,
          series: nota.dados.serie,
          number: nota.dados.numero,
          issuer_cnpj: nota.dados.cnpjEmitente,
          status: "so_chave",
        }
      : {
          access_key: null,
          model: null,
          uf_code: null,
          series: null,
          number: nota.numero,
          issuer_cnpj: null,
          status: "so_numero",
        };

  const { error } = await supabase
    .from("fiscal_notes")
    .upsert({ family_id: familyId, purchase_id: purchaseId, created_by: userId, ...campos }, { onConflict: "purchase_id" });
  return error;
}

/** Mensagem para a chave unica da familia, caso duas pessoas registrem a mesma nota ao mesmo tempo */
export const ERRO_NOTA_REPETIDA = { "23505": "Esta nota já está registrada em outra compra" };
