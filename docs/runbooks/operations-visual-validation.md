# Validação visual dos módulos operacionais

## Revisão transversal de 25/09/2026

Esta rodada amplia a identidade de Mesas e comandas/Balcão para o aplicativo Ops. Os registros das rodadas anteriores abaixo são históricos e não significam que seus fluxos foram novamente homologados hoje.

### Alterações desta rodada

- Fundo branco gelo aplicado pelo shell a todos os módulos operacionais, mantendo os tokens e o tema escuro.
- Menu lateral com grupos Operação, Gestão, Financeiro e fiscal e Administração; acesso direto às áreas de atendimento, seleção com borda/contraste e menos rótulos redundantes. Permissões e links existentes preservados.
- Menu recolhido corrigido: todos os grupos permanecem acessíveis por ícones e nomes, inclusive os que estavam fechados antes de recolher.
- Rótulos de campos explicitamente verticais corrigidos na biblioteca compartilhada. Checkboxes e rótulos comuns não recebem essa mudança.
- Compras e CRM sem título global duplicado. Cadastros, categorias, adicionais, promoções, PDF, Estoque, Pessoas, Financeiro, Relatórios e Equipamentos receberam ajustes localizados de espaçamento, campos, ações e responsividade.
- Relatórios sem sobreposição entre contexto e ações; resumo de filtros sem texto visual duplicado e com quebra dos indicadores em telas pequenas.
- Configurações com bloco de código gerencial compacto. Os cinco atalhos internos agora movem rolagem/foco sem trocar a rota por engano.
- Acesso por teclado “Ir para o conteúdo” corrigido para preservar a rota.
- Fechamento da equipe: observação preservada após erro ao confirmar fechamento ou decidir perda. Uma confirmação bem-sucedida continua fechando e limpando o formulário.
- Configuração de impressão deixa de anunciar carregamento depois de uma falha; erro e opção de recarregar permanecem visíveis.

### Cobertura atual por módulo

Inspeção de código pelos agentes, integração e inspeção pelo navegador integrado pelo agente principal. Sessão autenticada no frontend local 3118, API 3218 e banco QA existente. Não foram enviados pagamentos, impressões físicas, mensagens, convites ou alterações de credenciais. A revisão não representa homologação de cada combinação de botão, dado e permissão.

| Módulo | Inspeção de interface nesta rodada | Limite atual |
| --- | --- | --- |
| Visão geral | Indicadores, personalização e expansão de detalhes; tela de 375 px | Sem validar indicadores por dados de produção |
| Mesas e comandas | Regressão da lista, filtros, hierarquia e navegação móvel | Jornadas de atendimento completas são da rodada anterior |
| Balcão e retirada | Fila, contraste e modal Novo pedido em 375 px | Não foi criada nova comanda nesta rodada |
| Recepção e espera | Nova reserva, cliente sem reserva, histórico e estados vazios; desktop/mobile | Sem nova reserva persistida |
| Produção KDS | Estação vazia, menu do terminal, configuração e navegação; 375 px | Sem ticket ativo para transições nesta rodada |
| Entregas | Abas de pedidos/entregadores/zonas; cadastros de entregador e zona; 375 px | Sem despacho ou envio externo |
| Contas e caixa | Gavetas, sangria/suprimento e conferência de fechamento; desktop | Sem lançar movimento ou encerrar turno |
| Cardápio | Lista, editor de categoria e novo produto; 375/768 px | Sem salvar alterações no catálogo |
| QR das mesas | Guarda de publicação e revisão do formulário em código/testes | A unidade exige cardápio publicado para mostrar o editor real |
| Estoque | Novo item e campos avançados, desktop/375/768 px | Sem saldo para exercitar contagem/movimentação real |
| Compras | Novo pedido, fornecedores, importar NF-e; 375/768 px | Sem receber compra ou importar nota |
| Pessoas | Hoje, Equipe e novo cadastro; 375/768 px | Sem criar pessoa, convite ou ampliar acesso |
| Fechamento da equipe | Filtros e estado vazio; modal de transição revisado em fonte | Duas regressões com API interceptada verificam erro/retry/sucesso, sem comprovar banco real |
| Clientes e campanhas | Atendimento, Clientes, novo cadastro com endereço opcional, Benefícios; 375 px | Perfil, campanhas e benefícios parcialmente bloqueados pelo banco |
| Financeiro | Agenda, conciliação, projeção e configurações; 375/768 px | Sem lançamento financeiro real |
| Relatórios | Filtros, ações expandidas, agendamento e janelas de visões/ações; 375/768 px e dark | Visões salvas e central de ações bloqueadas pelo banco |
| Fiscal e Contador | Estado de erro e revisão de código | Consultas iniciais bloqueadas pelo banco |
| Multiunidade | Estado de erro e revisão de código | Consulta de transferências bloqueada pelo banco |
| Assinatura e cobrança | Estado de erro e revisão de código | Consulta inicial bloqueada pelo banco; nenhum checkout |
| Configurações | Atalhos internos, endereço e campos; 375/dark, desktop em teste de regressão | Checklist de preparação depende de tabelas indisponíveis |
| Equipamentos e produção | Hierarquia, campos e estados de falha; 375 px | Impressão/SmartPOS dependem do banco e equipamentos; sem homologação física |
| Shell/menu/perfil | Recolher/expandir, menu móvel, Escape, busca e navegação de módulos, alternância de tema | Administração da plataforma não foi acessada com outra identidade |

