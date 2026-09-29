# Balcão, delivery e comprovantes

## Fluxo operacional

- O endereço principal do cliente é opcional. No delivery, o pedido exige endereço completo e zona; o pedido guarda seu próprio snapshot, independente de futuras edições no CRM.
- Clientes podem ser criados na abertura ou em **Mais → Cadastrar cliente**, antes do pagamento. Telefone duplicado exige revisar o cadastro existente. Cadastrar não autoriza campanhas.
- O entregador cadastrado é opcional. O painel permite selecionar o responsável, registrar saída e concluir a entrega. Na saída sem entregador cadastrado, informe o responsável avulso. Cobertura não validada exige confirmação com motivo e autorização do backend.
- O total do POS inclui a taxa da zona. Fechamento financeiro não conclui o delivery: pedidos pagos permanecem na fila até a entrega real.
- Um delivery vazio pode ser encerrado sem consumo: somente a taxa é removida, com auditoria e idempotência, desde que não exista entrega registrada ou movimentação financeira. A taxa isolada não pode ser cobrada.
- A abertura de delivery exige conexão. O Edge rejeita a abertura offline antes de criar o atendimento ou ocupar uma mesa, pois endereço e taxa dependem de validação online.
- **Equipamentos e produção → Impressão do atendimento** configura impressora e emissão automática da via de entrega no envio à produção. Sem habilitação, a via continua disponível manualmente no pedido.

## Padrão impresso

Pré-conta, extrato de pagamentos, comprovante final, produção e via de entrega usam o mesmo cabeçalho, contexto e hierarquia. Nome, razão social, CNPJ, contato, endereço e logo monocromática aparecem quando cadastrados. As vias operacionais continuam identificadas como não fiscais.

A cozinha recebe itens, adicionais, observações e alergias. A via de entrega acrescenta cliente, telefone, endereço completo/referência, entregador, taxa e situação do pagamento. Documentos financeiros preservam seus totais; reimpressões mantêm o snapshot original e identificam a segunda via. Para dados atualizados, emita uma nova via.

