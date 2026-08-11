# Task 40 — backup/restore e níveis de release

Data: 2026-08-11

## Entrega local

- Backup PostgreSQL custom por container, sem owner/ACL, com versão e migration imutáveis.
- Arquivos de objetos e configuração previamente criptografada opcionais, ambos cobertos por SHA-256.
- Manifesto assinado por HMAC-SHA-256 com chave externa mínima de 32 bytes; URL, senha e chave não são persistidas.
- Restore fail-closed valida assinatura, caminhos, hashes, artefato e separação origem/destino antes de tocar no banco.
- Evidência registra duração, backup, artefato, migration, destino e smoke; promoção continua subordinada aos níveis já definidos.

## TDD e ensaio

RED: os três testes falharam com scripts/runbook ausentes.

GREEN:

- `rtk pnpm test:disaster-recovery`: 3/3.
- Ausência de chave HMAC e manifesto forjado falham antes de qualquer comando PostgreSQL.
- Ensaio positivo usou dois containers descartáveis `postgres:17-alpine`, origem e destino distintos.
- O backup foi criado, restaurado e validado por `SELECT 1`; a linha `giromesa-dr-ok` foi recuperada no destino.
- `restore-evidence.json` registrou restore em 2 segundos, dentro do teto local de 30 minutos.
- Containers e artefatos temporários foram removidos após o gate.

## Limite da evidência

O ensaio local prova o mecanismo, não RPO/RTO operacional. Object storage com object-lock, cofre/rotação da chave HMAC, agenda a cada 5 minutos, alertas, cópia multizona, dados/objetos completos e execução na VPS dependem de infraestrutura externa. Até esses itens serem homologados, o nível máximo não pode alegar `pilot-approved` ou `production-approved` pelo gate de restore.