Em 375 px, as páginas principais de Dashboard, Recepção, Salão, Balcão, Entregas, Estoque, Compras, Pessoas, Fechamento da equipe, Financeiro, Relatórios, Configurações, Equipamentos, Cardápio, CRM, QR e KDS não apresentaram overflow horizontal do documento. Em 768 px foram conferidos Cardápio, Estoque, Compras, Pessoas, Financeiro e Relatórios. Inspeções desktop ocorreram em 1280 px. Scroll local de listas/tabelas continua permitido.

### Checks executados

- Ops: **91 arquivos / 447 testes aprovados**.
- Biblioteca UI: **1 teste aprovado**, typecheck aprovado.
- Após os ajustes finais, App e Reports: **21 testes aprovados**.
- Configurações: jornada Playwright em **1440/light e 375/dark**, incluindo os cinco atalhos internos e o acesso por teclado ao conteúdo.
- Fechamento da equipe: **2 regressões Playwright** para preservação da observação após falha e retry bem-sucedido.
- Typecheck Ops, build de produção, Biome dos arquivos editados e `git diff --check` aprovados. O build mantém o aviso existente de chunk principal acima de 500 kB.
- Nenhuma exceção JavaScript apareceu na consulta dos logs do navegador ao final da inspeção; isso não elimina as falhas de API descritas abaixo.

### Bloqueio de integridade do banco QA

O PostgreSQL local `giro_counter_qa_20260918` retornou `58P01` (arquivo físico ausente). Falhas reproduzidas incluem:

- `public.growth_inventory_transfers`: `base/16384/17262` — impede a visão Multiunidade.
- `public.management_report_views`: `base/16384/22659` — impede visões salvas.
- `public.management_report_alerts`: `base/16384/22618` — impede a central de ações.
- Fiscal, Contador, Assinatura e partes de CRM/Equipamentos também apresentaram falhas de consulta pela interface.

Inventário somente leitura de `pg_class`, `pg_relation_filepath` e `pg_stat_file(..., true)`: **803 arquivos principais ausentes entre 1.639 relações verificadas**, incluindo 131 tabelas, 485 índices, 186 TOAST e uma sequência. Destas, 91 tabelas são do aplicativo; há também relações de catálogos PostgreSQL. O inventário indica arquivos ausentes; não mede quantidade de registros perdidos. JSON de diagnóstico local: `C:/Users/maxue/AppData/Local/Temp/giromesa-qa-missing-relations-20260925.json`.

Não houve recriação de tabelas, fallback de valores para zero, recuperação destrutiva ou alteração do banco para esconder o problema. `REINDEX` não recupera o arquivo de uma tabela. A validação integral depende de uma cópia íntegra restaurada em instância paralela e conferida antes de substituir a conexão atual. A instância existente foi preservada.

A sequência de navegações/HMR também atingiu temporariamente o limite HTTP 429; a sessão voltou pelo botão Tentar novamente após o intervalo. A proteção de requisições foi preservada.

**Estado da entrega:** alterações e aplicação locais, sem commit, push ou deploy. Padronização implementada e checks de código concluídos; a homologação funcional de todos os módulos permanece parcial devido ao banco QA.

## Escopo e resultado