Referências consultadas: [Square — identidade do comprovante](https://squareup.com/help/us/en/article/5424-customize-digital-receipts-and-invoices), [Toast — dados do cliente](https://support.toasttab.com/en/article/Guest-Details-on-Receipts) e [Epson — impressão raster ESC/POS](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lparen_cl_fn112.html).

## Evidência local de 18/09/2026

QA pelo User Computer em tenant e PostgreSQL descartáveis, sem provedores externos:

1. Retirada: abrir pelo nome, adicionar produto, enviar, cadastrar cliente pela conta, receber em dinheiro, preparar e marcar pronto no KDS, confirmar encerramento. Cliente persistido e atendimento fora da fila ativa.
2. Delivery: selecionar cliente existente, reaproveitar endereço, escolher entregador, enviar, conferir item de R$ 15,00 + taxa de R$ 7,00, receber e fechar antes do preparo. Pedido permaneceu na fila; KDS confirmou preparo/pronto, painel registrou saída com motivo de cobertura e conclusão. Somente então apareceu em Entregues.
3. CRM: cliente criado no atendimento presente na gestão; endereço editado no cadastro; pedido anterior manteve o endereço original.
4. Interface inspecionada em 1440×900, 1024×768 e 375×812, temas claro e escuro. Tela de pagamento móvel sem overflow horizontal.
5. Delivery vazio: abertura com endereço atualizado do CRM e taxa de R$ 7,00; **Encerrar sem consumo** confirmou total R$ 0,00, nenhuma cobrança e saída da fila ativa.

Durante as recargas de desenvolvimento, houve um limite transitório de requisições na inicialização. **Tentar novamente** recuperou a tela e os dados persistidos; as proteções de frequência foram mantidas.

Checks: 84 arquivos/398 testes Ops aprovados; build/typecheck Ops e API; testes de clientes, POS/KDS, permissões, contratos, impressão, logo, fiscal e persistência Edge. OpenAPI e clientes TypeScript/C# regenerados; cliente C# compila. Migrations 0085/0086 aplicadas e reaplicadas no banco descartável. A fixture HTTP reproduzível está em `tests/e2e-live/counter-live-fixture.mjs`; não é um teste de navegador. O console do navegador não apresentou erros ou avisos na conferência final.

Previews textuais gerados pelo formatter real: `apps/backends/edge-hub.tests/bin/Debug/net10.0/receipt-previews/`, com cinco tipos em 58 e 80 mm. Arquivos gerados de build não devem ser versionados.

## Refinamento visual do formulário

- Contato e entrega ocupam a largura disponível. CEP, número e UF têm larguras compactas no desktop; rua e referência recebem mais espaço. O mesmo componente atende CRM e edição do pedido.
- Agendamento é opcional e recolhido. Selecionar Retirada ou Delivery não preenche mais um prazo automático; prazos já registrados continuam válidos no acompanhamento operacional.
- Filtros de canal se distribuem em duas linhas na fila estreita, sem texto escapando. Os controles de quantidade usam ícones vetoriais centralizados.
- A paleta branco-gelo foi aplicada somente ao Balcão no tema claro, por tokens compartilhados. Outros módulos e o tema escuro mantêm suas paletas.
- Verificação dirigida pelo User Computer: formulário desktop, filtros na coluna lateral e endereço em 375 px, claro/escuro, sem overflow horizontal. Testes estreitos, typecheck, Biome e build Ops aprovados.
- Refinamento seguinte: ao abrir uma comanda, a fila fica recolhida e o pedido ocupa a largura disponível; **Voltar para a fila** restaura a navegação. A barra fixa reúne **Pedido**, **Conta**, **Pré-conta** com ícone de impressora e **Mais**. Separar consumo e cadastrar cliente são acionados por Mais. O cadastro mantém o rascunho enquanto a comanda permanece montada e devolve o foco ao menu quando fechado. QA em desktop e 375 px confirmou a barra, abertura/cancelamento da separação e preservação do formulário, sem registrar pagamentos ou modificar o consumo.

## Conta, divisão e correção de pagamento

- **Conta** concentra valores, pagamentos e recebimento. O status aparece somente no cabeçalho. **Pré-conta** é uma aba própria com botão **Imprimir**, pendências, confirmação de saída, vias divididas e reimpressão; abrir a aba não imprime.
- **Dividir conta**, junto de Confirmar, abre uma janela para dividir igualmente ou definir um valor por recebimento. Aplicar sugere o próximo valor sem registrar pagamento; os centavos residuais ficam na última parcela. **Desfazer divisão** restaura o recebimento do saldo. Esta preferência vale somente na tela atual e se perde ao recarregar, conforme aviso da janela.
- **Mais → Separar consumo** abre uma janela própria com o fluxo existente de transferência de itens. Não é a mesma operação que dividir o valor recebido.
- **Corrigir pagamento** permite a proprietário/gerente estornar um pagamento manual de uma comanda aberta, com motivo obrigatório. Preserva o pagamento original, registra estorno e contrapartida no caixa e recalcula o saldo. Não devolve automaticamente valores externos de Pix/cartão. Pagamentos de terminal mantêm o fluxo próprio; comandas encerradas e emissão fiscal ativa bloqueiam esta correção.
- A migration `0087_manual_payment_reversal.sql` permite o estorno manual sem instalação/attempt de terminal, mantendo a restrição de consistência do par. Backend mantém autorização, isolamento por unidade, idempotência e serialização com o encerramento.

QA adicional pelo User Computer: uma comanda exclusiva de teste de R$ 15,00 foi dividida em três recebimentos de R$ 5,00. Após receber R$ 5,00, desfazer a divisão manteve o pagamento e sugeriu o saldo de R$ 10,00. O recebimento desses R$ 10,00 quitou a conta; a correção com motivo restituiu o saldo, preservou o histórico e permitiu receber novamente e encerrar sem imprimir. As comandas existentes do usuário não tiveram seus pagamentos ou estados de impressão alterados neste teste.

As janelas de divisão e separação, a aba de impressão e seus alertas foram inspecionados em desktop e 375 px, com temas claro/escuro. Corrigida a rolagem horizontal da fila de impressão; medições finais de página e fila em 375 px ficaram em zero. Preferências de tema e viewport foram restauradas depois do teste.

Validação desta etapa: 23 testes estreitos de divisão, pagamentos, impressão e parsing; typecheck/build Ops; build API/DB; integração PostgreSQL de correção manual e SmartPOS (2/2, sem skips), incluindo concorrência com encerramento, isolamento, permissões, replay e bloqueio fiscal; self-check nativo SmartPOS. OpenAPI e clientes TypeScript/C# regenerados; cliente C# compilado sem erros ou avisos. Console final do navegador sem erros ou avisos. Os seletores dos E2E existentes foram atualizados; as suítes E2E completas não foram executadas nesta etapa.

## Refinamento da hierarquia da conta

Itens e taxa de serviço receberam cabeçalhos contrastantes e indicação de expansão. Itens e pagamentos usam cartões com bordas/sombra discreta; estornos mantêm rótulo e diferenciação visual. **Corrigir pagamento** fica junto do encerramento e, se houver mais de um recebimento elegível, abre a escolha do pagamento. O ajuste do item usa campos compactos e máscara brasileira para desconto.

O cadastro gerencial já existia no backend, sem acesso pela interface. **Configurações → Código gerencial → Cadastrar/alterar código** permite ao gerente/proprietário salvar seu próprio código de 4–8 dígitos, com confirmação. O backend deriva a identidade autenticada e mantém hash/auditoria. É independente do PIN de terminal. Nenhum código foi cadastrado ou alterado na QA visual.

Checks: typecheck/build Ops, Biome, seis testes de moeda/pagamentos e um teste dirigido do cadastro gerencial (sessão atual, contrato e propagação de recusa). User Computer conferiu a máscara `1.234,56`, abertura/cancelamento das janelas e hierarquia no desktop/claro/escuro e em 375 px. A inspeção móvel encontrou e corrigiu quebra do título da janela e textos dos três botões finais. Página, formulário e janela sem overflow horizontal. Nenhum pagamento ou ajuste foi confirmado nesta rodada.

## Gorjeta e desconto da conta

- O ajuste de item foi compactado; **Mais** abre e fecha o painel. Foram removidos o fechamento redundante e o atalho de cadastro de código. O resumo **Recebido** mostra somente o recebido líquido; os estornos permanecem em **Pagamentos registrados**.
- **Gorjeta e desconto** substitui a edição livre da porcentagem do serviço. **Retirar serviço** zera a taxa aplicada; **Aplicar serviço configurado** restaura a porcentagem efetiva da unidade, quando configurada para consumo local. Não há porcentagem fixa no frontend.
- O desconto da conta é adicional, em reais, distribuído proporcionalmente sobre o consumo líquido. Preserva descontos anteriores e centavos; não desconta gorjeta nem entrega. Serviço e total são recalculados no backend. Motivo e autorização são obrigatórios, com bloqueios financeiros/fiscais, idempotência e auditoria.
- O código é pessoal: gerente/proprietário autoriza em sua própria sessão. Caixa/garçom solicita o desconto e o gerente aprova no próprio dispositivo. Digitar o código de outra pessoa não eleva a permissão do operador.
- As vias de impressão mostram itens brutos, desconto negativo uma única vez, serviço e gorjeta separados e o total persistido. **TOTAL SUGERIDO** aparece somente na pré-conta.

Validação local em 19/09: 28 testes de backend, 27 testes dirigidos de Ops e 33 testes do formatter/gateway passaram; builds API/Ops e cliente C# aprovados, OpenAPI/TypeScript/C# regenerados. Biome e `git diff --check` sem problemas. O build Ops mantém o aviso de tamanho de chunk.

User Computer validou uma organização sintética separada, sem alterar as comandas do usuário: consumo de R$ 45,00 com serviço de 12% totalizou R$ 50,40; retirar/restaurar serviço atualizou os totais corretamente. Gorjeta de R$ 3,00 e desconto autorizado de R$ 5,00 produziram serviço de R$ 4,80 e total de R$ 47,80, persistidos após abrir outra aba. O documento da pré-conta continha esses valores, sem duplicar o desconto. O diálogo nativo de impressão/confirmação do navegador impediu concluir sua automação; nenhuma saída física foi confirmada. A tentativa de impressão da fixture permanece pendente de conferência.

Inspeção visual em desktop e 375 px, claro/escuro: ajuste compacto do item, campos de gorjeta/desconto e serviço sem overflow horizontal. Console da aba de QA sem erros/avisos. O cadastro gerencial abriu em Configurações e foi cancelado sem alterar o código do usuário. Viewport restaurado; testes financeiros executados somente na fixture separada. As suítes E2E completas não foram repetidas.

## Edição e organização do atendimento — 19/09

- **Detalhes** foi substituído por **Mais → Editar atendimento** em modal. Salvar persiste e cancelar descarta o rascunho; a aba de origem permanece selecionada e recebe o foco de volta. A versão de abertura é mantida para detectar edição concorrente, sem sobrescrever o rascunho durante consultas periódicas.
- Campos proporcionais, agendamento opcional recolhido e endereço exclusivo para delivery. O layout pertence à comanda compartilhada, sem depender do CSS da janela do Salão.
- **Vincular a uma mesa/Transferir mesa**, **Transferir item** e **Unificar comandas** abrem janelas próprias, com origem/destino e confirmação explícita. Transferência de item move a linha inteira em espera, inclusive quantidade, modificadores e desconto; o backend continua bloqueando pagamentos e operações não elegíveis. Na união, o serviço é recalculado pela taxa da conta de destino.
- Removido o botão manual **Marcar pronto e avisar** e o card **Cliente avisado**. O histórico usa **Pedido pronto**; o registro manual antigo não comprova entrega de mensagem. A sinalização e o envio automático ligados ao KDS permanecem intactos.
- QA pelo User Computer em organização sintética separada: edição salva; cancelamento descartado; transferência de 3 unidades com desconto; união com uma linha adicional, total R$ 61,60; vínculo com Mesa QA persistido. Nenhuma comanda do usuário foi alterada. Modais em desktop e 375 px, claro/escuro, sem overflow horizontal. Typecheck/build Ops, Biome, 11 testes estreitos de frontend e integração PostgreSQL POS (1/1, sem skips) passaram. Suítes E2E completas não repetidas; build mantém o aviso existente de chunk grande.

## Limites de homologação

- Nenhuma impressão física, corte de papel ou comunicação com a impressora do estabelecimento foi executada. Validar logo, acentos, contraste, corte e largura nos equipamentos reais antes do rollout.
- Fiscal: a taxa é propagada ao frete e reconciliada com o total. A modalidade de transporte existente foi preservada; emissão no provedor e regras fiscais do estabelecimento ainda exigem homologação específica.
- Estes testes são locais. Não houve commit, push ou deploy.
