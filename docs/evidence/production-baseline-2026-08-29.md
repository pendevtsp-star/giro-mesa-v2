# Baseline de produção — 2026-08-29

## Escopo comprovado

- Versão candidata do produto: `0.2.8`.
- Artefato imutável: `cb31e18bff700f574bead3da38f908f11bf64fb8`.
- Migration mais recente do journal: `0075_platform_staff_invitations`.
- A migration 0075 foi aplicada na VPS e a API pública reportou `schemaVersion: 75`.
- Os gates automatizado e de segurança desse artefato foram aprovados.
- O manifesto permanece em `software-ready`; esta evidência não promove o nível de prontidão.

## Proteção adicionada

O job TypeScript do CI agora executa `pnpm production:baseline`. A publicação de imagens continua condicionada à conclusão bem-sucedida do workflow `CI`, portanto um manifesto incoerente bloqueia a publicação.

## Validação local do ajuste

| Check | Resultado |
| --- | --- |
| `pnpm production:baseline` | aprovado |
| `pnpm test:production-baseline` | 17/17 aprovados |
| migrations em 10 bancos PostgreSQL descartáveis | 76/76 até `0075_platform_staff_invitations` |
| API com PostgreSQL real | 287/287 aprovados |
| worker com PostgreSQL real | 55/55 aprovados |
| E2E salão com API compilada e PostgreSQL | aprovado |
| E2E caixa com API compilada e PostgreSQL | aprovado |
| smoke k6 operacional, QR e isolamento multi-tenant | 100% dos checks, 0% de falhas |
| backup/restore Linux completo | banco, objetos, configuração criptografada e smoke aprovados |
| Edge Hub | 62/62 aprovados |
| shell Windows, cliente C# e self-check SmartPOS | aprovados |
| `pnpm exec biome check` dirigido | aprovado |
| `git diff --check` | aprovado |

As suítes de API e worker foram serializadas porque seus testes de integração alteram
`DATABASE_URL` no processo. A execução concorrente fazia aplicações de arquivos diferentes
capturarem bancos incorretos e tornava o resultado não determinístico.

## Limites desta evidência

Esta evidência local não substitui homologação com parceiro, provedores, impressoras ou
SmartPOS físicos. O resultado do novo CI só poderá ser registrado depois de commit e push;
nenhuma publicação ou promoção da VPS foi realizada por este ajuste local.
