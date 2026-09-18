# Revenda, estoque e vasilhames

## Cadastrar a bebida antes do cardápio

1. Em Estoque, cadastre um item do tipo **Produto de revenda**. Para venda de garrafas individuais, use unidade de estoque `un`, unidade de compra `caixa` e conversão `24` para uma caixa de 24 garrafas. O produto do Cardápio pode ficar como **Vincular depois**. A revisão de NF-e também permite essa ordem.
2. Receba a mercadoria pelo fluxo de compras. Uma caixa com conversão 24 entra como 24 unidades. Em uma entrada/ajuste manual de estoque, informe diretamente 24 unidades; esse formulário não converte caixas.
3. Em Cardápio → Novo produto → Produto de revenda, busque o item pelo nome, código interno ou código de barras. Selecione-o e informe os preços, categoria e estação de atendimento.
4. Ao salvar, a API cria o produto e vincula o item de estoque na mesma transação. O saldo, os lotes e os movimentos existentes permanecem no mesmo item. Itens já vinculados não podem ser usados para criar outro produto; itens de outra unidade também são recusados.

O vínculo direto consome uma unidade de estoque por unidade vendida, conforme o processamento do pedido pelo worker. O limite diário opcional do Cardápio é um controle separado do saldo físico. A ficha técnica é opcional: produtos preparados sem ficha continuam disponíveis e não têm baixa automática de ingredientes.

## Ficha técnica e informações de gestão

No editor do produto, **Estoque e ficha técnica · opcional** abre a mesma ficha versionada usada pelo Estoque e pela baixa dos ingredientes. Se utilizada, informe o insumo real, a quantidade, a perda e o local de saída. A composição antiga por nome permanece como referência legada; ela não representa um vínculo com o estoque e não é convertida automaticamente.

Em **Versões ativas**, **Desativar ficha técnica** pede confirmação e encerra a vigência da ficha. A disponibilidade do produto permanece como estava; as próximas vendas deixam de consumir os insumos dessa ficha. Pedidos enviados antes da desativação continuam usando a versão vigente no envio. Componentes e histórico são preservados; salvar novamente cria outra versão. Uma tentativa que falhou pode ser repetida sem duplicar a operação.

Gestores autorizados veem saldo físico, disponível após reservas/bloqueios, limite diário e custo estimado em campos distintos. O custo médio do estoque ou da receita é uma referência; não modifica automaticamente o preço de venda. A API omite custos, fichas internas e projeções de estoque para os demais perfis. O cardápio público mantém fotos, descrições e preços de venda, sem dados internos de gestão.

## Falta de estoque sem interromper o atendimento

Quando o estoque controlado é insuficiente, o envio online mostra **Conferir estoque**, com os produtos afetados e as ações **Voltar ao pedido** ou **Lançar mesmo assim**. Confirmar registra o responsável e a divergência na auditoria; a baixa pode deixar saldo negativo, que precisa de conferência. Nenhuma entrada fictícia é criada para cobrir a falta. A configuração existente do item que permite saldo negativo continua sendo respeitada.

Pedidos públicos e pedidos já atendidos offline mantêm uma origem própria na auditoria: não simulam confirmação do garçom e encaminham as divergências à operação. Lotes bloqueados e itens inativos continuam sujeitos às suas proteções. Indisponibilidade manual e limite diário do Cardápio permanecem controles independentes.

O Estoque mantém o alerta **Estoque precisa de conferência**, com filtro das posições negativas por item e local. Um freezer negativo não desaparece porque o depósito possui saldo positivo. Use contagem/ajuste com motivo ou registre o recebimento/transferência que faltou; reenvios e cancelamentos preservam a idempotência dos movimentos.

Uma reposição parcial pode reduzir um saldo negativo sem precisar zerá-lo: −10 + 3 resulta em −7. Entradas por lote sobre saldo anterior zero ou negativo usam o custo da nova entrada, evitando médias inválidas. Os indicadores de baixa pendente/com falha são associados ao pedido e ao escopo do estabelecimento.

## Depósito e freezers

1. Cadastre **Depósito**, **Freezer 1**, **Freezer 2** como locais distintos; use o tipo Freezer nos equipamentos.
2. Registre o recebimento das cervejas no depósito. Para abastecer, faça uma transferência com origem Depósito e destino Freezer 1. A entrada no destino depende da conferência do recebimento, inclusive quando parcial.
3. Configure a rota de saída da bebida para o freezer normalmente utilizado. Ao selecionar o produto, a tela carrega a rota já salva e permite ajustá-la. Não é necessário escolher o freezer a cada venda.
4. Acompanhe físico e disponível por local, metas de reposição e divergências. A retirada real deve respeitar o local configurado; o sistema não detecta de qual equipamento uma pessoa pegou a garrafa.

