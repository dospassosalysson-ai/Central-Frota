# Central Frota

Central operacional para atendimento compartilhado no WhatsApp, gestão de frota, fluxo fiscal e gestão de equipe. A aplicação usa Next.js no Render e Supabase para autenticação, Postgres e armazenamento privado de PDFs.

## O que já está estruturado

- sala de controle administrativa com atendimento, fiscal, equipe, custos, alertas e tráfego;
- caixa compartilhada para motoristas, supervisores LOG20 e fornecedores;
- chat interno separado do WhatsApp, com sala Geral da Frota, conversas diretas, discussões vinculadas aos atendimentos, leitura individual e notificações;
- autoria interna das respostas por painel ou celular — ecos do celular são identificados como `Wallace • celular`;
- planos de ação com responsável, prioridade, prazo, checklist, comentários, progresso e notificação de conclusão;
- convite de assistentes e perfis `admin` / `attendant`;
- notas fiscais deduplicadas por CNPJ + número + série;
- fluxo PDF → conferência → Benner via MV → Portal Fiscal;
- placa → centro de custo → projeto → linha do DRE, com alocação geral quando não houver placa;
- orçamento planejado, comprometido e realizado por centro de custo;
- aprovações de compras, serviços, pagamentos, exceções e reembolsos;
- auditoria de mensagens, atribuições, conclusões, equipe e aprovações;
- armazenamento privado de PDFs no bucket `fiscal-documents`;
- webhook assinado e idempotente para a API oficial da Meta;
- health check em `/api/health`.

## Arquitetura

```text
WhatsApp Cloud API ── webhook assinado ──┐
                                        ├── Next.js / Render ── Supabase Postgres
Navegador ── Supabase Auth ── Bearer ───┘                    └── Storage privado
```

O navegador recebe apenas a chave publicável. A `SUPABASE_SECRET_KEY` fica exclusivamente no backend do Render. As tabelas têm RLS habilitado sem políticas públicas; toda consulta de negócio passa pelas rotas autenticadas do servidor.

## Configuração inicial do Supabase

1. Abra o SQL Editor do projeto.
2. Execute integralmente [`supabase/schema.sql`](supabase/schema.sql).
3. Em Authentication → URL Configuration, use `https://central-frota.onrender.com` como Site URL e adicione `https://central-frota.onrender.com/?first_access=1` às Redirect URLs.
4. Em Authentication → Users, crie diretamente o primeiro usuário, confirme o e-mail e não compartilhe uma senha temporária. O primeiro perfil recebe `admin`; os seguintes recebem `attendant`.
5. Na tela de login, esse usuário escolhe **Primeiro acesso**, informa o e-mail cadastrado e recebe um link individual para definir a própria senha. Enquanto `first_access_completed_at` não existir, qualquer sessão autenticada fica bloqueada na definição da senha e não acessa os módulos. Depois de entrar como administrador, use Equipe → Convidar assistente para os próximos acessos; esses convites incluem o redirecionamento correto.

O SQL pode ser executado novamente com segurança durante a implantação inicial: tabelas e índices usam `if not exists` e as cargas demonstrativas usam `on conflict`.

Em bancos já existentes, aplique as migrações versionadas de [`supabase/migrations`](supabase/migrations) na ordem dos arquivos antes de publicar o código correspondente. O Render não executa essas migrações automaticamente. O chat interno usa canais privados do Supabase Realtime; mensagens são persistidas no Postgres e o tempo real funciona apenas como sinal de atualização.

## Variáveis de ambiente

Copie [`.env.example`](.env.example) para `.env.local` no desenvolvimento. No Render, configure:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
APP_URL=https://central-frota.onrender.com
```

Para a integração oficial do WhatsApp, acrescente:

```dotenv
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_GRAPH_VERSION=v23.0
WHATSAPP_VERIFY_TOKEN=
META_APP_SECRET=
```

Callback da Meta: `https://central-frota.onrender.com/api/webhooks/whatsapp`.

Sem as variáveis da Meta, as respostas continuam registradas com status `queued`, mas não são apresentadas como entregues. Isso permite preparar e validar a Central sem simular uma integração inexistente.

## Desenvolvimento

```bash
npm ci
npm run dev
```

Com `NODE_ENV=development`, `/preview` abre uma demonstração local da interface sem expor essa rota em produção.

Validações antes de publicar:

```bash
npm run typecheck
npm run lint
npm run build
docker build -t central-frota .
```

## Render

O repositório inclui Docker multi-stage e [`render.yaml`](render.yaml). O processo final roda como usuário sem privilégios, usa a saída standalone do Next.js e expõe a porta `3000`. O Render deve apontar para a branch `main` e usar o health check `/api/health`.

## Regras operacionais registradas

- o Benner não gera protocolo; o identificador operacional é o número da NF;
- a NF é única por CNPJ + número + série;
- lançamentos no Benner dependem do MV em computadores autenticados e permanecem como atividade humana controlada;
- PDFs ficam privados e exigem sessão válida para upload e download;
- respostas vindas do celular são atribuídas internamente ao Wallace;
- o administrador vê todos os atendimentos e planos; assistentes veem sua operação e tarefas atribuídas;
- módulos foram desacoplados para permitir ativação, evolução ou remoção sem refazer o sistema inteiro.
