# Niveis de release

Cada release deve registrar um baseline em `package.json`, no campo
`productionBaseline`. O comando `pnpm production:baseline` rejeita registros
sem um nivel permitido, artefato imutavel, migration estruturada ou gates
exigidos para o nivel declarado.

```json
{
  "productionBaseline": {
    "level": "software-ready",
    "artifact": "git:<sha-git-completo>",
    "migration": {
      "id": "0008_nome-da-migration",
      "status": "verified",
      "evidence": "git:<sha-git-completo>"
    },
    "gateResults": {
      "automated": {
        "status": "passed",
        "evidence": "git:<sha-git-completo>"
      },
      "security": {
        "status": "passed",
        "evidence": "git:<sha-git-completo>"
      }
    }
  }
}
```

`artifact` e cada campo `evidence` devem ser um SHA Git completo (com ou sem o
prefixo `git:`) ou digest SHA-256 pinado, como
`registry.example/giromesa@sha256:<64-hex>`. Valores como `source-tree`,
`latest`, `not-run`, `not-assessed` e `pending` nao sao evidencia valida.

Os unicos niveis permitidos sao:

1. `software-ready`: exige gates `automated` e `security`; migration
   `verified` ou `applied`.
2. `integration-ready`: exige os gates de `software-ready` e `integration`;
   migration `verified` ou `applied`.
3. `pilot-approved`: exige os gates anteriores mais `pilot` e `restore`;
   migration `applied`.
4. `production-approved`: exige todos os gates de piloto mais
   `high-availability` e `reconciliation`; migration `applied`.

Todo gate requerido tem o formato `{ "status": "passed", "evidence":
"<referencia-imutavel>" }`. Um gate ausente, `not-run`, pendente ou com
evidencia nao pinada bloqueia a promocao. Nenhum nivel superior pode ser
inferido a partir de build verde ou HTTP 200.
