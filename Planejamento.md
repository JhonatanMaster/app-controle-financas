# Planejamento — Controle Finanças

## Objetivo
Web app responsivo (mobile-first) de finanças pessoais para múltiplas famílias, inspirado no
Mobills (layout e fluxo de navegação semelhantes), com diferencial de controle de estoque
doméstico integrado a lista de compras, compras avulsas, rateio de despesas entre moradores e
comparativos de gastos.

## Stack sugerida (a confirmar antes de codar)
- Frontend: React/Next.js, responsivo, componentes reutilizáveis para telas do tipo "lista + card + gráfico".
- Backend/dados: Supabase (Postgres + Auth + Row Level Security).
- E-mails transacionais: Resend, com templates para convite, criação de conta e recuperação de senha.

## Estrutura do repositório (decidido)
Monorepo com separação clara de responsabilidades:

```
/frontend   -> UI (Next.js/React), consome a API do backend
/backend    -> regra de negócio, autenticação, integrações externas
```

- **Resend serve só para envio/entrega de e-mail.** Toda a lógica (montar o convite, gerar
  token, decidir quando disparar, template do e-mail) fica no `/backend` — o backend chama a
  API/SDK do Resend só na hora de efetivamente enviar.
- **MCP do Resend é ferramenta de desenvolvimento**, usada por mim (Claude Code) para
  criar/gerenciar templates, checar domínio, ver logs de envio etc. durante o desenvolvimento.
  O app em produção **não** usa MCP — o `/backend` usa a API/SDK oficial do Resend com sua
  própria API key em runtime.
- O mesmo vale para o Supabase: o MCP é usado por mim para criar/alterar schema e gerenciar o
  projeto durante o desenvolvimento; o `/backend` (e/ou `/frontend`, onde fizer sentido) usa o
  client oficial do Supabase (`supabase-js`) em runtime.

## Módulo 1 — Estoque de suprimentos
Cada item de estoque tem dois parâmetros fixos definidos pelo usuário:
- `quantidade_minima`: gatilho de reposição.
- `quantidade_ideal`: quantidade "cheia" desejada em casa.

Regra de consumo:
- O item começa com `quantidade_atual = quantidade_ideal`.
- Cada vez que o usuário registra "abri 1 pacote/unidade", `quantidade_atual -= 1`.
- Quando `quantidade_atual <= quantidade_minima`, o item é adicionado automaticamente à lista de
  compras, com quantidade sugerida = `quantidade_ideal - quantidade_atual`.
- Exemplo: arroz com mínimo=1, ideal=3. Se `quantidade_atual` cair para 1, sugere comprar 2. Se
  cair para 0 (esgotado), sugere comprar 3.

## Módulo 2 — Compra de suprimentos (modo mercado)
- Ao abrir o carrinho no mercado, o app mostra a lista de itens com a quantidade sugerida (calculada acima).
- Cada item tem botões "+" e "-" para o usuário registrar em tempo real quanto está colocando no
  carrinho físico. O usuário pode comprar menos, igual ou mais que a sugestão.
- Ao clicar em "Finalizar compra":
  - Abre modal para inserir o valor total pago, OU
  - Opção "Adicionar valor depois" — a compra fica salva no histórico (data, itens, quantidades)
    com valor pendente, editável posteriormente.
- Ao finalizar, `quantidade_atual` de cada item no estoque é incrementada pela quantidade
  efetivamente comprada (não pela sugerida).

## Módulo 3 — Compras avulsas
Cobre o caso de compras feitas fora do fluxo de reposição de estoque (ex.: filho passa no mercado
e compra itens que não estavam na lista automática).

- Usuário pode registrar uma compra avulsa de duas formas:
  1. **Detalhada**: informa os itens comprados e as quantidades (podem ou não existir no cadastro
     de estoque; se existirem, também incrementam `quantidade_atual` do item correspondente).
  2. **Simplificada**: registra apenas que houve uma compra naquela data e o valor total, sem
     detalhar itens.
- Em ambos os casos, a compra avulsa entra no histórico de compras (mesma listagem das compras de
  reposição, sinalizada como "avulsa") e **pode ser rateada** entre as pessoas da família, seguindo
  a mesma lógica do Módulo 4.

