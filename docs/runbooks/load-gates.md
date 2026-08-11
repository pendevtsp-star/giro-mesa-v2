# Gates de carga e soak

## Escopo

O harness em `load/` cobre três jornadas independentes:

- `k6-operational.js`: leitura do salão, abertura idempotente de mesa e releitura de comandas.
- `k6-public-qr.js`: leitura pública de menu, representando sessões originadas por QR.
- `k6-multitenant.js`: acesso ao próprio tenant e probe negativo contra outro tenant.

O alvo é por unidade: 500 mesas provisionadas, 50 terminais concorrentes e 2.000 sessões QR concorrentes. O profile `spike` chega a duas vezes esse alvo. Métricas levam apenas `name` e `kind`; IDs de tenant, unidade, dispositivo, mesa e comanda não são tags.

## Perfis

| Profile | Concorrência por unidade | Duração | Uso |
| --- | --- | --- | --- |
| `smoke` | 1 VU, 1 iteração | até 30 s | validação local leve |
| `target` | 50 terminais ou 2.000 QR | 10 min | gate no alvo |
| `spike` | rampa até 100 terminais ou 4.000 QR | 10 min | duas vezes o alvo |
| `soak` | 50 terminais ou 2.000 QR | 2 h | estabilidade sustentada |

Com múltiplas unidades, a concorrência é multiplicada pelo número de entradas na fixture. Os perfis `target`, `spike` e `soak` recusam fixture com menos de 500 mesas, 50 terminais ou 2.000 sessões QR declaradas por unidade.

## Thresholds obrigatórios

- erro HTTP: `rate < 0,001`;
- checks de jornada: `rate > 0,999`;
- leitura: p95 menor que 300 ms;
- escrita: p95 menor que 500 ms;
- isolamento: `isolation_breach == 0`.

Cada mesa é aberta uma única vez antes de a jornada entrar em leitura sustentada. Status 409 indica fixture suja ou distribuição incorreta e reprova a execução. Qualquer 200 no probe estrangeiro é violação de isolamento e aborta a aprovação.

## Pré-requisitos e dados

1. Usar ambiente local/staging descartável, nunca produção.
2. Registrar commit, perfil, horário, região/rede, réplicas, CPU/RAM, banco, pool e limites de fila.
3. Provisionar no mínimo dois tenants isolados. Para carga real, cada entrada da fixture deve referenciar 500 mesas e 50 terminais válidos e declarar 2.000 sessões QR.
4. Gerar a fixture fora do log do k6. Ela pode conter somente IDs técnicos, labels, nomes de variáveis e paths públicos; cookies, tokens e chaves são proibidos.
5. Disponibilizar cookies de sessão por variáveis nomeadas na fixture, com usuário de carga de menor privilégio. Não imprimir nem exportar essas variáveis.
6. Confirmar capacidade de reset/limpeza dos dados abertos pela jornada operacional.

`load/fixtures/smoke.example.json` é apenas formato seguro de exemplo. Substitua seus IDs pelos do seed local antes de executar; ele não declara que os UUIDs existem em um ambiente ativo.

## Smoke local

Defina no processo:

```powershell
$env:K6_BASE_URL = "http://localhost:3200"
$env:K6_PROFILE = "smoke"
$env:K6_FIXTURE_PATH = "./fixtures/smoke.local.json"
$env:K6_TENANT_A_COOKIE = "<sessão local>"
$env:K6_TENANT_B_COOKIE = "<sessão local>"
```

Execute separadamente:

```powershell
rtk proxy k6 run load/k6-operational.js
rtk proxy k6 run load/k6-public-qr.js
rtk proxy k6 run load/k6-multitenant.js
```

O public QR não usa os cookies. Operação e multitenancy falham antes de iniciar se uma variável de sessão estiver ausente. O harness não possui fallback para segredo em arquivo ou valor padrão.

## Target, spike e soak

Troque `K6_PROFILE` pelo profile aprovado e use uma fixture completa, gerada para o ambiente descartável. Antes de `spike` ou `soak`, execute e aprove `smoke` e `target` no mesmo artefato. Não rode os perfis pesados em laptop compartilhado ou VPS piloto.

Hardware mínimo não é presumido pelo repositório. O responsável deve declarar, no resultado, os recursos do gerador e do sistema sob teste. Interrompa se o gerador atingir 80% de CPU/memória, pois o resultado deixa de medir o sistema de forma confiável.

## Abort gates

Abortar imediatamente quando ocorrer qualquer um:

- `isolation_breach > 0`, resposta com dado de outro tenant ou efeito cruzado;
- perda, duplicação indevida ou corrupção operacional;
- erro igual ou superior a 0,1% após aquecimento;
- p95 de leitura igual ou superior a 300 ms ou escrita igual ou superior a 500 ms por 10 minutos;
- CPU sustentada acima de 85%, memória acima de 80%, pool acima de 85% ou fila sem drenagem;
- necessidade de copiar secret/payload para investigar.

O abort preserva métricas e evidências sanitizadas, mas não autoriza apagar fila, inbox, outbox ou dados de auditoria.

## Leitura e registro do resultado

Registrar por execução:

- commit e checksum da fixture sem seu conteúdo;
- profile, horários e número de unidades;
- hardware/rede do gerador e do sistema;
- thresholds aprovados/reprovados, p95, erro e isolamento;
- saturação, backlog e eventos operacionais;
- limpeza/reconciliação dos dados de carga.

Um smoke verde prova somente que o harness e a fixture alcançam o ambiente. `target`, `spike` e `soak` só podem ser declarados executados com artefato k6 e telemetria correspondentes. Nenhum desses perfis foi executado como parte da criação deste harness.
