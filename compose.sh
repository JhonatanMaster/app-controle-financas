#!/bin/sh
#
# Atalho para o docker compose que monta a combinacao de arquivos certa para o ambiente.
#
# Duas perguntas, respondidas pela propria configuracao presente.
#
#   De onde vem o banco, pela SUPABASE_URL do backend/.env. Um projeto hospedado dispensa os
#   containers de banco. Ausente, vazia ou apontando para a propria maquina acrescenta o
#   docker-compose.local.yml, com Postgres, GoTrue e PostgREST.
#
#   Como o app e publicado, pelo FRONTEND_HOST do .env da raiz. Com dominio definido acrescenta o
#   docker-compose.traefik.yml, que troca as portas do host por rotas no Traefik. Sem ele, o app
#   fica nas portas locais.
#
# A conexao e lida do backend/.env porque e o arquivo que o compose entrega ao container, e o
# dominio do .env da raiz porque e de la que o compose tira o resto da configuracao de ambiente.
#
# Recebe os mesmos argumentos do docker compose, por exemplo
#   ./compose.sh up --build -d
#   ./compose.sh logs -f backend
#   ./compose.sh down

set -eu

cd "$(dirname "$0")"

valor_de() {
  arquivo="$2"
  [ -f "$arquivo" ] || return 0

  # Ultima atribuicao valendo, ignorando linha comentada, aspas e espacos em volta
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$arquivo" |
    tail -n 1 |
    tr -d '"'\''' |
    sed 's/[[:space:]]*$//'
}

arquivos="-f docker-compose.yml"
origem_do_banco="Supabase hospedado"
publicacao="nas portas locais"

case "$(valor_de SUPABASE_URL backend/.env)" in
  # Vazia, ausente ou apontando para a propria maquina significa que o banco precisa ser criado
  "" | *localhost* | *127.0.0.1* | *'[::1]'* | *//gateway:*)
    arquivos="$arquivos -f docker-compose.local.yml"
    origem_do_banco="banco local em containers"
    ;;
esac

dominio="$(valor_de FRONTEND_HOST .env)"
if [ -n "$dominio" ]; then
  arquivos="$arquivos -f docker-compose.traefik.yml"
  publicacao="em https://$dominio pelo Traefik"
fi

echo "Subindo com $origem_do_banco, $publicacao"
exec docker compose $arquivos "$@"
