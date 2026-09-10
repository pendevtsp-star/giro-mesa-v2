# Simplificação de KDS, caixa e cardápio

## Alterações

- KDS: acesso direto à tela cheia; fila de tickets e alertas operacionais preservados. Navegação, indicadores, ritmo, produção por item e lotes ficam fora da tela cheia. Ritmo fica recolhido no modo normal.
- Caixa: áreas Turno, Extrato, Histórico e Configurações. A gaveta em foco permanece identificada; o fechamento começa recolhido. O resultado da conferência aparece antes de uma nova abertura. Revisões antigas ficam no histórico. Política e vínculo dos terminais têm campos alinhados; transferência sem outro operador mostra estado vazio.
- Cardápio público: cabeçalho compacto, horários e serviços secundários recolhidos, contraste da categoria ativa corrigido no escuro, produtos sem foto sem ilustração artificial. Modal sem foto abre diretamente no conteúdo, com observação e alergia usando a largura disponível.

As regras de autorização, contagem cega, confirmação de alergia, pagamentos e persistência continuam nos contratos existentes. Nenhuma migração ou dependência foi adicionada.

## Conferência com Computer Use

As páginas abertas de produção foram inspecionadas antes da alteração. Mutações de teste ocorreram somente na API local, com PostgreSQL e schema 82, em organização e unidade próprias.

- Caixa: abertura de R$ 100, suprimento de R$ 20, recarga confirmando saldo de R$ 120, fechamento contado em R$ 120 sem diferença e consulta ao histórico. Vínculo de terminal à gaveta Bar confirmado em outra sessão.
- KDS: seis tickets reais em duas estações; início de preparo, bloqueio de conclusão por alergia pendente, confirmação de ciência, conclusão e recarga mantendo o estado. Tela cheia inspecionada no Opera desktop e em viewport de 375 px.
- Cardápio: publicação real de oito produtos, busca combinada com categoria, detalhes, inclusão na seleção e revisão do carrinho. Inspeção clara/escura e a 375 px. Nenhum pedido público foi enviado.
- Os testes visuais revelaram e corrigiram dois problemas de cascata: resumo por item ainda visível na tela cheia e campos do modal de produto espremidos horizontalmente.

## Verificação reproduzível

- `pnpm --filter @giromesa/ops test`: 342 testes.
- `pnpm --filter @giromesa/customer test`: 21 testes.
- `tests/e2e-real/kds-production.spec.ts`: nove jornadas, incluindo tela cheia com resumo por item e alergia.
- `tests/e2e-real/cash-workspace.spec.ts`: isolamento das áreas, gaveta, fechamento, revisão e terminal.
- `tests/e2e/customer-tracking.spec.ts`: acompanhamento QR, alergia, recuperação de rede e largura utilizável dos campos a 375 px.
- Builds de Ops e Customer, TypeScript, Biome e `git diff --check`.

Esta conferência não inclui impressão física, pagamento em terminal ou emissão fiscal. Evidências de CI, publicação, promoção e limpeza pertencem ao registro operacional da release.