A rota pode ser configurada por produto e, pela API existente, por estação. Esta rodada não adiciona escolha de freezer por item lançado. O ticket interno e a conta do cliente mostram o produto e não imprimem o freezer. A origem usada na reserva fica preservada no processamento, para que trocar a configuração depois do envio não mova uma baixa já encaminhada para outro local.

O vínculo de revenda também fica preservado no envio, inclusive quando o produto ainda não controla estoque. Vincular, desvincular ou trocar o cadastro depois não muda a baixa daquele pedido. Cancelamentos usam os movimentos originais; novas baixas que atravessam vários lotes registram suas alocações para devolver a quantidade a cada lote correto, uma única vez.

## Garrafas retornáveis

Cadastre o recipiente vazio como outro item, do tipo **Vasilhame retornável**. No produto do Cardápio, abra **Editar Produto & Histórico → Embalagens retornáveis**, selecione **Retornável** e vincule, por exemplo, uma garrafa de 600 ml com quantidade 1 por cerveja. Também é possível ajustar o vasilhame principal pela edição do item de estoque quando ele já estiver ligado ao produto.

O vínculo de embalagem pertence ao produto do Cardápio. Uma bebida cadastrada apenas no estoque ainda não calcula vasilhames cheios; ao criar o produto e configurar a embalagem, o cálculo passa a considerar o saldo existente.

| Momento | Bebidas / cheios equivalentes | Vazios disponíveis | Retornos pendentes |
|---|---:|---:|---:|
| Receber 1 caixa com 24 garrafas | 24 | 0 | 0 |
| Enviar 3 cervejas no pedido, após processamento | 21 | 0 | 3 |
| Conferir o retorno das 3 garrafas | 21 | 3 | 0 |

Os cheios são calculados a partir do saldo da bebida e da quantidade de embalagens vinculadas. Não lance 24 garrafas vazias junto com as 24 cervejas: isso duplicaria a representação dos recipientes. Custódia pendente surge na venda, e o estoque de vazios aumenta na conferência do retorno. Cancelamentos revertem o consumo e apenas a custódia ainda aberta.

Garrafas e engradados são recipientes distintos. Vincule engradado à venda de caixa quando ele realmente for entregue ao cliente; uma venda individual de cerveja não deve gerar uma fração de engradado a devolver.

A edição do vasilhame principal preserva os demais vínculos (por exemplo, outra embalagem). Se o item for salvo e a configuração de embalagem falhar, a tela informa o resultado parcial e permite tentar novamente no mesmo item.

No envio do pedido, o sistema registra os recipientes vinculados, a quantidade por unidade, o depósito configurado e o prazo padrão de retorno. Alterar ou desativar o vínculo depois não muda a custódia daquele pedido, mesmo que a baixa ainda esteja na fila. Um produto enviado sem embalagem vinculada continua sem retorno esperado; o novo cadastro vale para os próximos envios. Esse registro é interno e não aparece no cardápio público. Em pedidos offline, a captura ocorre quando o envio é reconciliado pela API.

## Preços por canal

Salão/balcão e delivery têm valores identificados separadamente. Delivery vazio significa acompanhar o preço do salão; zero é um preço explícito. Na tabela, apagar o preço de delivery restaura a herança. A edição completa mantém o campo de motivo de ajuste separado dos dois preços.

Alterar preço, disponibilidade ou roteamento preserva a configuração do limite diário quando ela não é enviada na alteração. A publicação continua selecionando os produtos e conteúdos públicos; preço, adicionais e disponibilidade operacional dos produtos publicados são consultados novamente a cada abertura do cardápio. Saldo físico e custos continuam privados.

Se preço, promoção ou taxa de entrega mudar enquanto o carrinho estiver aberto, a API recalcula o pedido e exige confirmação do novo total antes de criar o pedido. Retirada, delivery e QR da mesa usam essa proteção. O cliente vê o total anterior e o atualizado; editar o carrinho invalida a confirmação anterior. Repetir um pedido já confirmado mantém o resultado original pela chave de idempotência.

## Limites do histórico

Pedidos antigos sem registro do vínculo no envio não permitem reconstruir com certeza uma vinculação posteriormente alterada. Baixas antigas que agregaram vários lotes sem registrar a divisão também exigem conferência para recompor os lotes; a correção não inventa esse histórico. Somente pedidos legados sem registro de retornáveis continuam consultando a configuração vigente no processamento da custódia.

## Atualização

O fluxo de revenda antes do Cardápio exige API e banco no schema 84 (migration `0084_inventory_resale_before_catalog.sql`). A interface exige essa versão para não aceitar um backend antigo que descarte o vínculo enviado. A migração não altera saldos nem vínculos existentes.

A preservação dos retornáveis usa a auditoria existente e não exige nova migração. API e worker devem receber a atualização; o worker atualizado aceita pedidos antigos, mas uma versão antiga do worker não utiliza o registro novo. Em atualização separada, atualize o worker antes da API.
