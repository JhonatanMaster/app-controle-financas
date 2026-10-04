#!/bin/sh
#
# Aplica supabase/migrations no banco local, em ordem, cada arquivo uma unica vez.
#
# O controle usa a mesma tabela do Supabase CLI, supabase_migrations.schema_migrations, entao o
# banco fica no mesmo estado que teria se as migrations tivessem sido aplicadas pelo CLI.

set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
psql_cmd() {
  psql --host db --username postgres --dbname postgres --quiet --no-psqlrc -v ON_ERROR_STOP=1 "$@"
}

psql_cmd <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  inserted_at timestamptz not null default now()
);
SQL

applied=0
for file in /migrations/*.sql; do
  [ -e "$file" ] || continue
  name="$(basename "$file" .sql)"
  version="${name%%_*}"

  if [ "$(psql_cmd --tuples-only --no-align -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")" = "1" ]; then
    echo "ja aplicada   $name"
    continue
  fi

  echo "aplicando     $name"
  psql_cmd --single-transaction \
    -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  applied=$((applied + 1))
done

# O PostgREST guarda o schema em cache; sem este aviso ele nao enxergaria as tabelas novas
psql_cmd -c "notify pgrst, 'reload schema'"

echo "migrations concluidas, $applied aplicada(s) nesta execucao"
