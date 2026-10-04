# Arquitetura

Este documento registra como o Controle Finanças está organizado e, principalmente, por que
cada decisão foi tomada. O README cobre o que o produto faz e como rodar; aqui fica o raciocínio
que não aparece lendo o código.

## Contexto

O sistema atende uma casa compartilhada por várias pessoas. Isso define três requisitos que
atravessam todas as decisões abaixo:

1. **Vários usuários, vários dispositivos, os mesmos dados.** Quem abre um pacote de arroz em
   casa precisa ver o reflexo disso no celular de quem está no mercado.
2. **Isolamento rígido entre famílias.** Ninguém de fora de uma casa pode ler nada dela, nem por
   erro de código na API.
3. **Uso no mercado, com uma mão e sinal ruim.** A tela de compras precisa ser direta e tolerar
   ações repetidas sem corromper o estoque.

## Visão geral

```
Navegador ──> frontend (Next.js) ──> backend (Fastify) ──> Supabase (Postgres + Auth)
                                            │
                                            └──> Resend (entrega de e-mail)
```

O frontend não conhece o Supabase. Não há URL nem chave do banco no bundle. Toda leitura e
escrita passa pela API, que devolve a sessão em cookie httpOnly.

## Decisões

### 1. Postgres gerenciado no Supabase, e não banco local nem self host

Um SQLite local resolveria o caso de um usuário num dispositivo, que não é o caso. Sincronizar
arquivos entre aparelhos seria reinventar um servidor de banco.

Hospedar a stack completa do Supabase no próprio servidor também foi descartado: são perto de dez
containers a manter e atualizar para um sistema de uso doméstico. O Supabase gerenciado entrega
Postgres, autenticação e Row Level Security prontos, com backup, e o servidor fica só com a
aplicação.

### 2. A API é o único caminho até os dados

Com o frontend falando direto com o Supabase, a regra de negócio acabaria dividida entre cliente
e banco. Concentrar tudo na API deixa um único lugar para validar, auditar e evoluir, e mantém o
navegador sem nenhuma credencial.

### 3. O backend acessa o banco com o token do próprio usuário

A escolha mais importante do projeto. O caminho óbvio seria o backend usar a chave de serviço, que
ignora o RLS, e filtrar por família no código. Qualquer rota esquecida viraria vazamento de dados.

Em vez disso, cada requisição monta um client do Supabase com o JWT de quem está logado. As
políticas de RLS continuam valendo e funcionam como segunda barreira: mesmo uma rota com bug de
autorização não enxerga dados de outra família.

A chave de serviço fica restrita a três operações administrativas de autenticação em que ainda não
existe sessão: criar a conta no cadastro, criar a conta no aceite de convite e gerar o link de
recuperação de senha. Nunca é usada para dados de negócio.

### 4. Invariantes de estoque e rateio moram no banco

Três regras não podem ficar inconsistentes em hipótese alguma, então são triggers:

- Registrar consumo decrementa o estoque, e o check constraint impede que ele fique negativo.
- Finalizar uma compra incrementa o estoque **uma única vez**, na transição de `finalized_at`
  de nulo para preenchido. Editar o valor depois não soma de novo.
- A soma do rateio nunca passa do valor total, e o status vira `fechado` sozinho quando a soma
  iguala o total.

No código da API essas regras dependeriam de todas as rotas lembrarem de aplicá-las. No banco,
valem para qualquer escrita, inclusive uma correção manual pelo SQL Editor.

### 5. Sessão em cookie httpOnly com domínio pai compartilhado

Tokens em `localStorage` ficam expostos a qualquer XSS. Em cookie httpOnly o JavaScript da página
não os lê. Como frontend e API ficam em subdomínios diferentes (`app.` e `api.app.`), o cookie
usa o domínio pai comum. O escopo é deliberadamente estreito: um domínio pai mais amplo mandaria o
cookie de sessão para outros sistemas hospedados no mesmo domínio.

