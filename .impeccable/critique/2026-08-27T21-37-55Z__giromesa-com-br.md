---
target: "Landing pública GiroMesa https://giromesa.com.br"
total_score: 17
max_score: 32
na_heuristics: 7,9
p0_count: 0
p1_count: 3
timestamp: 2026-08-27T21-37-55Z
slug: giromesa-com-br
---
Method: dual-agent (A: /root/design_review · B: /root/browser_evidence)

# Crítica da landing pública GiroMesa

Inspeção de [giromesa.com.br](https://giromesa.com.br/) em 27/08/2026, desktop 1440 px e celular 375 px. Revisão de design e navegação; não é medição de conversão nem homologação do sistema.

## Veredito

**A identidade tem personalidade, mas a apresentação parece incompleta.** Verde profundo, fundo quente e títulos serifados combinam com a proposta. Eu preservaria essa direção. O problema principal é que a página pede confiança sem mostrar o produto, contém um caminho de navegação sem destino e perde qualidade no celular.

Há linguagem própria de restaurante, mas a sequência de benefícios, planos e depoimentos ainda parece um modelo genérico de SaaS. A maior oportunidade é mostrar uma jornada real de pedido, produção e caixa, com imagens legíveis do sistema.

## Saúde de design

Escala heurística de 0 a 4; notas não são métricas de conversão. Critérios não verificados ou não aplicáveis ficam fora do denominador.

| Heurística | Nota | Principal evidência |
|---|---:|---|
| Visibilidade do estado | 2/4 | FAQ responde; CTA de produto não leva a conteúdo. |
| Linguagem do mundo real | 2/4 | Vocabulário operacional misturado a chaves internas e linguagem administrativa. |
| Controle e liberdade | 2/4 | Celular perde navegação e acesso evidente à operação. |
| Consistência | 2/4 | Rótulos e destinos geram expectativas diferentes. |
| Prevenção de erros | 2/4 | Disponibilidade de offline e condições do teste ficam ambíguas. |
| Reconhecimento | 2/4 | Planos claros no desktop; comparação móvel depende de lembrar os anteriores. |
| Flexibilidade e eficiência | n/a | Aceleradores de uso avançado não são necessários nesta landing. |
| Estética e minimalismo | 2/4 | Boa tipografia; hero e seção de confiança com espaços sem conteúdo útil. |
| Recuperação de erros | n/a | Não provoquei falhas nem enviei formulários em produção. |
| Ajuda e documentação | 3/4 | FAQ responde dúvidas relevantes de contratação e implantação. |
| **Total** | **17/32 — aceitável, 53%** | **Melhorias significativas necessárias.** |

## O que funciona

- **A frase principal é pertinente e memorável.** “O salão gira. A gestão acompanha.” conecta a marca ao cotidiano do cliente.
- **A direção visual merece ser mantida.** A tipografia editorial e o verde dão mais identidade que uma apresentação genérica de software.
- **Três planos e quatro etapas de implantação são compreensíveis.** A FAQ recolhível permite aprofundar sem transformar tudo em texto aberto.

## Cinco prioridades

### 1. [P1] O caminho para conhecer o produto não funciona

O CTA “Conhecer o produto” e outros links usam `#produto`, mas a seção não existe. O clique muda a URL sem revelar conteúdo. A home não contém imagens; no desktop, a segunda coluna do hero permanece vazia.

**Impacto:** quem procura evidência antes de solicitar contato fica sem resposta.

**Correção:** publicar uma seção com esse ID e uma captura real da operação, explicando o fluxo mostrado. Até haver material, apontar o botão para uma seção existente com rótulo correspondente e não reservar coluna para mídia ausente. Não preencher com um dashboard inventado. **Comando:** `$impeccable layout`.

### 2. [P1] O celular perde navegação e margens

Em 375 px, menu e acesso à operação desaparecem sem substituto. Logo, texto e botões encostam nas bordas. A página tem aproximadamente 7.700 px; os planos começam depois de cerca de 3.380 px de rolagem, sem atalho no cabeçalho.

**Impacto:** consultar preços e entrar no sistema exigem procura desnecessária. Ausência de overflow horizontal não significa boa adaptação móvel.

**Correção:** garantir margens laterais efetivas de 16–20 px; preservar acesso à operação e um menu compacto com atalhos de produto e planos. Conferir a cascata do contêiner no CSS servido. **Comando:** `$impeccable adapt`.

### 3. [P1] A promessa comercial não acompanha as condições reais

O primeiro CTA sugere começar um teste gratuito; o destino é uma solicitação de avaliação com retorno da equipe, e o período começa após ativação. Offline aparece entre os itens do plano, mas a FAQ condiciona sua disponibilidade comercial à homologação.

**Impacto:** o visitante pode interpretar como imediato ou disponível algo que depende de uma etapa posterior.

**Correção:** padronizar a ação como solicitação de teste assistido; explicar junto ao botão quando os 14 dias começam. Nos planos, distinguir claramente o que está disponível, o que é adicional e o que ainda depende de homologação, conforme a verdade comercial vigente. **Comando:** `$impeccable clarify`.

### 4. [P2] Detalhes internos aparecem como conteúdo público

Os benefícios mostram chaves como `operations`, `insights` e `finance`. Outros rótulos falam de publicação e catálogo em vez de ajudar o cliente a decidir.

**Impacto:** parecem placeholders e quebram a linguagem profissional da página.

**Correção:** renderizar ícones reconhecidos ou retirar o elemento; nunca exibir a chave interna. Trocar a linguagem editorial por benefícios e condições úteis, mantendo a publicação validada no backend. **Comando:** `$impeccable polish`.

### 5. [P2] A seção de confiança não apresenta evidências

A área intitulada “Experiências publicadas” não contém depoimentos. Ocupa aproximadamente 424 px no desktop e apresenta uma ressalva de homologação onde o visitante esperava comprovação.

**Impacto:** alonga a página e introduz dúvida logo depois dos preços.

**Correção:** não renderizar a seção quando a lista estiver vazia. Manter ressalvas junto ao recurso correspondente e acrescentar depoimentos apenas quando forem reais e autorizados. **Comando:** `$impeccable distill`.

## Carga cognitiva e jornada

**Carga moderada: 3 de 8 critérios com problemas.** Foco, agrupamento, hierarquia, sequência e divulgação progressiva funcionam. Pesam contra os seis benefícios com igual destaque, as sete ações no cabeçalho desktop e a comparação móvel que exige lembrar os planos anteriores. A contagem de opções é um sinal de atenção, não uma regra automática de reprovação.

**Jornada:** boa primeira impressão → falta de prova do produto → recuperação nas etapas de implantação → dúvidas comerciais nos planos → seção de confiança vazia. O maior ganho está em eliminar esses pontos de dúvida.

## Alertas por perfil

- **Primeira visita:** entende o segmento atendido, mas não consegue visualizar o sistema pelo CTA de produto.
- **Visitante móvel:** não encontra atalhos de preços e acesso; o banner inicial de cookies ocupa cerca de 259 px dos 900 px da tela observada.
- **Comprador criterioso:** percebe divergência entre o recurso incluído e a ressalva de disponibilidade futura.

## Observações menores

O símbolo de contato móvel é pouco reconhecível. O destaque do plano intermediário deveria explicar para qual necessidade ele serve. O banner de cookies pode ser mais compacto sem dificultar a recusa. Não há motivo para trocar a tipografia serifada apenas por preferência estética.

O axe encontrou uma violação moderada por viewport: o contato flutuante está fora dos landmarks (`region`, seletor `.whatsapp`). O foco por teclado estava visível nos controles percorridos. Isso não substitui uma auditoria completa de acessibilidade.

## Detector e confronto com a revisão visual

Na home, o detector registrou **23 ocorrências de regras no desktop e 34 no celular**, agrupadas em 15 e 26 seletores. São alertas brutos, não essa quantidade de defeitos confirmados. Nas páginas de teste e contato, usadas apenas para conferir os destinos, foram 7 e 6 ocorrências.

As duas avaliações concordaram sobre a falta de margens móveis, a ausência de imagem do produto, os links para seção inexistente e as inconsistências comerciais. O detector também apontou textos auxiliares a 9,6–10 px e respostas longas no FAQ desktop. Foram descartados falsos positivos de texto em degradê e marquee; o alerta sobre Inter não justifica trocar a fonte. Os resultados usados foram coletados antes de desenhar overlays, evitando contar o texto da própria ferramenta.

A injeção do detector por URL local falhou por proteção de acesso a loopback. O bundle local foi executado pela API de automação, sem mudar permissões do navegador. As sobreposições foram capturadas, mas não há uma aba visível aberta para o usuário.

Evidências: [hero desktop](C:/Users/maxue/.codex/visualizations/2026/08/27/01a0451f-7e1d-7e52-9e7d-a7449ecb526a/assessment-a/1440-first.png), [primeira tela móvel](C:/Users/maxue/.codex/visualizations/2026/08/27/01a0451f-7e1d-7e52-9e7d-a7449ecb526a/assessment-a/375-first.png), [relatório técnico B](C:/Users/maxue/.codex/visualizations/2026/08/27/01a0451f-7e1d-7e52-9e7d-a7449ecb526a/assessment-b/report.md).

## Questões de direção

Que tela real melhor demonstra o fluxo de pedido até o caixa? A ação principal deve assumir explicitamente a implantação assistida? Quais recursos podem ser usados hoje sem homologação futura?

## Limites

Home observada com HTTP 200 em ambos os tamanhos. FAQ, recusa de cookies e navegação de produto foram exercitadas; páginas de destino foram lidas sem envio de dados. Não foram medidos conversão, desempenho em rede lenta, leitores de tela, falhas de backend ou funcionalidades internas. A implementação do site não foi alterada.
