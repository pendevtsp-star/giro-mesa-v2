# Site comercial GiroMesa

## Prévia local da landing

A revisão visual alterna branco gelo, sálvia e verde-floresta com tokens de
`@giromesa/ui`. O hero usa três cenas ilustrativas, texto sobreposto e transições
automáticas a cada 8 segundos, sincronizadas ao preenchimento do indicador ativo.
Os indicadores também permitem selecionar uma cena. A reprodução continua mesmo
com o mouse sobre o hero. As cenas param fora da viewport, com a aba oculta,
durante o foco de teclado e com preferência por movimento reduzido.

As telas reais ficam ao fundo de um carrossel compacto na seção Produto, com
título e descrição sobrepostos. A passagem automática ocorre a cada 7 segundos,
com indicadores e setas, sem botão de reprodução. O mouse suspende a passagem
enquanto permanece sobre o carrossel; ao sair, a reprodução retoma. Foco de
teclado e arraste também suspendem a passagem durante a interação. Movimento
reduzido, aba oculta e seção fora da viewport suspendem a reprodução.
O fundo decorativo reage ao ponteiro
sem bloquear a rolagem. Os prompts, origens e a resolução entregue das cenas
estão em [.impeccable/hero-assets.md](.impeccable/hero-assets.md).

Para a revisão editorial local, execute `pnpm --filter @giromesa/site dev`
com estas variáveis no processo (não em produção):

```dotenv
SITE_LANDING_PREVIEW=1
API_URL=https://api.giromesa.com.br
NEXT_PUBLIC_API_URL=http://127.0.0.1:3218
NEXT_PUBLIC_OPS_URL=http://127.0.0.1:3118
```

`API_URL` é a origem do GET de catálogo no servidor. Autenticação, formulários
e outros clientes continuam usando `NEXT_PUBLIC_API_URL`. A prévia não envia
identificador de visitante ao catálogo nem registra impressões de experimentos.
Os preços e demais textos continuam vindo do catálogo publicado; apenas o
subtítulo aprovado para revisão é aplicado explicitamente por `landing-preview.ts`.

## Capturas do produto

`public/product/*-atual.jpg` contém capturas sem edição do Ops local, feitas em
19/09/2026 na unidade QA Balcão: Salão, Balcão e Cardápio. Os valores e itens
visíveis são dados do ambiente de teste, não resultados de clientes. Não há
depoimentos na landing.

A lista, dimensões, legendas e subtítulo da revisão ficam em
`lib/landing-preview.ts`. Substitua as imagens por novas capturas reais e atualize
essa lista quando a revisão visual do Ops terminar. A flag só funciona fora de
produção. Antes da publicação, revisar as capturas e publicar o texto/mídia no
catálogo comercial; em produção a seção Produto usa a mídia publicada. As cenas
ilustrativas do hero estão em `public/hero/` e não representam clientes reais.

Validação: `pnpm --filter @giromesa/site lint`, `typecheck` e `test`; inspecionar
375 px e desktop, botões do carrossel, movimento reduzido e rolagem por toque.