O `SameSite` não é fixo porque depende de onde a API está. Em subdomínios do mesmo domínio
registrável o navegador trata a chamada como same site e um cookie `Lax` viaja normalmente. Numa
API hospedada em outro domínio, o `Lax` seria descartado em toda requisição e a sessão cairia a
cada carga de página, então ali a sessão usa `SameSite=None`, que exige TLS. A escolha é feita por
requisição, comparando o host da API com o `FRONTEND_ORIGIN`.

### 5.1 A sessão é renovada sem o usuário perceber

O app é de uso doméstico e diário, quase sempre no celular. Pedir login a cada visita seria o
mesmo que pedir senha para abrir a geladeira, então a sessão precisa sobreviver a semanas de
intervalo.

O access token do Supabase vale uma hora; o refresh token é o que dá longevidade, e seu cookie
vive 400 dias, o teto que o navegador aceita para um cookie persistente. Qualquer requisição que
chegue com o access token vencido é renovada no próprio servidor, que regrava os cookies e segue
atendendo, em vez de devolver 401. O cliente ainda tem o retry que renova e repete a chamada, mas
ele passou a valer também para `/auth/me`, que é justamente quem decide se o app abre na tela de
uso ou no login. Antes, qualquer rota `/auth/` estava fora do retry, e o efeito prático era pedir
login de novo uma hora depois do último acesso, mesmo com refresh token válido por 30 dias.

Como o refresh token do Supabase é de uso único, renovações simultâneas com o mesmo token
derrubariam a sessão de uma das requisições. O servidor guarda a renovação em andamento por token
e faz as concorrentes esperarem a mesma promessa.

Falha de rede não é mais tratada como sessão encerrada. O frontend guarda o último perfil
conhecido, que não contém token nenhum, e só o descarta quando a API responde 401 de fato. Abrir o
app sem sinal mostra a tela de uso com erro de carregamento, e não a tela de login.

### 6. Erros do banco nunca chegam crus ao cliente

Mensagens do Postgres carregam nomes de tabela, constraint e detalhes de schema. A API traduz cada
código conhecido para uma resposta HTTP com texto próprio e registra o restante no log, devolvendo
apenas "Erro interno". A exceção são os erros levantados pelos triggers do projeto, que já são
escritos para o usuário final.

### 7. Configuração validada na inicialização

Variáveis de ambiente passam por um schema na subida do processo. Uma URL pública sem protocolo,
ou com `http` fora de localhost, derruba o boot com a causa explícita. A alternativa seria um CORS
quebrado em produção sem nenhuma pista no log, que foi exatamente o que motivou a checagem.

### 8. Ordem das seções aplicada no cliente

Os grupos de mercado têm uma ordem canônica guardada no banco (`sort_order`). O detalhe de uma
compra, porém, traz o grupo dois níveis abaixo (`purchase_items`, `stock_items`, `stock_groups`),
e o PostgREST não ordena registros pai por coluna de tabela embarcada. Uma view ou RPC só para
isso duplicaria o formato já entregue pelo embed.

A ordenação por seção é feita no frontend, num helper único usado pelas três telas. O volume é de
dezenas de itens por família, então o custo é irrelevante, e o banco continua dono da ordem.

### 9. Deploy atrás de um Traefik já existente

O servidor de produção já roda um Traefik compartilhado por outros sistemas. Em vez de publicar
portas, os containers entram na rede do proxy e declaram as próprias rotas por labels, com HTTPS
automático. Os nomes de router e service levam um prefixo para não colidir com os demais sistemas,
porque esses nomes são globais no Traefik.

Essa configuração, junto com domínios e procedimentos do servidor, fica num repositório privado de
infraestrutura. O compose deste repositório serve ao ambiente local descrito a seguir.

### 10. Ambiente local com um único comando

Quem clona o projeto, seja para avaliar ou para contribuir, precisa vê-lo funcionando sem criar
conta em serviço nenhum e sem instalar nada além do Docker.

O caminho óbvio seria o Supabase CLI, mas ele é uma ferramenta a mais, exige Node e obriga a copiar
chaves geradas na hora para o `.env`. Em vez disso, o compose monta só o subconjunto do Supabase
que o backend usa: Postgres, GoTrue e PostgREST, atrás de um nginx que reproduz os caminhos
`/auth/v1` e `/rest/v1` do serviço hospedado. Para o `supabase-js` não há diferença.

