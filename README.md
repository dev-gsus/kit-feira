# Kit Feira

Loja de kits e produtos avulsos de feira com checkout e confirmação pelo
WhatsApp, histórico de pedidos e custos de compra, painel administrativo e
campanhas de sorteio.

## Preparar o Supabase

1. Em uma instalação nova, execute [`supabase/schema.sql`](./supabase/schema.sql)
   no SQL Editor. A migração
   [`supabase/migrations/20261123_marketplace_custom_fair.sql`](./supabase/migrations/20261123_marketplace_custom_fair.sql)
   habilita produtos avulsos quando ainda não estiver incluída no banco.
2. Em todas as instalações, aplique uma vez
   [`supabase/migrations/20261123_customer_accounts_crm.sql`](./supabase/migrations/20261123_customer_accounts_crm.sql).
   Ela cria contas de clientes, endereços salvos, histórico de pedidos e acesso ao CRM.
3. Aplique também uma vez
   [`supabase/migrations/20261123_marketplace_announcements.sql`](./supabase/migrations/20261123_marketplace_announcements.sql)
   para habilitar os recados de preço gerenciados pelo painel. A instalação nova
   já inclui essa tabela em `supabase/schema.sql`.
4. Aplique
   [`supabase/migrations/20261123_admin_raffle_controls.sql`](./supabase/migrations/20261123_admin_raffle_controls.sql)
   para permitir excluir sorteios e realizar sorteios antes da data agendada.
5. Em **Authentication → Users**, cadastre ou confirme as contas que poderão
   administrar o painel. A autorização administrativa é mantida separadamente
   em `admin_users`; novos clientes não são adicionados a essa tabela:

   ```sql
   insert into public.admin_users (user_id)
   values ('UUID_DO_USUARIO_ADMIN');
   ```

5. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no `.env.local`.
   A chave publishable/anon é usada no navegador; nunca coloque uma chave
   `service_role` no site.
5. Em **Authentication → URL Configuration**, configure a URL local e adicione
   `https://kit-feira.vercel.app/conta` à lista de URLs de redirecionamento
   permitidas para a confirmação de cadastro.
6. Para envios reais de confirmação de cadastro, configure um servidor SMTP
   próprio em **Authentication → SMTP Settings**. O serviço de e-mail padrão
   do Supabase tem limite baixo para testes e pode retornar `email rate limit
   exceeded`; após esse erro, aguarde o limite ser liberado antes de tentar
   novamente. Não desative a confirmação de e-mail só para contornar o limite.

O painel não controla estoque. Na aba **Loja Kit Feira**, cadastre, consulte,
edite, publique/oculte ou exclua kits prontos e produtos avulsos com descrição,
unidade, preço e foto. Ao excluir um item, os dados dos pedidos anteriores são
preservados. O checkout registra
o pedido e os itens com os preços confirmados pelo banco antes de oferecer a
confirmação pelo WhatsApp `11 97077-3006`; o status inicial fica como aguardando confirmação.
Produtos vendidos por kg aceitam quantidades de meio em meio quilo. Clientes
podem comprar sem conta; quando entram, seus novos pedidos e endereços ficam
salvos na própria área `/conta`. Contas de clientes veem apenas os próprios
dados e pedidos; o CRM e os dados de todos os pedidos permanecem restritos aos
administradores autorizados.
O CEP busca rua, bairro e cidade para o checkout e os endereços da conta. Na
aba **Recados da feira**, administradores publicam e ocultam chamadas de preço
que aparecem animadas na loja.

Na aba **Custos de compra**, registre cada compra de fruta ou insumo com
quantidade, unidade e total pago. O painel compara o preço por unidade com a
compra anterior do mesmo item e unidade e mostra aumento, economia ou primeiro
preço registrado.

## Executar localmente

```sh
npm install
npm run dev
```

- Loja: `/`
- Login/cadastro de clientes: `/login`
- Conta, endereços e pedidos: `/conta`
- Painel administrativo: `/admin`
- Build de produção: `npm run build`

## Publicar no GitHub Pages

O workflow [`.github/workflows/pages.yml`](./.github/workflows/pages.yml)
compila e publica o site ao enviar alterações para `main` ou `master`, ou ao
iniciá-lo manualmente em **Actions**.

1. Crie ou escolha um repositório GitHub e envie o código para a branch `main`
   (ou `master`). O arquivo `.gitignore` exclui `.env.local`, credenciais e
   `node_modules`.
2. Em **Settings → Secrets and variables → Actions**, crie os secrets
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Não envie `.env.local` ao Git.
3. Em **Settings → Pages**, selecione **GitHub Actions** como origem.
4. Execute o workflow **Publish Kit Feira** ou envie um novo commit. O endereço
   publicado aparecerá no ambiente `github-pages` da execução.

O build configura o caminho do site para o nome do repositório e inclui um
fallback para abrir as rotas do app no GitHub Pages. O projeto não está conectado a
um repositório remoto por padrão.

## Publicar na Vercel

O projeto Kit Feira também está conectado ao repositório `dev-gsus/kit-feira`
na Vercel. Cada push para `main` inicia uma publicação; o endereço principal é
`https://kit-feira.vercel.app`.

Em **Settings → Environment Variables**, mantenha `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` disponíveis nos ambientes Production, Preview e
Development. A chave usada no site deve ser a chave publishable do Supabase;
ela é incorporada ao JavaScript do navegador. Nunca use `service_role`.
O arquivo `vercel.json` reescreve `/admin`, `/login` e `/conta` para a aplicação
React para que as rotas funcionem também ao abrir o link diretamente.

## Sorteios

Os sorteios continuam disponíveis em seção própria. O CPF permite uma
inscrição por pessoa em cada sorteio; os resultados só aparecem no site após
publicação pelo painel.
