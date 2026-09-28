# Controle Finanças

Web app para organizar as finanças de uma casa em família: controla o estoque da despensa,
monta a lista de compras sozinho, acompanha as compras no mercado e divide as despesas entre
os moradores.

## A dor que ele resolve

Quem cuida das compras da casa conhece o ciclo: descobre que o arroz acabou na hora de cozinhar,
vai ao mercado sem lista e compra por intuição, esquece itens, compra em excesso outros, e no fim
do mês ninguém sabe quanto foi gasto nem quem pagou o quê.

Apps de finanças pessoais registram o dinheiro depois que ele já saiu. O Controle Finanças age
antes: ele sabe o que tem na despensa, avisa o que está acabando e entrega a lista pronta quando
você chega ao mercado. E como a casa é compartilhada, o app também é: cada membro da família
acessa os mesmos dados e as despesas podem ser rateadas.

## A ideia base

Cada item da despensa tem dois números definidos por você:

- **mínimo**: quando o estoque chega nele, é hora de repor
- **ideal**: quanto você gosta de ter em casa

Exemplo: arroz com mínimo 1 e ideal 3. Você cadastra e o app assume que tem 3 pacotes. Toda vez
que abre um pacote, clica em "Abri 1". Quando sobra só 1, o arroz entra automaticamente no
carrinho com a sugestão de comprar 2 (o ideal menos o que ainda tem). Se zerar, a sugestão vira 3.

No mercado, você abre o carrinho no celular, ajusta com os botões de mais e menos conforme coloca
os produtos no carrinho físico (pode levar mais ou menos que o sugerido) e, ao passar no caixa,
clica em "Finalizar". O estoque é atualizado com o que você comprou de fato. O valor pago pode ser
informado na hora ou depois.

A partir daí entram as outras peças: compras avulsas (alguém passou no mercado fora da lista),
rateio de cada compra e das contas da casa entre as pessoas, e comparativos de gastos por mês.

## Funcionalidades

Prontas nesta versão:

- Cadastro do titular e criação da família
- Convite de membros por e-mail, que criam a própria senha pelo link
- Recuperação de senha por e-mail
- Estoque com mínimo, ideal, quantidade atual e botão de consumo
- Lista de compras automática
- Modo mercado com ajuste de quantidades, itens extras e finalização
- Compras avulsas, só com o valor ou detalhadas por item
- Histórico de compras com valor pendente para preencher depois
- Rateio de compras por pessoa, com a soma obrigatoriamente igual ao total (API pronta, tela em desenvolvimento)

Próximas etapas: tela de rateio, contas da casa (água, luz, internet, gás e outras) com rateio,
e comparativos de gastos por pessoa, por mês e de itens consumidos.

## Como funciona por dentro

```
/frontend   Next.js 16, React 19, Tailwind 4. Interface web responsiva.
/backend    Fastify + TypeScript. API REST, regras de negócio, e-mails.
/supabase   schema.sql com tabelas, triggers e políticas de segurança.
```

- O **frontend** nunca fala com o banco. Toda leitura e escrita passa pela API do backend, e a
  sessão fica em cookies httpOnly. Nenhuma credencial do Supabase chega ao navegador.
- O **backend** autentica o usuário no Supabase Auth e, nas demais chamadas, acessa o banco com o
  token do próprio usuário. Assim as políticas de Row Level Security do Postgres continuam valendo:
  mesmo que uma rota tenha um bug, uma família não consegue ler dados de outra.
- O **banco** (Postgres no Supabase) guarda as regras que não podem falhar: o consumo decrementa o
  estoque, finalizar uma compra incrementa o estoque uma única vez, e o rateio bloqueia qualquer
  soma acima do total.
- Os **e-mails** de convite e recuperação de senha são enviados pelo Resend. O Resend só entrega;
  o conteúdo e a lógica ficam no backend.

## Rodando localmente

### Pré requisitos