Padronização local de Contas e caixa, Produção KDS, Entregas e Recepção e espera, seguindo Estoque/Cardápio. Fundo branco gelo, ações operacionais em primeiro plano, configurações e históricos agrupados, textos menores e modais compartilhados. Topbar com cor de fundo a 80% de opacidade, `blur(20px) saturate(140%)`, conteúdo opaco e alternativa sólida quando a transparência não estiver disponível ou for reduzida pelo usuário.

As alterações permanecem no checkout local. Não houve commit, push ou publicação. As operações de teste usam organização e unidade QA separadas dos registros originais do estabelecimento.

## Interface real, depois das correções

Validação no navegador integrado contra API e banco locais, sem interceptação dos endpoints para simular resultados.

| Módulo | Ações exercitadas e resultados |
| --- | --- |
| Recepção | Reserva criada pela interface; busca e vazio; validação de telefone dentro do modal; confirmação, ocupação de mesa com abertura da comanda, conclusão, cancelamento e ausência. Fila: adicionar, usar sugestão de espera, registrar contato, sentar, sair e ausência. Histórico e carregar mais. Menus fecham fora/Escape; modais fecham por cancelar/Escape e restauram foco. |
| Entregas | Filtros Todos/Atrasados/Agendados e busca; etapas mobile com seleção acessível. Registro, confirmação, preparo, pronto, despacho com entregador e justificativa de cobertura, conclusão, insucesso com motivo, nova tentativa e devolução. Dados, histórico e notificações recolhíveis; cobrança pendente e link da conta preservados. Cadastro/disponibilidade de entregador; cadastro, edição, ativação e desativação de zona. Consulta retornou coberto, fora de cobertura e cobertura indisponível com mensagens distintas. |
| Caixa | Criar, renomear, ativar/desativar gaveta fechada; desativação bloqueada em gaveta aberta. Atalhos de fundo de R$ 50/100/150/200/300, abertura, sangria, suprimento e validação nativa dos campos. Transferência solicitada, aceite/rejeição com motivo, aprovação/rejeição de suprimento e passagem de responsabilidade. Comandas pendentes, filtros do extrato, histórico e revisão. Contagem por cédulas/moedas, zerar, digitar diretamente, revisar/corrigir e fechamento R$ 50/R$ 50. Resultado deixa de aparecer ao selecionar outra gaveta, confirmado após novo fechamento. |
| Caixa: documentos | Detalhe do turno, comprovante, retorno ao detalhe e ação de impressão acionados. CSV/PDF retornaram HTTP 200; conteúdo CSV, assinatura `%PDF-` e hash quando disponível foram conferidos. O navegador integrado não confirmou evento de download; a geração dos arquivos foi validada separadamente pela API. |
| KDS | Perfil/nome do terminal, fixar/liberar estação, sincronizar, densidade, som, tela cheia, atalhos e quatro áreas de configuração. Disponibilidade limitada, pausa, retorno agendado e volta à venda. Iniciar, parcial, pronto, refazer, reabrir, bloquear/desbloquear e transferir item. Prioridade, recebimento no passe, runner, entrega direta e lotes. Cancelamento inválido mantém modal/contexto; cancelamento válido autorizado pela API de gerente QA e ciência confirmada na interface. Erros de impressão aparecem sem perder o ticket. |

Também foram validados os estados de carregamento, vazio e erros de validação/autorização encontrados durante os fluxos. O avanço manual de Entregas continua sendo uma transição da entrega: não inicia/conclui um ticket KDS. A projeção automática segue o sentido POS/KDS → Entregas, comportamento existente preservado.

## Aparência e acessibilidade

- Inspeção dos quatro módulos em 375 px e 1440 px, temas claro e escuro; nenhuma rolagem horizontal da página nas visões verificadas.
- Inspeção dos modais de cadastro, movimento, confirmação e detalhes em celular; ações acessíveis por rolagem interna, foco visível e fechamento por teclado.
- KDS mobile corrigido para usar tokens existentes: espaçamento de 8 px e padding de 8/12 px nos indicadores. As variáveis anteriores não existiam e anulavam o espaçamento.
- Texto das abas selecionadas do caixa e identificação do entregador usam tokens de texto com contraste no tema escuro. Texto selecionado do caixa: `rgb(157, 231, 200)` sobre `rgb(27, 34, 32)`.
- Topbar verificada no navegador: alfa `0.8` no fundo, `opacity: 1` no elemento, desfoque ativo. Nenhum erro novo de console na navegação final após recarregar a aplicação.

## Checks e limites

