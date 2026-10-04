import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O RLS libera os grupos de todas as familias de que a pessoa participa, entao quem
 * pertence a duas casas conseguiria marcar um item com o grupo da outra sem esta checagem.
 */
export async function groupBelongsToFamily(supabase: SupabaseClient, familyId: string, groupId: string) {
  const { data } = await supabase
    .from("stock_groups")
    .select("id")
    .eq("id", groupId)
    .eq("family_id", familyId)
    .maybeSingle();

  return Boolean(data);
}