- Node.js 22 ou superior
- Uma conta no [Supabase](https://supabase.com) com um projeto criado
- Uma conta no [Resend](https://resend.com) com um domínio verificado (ou use o domínio de testes
  do Resend para enviar só para o seu próprio e-mail)

### 1. Banco de dados

No painel do Supabase, abra o SQL Editor e execute o conteúdo de `supabase/schema.sql`. Ele cria
todas as tabelas, triggers, a view da lista de compras e as políticas de segurança.

Depois copie, em Project Settings, API Keys:

- a URL do projeto
- a chave `anon` (ou `publishable`)
- a chave `service_role` (esta nunca deve ir para o frontend nem para o Git)

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Preencha o `.env`:

```env
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
COOKIE_SECRET=uma-frase-longa-e-aleatoria
COOKIE_DOMAIN=

SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Controle Financas <no-reply@seudominio.com>
APP_BASE_URL=http://localhost:3000
```

`COOKIE_DOMAIN` fica vazio em localhost. `APP_BASE_URL` é usado para montar os links dos e-mails.
A API sobe em `http://localhost:4000` e responde `{"ok":true}` em `/health`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

O arquivo `frontend/.env.local` já aponta para `http://localhost:4000`. Abra
`http://localhost:3000`, crie sua conta e comece cadastrando itens no Estoque.

### Fluxo de teste sugerido

1. Criar conta em `/criar-conta` (você vira o titular da família)
2. Em Estoque, cadastrar "Arroz" com mínimo 1 e ideal 3
3. Clicar "Abri 1" duas vezes e ver o item entrar no carrinho com sugestão de 2
4. Em Compras, "Ir ao mercado", ajustar a quantidade, "Finalizar compra" informando o valor
5. Voltar ao Estoque e ver a quantidade atualizada
6. Em Família, convidar alguém por e-mail e aceitar o convite pelo link recebido

## Rodando com Docker (produção)

O `docker-compose.yml` sobe `backend` e `frontend` sem publicar portas no host. Os containers
entram em uma rede externa onde já existe um **Traefik** (por exemplo o do Dokploy) e carregam
labels que criam as rotas: um host para o frontend, outro para a API, HTTPS via Let's Encrypt e
redirecionamento de http para https.

Pré requisitos no servidor:

- Traefik com provider Docker habilitado, entrypoints `web` (80) e `websecure` (443) e um
  certresolver chamado `letsencrypt`. É a configuração padrão do Dokploy.
- Registros DNS tipo A para o host do frontend e o host da API apontando para o servidor.

Passos:

```bash
git clone <seu-fork> && cd <pasta>
cp .env.example .env              # FRONTEND_HOST, API_HOST e PROXY_NETWORK
cp backend/.env.example backend/.env   # chaves do Supabase, Resend e URLs em https
docker compose up -d --build
```

No `backend/.env` use `FRONTEND_ORIGIN` e `APP_BASE_URL` com `https://` + `FRONTEND_HOST`, e
`COOKIE_DOMAIN` com o domínio pai que abrange os dois hosts (ex.: `.app.seudominio.com` para
`app.seudominio.com` e `api.app.seudominio.com`).

Para atualizar depois de um `git pull`, rode `docker compose up -d --build` de novo. A URL da API
é embutida no build do frontend a partir de `API_HOST`, então mudanças nela exigem rebuild.

Se o Traefik do seu servidor usar outros nomes de entrypoint ou de certresolver, ajuste as labels
no `docker-compose.yml`.

## Estrutura de dados resumida

| Tabela | Para que serve |
|---|---|
| `families`, `family_members` | Família e quem tem acesso (titular e membros convidados) |
| `people` | Pessoas do rateio, com ou sem login |
| `stock_items`, `stock_consumption_events` | Itens da despensa e registro de consumo |
| `purchases`, `purchase_items`, `purchase_splits` | Compras, itens do carrinho e rateio |
| `bill_categories`, `bills`, `bill_splits` | Contas da casa e rateio (próxima fase) |
| view `shopping_list` | Itens no mínimo com a quantidade sugerida |

## Licença

Este é um projeto proprietário. Todos os direitos reservados.

O código está publicado apenas para referência e avaliação. Não é permitido copiar, modificar,
distribuir, sublicenciar ou usar comercialmente qualquer parte deste repositório sem autorização
prévia e por escrito do autor.
