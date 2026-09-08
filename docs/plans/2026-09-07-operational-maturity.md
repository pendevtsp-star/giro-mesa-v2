# Evolução operacional — oito frentes

Escopo solicitado: aplicar as oito recomendações de maturidade e refinar o frontend existente. Não substituir integrações reais por simulações, duplicar módulos existentes ou declarar homologação sem evidência. O usuário informou que ainda não tem maquininhas contratadas.

## Sequência e critérios

| Frente | Trabalho e critério de aceite | Estado |
|---|---|---|
| 1. Continuidade | Guarda de espaço/inodes antes de baixar imagens/parar serviços, com estimativa conservadora para imagens de destino e recuperação; repetição segura de comandos e regressão do Edge Hub. | Implementado e testado localmente; carga k6 pendente |
| 2. Atendimento | Pedido pendente por organização/unidade/operador/comanda, comandos persistidos com a mesma idempotência após recarga, retomada por etapa e liberação do rascunho somente após rejeição definitiva sem aceite parcial. | Implementado e testado localmente |
| 3. Pagamentos/fiscal | Diagnóstico atualizado após pareamento, nova conferência e mensagens operacionais compartilhadas. Bloqueios de fornecedor/homologação preservados, inclusive emissão fiscal. | Melhoria local validada; hardware e homologação pendentes |
| 4. Marketplace | Consulta ao contrato oficial do iFood; nenhum conector especulativo ou simulado foi adicionado. Primeiro provedor e acesso de homologação precisam ser confirmados pelo responsável. | Não implementado; depende da definição do provedor |
| 5. Lucro/perdas | Custo histórico da contagem aprovada, diferença física mais recente por insumo/local, margem por canal e taxas conciliadas. Custo ausente permanece desconhecido; zero conhecido continua zero. | Implementado e testado com PostgreSQL isolado |
| 6. Implantação | Checklist conferido pelo servidor, com estado de erro/recuperação, compatibilidade com backend anterior e atalhos para cardápio, equipe, produção e atendimento. Cadastros não são apresentados como homologação. | Implementado e testado localmente |
| 7. Gestão por exceção | Prioridades completas com expansão, filtros por responsável, totais corretos e atalho para preparação da unidade; hierarquia e ações refinadas no dashboard. | Implementado e testado localmente |
| 8. Retenção | Custo e margem atribuída com cobertura explícita; atribuição determinística por pagamento, correção de vencedor tardio, estornos e reprocessamento sem duplicidade. | Implementado e testado com PostgreSQL isolado; limite abaixo |

## Direção visual

Modo Operate, refinamento da identidade do Cardápio definida em DESIGN.md: superfícies discretas, hierarquia por texto e espaço, ações próximas do objeto, controles compartilhados, luz/escuro e 375 px. Não é uma troca de marca. Usar Impeccable com inspeções visuais em lotes e revisão independente.

Referências consultadas em 07/09/2026 (declarações dos fornecedores, não benchmarks independentes):

