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
  created_at: string;
  purchase_items: { count: number }[];
};

export type PurchaseItem = {
  id: string;
  stock_item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number | null;
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

export type PurchaseDetail = Omit<PurchaseSummary, "purchase_items"> & {
  family_id: string;
  purchase_items: PurchaseItem[];
  purchase_splits: PurchaseSplit[];
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

export type Person = {
  id: string;
  name: string;
  linked_member_id: string | null;
  created_at: string;
};
