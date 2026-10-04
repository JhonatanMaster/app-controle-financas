# Controle Finanças

Web app para organizar as finanças de uma casa em família: controla o estoque da despensa,
monta a lista de compras sozinho, acompanha as compras no mercado e divide as despesas entre
os moradores.

**Versão atual: 1.3.0** · [histórico de versões](#versões) · [decisões de arquitetura](docs/arquitetura.md)

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

**Acesso e família**
- Cadastro do titular e criação da família
- Convite de membros por e-mail, que criam a própria senha pelo link
- Recuperação de senha por e-mail
- Senha forte validada na API, com checklist dos requisitos enquanto a pessoa digita

**Estoque e compras**
- Estoque com mínimo, ideal, quantidade atual e botão de consumo
- Grupos de mercado por item (limpeza, açougue, congelados e outros), com todas as listas
  organizadas por seção na ordem em que se percorre o supermercado
- Lista de compras automática
- Modo mercado com ajuste de quantidades, itens extras e finalização
- Compras avulsas, só com o valor ou detalhadas por item, com seção própria

**Gastos**
- Histórico agrupado por semana, mês ou intervalo escolhido no calendário, com o total de cada período
- Gráfico do custo dos últimos três meses
- Rateio de compras por pessoa, com a soma obrigatoriamente igual ao total (disponível na API,
  tela prevista para a próxima versão)

Próximas etapas: tela de rateio, contas da casa (água, luz, internet, gás e outras) com rateio,
e comparativos de gastos por pessoa, por mês e de itens consumidos. O detalhamento está no
[roadmap](docs/arquitetura.md#roadmap).

## Avaliar localmente

O único pré requisito é o [Docker](https://docs.docker.com/get-docker/) com Docker Compose
(Docker Desktop no Windows e no macOS). Não precisa de Node, de conta no Supabase nem de
configurar nada.

```bash
git clone https://github.com/JhonatanMaster/app-controle-financas.git
cd app-controle-financas
docker compose up -d --build
```

Abra [http://localhost:3000](http://localhost:3000) e crie uma conta. Você entra como titular de
uma família nova, que já nasce com os grupos de mercado padrão.

A primeira subida leva alguns minutos, porque baixa as imagens e compila a aplicação. As seguintes
são rápidas. Para acompanhar até tudo ficar pronto:

```bash
docker compose ps
```

### O que sobe

O compose monta um Supabase mínimo dentro do Docker, com os mesmos componentes que o sistema usa
em produção, e a aplicação por cima dele:

| Serviço | Papel |
|---|---|
| `db` | Postgres com as extensões e papéis do Supabase |
| `auth` | GoTrue, a autenticação do Supabase |
| `migrate` | Aplica `supabase/migrations` uma única vez e encerra |
| `rest` | PostgREST, a API REST do Supabase |
| `gateway` | Expõe autenticação e REST no formato de caminho do Supabase hospedado |
| `backend` | API Fastify |
| `frontend` | Interface Next.js |

A ordem é garantida pelos healthchecks: o schema só é aplicado depois que a autenticação existe, e
a API REST só sobe com o schema pronto.

### O que testar

1. Em **Estoque**, cadastre "Arroz" no grupo Cozinha, com mínimo 1 e ideal 3
2. Clique em **Abri 1** duas vezes. O item cai no carrinho com sugestão de comprar 2
3. Cadastre mais itens em grupos diferentes e consuma até o mínimo
4. Em **Compras**, abra o carrinho automático e veja os itens separados por seção do mercado
5. **Ir ao mercado**: ajuste as quantidades com + e −, adicione um item avulso escolhendo o grupo
6. **Finalizar compra** com um valor e volte ao Estoque para ver as quantidades atualizadas
7. No histórico, alterne entre semana, mês e período específico, e abra o gráfico no fim da página
8. Em **Família**, convide um e-mail qualquer e abra o link do convite a partir do log

### E-mails em ambiente local

Nenhum e-mail sai de verdade. Convites e links de redefinição de senha são impressos no log do
backend, prontos para abrir no navegador:

```bash
docker compose logs -f backend
```

Para testar o envio real, crie um `.env` na raiz a partir do `.env.example` com uma chave do
[Resend](https://resend.com) e rode `docker compose up -d` de novo.

### Endereços

| Serviço | Endereço |
|---|---|
| Aplicação | http://localhost:3000 |
| API | http://localhost:4000 (`/health` informa a versão) |
| Postgres | `postgresql://postgres:postgres-local@localhost:54322/postgres` |

Se alguma porta já estiver ocupada, copie `.env.example` para `.env` na raiz e ajuste.

### Encerrando

```bash
docker compose down        # para tudo e preserva os dados
docker compose down -v     # para tudo e apaga o banco, a próxima subida recomeça do zero
```

## Desenvolvimento sem Docker

Para trabalhar no código com recarga automática, deixe só a infraestrutura no Docker e rode backend
e frontend no Node 22:

```bash
docker compose up -d gateway

cp backend/.env.example backend/.env
cd backend && npm install && npm run dev       # API em http://localhost:4000

cp frontend/.env.example frontend/.env.local
cd frontend && npm install && npm run dev      # app em http://localhost:3000
```

Subir o `gateway` já traz junto banco, autenticação, migrations e REST, porque ele depende de todos.
O `backend/.env.example` vem preenchido com os valores desse ambiente, então não há nada para editar.

## Usando um Supabase hospedado

Para apontar para um projeto no [supabase.com](https://supabase.com) em vez do ambiente local,
rode `supabase/migrations/20260921000000_schema_inicial.sql` uma vez no SQL Editor do projeto e
use no `backend/.env` a URL e as chaves que ficam em Project Settings, API Keys. A chave secreta
dá acesso irrestrito ao banco e nunca deve ir para o frontend nem para o Git.

## Como funciona por dentro

```
/frontend   Next.js 16, React 19, Tailwind 4. Interface web responsiva.
/backend    Fastify + TypeScript. API REST, regras de negócio, e-mails.
/supabase   Migrations com tabelas, triggers e políticas de segurança.
/docker     Peças do ambiente local: gateway, papéis do Postgres e aplicação das migrations.
/docs       Decisões de arquitetura.
```

- O **frontend** nunca fala com o banco. Toda leitura e escrita passa pela API do backend, e a
  sessão fica em cookies httpOnly. Nenhuma credencial do Supabase chega ao navegador.
- O **backend** autentica o usuário no Supabase Auth e, nas demais chamadas, acessa o banco com o
  token do próprio usuário. Assim as políticas de Row Level Security do Postgres continuam valendo:
  mesmo que uma rota tenha um bug, uma família não consegue ler dados de outra.
- O **banco** guarda as regras que não podem falhar: o consumo decrementa o estoque, finalizar uma
  compra incrementa o estoque uma única vez, e o rateio bloqueia qualquer soma acima do total.
- Os **e-mails** de convite e recuperação de senha são enviados pelo Resend. O Resend só entrega;
  o conteúdo e a lógica ficam no backend.
- **Erros do banco nunca chegam crus ao cliente**: a API traduz cada código do Postgres para uma
  resposta própria e registra o resto no log.
- A **configuração é validada na subida**: uma URL malformada ou a falta da chave de e-mail em
  produção derrubam o boot com a causa explícita, em vez de falhar silenciosamente depois.

O raciocínio por trás de cada escolha, incluindo as alternativas descartadas, está em
[docs/arquitetura.md](docs/arquitetura.md).

## Estrutura de dados resumida

| Tabela | Para que serve |
|---|---|
| `families`, `family_members` | Família e quem tem acesso (titular e membros convidados) |
| `people` | Pessoas do rateio, com ou sem login |
| `stock_groups` | Seções do mercado, na ordem em que se percorre as gôndolas |
| `stock_items`, `stock_consumption_events` | Itens da despensa e registro de consumo |
| `purchases`, `purchase_items`, `purchase_splits` | Compras, itens do carrinho e rateio |
| `bill_categories`, `bills`, `bill_splits` | Contas da casa e rateio (próxima fase) |
| view `shopping_list` | Itens no mínimo, com quantidade sugerida e a seção do item |

## Produção

Em produção a aplicação roda atrás de um reverse proxy com HTTPS automático, com os containers
declarando as próprias rotas. A configuração dessa infraestrutura, com domínios, servidor e
procedimentos de operação, é mantida num repositório privado. O `docker-compose.yml` daqui é
voltado à avaliação local.

## Versões

O projeto segue [Versionamento Semântico](https://semver.org/lang/pt-BR/):

- **MAJOR** quando uma mudança quebra compatibilidade, seja no contrato da API, seja exigindo
  migração manual de dados de quem já usa o sistema
- **MINOR** para funcionalidade nova que não quebra nada existente
- **PATCH** para correções

Cada release tem uma tag `vX.Y.Z` no Git. As versões anteriores à 1.3.0 foram marcadas
retroativamente, sobre os commits que fecharam cada entrega. A linha 1.x começa na primeira
publicação em produção, com dados reais de uso; antes disso não houve release.

### 1.3.0 · versão atual

Histórico de gastos e acabamento para uso no celular.

- Histórico de compras agrupado por semana, mês ou intervalo escolhido no calendário, com o total
  de cada período ao lado
- Compras finalizadas sem valor saem da soma e aparecem contadas à parte, para o total não enganar
- Gráfico de barras com o custo dos últimos três meses, incluindo meses sem compra
- Comportamento de app nativo: sem zoom por gesto ou duplo toque, sem pull to refresh e sem realce
  ao tocar
- Tratamento de erros do banco centralizado; a API deixou de devolver mensagens internas do Postgres
- Mensagens da API e e-mails de convite e recuperação de senha revisados
- `/health` passou a informar a versão em execução
- Ambiente local completo com um único `docker compose up`: Postgres, autenticação e API REST do
  Supabase sobem junto com a aplicação, e as migrations são aplicadas sozinhas. O único pré
  requisito é o Docker
- Resend opcional fora de produção: sem chave, os e-mails de convite e senha vão para o log do
  backend. Rodando em https a chave continua obrigatória

### 1.2.0

Organização por seção do mercado.

- Grupos de mercado por item, com sete grupos padrão criados para cada família na ordem em que se
  percorre o supermercado, dos produtos de limpeza até frios e padaria
- Criação de grupo novo direto no formulário do item, entrando no fim da ordem
- Estoque, lista de compras automática e modo mercado agrupados por seção, com os itens sem grupo
  reunidos em "Outros"
- Item avulso da compra com seção própria, já que não tem item de estoque de onde herdar
- Validação que impede marcar um item com grupo de outra família, caso não coberto pelo RLS para
  quem participa de mais de uma casa

### 1.1.0

Segurança de acesso.

- Política de senha forte, com mínimo de seis caracteres e presença de maiúscula, minúscula, número
  e caractere especial, validada na API
- Checklist visual dos requisitos, marcado conforme a pessoa digita, no cadastro, no aceite de
  convite e na redefinição de senha
- Correção: URLs públicas da configuração passaram a exigir endereço completo com https fora de
  localhost. Um valor malformado deixava o CORS quebrado em produção sem nenhum erro no log; agora
  o backend recusa subir e informa a causa

### 1.0.0

Primeira versão em produção.

- Contas multi família com titular, convite de membros por e-mail e recuperação de senha
- Isolamento entre famílias garantido por Row Level Security no banco, além das regras da API
- Estoque com quantidade mínima e ideal e registro de consumo
- Lista de compras montada automaticamente a partir do estoque
- Modo mercado com ajuste de quantidades e finalização com valor informado na hora ou depois
- Compras avulsas, simples ou detalhadas por item
- Rateio de compras na API, com a soma igual ao total garantida por trigger
- Deploy com Docker Compose atrás de Traefik, com HTTPS automático

## Licença

Este é um projeto proprietário. Todos os direitos reservados.

O código está publicado apenas para referência e avaliação. Não é permitido copiar, modificar,
distribuir, sublicenciar ou usar comercialmente qualquer parte deste repositório sem autorização
prévia e por escrito do autor.
