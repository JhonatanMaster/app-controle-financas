-- Schema completo do Controle Financas para um projeto Supabase novo.
-- Rode no SQL Editor do Supabase (ou via supabase db push) uma unica vez.

-- ========== Enums

create type family_member_role as enum ('titular', 'membro');
create type family_member_status as enum ('convidado', 'ativo');
create type purchase_type as enum ('reposicao', 'avulsa');
create type purchase_value_status as enum ('pendente', 'definido');

-- ========== Tabelas

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  invited_email text not null,
  display_name text,
  role family_member_role not null default 'membro',
  status family_member_status not null default 'convidado',
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (family_id, invited_email)
);

-- Pessoas do rateio. Podem nao ter login (ex. filho pequeno)
create table people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  linked_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table stock_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  unit text not null default 'un',
  min_quantity numeric not null default 0,
  ideal_quantity numeric not null default 0,
  current_quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_quantity >= 0 and ideal_quantity >= min_quantity and current_quantity >= 0)
);

create table stock_consumption_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  consumed_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  purchase_date date not null default current_date,
  type purchase_type not null default 'reposicao',
  total_value numeric,
  value_status purchase_value_status not null default 'pendente',
  rateio_status text not null default 'pendente' check (rateio_status in ('pendente', 'fechado')),
  finalized_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  stock_item_id uuid references stock_items(id) on delete set null,
  item_name text not null,
  quantity numeric not null default 1,
  unit_price numeric,
  created_at timestamptz not null default now()
);

create table purchase_splits (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_id, person_id)
);

create table bill_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  unique (family_id, name)
);

create table bills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  category_id uuid not null references bill_categories(id) on delete restrict,
  reference_month date not null,
  total_value numeric not null,
  rateio_status text not null default 'pendente' check (rateio_status in ('pendente', 'fechado')),
  due_date date,
  created_at timestamptz not null default now()
);

create table bill_splits (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (bill_id, person_id)
);

-- ========== Indices

create index idx_bill_splits_person_id on bill_splits(person_id);
create index idx_bills_category_id on bills(category_id);
create index idx_bills_family_id on bills(family_id);
create index idx_families_owner_user_id on families(owner_user_id);
create index idx_family_members_user_id on family_members(user_id);
create index idx_people_family_id on people(family_id);
create index idx_people_linked_member_id on people(linked_member_id);
create index idx_purchase_items_purchase_id on purchase_items(purchase_id);
create index idx_purchase_items_stock_item_id on purchase_items(stock_item_id);
create index idx_purchase_splits_person_id on purchase_splits(person_id);
create index idx_purchases_created_by on purchases(created_by);
create index idx_purchases_family_id on purchases(family_id);
create index idx_purchases_family_finalized on purchases(family_id, finalized_at);
create index idx_stock_consumption_events_created_by on stock_consumption_events(created_by);
create index idx_stock_consumption_events_family_id on stock_consumption_events(family_id);
create index idx_stock_consumption_events_stock_item_id on stock_consumption_events(stock_item_id);
create index idx_stock_items_family_id on stock_items(family_id);

-- ========== Funcoes de autorizacao (schema private, fora da API REST)

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_family_member(target_family_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
      and fm.status = 'ativo'
  );
$$;

create or replace function private.is_family_titular(target_family_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
      and fm.status = 'ativo'
      and fm.role = 'titular'
  );
$$;

grant execute on function private.is_family_member(uuid) to authenticated;
grant execute on function private.is_family_titular(uuid) to authenticated;

-- ========== Triggers

-- Quem cria a familia ja entra como titular ativo
create or replace function private.handle_new_family()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into family_members (family_id, user_id, invited_email, role, status, joined_at)
  values (
    new.id,
    new.owner_user_id,
    (select email from auth.users where id = new.owner_user_id),
    'titular',
    'ativo',
    now()
  );
  return new;
end;
$$;

create trigger on_family_created
after insert on families
for each row execute function private.handle_new_family();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stock_items_set_updated_at
before update on stock_items
for each row execute function public.set_updated_at();

-- Consumo decrementa o estoque atual
create or replace function private.apply_stock_consumption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update stock_items
    set current_quantity = current_quantity - new.quantity
    where id = new.stock_item_id;
  return new;
end;
$$;

create trigger stock_consumption_events_apply
after insert on stock_consumption_events
for each row execute function private.apply_stock_consumption();

-- Ao finalizar a compra o estoque dos itens comprados sobe, uma unica vez
create or replace function private.apply_purchase_stock_increment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update stock_items si
    set current_quantity = si.current_quantity + pi.quantity
    from purchase_items pi
    where pi.purchase_id = new.id
      and pi.stock_item_id = si.id;
  return new;
end;
$$;

create trigger purchases_apply_stock_increment
after update on purchases
for each row
when (old.finalized_at is null and new.finalized_at is not null)
execute function private.apply_purchase_stock_increment();

-- Rateio de compras. Bloqueia soma acima do total e fecha quando a soma iguala o total
create or replace function private.check_purchase_split_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase purchases%rowtype;
  v_sum_others numeric;
