# Estoque e Cardápio — validação local de 18/09/2026

Escopo: seis recomendações aprovadas — preço público confirmado, preservação do limite diário, recomposição de negativos/custo, vínculo histórico de baixa e estorno, indicadores da automação e desativação da ficha técnica. A revisão do estorno também corrigiu a recomposição de vendas que consomem mais de um lote. A melhoria adicional aprovada preserva o vínculo dos vasilhames no envio do pedido.

## Evidência

- PostgreSQL 17.6 local exclusivo, em `127.0.0.1:55486`, com quatro bancos separados e migrações até o schema 84. Sem conexão com produção.
- Management: 3 integrações novas e 2 regressões aprovadas, zero skips. Incluem reposição parcial, custos ao zerar/cruzar saldo negativo, escopo da automação, desativação, autorização, idempotência e concorrência da receita.
- Worker: 2 integrações PostgreSQL e 5 testes unitários aprovados, zero skips. Incluem vínculo alterado/desfeito, produto sem controle no envio, receitas históricas, lotes múltiplos, estorno e replay.
- Catálogo, POS e pedido público: 3 integrações PostgreSQL aprovadas, zero skips. Incluem preço operacional atual, adicionais, pausa expirada, promoção/taxa, confirmação de total com rollback, replay e preservação de `autoDeductStock`.
- Envio/estoque e sync: 5 testes aprovados, zero skips, incluindo uma integração PostgreSQL da confirmação de falta, ficha opcional e snapshot vazio.
- Contratos: 20 testes aprovados. Customer: 22 testes aprovados. Regras da API: 28 testes aprovados. Cliente/estoque/despacho do Ops: 30 testes aprovados.
- Interface com APIs controladas: 3 jornadas Customer (retirada, delivery e QR) e 2 jornadas Cardápio/estoque aprovadas. Incluem tela de 375 px, confirmação de novo total, recuperação de falha de rede, edição do carrinho invalidando a revisão, desativação com confirmação/retry e persistência após reload. Configs: `tests/customer-pricing.config.ts` e `tests/catalog-recipe-ui.config.ts`.
- Builds API, worker, Customer e Ops aprovados. OpenAPI e clientes TypeScript/C# regenerados; build C# com zero avisos/erros.
- Biome dos arquivos alterados e `git diff --check` aprovados. Permanecem avisos anteriores de tamanho do bundle Ops e de formatos/polimorfismo no gerador Kiota.

## Validação adicional — vínculo de vasilhames preservado

- PostgreSQL 17.6 exclusivo em `127.0.0.1:55487`, dois bancos separados migrados até o schema 84.
- API: `pilot-inventory-send.integration.test.ts` e `public-order.integration.test.ts`, 3 testes aprovados, incluindo 2 integrações. Confirmam captura no envio, ausência de vínculo, depósito/prazo, rollback, replay, sincronização offline e dados internos ausentes da resposta pública.
- Worker: `inventory.integration.test.ts`, `inventory-binding.integration.test.ts`, `inventory.test.ts` e `inventory-integrity.test.ts`, 7 testes aprovados, incluindo 2 integrações. Confirmam troca/desativação de vínculo e reclassificação do recipiente após envio, ausência preservada, prazo/depósito originais, devolução parcial, cancelamento antes/depois da baixa, replay, legado, isolamento e rejeição atômica de registros inválidos/overflow.
- Total desta rodada: 10 testes, zero falhas e zero skips. Builds API/worker, Biome, `git diff --check` e revisão independente aprovados. Grafo atualizado e wiki verificada. Nenhuma mudança de interface, contrato HTTP ou schema foi necessária.

## Limites da conclusão

Validação local: não houve commit, push, implantação ou homologação com movimento real de estabelecimento. E2E com API controlada e integração com PostgreSQL são evidências distintas.

Históricos anteriores sem snapshot de vínculo/divisão de lotes não são reconstruídos por suposição. Pedidos legados sem o registro de retornáveis mantêm a consulta à configuração vigente no processamento. Nos pedidos novos, alterações posteriores de vínculo, quantidade, depósito ou prazo padrão não alteram a custódia. No offline, essa captura ocorre na reconciliação pela API.

Comportamento operacional e procedimento de conferência: [revenda, estoque e vasilhames](catalog-inventory.md).
