---
timestamp: 2026-09-01T19-21-59Z
slug: apps-frontends-customer-app-m-slug-page-tsx
---
## Design Health Score

| # | Heurística | Nota | Problema principal |
|---|---|---:|---|
| 1 | Visibilidade do estado | 2 | O modo sem mesa aparecia simultaneamente como alerta e painel de orientação. |
| 2 | Correspondência com o mundo real | 3 | A linguagem é clara, mas o estado anônimo parecia uma falha operacional. |
| 3 | Controle e liberdade | 3 | Busca, categorias e fechamento dos diálogos são diretos. |
| 4 | Consistência e padrões | 2 | CSS local, `Button` compartilhado e cores fixas produziam layouts e temas divergentes. |
| 5 | Prevenção de erros | 3 | Sessão, checkout e disponibilidade são protegidos, com pequenas lacunas visuais. |
| 6 | Reconhecimento em vez de memória | 3 | Ações principais são visíveis; categorias roláveis e informação por ícone eram menos descobríveis. |
| 7 | Flexibilidade e eficiência | 2 | Busca e filtros ajudam, mas faltava escolha explícita de tema. |
| 8 | Estética e minimalismo | 2 | Banner duplicado, contraste fragmentado e tipografia inconsistente atrasavam o cardápio. |
| 9 | Reconhecer e recuperar erros | 3 | As mensagens são acionáveis e preservam o fluxo. |
| 10 | Ajuda e documentação | 2 | Existe ajuda contextual mínima, mas concentrada no botão de informações. |
| **Total** |  | **25/40** | **Aceitável; melhorias importantes necessárias** |

## Design Specificity Verdict

**Avaliação de design:** a identidade de restaurante está presente na marca, no catálogo e na linguagem, mas a composição ainda era parcialmente intercambiável com qualquer catálogo genérico. O conflito entre serifas locais, componentes do design system e superfícies claras fixas tirava coerência da experiência.

**Varredura determinística:** o detector estático retornou zero achados para os componentes TSX. Isso não contradiz a crítica: os defeitos principais estavam no CSS computado, no contraste entre temas e na composição responsiva. A inspeção por Playwright confirmou a diferença entre a ausência de alertas sintáticos e os problemas renderizados.

## Overall Impression

A base funcional era boa e acessível, mas o cardápio começava como uma tela de diagnóstico, não como uma experiência de escolha. A maior oportunidade era devolver prioridade aos pratos, usando um único sistema visual nos três modos de tema.

## What's Working

- Busca, categorias e cards dão uma rota de navegação compreensível sem esconder o catálogo.
- Sessão de mesa e checkout preservam verdade operacional; o modo público não inventa confirmação.
- Elementos importantes já usam controles nativos, nomes acessíveis, `fieldset`, `legend` e `aria-pressed`.

## Priority Issues

### P1 — Tema escuro fragmentado

**Por que importa:** toolbar, imagens substitutas, chips e checkout pareciam pertencer a outro tema, reduzindo contraste e confiança.  
**Correção:** substituir cores fixas por tokens `--gm-*` em menu e checkout.  
**Comando sugerido:** `$impeccable colorize`.

### P1 — Estado sem mesa duplicado e com tom de erro

**Por que importa:** navegar sem QR é válido, mas dois painéis empurravam a busca e sugeriam falha.  
**Correção:** manter uma única orientação compacta e reservar banners para sessão realmente confirmada ou indisponível.  
**Comando sugerido:** `$impeccable distill`.

### P1 — Cards herdavam comportamento visual do botão

**Por que importa:** `display`, `white-space`, hover e peso tipográfico do componente compartilhado deformavam os cards, sobretudo com textos longos.  
**Correção:** declarar o layout completo do card e usar a variante neutra do botão.  
**Comando sugerido:** `$impeccable layout`.

### P1 — Contraste instável no cabeçalho e checkout

**Por que importa:** branding claro e superfícies claras fixas podiam apagar título, opção selecionada e controles.  
**Correção:** overlay consistente no branding e superfícies semânticas no drawer.  
**Comando sugerido:** `$impeccable audit`.

### P1 — Ausência de seletor Claro/Escuro/Sistema

**Por que importa:** a demonstração não permitia comparar temas e não persistia a intenção do usuário.  
**Correção:** controle segmentado visível, persistência da preferência e listener do sistema.  
**Comando sugerido:** `$impeccable adapt`.

## Persona Red Flags

**Casey, usuário mobile distraído:** o catálogo começava tarde, o cabeçalho disputava espaço em 375 px e categorias adicionais não indicavam rolagem. O checkout escuro inicialmente tinha título e seleção quase invisíveis.

**Jordan, primeira visita:** o banner vermelho fazia um modo público válido parecer erro. A repetição entre o banner e “Use o QR Code da mesa” não deixava claro se era possível continuar navegando.

**Sam, usuário dependente de acessibilidade:** a semântica dos filtros era boa, mas contraste dependente de cor fixa e textos muito pequenos comprometiam baixa visão e zoom.

## Minor Observations

- O rodapé e estados de serviços também usavam cores fixas.
- Tipografia Georgia local entrava em conflito com `--gm-display`.
- A lista horizontal de categorias ocultava a scrollbar.
- O drawer mobile não ocupava simetricamente a viewport.

## Questions to Consider

- Os serviços públicos precisam permanecer todos expandidos após o catálogo ou podem ganhar divulgação progressiva?
- O cabeçalho deve priorizar a marca ou o primeiro produto em telas muito baixas?
- Quais informações do estabelecimento precisam estar sempre visíveis, e quais podem ficar no painel de informações?
