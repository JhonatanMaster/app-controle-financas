export type Membership = {
  family_id: string;
  role: "titular" | "membro";
  display_name: string | null;
  families: { name: string } | null;
};

export type Me = {
  id: string;
  email: string;
  families: Membership[];
};

export type StockGroup = {
  id: string;
  name: string;
  sort_order: number;
};

export type StockItem = {
  id: string;
  family_id: string;
  name: string;
  unit: string;
  min_quantity: number;
  ideal_quantity: number;
  current_quantity: number;
  group_id: string | null;
  stock_groups: StockGroup | null;
  created_at: string;
  updated_at: string;
};

export type ShoppingListItem = {
  stock_item_id: string;
  family_id: string;
  name: string;
  unit: string;
  min_quantity: number;
  ideal_quantity: number;
  current_quantity: number;
  suggested_quantity: number;
  group_id: string | null;
  group_name: string | null;
  group_sort_order: number | null;
};

export type PurchaseSummary = {
  id: string;
  purchase_date: string;
  type: "reposicao" | "avulsa";
  total_value: number | null;
  value_status: "pendente" | "definido";
  rateio_status: "pendente" | "fechado";
  finalized_at: string | null;
  notes: string | null;
  /** Opcional porque uma compra guardada no aparelho antes desta versao chega sem o campo */
  payment_method?: string | null;
  created_at: string;
  purchase_items: { count: number }[];
  fiscal_notes?: Embutido<Pick<FiscalNote, "id" | "model" | "status" | "issuer_name">>;
};

/**
 * Relacao um para um embutida pelo PostgREST. Ele devolve objeto quando reconhece a chave unica e
 * lista nos demais casos, entao quem le usa umSo() em vez de confiar no formato.
 */
export type Embutido<T> = T | T[] | null;

export function umSo<T>(valor: Embutido<T> | undefined): T | null {
  if (!valor) return null;
  return Array.isArray(valor) ? (valor[0] ?? null) : valor;
}

export type FiscalNotePayment = { method: string; value: number };

/** Nota fiscal lida pelo QR Code ou registrada pela chave de acesso */
export type FiscalNote = {
  id: string;
  access_key: string;
  /** 65 para NFCe, o cupom do mercado, e 55 para NFe */
  model: 55 | 65;
  /** importada quando os itens vieram da SEFAZ, so_chave quando entrou apenas pela chave */
  status: "importada" | "so_chave";
  uf_code: number;
  series: number | null;
  number: number | null;
  issuer_name: string | null;
  issuer_cnpj: string | null;
  issuer_address: string | null;
  issued_at: string | null;
  total_value: number | null;
  discount_value: number | null;
  items_count: number | null;
  payments: FiscalNotePayment[];
  authorization_protocol: string | null;
  consultation_url: string | null;
  created_at: string;
};

export type PurchaseItem = {
  id: string;
  stock_item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number | null;
  /** Os tres campos abaixo so existem em itens vindos de nota fiscal */
  unit?: string | null;
  total_price?: number | null;
  product_code?: string | null;
  group_id: string | null;
  stock_groups: StockGroup | null;
  stock_items: {
    unit: string;
    ideal_quantity: number;
    current_quantity: number;
    stock_groups: StockGroup | null;
  } | null;
};

export type PurchaseSplit = {
  id: string;
  person_id: string;
  amount: number;
  people: { name: string } | null;
};

/** Cada vez que o valor de uma compra foi informado ou corrigido */
export type PurchaseValueChange = {
  id: string;
  /** Nulo quando foi o primeiro valor informado, e nao uma correcao */
  old_value: number | null;
  new_value: number | null;
  changed_by_name: string | null;
  changed_at: string;
};

export type PurchaseDetail = Omit<PurchaseSummary, "purchase_items" | "fiscal_notes"> & {
  family_id: string;
  purchase_items: PurchaseItem[];
  purchase_splits: PurchaseSplit[];
  // Opcional porque uma compra guardada no aparelho antes desta versao chega sem o campo
  purchase_value_changes?: PurchaseValueChange[];
  fiscal_notes?: Embutido<FiscalNote>;
};

export type FamilyMember = {
  id: string;
  invited_email: string;
  display_name: string | null;
  role: "titular" | "membro";
  status: "convidado" | "ativo";
  invited_at: string;
  joined_at: string | null;
};

export type FuelType = "alcool" | "gasolina";

export type FuelFill = {
  id: string;
  created_by: string;
  /** Nome de quem lancou, para mostrar na lista quando os registros sao compartilhados */
  author_name: string | null;
  fill_date: string;
  fuel_type: FuelType;
  value: number;
  station_name: string | null;
  created_at: string;
};

/** Abastecimentos visiveis para quem pediu, junto com a configuracao de compartilhamento */
export type FuelResponse = {
  shared: boolean;
  isTitular: boolean;
  userId: string;
  userName: string | null;
  fills: FuelFill[];
};

export type Person = {
  id: string;
  name: string;
  linked_member_id: string | null;
  created_at: string;
};