- Ops: 90 arquivos de teste, **445 testes aprovados**; typecheck e build de produção aprovados.
- Biome dos 36 arquivos de implementação/jornada verificados sem erros. A folha legada `styles/management.css` mantém quatro avisos de especificidade preexistentes fora dos três espaçamentos corrigidos. O build mantém o aviso de bundle principal acima de 500 kB.
- Jornadas em `tests/e2e-real/{cash-workspace,delivery-production,kds-production,salon-production}.spec.ts` atualizadas. Não houve execução da suíte Playwright CLI; a interação real foi feita pelo navegador integrado.
- Impressão física, primeira via/reimpressão em equipamento, terminais de caixa e notificações externas não foram homologados. Nenhuma mensagem foi enviada. Os botões e estados dependentes desses recursos não equivalem a uma homologação real do provedor/equipamento.
- O cenário KDS usa serviço rápido. Sequência de cursos e avisos de alergia/alteração posterior ao envio não tiveram cenário específico nesta rodada. Recuperação offline completa também não foi homologada; a tentativa de emulação do navegador não comprovou isolamento da API em outra origem.

## Caixa API

Executado em 22/09/2026, somente na aplicação local e no cenário sintético “QA Visual”, unidade “Operação visual isolada”. As identidades adicionais de caixa e gerente possuem acesso apenas à organização de QA. Nenhum convite, mensagem, pagamento externo ou impressão física foi enviado.

| Fluxo | Evidência persistida |
| --- | --- |
| Cadastro de gavetas | Criação de duas gavetas (201); renomeação, desativação e reativação de gaveta fechada (200). |
| Abertura | Três turnos abertos com fundo de R$ 100,00 (201). |
| Movimentos | Suprimento de R$ 25,00 e sangria de R$ 15,00 (201), conferidos no extrato. Suprimento de R$ 600,00 executado por proprietário conforme sua permissão. |
| Fechamento com diferença | Esperado R$ 710,00, contado R$ 705,00, diferença −R$ 5,00 e revisão necessária (201). Detalhe persistido confirmou os valores e a contagem por dinheiro (200). |
| Transferência entre responsáveis | Mesmo responsável nas duas gavetas recusado com `CASH_TRANSFER_DISTINCT_RESPONSIBLES_REQUIRED` (409). Após passagem a operador sintético, transferência de R$ 5,00 solicitada e aceita pelo destino (201), registrada nas duas gavetas. Outra transferência de R$ 2,00 foi rejeitada (201). |
| Aprovação | Suprimento de R$ 600,00 solicitado por caixa criou pendência (201); aprovação pelo proprietário gerou movimento persistido (201). Pendências adicionais preparadas para aceite/rejeição pela interface. |
| Restrição por perfil | Consulta pelo caixa sintético (200) retornou `canViewExpected=false` e `expectedCents=null`. Revisão, gestão de gavetas/políticas/terminais e aprovação indisponíveis. Transferências destinadas a outro responsável retornaram `canDecide=false`. |
| Revisão por outro gestor | Regra backend preservada: quem abriu, é responsável ou fechou não pode revisar. Gerente sintético distinto revisou o turno com −R$ 5,00 (201); nova consulta (200) confirmou `status=reviewed` e `reviewedByName=Gerente sintético QA`. |
| Histórico | Listagem filtrada e detalhe do turno consultados com sucesso (200), incluindo movimentos e conferência monetária. |

Turno de referência da divergência: `33d77daf-12cd-47de-8095-173d0625e7af`. Organização: `306daed7-aa3e-42d7-a735-b7587ddb0a20`; unidade: `acc059ec-c066-4da4-914f-459570f1139a`.

Correções resultantes da execução: alertas de aprovação/transferência duplicados foram substituídos pelos painéis de ação existentes; troca de gaveta limpa resultado e comprovante do fechamento anterior; revisão própria informa a necessidade de outro gestor; destinatários da passagem de responsabilidade excluem ator e responsável atual; histórico recarrega após atualização dos turnos. A regra de autorização permanece no backend.

Checks locais: `src/features/cash/cash.test.ts` cobre resumo monetário, seleção de responsáveis e visibilidade dos alertas. O inventário de jornadas em `tests/e2e-real/cash-workspace.spec.ts` foi atualizado; não foi executado pelo agente de Caixa via Playwright. A validação visual com CUA é coordenada pelo agente principal e deve ser registrada separadamente. APIs locais não comprovam dispositivo, impressora, provedor de pagamento ou produção remota.
