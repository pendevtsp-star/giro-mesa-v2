# Atendimento e recebimento — versão 0.3.2

Data: 9 de setembro de 2026.

## Escopo

- Mesas/comandas e balcão compartilham recebimento compacto, ações acessíveis durante a rolagem e opções secundárias de impressão/divisão.
- Balcão permite retornar à fila, preservando busca, filtros, foco e rascunho; Escape respeita campos, menus e diálogos.
- Valores vazios/inválidos não viram pagamento integral. Recebimentos aguardam saldo confirmado; consultas iniciadas antes da mutação não liberam a trava de atualização.
- O fechamento não interpreta eventos pendentes de pedidos sem vínculo com vasilhames como custódia. Pedidos potencialmente retornáveis e custódias reais mantêm suas proteções e isolamento por organização/unidade.

## Evidência e limites

- Verificação local: 314 testes Ops, teste da biblioteca UI, build Ops/API, formatter e 28 cenários Playwright de atendimento, balcão e recebimento. A suíte `tests/e2e-real` usa contratos HTTP controlados, não comprova por si só persistência na VPS.
- A regressão de vasilhames integra a suíte PostgreSQL `pilot-pos.integration.test.ts`. Sem PostgreSQL local disponível, sua execução efetiva é gate obrigatório do CI antes da promoção.
- Os testes anteriores com frontend local e API de produção usaram somente a conta de testes: pagamento parcial e final, encerramento, limpeza/liberação da mesa e conferência de caixa. Inspeções de layout incluíram claro/escuro e larguras de 360 a 1440 px.
- Esta nota não substitui evidência de publicação. A promoção exige CI/Security aprovados para o SHA exato, manifestos target/recovery assinados, backup completo e confirmação de SHA, schema 80, digests e saúde da VPS.
- SmartPOS físico e integrações externas permanecem sujeitos a contratação e homologação; não são declarados homologados nesta versão.

## Atualização de segurança antes da promoção

O primeiro CI bloqueou a publicação na auditoria de dependências. Foram atualizados Next.js para 16.3.3, sharp para 0.35.4, js-yaml do gerador OpenAPI para 4.3.2 e Vitest para 4.1.11. Os limites de segurança do CI permanecem ativos. Referências: [Next.js/AVIF](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), [sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh) e [Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

A auditoria local após a atualização não encontrou vulnerabilidades conhecidas. Os 22 testes do site, 21 do cardápio público e os 315 testes Ops/UI passaram; builds do site e cardápio público também passaram.
