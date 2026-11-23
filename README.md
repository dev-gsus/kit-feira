# Kit Feira

Loja de kits de frutas com checkout e confirmação pelo WhatsApp, histórico de
pedidos e custos de compra, painel administrativo e campanhas de sorteio.

## Preparar o Supabase

1. Abra o SQL Editor do projeto e execute [`supabase/schema.sql`](./supabase/schema.sql).
   O script cria as tabelas, políticas de acesso, funções de checkout e
   comparação de preços e o bucket de fotos dos kits. Ele também atualiza o
   esquema dos sorteios existente.
2. Em **Authentication → Users**, cadastre as contas que poderão administrar o painel.
   As contas existentes quando o esquema inicial foi instalado já foram
   autorizadas; novas contas precisam ser adicionadas manualmente:

   ```sql
   insert into public.admin_users (user_id)
   values ('UUID_DO_USUARIO_ADMIN');
   ```

3. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no `.env.local`.
   A chave publishable/anon é usada no navegador; nunca coloque uma chave
   `service_role` no site.
4. Em **Authentication → URL Configuration**, mantenha a URL local e, após
   publicar, adicione também o endereço do GitHub Pages à lista de URLs de
   redirecionamento permitidas.

O painel não controla estoque. Cadastre kits com descrição, conteúdo, preço e
foto na aba **Loja Kit Feira**. O checkout registra o pedido e os itens com os
preços confirmados pelo banco antes de abrir o WhatsApp `11 97077-3006`; o
status inicial fica como aguardando confirmação. Dados pessoais e endereço
ficam visíveis apenas para administradores.

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
fallback para abrir `/admin` no GitHub Pages. O projeto não está conectado a
um repositório remoto por padrão.

## Sorteios

Os sorteios continuam disponíveis em seção própria. O CPF permite uma
inscrição por pessoa em cada sorteio; os resultados só aparecem no site após
publicação pelo painel.