A ordem de subida é o ponto delicado. O schema referencia `auth.users` e funções de `auth` que o
GoTrue cria nas próprias migrations, então um serviço de migração só roda depois que o GoTrue está
saudável, e o PostgREST só sobe depois da migração, para não guardar em cache um schema vazio. O
controle do que já foi aplicado usa a mesma tabela do Supabase CLI, então reiniciar o ambiente não
reaplica nada.

As chaves do ambiente são JWTs assinados com um segredo local e validade longa, fixados no compose.
As chaves de demonstração do compose oficial do Supabase expiram em 2027, o que quebraria o
ambiente sem nenhuma mudança no código.

O único serviço externo restante era o Resend. Sem a chave, o backend imprime o e-mail com o link
no log em vez de enviar, o que mantém convite e recuperação de senha testáveis. Para isso nunca
acontecer em produção por esquecimento, a chave é obrigatória sempre que a aplicação roda em https,
e a validação da configuração recusa a subida sem ela.

O schema também deixou de ser um arquivo avulso e virou a primeira migration. Assim o mesmo arquivo
serve ao ambiente local e a um projeto hospedado, e mudanças futuras entram como novas migrations
em vez de edições num script gigante.

## Modelo de dados

| Entidade | Papel |
|---|---|
| `families` | A casa. Tem um titular (`owner_user_id`) |
| `family_members` | Quem tem acesso. Status `convidado` até o aceite, `ativo` depois |
| `people` | Quem participa do rateio, com ou sem login |
| `stock_groups` | Seções do mercado com ordem de percurso |
| `stock_items` | Itens da despensa com mínimo, ideal e quantidade atual |
| `stock_consumption_events` | Histórico de consumo, base para os comparativos |
| `purchases` / `purchase_items` | Compras e seus itens, de reposição ou avulsas |
| `purchase_splits` | Contribuição de cada pessoa numa compra |
| `bill_categories` / `bills` / `bill_splits` | Contas da casa e rateio |

A view `shopping_list` expõe os itens abaixo do mínimo, já com a quantidade sugerida e a seção.
Ela usa `security_invoker`, então herda o RLS das tabelas de origem.

## Regras de negócio

**Estoque.** Um item nasce com a quantidade ideal. Quando a quantidade atual chega ao mínimo, ele
entra na lista de compras sugerindo `ideal − atual`. Com arroz em mínimo 1 e ideal 3, sobrar 1
pacote sugere comprar 2; zerar sugere comprar 3.

**Compra.** No mercado a pessoa ajusta a quantidade de cada item conforme coloca no carrinho, e
pode levar mais ou menos que o sugerido. Ao finalizar, o estoque recebe o que foi comprado de
fato. O valor pode ser informado na hora ou depois.

**Rateio.** A soma das contribuições precisa fechar exatamente com o total. Compra sem valor
definido não pode ser rateada.

**Permissões.** Todo membro ativo lê e escreve os dados da família. Só o titular convida e remove
membros.

## Roadmap

A base (estoque, compras e acesso multi família) está entregue. A próxima fase completa a parte
financeira:

1. **Rateio de compras.** A API existe; falta a tela de pessoas e a de rateio por compra.
2. **Contas da casa.** Tabelas e triggers existem; faltam rotas, telas e as categorias padrão
   (água, luz, internet, gás de cozinha e outras).
3. **Comparativos.** Gastos por pessoa no mês, total mês a mês somando compras e contas, e itens
   consumidos por mês a partir de `stock_consumption_events`.

A ordem importa: os comparativos dependem dos dados produzidos pelas duas etapas anteriores.

## Limitações conhecidas

- O Safari do iOS ignora `user-scalable=no` desde o iOS 10. Lá o duplo toque deixa de dar zoom,
  mas o gesto de pinça continua funcionando.
- Não há gestão de grupos de mercado além da criação: renomear, reordenar e excluir ficaram fora
  do escopo inicial. Excluir um grupo pelo banco devolve os itens para a seção "Outros".