begin
  select * into v_purchase from purchases where id = new.purchase_id;

  if v_purchase.value_status <> 'definido' then
    raise exception 'Nao e possivel ratear, a compra ainda nao tem valor definido';
  end if;

  select coalesce(sum(amount), 0) into v_sum_others
  from purchase_splits
  where purchase_id = new.purchase_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_sum_others + new.amount > v_purchase.total_value then
    raise exception 'Soma do rateio (%) excede o valor total da compra (%)',
      v_sum_others + new.amount, v_purchase.total_value;
  end if;

  return new;
end;
$$;

create trigger purchase_splits_before_write
before insert or update on purchase_splits
for each row execute function private.check_purchase_split_before_write();

create or replace function private.sync_purchase_rateio_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_total numeric;
  v_sum numeric;
begin
  v_purchase_id := coalesce(new.purchase_id, old.purchase_id);
  select total_value into v_total from purchases where id = v_purchase_id;
  select coalesce(sum(amount), 0) into v_sum from purchase_splits where purchase_id = v_purchase_id;

  update purchases
    set rateio_status = case when v_sum = v_total then 'fechado' else 'pendente' end
    where id = v_purchase_id;

  return null;
end;
$$;

create trigger purchase_splits_sync_status
after insert or update or delete on purchase_splits
for each row execute function private.sync_purchase_rateio_status();

-- Rateio de contas, mesma regra
create or replace function private.check_bill_split_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill bills%rowtype;
  v_sum_others numeric;
begin
  select * into v_bill from bills where id = new.bill_id;

  select coalesce(sum(amount), 0) into v_sum_others
  from bill_splits
  where bill_id = new.bill_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_sum_others + new.amount > v_bill.total_value then
    raise exception 'Soma do rateio (%) excede o valor total da conta (%)',
      v_sum_others + new.amount, v_bill.total_value;
  end if;

  return new;
end;
$$;

create trigger bill_splits_before_write
before insert or update on bill_splits
for each row execute function private.check_bill_split_before_write();

create or replace function private.sync_bill_rateio_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill_id uuid;
  v_total numeric;
  v_sum numeric;
begin
  v_bill_id := coalesce(new.bill_id, old.bill_id);
  select total_value into v_total from bills where id = v_bill_id;
  select coalesce(sum(amount), 0) into v_sum from bill_splits where bill_id = v_bill_id;

  update bills
    set rateio_status = case when v_sum = v_total then 'fechado' else 'pendente' end
    where id = v_bill_id;

  return null;
end;
$$;

create trigger bill_splits_sync_status
after insert or update or delete on bill_splits
for each row execute function private.sync_bill_rateio_status();

-- ========== View da lista de compras automatica

create view shopping_list
with (security_invoker = true)
as
select
  id as stock_item_id,
  family_id,
  name,
  unit,
  min_quantity,
  ideal_quantity,
  current_quantity,
  (ideal_quantity - current_quantity) as suggested_quantity
from stock_items
where current_quantity <= min_quantity;

-- ========== Row Level Security

alter table families enable row level security;
alter table family_members enable row level security;
alter table people enable row level security;
alter table stock_items enable row level security;
alter table stock_consumption_events enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table purchase_splits enable row level security;
alter table bill_categories enable row level security;
alter table bills enable row level security;
alter table bill_splits enable row level security;

create policy "members can view their family" on families
  for select using (owner_user_id = (select auth.uid()) or private.is_family_member(id));
create policy "titular can update family" on families
  for update using (private.is_family_titular(id));
create policy "authenticated users can create a family" on families
  for insert with check (owner_user_id = (select auth.uid()));

create policy "members can view family_members" on family_members
  for select using (
    user_id = (select auth.uid())
    or private.is_family_member(family_id)
    or (user_id is null and invited_email = (select auth.jwt() ->> 'email'))
  );
create policy "titular inserts family_members" on family_members
  for insert with check (private.is_family_titular(family_id));
create policy "titular or invited self can update family_members" on family_members
  for update
  using (
    private.is_family_titular(family_id)
    or (user_id is null and invited_email = (select auth.jwt() ->> 'email'))
  )
  with check (
    private.is_family_titular(family_id)
    or (user_id = (select auth.uid()))
  );
create policy "titular deletes family_members" on family_members
  for delete using (private.is_family_titular(family_id));

create policy "members can manage people" on people
  for all using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));

create policy "members can manage stock_items" on stock_items
  for all using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));

create policy "members can manage stock_consumption_events" on stock_consumption_events
  for all using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));

create policy "members can manage purchases" on purchases
  for all using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));

create policy "members can manage purchase_items" on purchase_items
  for all
  using (private.is_family_member((select family_id from purchases p where p.id = purchase_id)))
  with check (private.is_family_member((select family_id from purchases p where p.id = purchase_id)));

create policy "members can manage purchase_splits" on purchase_splits
  for all
  using (private.is_family_member((select family_id from purchases p where p.id = purchase_id)))
  with check (private.is_family_member((select family_id from purchases p where p.id = purchase_id)));

create policy "members can manage bill_categories" on bill_categories
  for all using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));

create policy "members can manage bills" on bills
  for all using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));

create policy "members can manage bill_splits" on bill_splits
  for all
  using (private.is_family_member((select family_id from bills b where b.id = bill_id)))
  with check (private.is_family_member((select family_id from bills b where b.id = bill_id)));
