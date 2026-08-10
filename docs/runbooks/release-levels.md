# Niveis de release

Cada release deve registrar um baseline em `package.json`, no campo `productionBaseline`.
O comando `pnpm production:baseline` rejeita um registro sem nivel, artefato,
migration ou resultados de gates.

```json
{
  "productionBaseline": {
    "level": "not-assessed",
    "artifact": "git:<commit-imutavel>",
    "migration": "<ultima-migration-aplicavel>",
    "gateResults": {
      "automated": "not-run",
      "external": "not-run"
    }
  }
}
```

`not-assessed` e um estado de registro, nao um nivel de prontidao. Os niveis de
prontidao permitidos pelo design sao:

1. `software-ready`: implementacao, contratos, migrations, seguranca e suites
   automatizadas concluidas.
2. `integration-ready`: integracao externa validada em sandbox ou simulador
   contratual.
3. `pilot-approved`: ambiente piloto, hardware escolhido, rede degradada,
   restore e jornadas reais validados.
4. `production-approved`: fornecedores homologados, alta disponibilidade e DR
   comprovados, 14 turnos sem Sev1 e reconciliacao completa.

Nao infira um nivel a partir de build verde ou HTTP 200. Atualize o manifesto
com o commit imutavel do artefato, a migration aplicavel e os resultados reais
dos gates antes de promover uma release. Dependencias externas pendentes devem
permanecer registradas como resultado bloqueado; elas nunca sao tratadas como
aprovadas por simulacao.
