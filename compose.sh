#!/bin/sh
#
# Atalho para o docker compose que decide sozinho de onde vem o banco.
#
# Com SUPABASE_URL de um projeto hospedado em backend/.env, sobe apenas backend e frontend,
# ligados nesse projeto. Sem ela, ou apontando para a propria maquina, acrescenta o
# docker-compose.local.yml, que poe Postgres, GoTrue e PostgREST em containers.
#
# A fonte e so o backend/.env porque e exatamente o arquivo que o compose entrega ao container.
# Exportar a variavel no shell nao mudaria o que o backend recebe, entao tambem nao muda a escolha.
#
# Recebe os mesmos argumentos do docker compose, por exemplo
#   ./compose.sh up --build -d
#   ./compose.sh logs -f backend
#   ./compose.sh down

set -eu

cd "$(dirname "$0")"

url_do_supabase() {
  [ -f backend/.env ] || return 0

  # Ultima atribuicao valendo, ignorando linha comentada, aspas e espacos em volta
  sed -n 's/^[[:space:]]*SUPABASE_URL[[:space:]]*=[[:space:]]*//p' backend/.env |
    tail -n 1 |
    tr -d '"'\''' |
    sed 's/[[:space:]]*$//'
}

url="$(url_do_supabase)"

case "$url" in
  # Vazia, ausente ou apontando para a propria maquina significa que o banco precisa ser criado
  "" | *localhost* | *127.0.0.1* | *'[::1]'* | *//gateway:*)
    echo "Sem Supabase hospedado em backend/.env, subindo tambem o banco local em containers"
    exec docker compose -f docker-compose.yml -f docker-compose.local.yml "$@"
    ;;
  *)
    echo "Supabase hospedado configurado em backend/.env, subindo so a aplicacao"
    exec docker compose -f docker-compose.yml "$@"
    ;;
esac
