# Evidência técnica da versão 0.3.0

Data: 8 de setembro de 2026. Artefato técnico: `354f08c1515a9116f0fde9eda5fb5df0d1983370`.

- [CI técnico](https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/34255069538): instalação congelada, auditoria, migrations, backup/restore lógico, lint, tipos, testes, build, contratos gerados, E2E, .NET, Terraform e segurança de release passaram. A execução terminou com falha exclusivamente no último gate, pois o baseline ainda declarava a migration 0079. Este registro e a atualização de metadata corrigem essa divergência; não representam um CI integralmente verde para o artefato técnico.
- [Security](https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/34255069587): sucesso no mesmo artefato.
- [Recuperação](https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/34253704633): recovery `36cec6535b1826f6ebe34b98cb697762e3517ceb` validado em PostgreSQL 16/17, upgrade legado e runtime nos schemas 77/80. Evidência imutável: `recovery/36cec6-validation-0080.json`, SHA-256 `8f2574d745496c2c49986c1c7a8994b7f093a3154e2d48f28493d7ee1acc8a06`.

O baseline permanece `software-ready`, com migration 0080 `verified`: a comprovação acima não afirma aplicação na VPS nem homologação de pagamentos/fiscal. O commit de metadata deve passar novamente por CI e Security antes da publicação assinada target/recovery e promoção pelo entrypoint confiável. A conclusão da promoção requer backup completo, migration, SHA/schema, digests e saúde do runtime comprovados na VPS.