## Módulo 4 — Rateio de compras
- Tela "Pessoas": cadastro de nome (ex.: Pessoa 1, Pessoa 2) vinculado à família/conta.
- Tela "Rateio": usuário seleciona uma compra (de reposição ou avulsa) por data, vê os itens
  (quando houver) e o valor total, e informa quanto cada pessoa contribuiu
  (ex.: Pessoa 1 = R$100, Pessoa 2 = R$200).
- **Regra a confirmar**: a soma das contribuições deve obrigatoriamente bater com o valor total da
  compra, ou o sistema aceita divergência (ex.: alguém ainda não pagou)?

## Módulo 5 — Contas da casa
- Categorias fixas: Água, Luz, Internet, Gás de cozinha.
- Categoria livre: "Outras contas", onde o usuário cria novos tipos.
- Todas as contas (fixas e livres) têm rateio por pessoa, no mesmo padrão do Módulo 4
  (ex.: Luz → Pessoa 1: R$100; Água → Pessoa 1: R$100, Pessoa 2: R$200).

## Módulo 6 — Comparativos
Tela com 3 abas:
1. Gastos por pessoa no mês (valor + gráfico de barras).
2. Comparativo de gastos totais mês a mês.
3. Comparativo de itens consumidos mês a mês (do estoque/compras).

## Módulo 7 — Multi-família, autenticação e isolamento de dados
- Cada conta é criada por um "titular" (quem assina o serviço).
- O titular pode convidar outros membros por e-mail (cônjuge, filhos) para acessar os dados da
  mesma família/conta.
- Convite: e-mail enviado via Resend com template + link. Ao clicar, o convidado informa e-mail e
  cria senha para ativar o acesso.
- Fluxos padrão de auth: criar conta, login, recuperação de senha — todos os e-mails via Resend.
- **Isolamento de dados (requisito obrigatório)**: qualquer pessoa que não tenha recebido convite
  do titular da família não pode visualizar nenhum dado daquela família — nem estoque, nem
  compras, nem rateios, nem contas. Isso deve ser garantido no nível do banco (Row Level Security
  no Supabase), não apenas escondido na interface, para impedir acesso mesmo via chamadas diretas
  à API.
- Modelo de permissão a confirmar: todos os membros têm acesso total (leitura/escrita) aos dados
  da família, ou existem papéis diferentes (ex.: titular vs. membro)?

## Requisitos não funcionais
- Responsivo (mobile e desktop), com prioridade para uso no celular durante a compra no mercado.
- Moeda em Real (BRL), formatação pt-BR.
- Isolamento de dados por família (nenhuma família acessa dados de outra) — ver Módulo 7.

## Decisão técnica: Supabase vs. banco local (ex. SQLite)
- O app é **multiusuário e multi-dispositivo por natureza**: vários membros da mesma família
  acessam os mesmos dados de aparelhos diferentes, e precisam de convite por e-mail e autenticação.
- SQLite local não resolve isso sem reinventar um servidor de sincronização por conta própria —
  ele foi pensado para um único processo/dispositivo acessando o arquivo.
- Um banco local só faria sentido se o escopo fosse um app single-user, single-device — não é o caso aqui.

## Infraestrutura e deploy (decidido)
- **Hospedagem do app**: VPS Hostinger, orquestrado via `docker-compose`, com um serviço para
  `/frontend` e outro para `/backend` (ver "Estrutura do repositório" acima).
- **Domínio**: `seudominio.com`.
  - Frontend: `compras.seudominio.com`
  - Backend/API: `api.compras.seudominio.com`
  - Ambos no mesmo VPS, roteados por reverse proxy (Nginx/Traefik) para os respectivos containers
    do `docker-compose`, cada subdomínio com seu próprio certificado TLS.
- **Banco de dados e Auth**: **Supabase Cloud (gerenciado)** — não será feito self-host da stack
  Supabase no VPS. Só os containers `/frontend` e `/backend` rodam no VPS; o Postgres, a
  Auth e o Row Level Security ficam no Supabase Cloud.
  - Motivo: um self-host completo do Supabase exige ~8-10 containers adicionais (Kong, GoTrue,
    PostgREST, Realtime, Storage, Studio, etc.), o que é peso desnecessário de operação/atualização
    num VPS pequeno para um app de uso familiar. O Supabase Cloud entrega Postgres + Auth + RLS
    prontos, com backup e updates gerenciados, e o VPS fica livre só para servir o app.
  - RLS no Supabase garante o isolamento de dados por família (Módulo 7) no nível do banco, não
    apenas na interface.
