-- Senhas dos papeis internos do Supabase. A imagem cria os papeis sem senha, e sem isto o
-- GoTrue e o PostgREST nao conseguem se conectar. Usado so no ambiente local.
--
-- A lista cobre os papeis das variantes da imagem, e so recebe senha quem existir de fato.
-- Um ALTER ROLE sobre papel inexistente interrompe o migrate.sh da propria imagem, que roda
-- este arquivo, e o banco fica sem as migrations seguintes. O sintoma e o GoTrue reiniciando
-- sem parar com "must be owner of function uid", porque quem ajusta o dono das funcoes do
-- schema auth e justamente uma dessas migrations.
\set pgpass `echo "$POSTGRES_PASSWORD"`

select format('alter role %I with password %L', rolname, :'pgpass')
from pg_roles
where rolname in (
  'authenticator',
  'pgbouncer',
  'supabase_auth_admin',
  'supabase_functions_admin',
  'supabase_storage_admin'
)
order by rolname
\gexec
