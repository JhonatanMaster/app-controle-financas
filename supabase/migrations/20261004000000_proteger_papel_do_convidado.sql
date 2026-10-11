-- Impede que um convidado se promova a titular ao aceitar o convite.
--
-- A politica de update deixa o convidado alterar a linha do proprio convite, porque e assim que ele
-- aceita, gravando user_id e status. A checagem dela so exige user_id igual ao dele, e titular e
-- justamente quem tem role titular nessa mesma linha, entao o mesmo update que aceita o convite
-- poderia trocar o role e dar ao convidado o poder de convidar e remover membros, inclusive o
-- titular original. Uma politica de RLS nao enxerga o valor anterior da linha, por isso a protecao
-- e um trigger que compara o antes e o depois.

create or replace function private.proteger_campos_do_convite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Papeis administrativos, como o service_role do backend e o dono das migrations, nao passam pela
  -- regra. Ela existe para quem chega pela API autenticado como usuario comum
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if private.is_family_titular(old.family_id) then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.family_id is distinct from old.family_id
     or new.invited_email is distinct from old.invited_email
     or new.invited_at is distinct from old.invited_at
  then
    raise exception 'Somente o titular pode alterar o papel, a família ou o e-mail de um membro'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger proteger_campos_do_convite
  before update on family_members
  for each row execute function private.proteger_campos_do_convite();