- **Integração de desenvolvimento**: uso do **Supabase MCP server** no Claude Code para
  criar/alterar schema, rodar queries e gerenciar o projeto Supabase diretamente durante o
  desenvolvimento. Setup (executado pelo usuário, requer autenticação interativa via navegador):
  ```
  claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=<PROJECT_REF>"
  claude /mcp   # autenticar (rodar em terminal normal, não em extensão de IDE)
  ```
  Opcional: `npx skills add supabase/agent-skills` para instalar skills de agente específicas do Supabase.
- **E-mails transacionais**: Resend, para convites de família, criação de conta e recuperação de senha.

## Schema implementado no Supabase (projeto `SEU_PROJETO`)
Aplicado via MCP em 3 migrations (`initial_schema`, `harden_functions`,
`move_auth_helpers_to_private_schema`, `performance_fixes`):

- Tabelas: `families`, `family_members`, `people`, `stock_items`,
  `stock_consumption_events`, `purchases`, `purchase_items`, `purchase_splits`,
  `bill_categories`, `bills`, `bill_splits`.
- View `shopping_list`: itens de estoque com `current_quantity <= min_quantity`, já calculando
  `suggested_quantity = ideal_quantity - current_quantity` (Módulo 1).
- Funções de autorização (`is_family_member`, `is_family_titular`) isoladas no schema `private`
  (não expostas via API REST), usadas pelas policies de RLS em todas as tabelas.
- Trigger `on_family_created`: ao criar uma família, o criador já entra automaticamente como
  `family_members` com role `titular` e status `ativo`.
- RLS habilitado em todas as tabelas, checado contra `get_advisors` (security): sem alertas
  pendentes além de uma função interna do próprio Supabase (não criada por nós).
- Índices adicionados em todas as foreign keys e policies otimizadas para não reavaliar
  `auth.uid()`/`auth.jwt()` por linha (checado contra `get_advisors` performance).

## Decisões finais confirmadas pelo usuário
1. **Rateio**: a soma das contribuições **precisa fechar** com o valor total da compra/conta.
   Implementado via migration `rateio_soma_obrigatoria`:
   - Coluna `rateio_status` (`pendente`/`fechado`) em `purchases` e `bills`.
   - Trigger `before insert/update` em `purchase_splits`/`bill_splits` bloqueia qualquer
     contribuição que faça a soma **ultrapassar** o valor total (erro imediato).
   - Trigger `after insert/update/delete` recalcula a soma e marca `rateio_status = 'fechado'`
     automaticamente quando soma = total, ou `'pendente'` enquanto não fecha.
   - Rateio de compra só é permitido quando `purchases.value_status = 'definido'` (valor já
     inserido) — compras com "adicionar valor depois" pendente não podem ser rateadas ainda.
2. **Permissões**: confirmado — todo membro convidado (uma vez `status = 'ativo'`) tem acesso
   total de leitura/escrita aos dados da família (estoque, compras, contas, pessoas, rateio),
   igual ao titular. A única distinção que permanece é administrativa: só o `titular` pode
   convidar/remover/editar outros `family_members` (quem tem acesso à conta). Caso precise
   restringir alguma ação específica no futuro, o usuário vai sinalizar.
3. **MVP confirmado**: Estoque + Compras + Login multi-família (Módulos 1, 2 e 7) primeiro.
   Rateio e Comparativos ficam para a segunda fase — o usuário será avisado quando o MVP estiver
   pronto para começar essa etapa.

## Arquitetura de acesso a dados (decidido)
- **O `/frontend` nunca fala com o Supabase diretamente** — sem URL nem chave do Supabase no
  bundle do frontend. Toda leitura/escrita passa por uma API REST no `/backend`.
