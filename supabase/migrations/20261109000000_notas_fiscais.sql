-- Notas fiscais de compra importadas pelo QR Code ou pela chave de acesso.
--
-- A NFCe (modelo 65) e o cupom do mercado. O QR Code impresso nele aponta para a consulta publica
-- da SEFAZ, que mostra os itens, o total e a forma de pagamento. A API le essa pagina, e a compra
-- nasce preenchida com o que a nota diz. A NFe (modelo 55) tambem e aceita pela chave, mas a
-- consulta dela exige certificado ou captcha, entao entra so com os dados que a propria chave traz.
--
-- A compra continua sendo o registro de gasto. A nota fica ao lado, um para um, guardando o que
-- veio da SEFAZ, inclusive a pagina original para ver e baixar depois.

-- ========== Itens com unidade e total da linha

-- Na nota o item vem com a unidade do jeito que o mercado cadastrou (kg, UN, FR, L) e com o total
-- da linha ja arredondado pelo caixa. Recalcular quantidade vezes preco erraria nos centavos dos
-- itens pesados, entao o total da linha e guardado como veio.
alter table purchase_items
  add column unit text check (unit is null or length(trim(unit)) between 1 and 10),
  add column total_price numeric check (total_price is null or total_price >= 0),
  add column product_code text check (product_code is null or length(product_code) <= 60);

-- Vale para qualquer compra, com ou sem nota, por isso fica na propria compra
alter table purchases
  add column payment_method text check (payment_method is null or length(trim(payment_method)) between 1 and 60);

-- ========== Notas

-- importada quando os itens vieram da SEFAZ, so_chave quando a nota entrou apenas pela chave
create type fiscal_note_status as enum ('importada', 'so_chave');

create table fiscal_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  purchase_id uuid not null unique references purchases(id) on delete cascade,
  access_key text not null check (access_key ~ '^[0-9]{44}$'),
  model smallint not null check (model in (55, 65)),
  status fiscal_note_status not null,
  uf_code smallint not null,
  series integer,
  number integer,
  issuer_name text check (issuer_name is null or length(issuer_name) <= 200),
  issuer_cnpj text check (issuer_cnpj is null or issuer_cnpj ~ '^[0-9]{14}$'),
  issuer_address text check (issuer_address is null or length(issuer_address) <= 300),
  issued_at timestamptz,
  total_value numeric check (total_value is null or total_value >= 0),
  discount_value numeric check (discount_value is null or discount_value >= 0),
  items_count integer check (items_count is null or items_count >= 0),
  -- Uma nota pode ser paga com mais de uma forma, cada elemento traz o nome em method e o valor em value
  payments jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array'),
  authorization_protocol text check (authorization_protocol is null or length(authorization_protocol) <= 30),
  consultation_url text check (consultation_url is null or length(consultation_url) <= 1000),
  -- Pagina da consulta publica como a SEFAZ devolveu, sem scripts, para ver e baixar a nota completa
  source_html text check (source_html is null or length(source_html) <= 2000000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A mesma nota lida duas vezes duplicaria o gasto
  unique (family_id, access_key)
);

create index idx_fiscal_notes_created_by on fiscal_notes(created_by);

alter table fiscal_notes enable row level security;

-- Sem politica de update de proposito. A nota e o retrato do que a SEFAZ devolveu, e corrigir um
-- valor se faz na compra, onde o historico do valor registra a mudanca
create policy "members can view fiscal notes" on fiscal_notes
  for select using (private.is_family_member(family_id));

create policy "members can insert fiscal notes" on fiscal_notes
  for insert with check (
    private.is_family_member(family_id)
    and created_by = (select auth.uid())
    and exists (select 1 from purchases p where p.id = purchase_id and p.family_id = fiscal_notes.family_id)
  );

create policy "members can delete fiscal notes" on fiscal_notes
  for delete using (private.is_family_member(family_id));

-- ========== Importacao atomica

-- Compra, itens e nota precisam nascer juntos. Feito em tres chamadas pela API, uma falha no meio
-- deixaria uma compra sem itens ou sem nota, e a nota repetida so seria percebida depois de a
-- compra ja existir. Security invoker, entao o RLS de cada tabela vale como numa escrita comum.
create or replace function public.importar_nota_fiscal(p_family_id uuid, p_nota jsonb, p_itens jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_total numeric := (p_nota ->> 'total_value')::numeric;
begin
  if jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'Itens da nota em formato inválido';
  end if;

  if exists (select 1 from fiscal_notes where family_id = p_family_id and access_key = p_nota ->> 'access_key') then
    raise exception 'Esta nota já foi registrada';
  end if;

  -- Ja passou no caixa, entao nasce finalizada. Sem total, como na entrada so pela chave, fica
  -- com o valor pendente para informar depois pelo fluxo que ja existe
  insert into purchases (family_id, purchase_date, type, total_value, value_status, finalized_at, notes, payment_method, created_by)
  values (
    p_family_id,
    coalesce((p_nota ->> 'purchase_date')::date, current_date),
    'avulsa',
    v_total,
    case when v_total is null then 'pendente'::purchase_value_status else 'definido'::purchase_value_status end,
    now(),
    nullif(left(p_nota ->> 'issuer_name', 200), ''),
    nullif(p_nota ->> 'payment_method', ''),
    auth.uid()
  )
  returning id into v_purchase_id;

  insert into purchase_items (purchase_id, item_name, quantity, unit, unit_price, total_price, product_code)
  select
    v_purchase_id,
    item ->> 'name',
    (item ->> 'quantity')::numeric,
    nullif(item ->> 'unit', ''),
    (item ->> 'unit_price')::numeric,
    (item ->> 'total_price')::numeric,
    nullif(item ->> 'product_code', '')
  from jsonb_array_elements(p_itens) as item;

  insert into fiscal_notes (
    family_id, purchase_id, access_key, model, status, uf_code, series, number,
    issuer_name, issuer_cnpj, issuer_address, issued_at, total_value, discount_value, items_count,
    payments, authorization_protocol, consultation_url, source_html, created_by
  )
  values (
    p_family_id,
    v_purchase_id,
    p_nota ->> 'access_key',
    (p_nota ->> 'model')::smallint,
    (p_nota ->> 'status')::fiscal_note_status,
    (p_nota ->> 'uf_code')::smallint,
    (p_nota ->> 'series')::integer,
    (p_nota ->> 'number')::integer,
    p_nota ->> 'issuer_name',
    p_nota ->> 'issuer_cnpj',
    p_nota ->> 'issuer_address',
    (p_nota ->> 'issued_at')::timestamptz,
    v_total,
    (p_nota ->> 'discount_value')::numeric,
    (p_nota ->> 'items_count')::integer,
    coalesce(p_nota -> 'payments', '[]'::jsonb),
    p_nota ->> 'authorization_protocol',
    p_nota ->> 'consultation_url',
    p_nota ->> 'source_html',
    auth.uid()
  );

  return v_purchase_id;
end;
$$;

revoke execute on function public.importar_nota_fiscal(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.importar_nota_fiscal(uuid, jsonb, jsonb) to authenticated;
