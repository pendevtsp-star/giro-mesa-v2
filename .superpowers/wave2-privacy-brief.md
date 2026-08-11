# Onda 2P antecipada — ciclo LGPD (Task 37)

Base `c899c4805f999eda18b22cbb8f7d8ebe30603333`. Integração posterior adicionará processadores dos domínios Wave1/DoseClub; ausência de processador deve falhar fechado.

## Escopo

- Inventário de dados e base legal/retention/owner em `docs/privacy/data-inventory.md`, sem alegar revisão jurídica conclusiva.
- API/serviço persistente para solicitações de acesso/exportação, correção e anonimização/exclusão.
- State machine assíncrona/idempotente com verify-subject, approval, processing, partial, completed, rejected, failed e retry.
- Registry de processadores por domínio; resultado `completed` apenas quando todos os processadores obrigatórios confirmarem. Domínio conhecido sem adapter => `partial/blocked`, nunca sucesso.
- Export criptografado, TTL curto, one-time/authorized download, audit trail e redaction; objetos/media/offline entram por adapters explícitos.
- Correção não reescreve ledger/audit/fiscal legalmente imutável; usa retificação/tombstone conforme política.
- Anonimização preserva integridade referencial e obrigações legais; hard delete só onde permitido.
- RLS/FORCE RLS, step-up e least privilege. Platform admin não recebe conteúdo por padrão.

## Persistência

- Migration reservada `0025` se necessária. Não usar `0017`–`0024`/`0026+`.
- Fresh/upgrade/RLS e concorrência/replay em PostgreSQL real.

## Processo

- TDD, commit único Task37 e relatório `.superpowers/wave2-privacy-report.md`.
- Gates focados API/worker/PG/docs, OpenAPI/clientes no fechamento, Biome/diff.
- Sem provider/storage real, email real, deploy, DoseClub ou integração falsa com Wave1.