- O `/backend` é o único componente com credenciais do Supabase. Para preservar o RLS como
  camada real de proteção (não só regra de negócio no código), o backend autentica o usuário via
  Supabase Auth e, nas chamadas seguintes, usa o **access token do próprio usuário** (não a
  service role key) para montar o client do Supabase por request — assim toda query já respeita
  as policies de RLS por família, e o backend adiciona validação de negócio por cima.
- Isso significa: mesmo que uma rota do backend tenha um bug de autorização, o RLS no banco ainda
  impede um usuário de ler/escrever dados de outra família.

## Status do MVP (Estoque + Compras + Login multi-família) — CONCLUÍDO em 2026-09-21

### Backend (`/backend`, Fastify + TypeScript)
- `POST /auth/signup-family`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `GET /auth/me`
- `POST /auth/accept-invite` (cria a conta do convidado ou vincula conta existente pela senha)
- `POST /auth/forgot-password` + `POST /auth/reset-password` (link gerado pelo Supabase Admin,
  e-mail enviado pelo Resend, verificação por `verifyOtp` no backend)
- `GET/POST/DELETE /families/:id/members|invites|people`
- `GET/POST/PATCH/DELETE /families/:id/stock-items`, `POST .../consume`, `GET .../shopping-list`
- `GET/POST/DELETE /families/:id/purchases`, itens com `POST/PATCH/DELETE`, `POST .../finalize`,
  `PATCH .../value`, `PUT .../splits` (rateio já pronto no backend, UI fica para a fase 2)
- Sessão em cookies `httpOnly` (`sb_access_token` / `sb_refresh_token`); o frontend nunca vê tokens.
- Service role usada só em `admin.createUser` e `admin.generateLink`; todo o resto usa o JWT do
  usuário, então o RLS do banco continua sendo a barreira real.

### Frontend (`/frontend`, Next.js 16 + Tailwind 4)
- Rotas públicas: `/login`, `/criar-conta`, `/recuperar-senha`, `/redefinir-senha`, `/aceitar-convite`
- Rotas internas: `/app` (início), `/app/estoque`, `/app/compras`, `/app/compras/[id]` (modo
  mercado com + e −, finalizar com valor ou adicionar depois), `/app/familia` (convites, troca de
  família ativa)
- Layout estilo Mobills: sidebar no desktop, barra inferior no mobile, tema claro/escuro automático.

### Ajustes de schema feitos durante os testes
- `purchases.finalized_at` separa "passou no caixa" de "valor informado"; o trigger de
  incremento de estoque dispara em `finalized_at`, não em `value_status`.
- Policies de SELECT ampliadas: dono sempre vê sua `families`; usuário sempre vê a própria linha
  em `family_members`; convidado vê o próprio convite pendente (necessário para o `UPDATE` de
  aceite passar no RLS).

### Validação
- Script E2E via API cobriu: signup, estoque, consumo até o mínimo, carrinho automático, modo
  mercado, finalizar sem valor, incremento de estoque, valor depois, rateio (bloqueio de excesso
  e fechamento automático), compra avulsa, convite por e-mail (entregue pelo Resend), aceite,
  isolamento entre famílias (zero vazamento) e permissões de titular.
- Fluxo também validado clicando na UI (Chrome): criar conta, cadastrar item, "Abri 1" x2,
  carrinho automático, ir ao mercado, +1, finalizar com R$ 89,90, estoque atualizado, convite.

### Deploy (pendente de executar no VPS)
- `docker-compose.yml` na raiz sobe `backend` (4100) e `frontend` (3100) em `127.0.0.1`
  (portas do host configuráveis via `.env` na raiz, pois 3000 já estava ocupada no VPS);
  o reverse proxy do VPS deve apontar `api.compras.seudominio.com` para 4100 e
  `compras.seudominio.com` para 3100, com TLS.
- Preencher `backend/.env` no servidor a partir de `backend/.env.example`
  (`COOKIE_DOMAIN=.compras.seudominio.com`, `FRONTEND_ORIGIN` e `APP_BASE_URL` em https).

## Próxima fase: Rateio + Comparativos (Módulos 4, 5 e 6)
- UI de pessoas e rateio por compra (backend já pronto), contas da casa (`bill_categories`,
  `bills`, `bill_splits` já existem no banco, faltam rotas e telas), e tela de comparativos
  (gastos por pessoa, mês a mês, itens consumidos).
