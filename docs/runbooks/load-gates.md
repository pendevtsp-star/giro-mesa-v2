# Gates de carga e soak

## Escopo

O harness em `load/` cobre três jornadas independentes:

- `k6-operational.js`: leitura do salão, abertura exclusiva de mesa e releitura de comandas.
- `k6-public-qr.js`: leitura pública de menu, representando sessões originadas por QR.
- `k6-multitenant.js`: acesso ao próprio tenant e probe negativo contra outro tenant.

O alvo é por unidade: 500 mesas provisionadas, 50 terminais concorrentes e 2.000 sessões QR concorrentes. O profile `spike` chega a duas vezes esse alvo. Métricas levam apenas `name` e `kind`; IDs de tenant, unidade, dispositivo, mesa e comanda não são tags.

## Perfis

| Profile | Concorrência por unidade | Duração | Uso |
| --- | --- | --- | --- |
| `smoke` | 1 VU por tenant, 1 iteração por VU | até 30 s | validação local leve |
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

Cada VU operacional mantém estado isolado, recebe uma mesa exclusiva pelo seu índice local — inclusive os VUs 51–100 do spike — e tenta abri-la somente na primeira iteração. As iterações seguintes reutilizam a sessão aberta e permanecem em leitura; não repetem `tab.open`. Status 409 indica fixture suja ou distribuição incorreta e reprova a execução. Qualquer 200 no probe estrangeiro é violação de isolamento e aborta a aprovação.

## Pré-requisitos e dados

1. Usar ambiente local/staging descartável, nunca produção.
2. Registrar commit, perfil, horário, região/rede, réplicas, CPU/RAM, banco, pool e limites de fila.
3. Provisionar no mínimo dois tenants isolados. Para carga real, cada entrada da fixture deve referenciar 500 mesas e 50 terminais válidos e declarar 2.000 sessões QR.
4. Gerar a fixture fora do log do k6. Ela pode conter somente IDs técnicos, labels, nomes de variáveis e paths públicos; cookies, tokens e chaves são proibidos.
5. Disponibilizar cookies de sessão por variáveis nomeadas na fixture, com usuário de carga de menor privilégio. Não imprimir nem exportar essas variáveis.
6. Confirmar capacidade de reset/limpeza dos dados abertos pela jornada operacional.

`load/fixtures/smoke.example.json` é apenas formato seguro de exemplo. Substitua seus IDs pelos do seed local antes de executar; ele não declara que os UUIDs existem em um ambiente ativo.

### Smoke local descartável

O gate abaixo constrói API e banco, sobe PostgreSQL 17 descartável, aplica todas as migrations, cria dois tenants e duas sessões efêmeras, e executa os três entrypoints na imagem oficial pinada do k6:

```powershell
rtk pnpm test:load:smoke
```

O orquestrador usa banco e role de login exclusivos, gera a fixture sem segredos e injeta cookies por arquivo de ambiente temporário. O executor `per-vu-iterations` obriga uma iteração para cada tenant. Depois do k6, uma consulta no PostgreSQL descartável exige exatamente uma comanda aberta na mesa esperada de cada tenant.

Fixture, arquivo de ambiente e containers nomeados são removidos em sucesso ou falha. `SIGINT`/`SIGTERM` interrompem os processos filhos, executam o mesmo cleanup e fazem o gate falhar; falha ao confirmar a ausência de qualquer container também reprova. O JSON `status: passed` é emitido somente depois dessas confirmações. Os resumos sanitizados ficam no diretório temporário impresso ao final. Esse smoke comprova tráfego HTTP real leve e isolamento bidirecional; não substitui os perfis `target`, `spike` ou `soak`.

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

## Probe local F1: 120 mesas e 12 terminais

`load/f1-local.mjs` mede o cenário F1 contra a API local já servida em `127.0.0.1:3217`.
Ele não usa Docker, WSL ou k6, não inicia nem reinicia serviços e recusa outro host ou porta. O probe:

- cria uma organização/unidade exclusiva e 120 mesas em quatro lotes de 30;
- abre 12 autenticações HTTP independentes do mesmo owner, cada uma com cookie e `x-device-id` próprios;
- distribui dez mesas exclusivas para cada terminal e mantém 12 loops concorrentes de leitura;
- descarta em um proxy TCP local a resposta de uma abertura já confirmada pela API, repete a mesma chave idempotente e exige replay;
- consulta novamente a API e exige 120 mesas e 120 comandas raiz abertas no tenant do probe.

Defina a chave interna da instância local apenas no ambiente do processo. Ela e os cookies não são
gravados nos artefatos:

```powershell
$env:F1_API_URL = "http://127.0.0.1:3217"
$env:F1_INTERNAL_API_KEY = "<chave interna exclusiva da API local>"
$env:F1_DURATION_SECONDS = "60"
$env:F1_THINK_TIME_MS = "1000"
rtk node load/f1-local.mjs
```

