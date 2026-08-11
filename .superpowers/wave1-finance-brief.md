# Onda 1C — financeiro, estoque e remuneração (Tasks 22–29)

Base: `c899c4805f999eda18b22cbb8f7d8ebe30603333`.

## Escopo e ordem

Implementar Tasks 22–29 do plano em commits separados:

1. Ledger monetário balanceado.
2. Payment adapters + estado incerto + simuladores API/SmartPOS.
3. Fiscal desacoplado por adapter.
4. Quantidades/unidades/conversões e ficha técnica versionada.
5. Ledger de retornáveis.
6. Incidentes gerenciais sem desconto automático em folha.
7. DSL segura de remuneração.
8. Apuração/relatórios estimado-aprovado-fechado, PDF/CSV/print.

Migrações reservadas nesta branch: `0020` ledger/pagamentos, `0021` estoque-retornáveis-incidentes, `0022` remuneração e `0023` somente se fiscal exigir persistência adicional. Não use `0017`–`0019` nem `0024+`.

## Invariantes

- Dinheiro sempre inteiro em centavos e lançamentos balanceados/double-entry; nenhuma soma float.
- Idempotência e reversões explícitas; nunca apagar ledger financeiro.
- Estado `unknown` de pagamento exige lookup/reconcile/manual review; venda não é duplicada.
- Nunca armazenar/logar PAN, CVV, track data ou credenciais de terminal.
- Fiscal não desfaz a venda; documento tem state machine própria e adapter simulado.
- Quantidades dimensionais com precisão fixa, conversão explícita, yield e vigência.
- Retornáveis suportam agregado/serializado, custódia e reconciliação sem imputar desconto salarial.
- Incidentes usam linguagem neutra, evidência, aprovação e audit trail.
- DSL sem eval/código arbitrário, versionada, simulável e congelada no fechamento.
- Relatórios distinguem serviço, comissão e participação; valores são estimados até aprovação.
- RLS/FORCE RLS/RBAC unit-scoped e least privilege.

## Processo otimizado

- RED/GREEN e gate focado por task; commit por task.
- PostgreSQL descartável reutilizável com DB isolado; fresh/upgrade e RLS negativo no checkpoint.
- Gere OpenAPI/TS/C# uma vez no fechamento da trilha.
- Gate final: domain/API/worker/PG/Edge adapters, Ops focado/relatórios, contratos, C# build, Biome/diff.
- Relatório `.superpowers/wave1-finance-report.md`.
- Sem provider Focus/PayGo real, push/deploy, desconto automático ou Task 30+.
