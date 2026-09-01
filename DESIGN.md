# GiroMesa V2 — sistema visual shadcn/ui de produção

O Cardápio operacional é a referência visual canônica. A implementação compartilhada segue shadcn/ui com Tailwind CSS v4 e vive em `packages/ui`; CSS específico de domínio pode permanecer junto da feature, mas não deve redefinir primitivos globais.

## Princípios

- Interface compacta, previsível e orientada à próxima ação.
- Hierarquia por tipografia, espaçamento e contraste; evite sombras fortes, gradientes decorativos e excesso de contêineres.
- Uma ação primária clara por contexto. Ações secundárias permanecem visíveis sem competir com a principal.
- Estados operacionais são explícitos: carregando, sincronizando, offline, vazio, sucesso, alerta e erro.
- A mesma linguagem deve funcionar em light/dark, desktop/mobile e mouse/teclado/toque.

## Fonte de verdade

- Tokens: `packages/ui/src/tokens/*.css`.
- Temas: `packages/ui/src/themes/{light,dark}.css`.
- Componentes: `packages/ui/src/components`.
- Configuração do gerador shadcn: `packages/ui/components.json` e o `components.json` de cada frontend.
- Utilitários de composição: `packages/ui/src/lib/utils.ts` (`cn`).
- Padrões extraídos do Cardápio: `packages/ui/src/patterns.css`.
- Consumo global: `@giromesa/ui/styles.css`.
- Regras específicas do catálogo: `apps/frontends/ops/src/features/catalog/catalog.css`.

Novas cores, espaçamentos, raios, sombras e botões reutilizáveis entram primeiro em `packages/ui`. Não duplique um padrão existente dentro de uma página.

Os tokens públicos shadcn (`--background`, `--foreground`, `--primary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input` e `--ring`) são a camada semântica. Os aliases `--gm-*` permanecem durante a migração para compatibilidade com as features existentes.

## Cores e superfícies

- Marca/ação: `--gm-brand`, `--gm-brand-strong`, `--gm-action`, `--gm-action-hover`.
- Texto: `--gm-ink`; texto secundário: `--gm-muted`.
- Fundo da aplicação: `--gm-paper`; superfície: `--gm-surface`; superfície discreta: `--gm-surface-soft`; rebaixo: `--gm-surface-sunken`.
- Bordas: `--gm-border`; foco: `--gm-focus`.
- Feedback: `--gm-success`, `--gm-info`, `--gm-warning`, `--gm-danger` e respectivas superfícies `*-soft`.
- Nunca escolha cor pelo tema atual. Use tokens semânticos para que `[data-theme="dark"]` faça a troca.

## Tipografia

- Interface: `--gm-font` (Inter/system sans).
- Títulos e títulos fortes de modal: `--gm-display`, alinhado à pilha sans-serif da interface shadcn.
- Escala: `--gm-font-xs`, `sm`, `base`, `md`, `lg`, `xl`, `2xl`.
- Corpo operacional padrão: `0.82rem–0.88rem`; metadados/pills: `0.68rem–0.76rem`; título de card: aproximadamente `1.05rem`.
- Pesos 600–800 comunicam ação/status. Evite negrito em todos os textos.
- Títulos usam line-height compacto e leve tracking negativo; corpo usa `--gm-leading-normal`.

## Espaçamento, bordas e densidade

- Use a escala `--gm-space-1` a `--gm-space-16`; prefira passos de 4/8/12/16/24/32 px.
- Raios: 6 px em controles, 8 px em campos, 12 px em cards, 18 px em modais, `999px` em pills.
- Cards têm borda de 1 px, superfície plana e `--gm-shadow-sm` apenas quando necessário.
- Evite mais de três níveis simultâneos de superfície.
- Controles devem permitir leitura rápida: altura mínima 34 px em ações compactas e 40 px no padrão.

## Botões e ações

- Use `Button` de `@giromesa/ui`: `primary`, `secondary`, `ghost` e `danger`; tamanhos `sm` e padrão.
- Botão primário: ação confirmatória ou avanço principal. Um por grupo visual.
- Secundário: ações reversíveis/utilitárias. Ghost: navegação leve. Danger: operação destrutiva confirmada.
- Ícone acompanha rótulo quando reduz ambiguidade; botão apenas com ícone exige `aria-label`/tooltip.
- Estados obrigatórios: hover, active, focus-visible, disabled e busy.
- Novo padrão de botão deve ser implementado/testado na biblioteca antes de ser usado no app.

