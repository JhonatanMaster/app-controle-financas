-- Abastecimentos de combustivel, um registro por abastecimento do carro de cada pessoa.
--
-- Cada um tem o proprio carro, entao o registro pertence a quem lancou. Por padrao cada pessoa ve
-- so os seus. Quando o titular habilita o compartilhamento, a familia inteira passa a ver todos.

create type tipo_combustivel as enum ('alcool', 'gasolina');

alter table families
  add column abastecimentos_compartilhados boolean not null default false;

create table fuel_fills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  fill_date date not null default current_date,
  fuel_type tipo_combustivel not null,
  value numeric not null check (value > 0),
  station_name text check (station_name is null or length(trim(station_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create index idx_fuel_fills_family_date on fuel_fills(family_id, fill_date);
create index idx_fuel_fills_created_by on fuel_fills(created_by);

-- ========== Funcao de visibilidade (schema private, fora da API REST)

create or replace function private.abastecimentos_compartilhados(target_family_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from families f
    where f.id = target_family_id
      and f.abastecimentos_compartilhados
  );
$$;

grant execute on function private.abastecimentos_compartilhados(uuid) to authenticated;

-- ========== Row Level Security

alter table fuel_fills enable row level security;

-- Le o proprio registro sempre, e os da familia so quando o titular compartilha
create policy "members can view own or shared fuel fills" on fuel_fills
  for select using (
    private.is_family_member(family_id)
    and (created_by = (select auth.uid()) or private.abastecimentos_compartilhados(family_id))
  );

-- So se registra e so se altera ou apaga o proprio abastecimento, mesmo em familia compartilhada
create policy "members can insert own fuel fills" on fuel_fills
  for insert with check (
    private.is_family_member(family_id)
    and created_by = (select auth.uid())
  );

create policy "members can update own fuel fills" on fuel_fills
  for update
  using (private.is_family_member(family_id) and created_by = (select auth.uid()))
  with check (private.is_family_member(family_id) and created_by = (select auth.uid()));

create policy "members can delete own fuel fills" on fuel_fills
  for delete using (private.is_family_member(family_id) and created_by = (select auth.uid()));