Depois que o processo terminar e o exit code tiver sido registrado, remova a chave do shell:

```powershell
Remove-Item Env:F1_INTERNAL_API_KEY
```

A duração aceita de 10 a 600 segundos. O resumo sanitizado e a fixture sem credenciais ficam em
`tests/e2e-live/.runtime/f1/<timestamp>/`. Registre duração real, vazão, p95 de leitura e escrita,
falhas, contagens finais e o SHA/schema retornado por `/health`. O gate usa p95 menor que 300 ms para
leituras, p95 menor que 500 ms para escritas e taxa de falhas menor que 0,1%.

O limite sensível de autenticação permanece em dez tentativas por IP por minuto. O runner usa a sessão
emitida pelo cadastro como a primeira das 12 e espera o `Retry-After` ao preparar as demais. Esse tempo
de preparação não conta como carga operacional. O think time padrão de 1 segundo mantém o loop dentro
do ritmo humano previsto; o resumo separa vazão de leitura e escrita. As 12 sessões ainda representam
um único owner, portanto este perfil não comprova 12 identidades de garçom nem atribuições de praça.
Uma falha antes do resumo gera `prefix-failed.json` e não produz resultado de capacidade.

### Resultado local F1 de 2026-09-10

O probe de cinco minutos em PostgreSQL 17 e API local, schema 83, concluiu com 120 mesas e 120
comandas raiz persistidas. As 12 sessões do mesmo owner sustentaram 6.318 leituras em 300 segundos
(21,06 leituras/s), com p95 de 121,68 ms. As 119 escritas medidas foram exclusivamente a rajada
inicial de abertura das outras mesas, antes do steady state, com p95 de 253,40 ms; o steady state não
enviou pedidos nem outras mutações. O runner observou zero respostas HTTP com falha nessa execução e
confirmou replay idempotente após descartar uma resposta já confirmada pela API.

Esses números não demonstram capacidade sustentada de pedidos ou pagamentos. Também não comprovam 12
identidades de garçom, comportamento da VPS ou ausência de perda. O artefato sanitizado está em
`tests/e2e-live/.runtime/f1/2026-09-10T22-58-15.229Z/summary.json`. A execução prefixada anterior, com
think time de 250 ms, foi reprovada por 429 compartilhado entre sessões e está preservada no diretório
`2026-09-10T22-40-22.439Z`; ela não gerou métricas válidas de capacidade.

Esse probe comprova somente o comportamento observado na máquina e na API locais durante aquela
execução. Ele não mede a infraestrutura da VPS, não substitui `target`, `spike` ou `soak` e não
autoriza afirmar ausência de perda em outros padrões de falha.

## Target, spike e soak

Troque `K6_PROFILE` pelo profile aprovado e use uma fixture completa, gerada para o ambiente descartável. Antes de `spike` ou `soak`, execute e aprove `smoke` e `target` no mesmo artefato. Não rode os perfis pesados em laptop compartilhado ou VPS piloto.

Hardware mínimo não é presumido pelo repositório. O responsável deve declarar, no resultado, os recursos do gerador e do sistema sob teste. Interrompa se o gerador atingir 80% de CPU/memória, pois o resultado deixa de medir o sistema de forma confiável.

## Abort gates

Abortar imediatamente quando ocorrer qualquer um:

- `isolation_breach > 0`, resposta com dado de outro tenant ou efeito cruzado;
- perda, duplicação indevida ou corrupção operacional;
- erro igual ou superior a 0,1% após 30 segundos de aquecimento;
- p95 de leitura igual ou superior a 300 ms ou escrita igual ou superior a 500 ms após 1 minuto;
- CPU sustentada acima de 85%, memória acima de 80%, pool acima de 85% ou fila sem drenagem;
- necessidade de copiar secret/payload para investigar.

Os thresholds do k6 usam `abortOnFail`: isolamento tem `delayAbortEval: 0s`, checks e erro usam `30s`, e latência usa `1m`. Os gates de integridade e saturação que dependem de observação externa continuam sob responsabilidade do operador. O abort preserva métricas e evidências sanitizadas, mas não autoriza apagar fila, inbox, outbox ou dados de auditoria.

## Leitura e registro do resultado

Registrar por execução:

- commit e checksum da fixture sem seu conteúdo;
- profile, horários e número de unidades;
- hardware/rede do gerador e do sistema;
- thresholds aprovados/reprovados, p95, erro e isolamento;
- saturação, backlog e eventos operacionais;
- limpeza/reconciliação dos dados de carga.

Um smoke verde prova somente que o harness, as migrations e a fixture alcançam a API local descartável, que cada tenant executa sua jornada e que as duas mesas esperadas ficam abertas no tenant correto. `target`, `spike` e `soak` só podem ser declarados executados com artefato k6 e telemetria correspondentes. Nenhum desses perfis pesados foi executado como parte desta validação.