## Padrões do Cardápio disponíveis na biblioteca

- `.gm-toolbar`: resumo + ações com wrap responsivo.
- `.gm-form-stack`, `.gm-form-grid`, `.gm-form-field`, `.gm-form-control`: formulários densos e consistentes.
- `.gm-disclosure`: seções progressivas para opções avançadas.
- `.gm-observability-row`: linha de saúde, sincronização e contexto operacional.
- `.gm-pill` e tones semânticos: metadados e estados compactos.

Use esses padrões antes de criar classes locais equivalentes.

## Formulários

- Label sempre visível; placeholder é exemplo, não substituto do label.
- Valide no cliente para feedback imediato e novamente no backend.
- Erro fica próximo ao campo e também pode alimentar um toast de resumo.
- Não limpe o formulário antes da confirmação real da operação.
- Campos financeiros exibem formato local, mas enviam inteiros em centavos.
- Agrupe opções avançadas em disclosures; o fluxo principal deve permanecer curto.

## Modais

- Use `Modal` de `@giromesa/ui`, baseado em `<dialog>`.
- Larguras: `sm 440px`, `md 560px`, `lg 720px`, `xl 1100px`.
- Limite vertical: até `92dvh`; corpo rola internamente e cabeçalho permanece estável.
- Em mobile o modal encosta na base, respeita safe areas e nunca excede a viewport.
- Escape e botão Fechar devem devolver foco ao acionador. Não empilhe modais sem necessidade operacional real.

## Responsividade

- O sistema deve funcionar sem overflow horizontal a partir de 375 px.
- Referências: 480 px (telefone estreito), 640/760 px (empilhamento), 1100 px (toolbars/grids), 1440 px (desktop amplo).
- Grids colapsam para uma coluna; toolbars fazem wrap; tabelas extensas usam contêiner com rolagem própria e cabeçalho compreensível.
- Não fixe `grid-template-columns` inline. Use classes responsivas e `min-width: 0` nos filhos.
- Áreas de toque devem preservar pelo menos 40 px quando o contexto não for uma toolbar densa.

## Dark mode e movimento

- Dark mode é dirigido por `[data-theme="dark"]` e tokens; teste contraste em ambos os temas.
- Elementos elevados usam borda e sombra escura sem halos claros.
- Respeite `prefers-reduced-motion`; animações não podem ser necessárias para compreender estado.
- Transições usam `--gm-duration-*` e `--gm-ease-*`, normalmente 140–200 ms.

## Observabilidade visual

- Topbar informa conexão/sincronização sem bloquear a tarefa.
- Operações assíncronas mostram busy no controle de origem e impedem envio duplicado.
- Toasts distinguem sucesso, informação, alerta e erro; erros usam `role="alert"`.
- Toasts são transitórios e desaparecem automaticamente após 2 segundos; informações que exigem ação permanecem no campo ou painel de origem.
- Dados não confirmados não permanecem visualmente como salvos após falha; faça rollback ou recarregue a fonte real.
- Fluxos somente locais devem exibir “prévia local/não persistido” e nunca mensagem de sucesso persistente.
- Estados vazios explicam a próxima ação; skeletons preservam a geometria; logs técnicos não substituem mensagens para o operador.

## Acessibilidade e conteúdo

- WCAG AA, foco visível, ordem de tab lógica, landmarks e nomes acessíveis são requisitos.
- Não comunique estado somente por cor; combine texto/ícone.
- `fieldset`/`legend` para grupos, `aria-pressed` para toggles e `aria-current` para navegação.
- Textos são diretos, operacionais e em português brasileiro. Evite prometer integração ou persistência inexistente.

## Checklist de revisão visual

- Reutiliza biblioteca/tokens e não cria variante duplicada?
- Funciona em 375, 412, 768, 1024 e 1440 px sem overflow de página?
- Light e dark preservam contraste e hierarquia?
- Teclado, Escape, retorno de foco e leitor de tela funcionam?
- Loading, erro, vazio, offline e sucesso são distinguíveis?
- Valores recusados pela API voltam ao último estado confirmado?
- A ação principal é óbvia e o restante não polui a tela?