- [Lightspeed: navegação por tarefas frequentes](https://resto-support.lightspeedhq.com/hc/en-us/articles/360005777873-About-navigation-in-Restaurant-POS).
- [Lightspeed: mesas e divisão por assento](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804656689-About-floor-plans-and-tables).
- [Consumer: atendimento na mesa e continuidade em rede local](https://www.consumer.com.br/comanda-mobile).
- [Toast Go: operação no dispositivo de mão](https://pos.toasttab.com/hardware/toast-go).

## Limites de entrega

Registrar separadamente código local, testes automatizados, CI, publicação, execução em produção e homologação externa. Não fazer push/deploy nem contratar provedores implicitamente. Preservar scratch/ e alterações de outros trabalhos. Atualizar este documento com evidências e pendências ao integrar cada frente.

## Fechamento local — 08/09/2026

- Ops: 314 testes em 70 arquivos aprovados; typecheck e build aprovados. O lint passou com avisos de CSS preexistentes; o build ainda alerta para o chunk principal de aproximadamente 639 kB antes de gzip. Não foi medido ganho de Core Web Vitals.
- Navegador: 35 cenários conjuntos de dashboard, salão, balcão, dispositivos e relatórios aprovados; mais o cenário de Configurações aprovado. Esse último percorre os tamanhos dentro do projeto desktop, e sua duplicata no projeto mobile é intencionalmente ignorada. Axe, claro/escuro e 375 px incluídos nas matrizes das áreas alteradas. APIs de UI interceptadas com contratos de teste; isso não é homologação ponta a ponta de fornecedor nem reteste da produção nova.
- PostgreSQL 17 local e descartável, restrito a loopback: migrations até `0080_campaign_attribution_cost` aplicadas; cinco testes de integração relevantes aprovados (configurações 2, relatórios 1, inventário 1, atribuição de campanhas 1), incluindo isolamento de tenant, permissões, custo desconhecido/zero e estornos.
- Pacotes: 19 testes de contratos e 27 de banco aprovados; builds de API/worker aprovados; OpenAPI e clientes TypeScript/C# regenerados. Cliente C# compilado com zero erros/avisos.
- Continuidade: 33 testes de endurecimento do deploy, 15 testes do executor de carga e 67 testes do Edge Hub aprovados. Os 15 testes do executor **não** representam execução de carga k6.
- Revisão visual Impeccable: tabelas de margem e inventário reutilizam o layout móvel empilhado existente; hierarquia do dashboard, âncora do checklist e mensagens de maquininha refinadas. A única ocorrência no detector dos demais arquivos era uma animação de largura, removida. O componente de campanhas foi verificado separadamente.
- Grafo e wiki atualizados; mapa inclui o checklist. Nenhuma exclusão material, push, commit ou promoção à VPS neste lote. `scratch/` preservado.

### Pendências que impedem declarar as oito frentes concluídas

1. Marketplace: escolher o provedor e obter acesso de desenvolvimento/homologação antes de fechar o fluxo de catálogo, recebimento, cancelamento e reconciliação. Referência consultada: [fluxo oficial de pedidos do iFood](https://developer.ifood.com.br/pt-BR/docs/guides/modules/order/workflow/).
2. Maquininha/fiscal: contrato, equipamento e credenciais de homologação, além dos aceites aplicáveis; o usuário informou não ter adquirente contratado. Nenhuma transação financeira ou emissão fiscal real foi feita neste lote.
3. Release: `production:baseline` falha porque ainda referencia a migration `0079`; o gate fiscal tem 6 testes aprovados e 1 falha por falta de evidência de recuperação para `0080`. Não mudar esses comprovantes para “aprovado” sem gerar evidência real e artefatos imutáveis. CI, publicação, backup/recuperação, aplicação da migration e verificação da produção seguem pendentes de um fluxo de release autorizado.
4. Carga: o executor existente usa Docker/k6; Docker/WSL estava indisponível. PostgreSQL nativo permitiu testar persistência sem alterar a infraestrutura do usuário, mas não substitui o teste de carga e continuidade de rede/hardware em campo.

### Limites deliberados dos indicadores

A atribuição de campanha mantém o contrato singular existente de uma comanda por entrega: pagamentos da primeira comanda vencedora são conciliados, não um relacionamento de múltiplas compras por campanha. Ampliar esse contrato exige modelo próprio antes de alegar receita vitalícia atribuída. Custo e margem ficam indisponíveis quando a cobertura não é demonstrável; taxas só entram quando a conciliação fecha com o total da comanda. A estimativa de espaço do deploy não é uma medida exata do tamanho descompactado de imagens remotas.

### Evidências locais

Capturas, traces de falha e TRX do Edge Hub ficam em `C:\Users\maxue\AppData\Local\Temp\giromesa-pg-20260907-2200` (`e2e-final`, `screens-setup`, `screens-reports`, `screens-device`, `screens-dashboard`, `edge-results`). Dados e arquivos temporários de teste não foram adicionados ao repositório.

### Comparação resumida

O produto avançou em recuperação do atendimento, transparência financeira e legibilidade móvel, alinhado a padrões operacionais observados em Lightspeed, Toast e Consumer. Não há evidência para declarar equivalência integral aos líderes: integrações homologadas, desempenho sob carga e operação real sem internet ainda são critérios abertos.
