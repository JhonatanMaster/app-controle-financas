-- Historico do valor das compras e protecao do rateio quando o total muda.
--
-- O valor de uma compra pode precisar de correcao depois de informado, por exemplo quando alguem
-- digita errado no caixa. A correcao precisa deixar rastro, com o valor antigo, quem mudou e
-- quando, e o rastro nao pode depender de cada caminho de escrita lembrar de grava-lo. Por isso o
-- registro e feito por trigger, e a tabela nao aceita escrita pela API.
--
-- Ate aqui a regra de que a soma do rateio nunca passa do total so era conferida quando o rateio
-- mudava. Com o total editavel ela tambem precisa valer quando o total muda.

create table purchase_value_changes (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  -- Nulo quando e o primeiro valor informado, e nao uma correcao
  old_value numeric,
  new_value numeric,
  changed_by uuid references auth.users(id) on delete set null,
  -- Copiado no momento da mudanca para o historico seguir legivel se a pessoa sair da familia
  changed_by_name text,
  changed_at timestamptz not null default now()
);

create index idx_purchase_value_changes_purchase on purchase_value_changes(purchase_id, changed_at);
create index idx_purchase_value_changes_family_id on purchase_value_changes(family_id);
create index idx_purchase_value_changes_changed_by on purchase_value_changes(changed_by);

alter table purchase_value_changes enable row level security;

-- Sem politica de escrita de proposito. Quem grava e o trigger abaixo, como security definer, e
-- ninguem altera ou apaga o historico pela API
create policy "members can view purchase value changes" on purchase_value_changes
  for select using (private.is_family_member(family_id));

-- ========== Rateio

create or replace function private.check_purchase_total_against_splits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sum numeric;
  v_tem_rateio boolean;
begin
  if new.total_value is not null and new.total_value < 0 then
    raise exception 'O valor da compra não pode ser negativo';
  end if;

  select coalesce(sum(amount), 0), count(*) > 0
    into v_sum, v_tem_rateio
  from purchase_splits
  where purchase_id = new.id;

  -- Sem rateio nao ha soma a respeitar, e o status segue como estava
  if not v_tem_rateio then
    return new;
  end if;

  if new.total_value is null or new.total_value < v_sum then
    raise exception 'O novo valor (R$ %) é menor que o total já rateado (R$ %). Ajuste o rateio antes de reduzir o valor.',
      replace(to_char(coalesce(new.total_value, 0), 'FM999999990.00'), '.', ','),
      replace(to_char(v_sum, 'FM999999990.00'), '.', ',');
  end if;

  new.rateio_status := case when v_sum = new.total_value then 'fechado' else 'pendente' end;
  return new;
end;
$$;

create trigger purchases_check_total_against_splits
before update of total_value on purchases
for each row
when (old.total_value is distinct from new.total_value)
execute function private.check_purchase_total_against_splits();

-- ========== Historico

create or replace function private.registrar_valor_da_compra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_autor uuid := auth.uid();
  v_nome text;
begin
  -- Um unico trigger cobre insert e update, e o WHEN de um trigger assim nao pode citar OLD
  if tg_op = 'UPDATE' and old.total_value is not distinct from new.total_value then
    return null;
  end if;
  if tg_op = 'INSERT' and new.total_value is null then
    return null;
  end if;

  select coalesce(fm.display_name, fm.invited_email)
    into v_nome
  from family_members fm
  where fm.family_id = new.family_id
    and fm.user_id = v_autor;

  insert into purchase_value_changes (purchase_id, family_id, old_value, new_value, changed_by, changed_by_name)
  values (
    new.id,
    new.family_id,
    case when tg_op = 'UPDATE' then old.total_value end,
    new.total_value,
    v_autor,
    v_nome
  );

  return null;
end;
$$;

create trigger purchases_registrar_valor
after insert or update of total_value on purchases
for each row
execute function private.registrar_valor_da_compra();
