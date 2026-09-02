# Pessoas: múltiplas funções e restrição no SmartPOS

Status: implementação local concluída em 2026-09-02. Produção continua condicionada à aplicação da migração e à homologação do fluxo.

## Entendimento confirmado

- Cada funcionário usa uma identidade, uma conta e um PIN por organização.
- Owner ou responsável autorizado concede uma ou mais **funções autorizadas** permanentes por unidade.
- Não há redistribuição obrigatória de função a cada turno.
- No navegador comum, o acesso é a união das permissões concedidas naquela unidade.
- No app GiroMesa SmartPOS pareado, somente rotas e capacidades operacionais ficam disponíveis.
- Módulos administrativos ficam ocultos e bloqueados no app, inclusive por URL ou chamada direta à API.
- Abrir um navegador comum no mesmo aparelho está fora desse bloqueio; controle do dispositivo inteiro exigiria quiosque/MDM.

## Premissas e não objetivos

- Escala inicial: dezenas ou centenas de funcionários por estabelecimento.
- Concessão, revogação, convite, aceite e troca por PIN exigem API online.
- Auditoria reutiliza retenção e controles existentes e nunca grava PIN, senha, token ou credencial do dispositivo.
- Não fazem parte desta entrega: PIN por função, função ativa por turno, matriz dinâmica por modo de terminal, novo frontend SmartPOS ou bloqueio do aparelho físico inteiro.

## Modelo de dados e invariantes

### Identidade e acesso

- `memberships` continua representando a participação da identidade na organização.
- `terminal_operator_pins` continua com um PIN por `membership`.
- `management_person_access` continua representando vínculo, unidade, convite e estado do acesso.
- Uma nova coleção `management_person_role_assignments` registra as funções administradas por Pessoas, com unicidade por organização, unidade, pessoa e papel.
- `role_bindings` continua sendo a fonte dos grants efetivos usados pela autorização.

Cada assignment contém o papel desejado e o `roleBindingId` correspondente quando o acesso está ativo. Os invariantes são:

1. acesso ativo exige exatamente um binding de unidade por assignment;
2. `roleBindingId = null` só é permitido enquanto convite estiver pendente ou acesso estiver suspenso;
3. bindings `unitId = null` são globais, ficam fora de Pessoas e nunca são removidos por esse fluxo;
4. um grant global aplicável bloqueia suspensão ou desligamento por unidade até ser resolvido no fluxo organizacional;
5. os fluxos de Pessoas não criam ou removem binding exato da unidade sem atualizar o assignment na mesma transação;
6. violações do item anterior retornam `PERSON_ROLE_ASSIGNMENT_REQUIRED`, sem alteração parcial.

### Concorrência

As mutações usam advisory lock transacional por organização, unidade e pessoa. As ações editáveis também enviam `expectedRevision`; conflito retorna `PERSON_ACCESS_CHANGED` e preserva as escolhas locais para revisão, sem merge implícito.

## Autorização

### Navegador comum

A autorização consulta os `roleBindings` atuais da unidade em cada operação. Tokens e filas não incorporam papéis. A permissão efetiva é a união dos papéis ativos.

### App GiroMesa SmartPOS

O app provisionado opera exclusivamente com sessão de terminal. A sessão pessoal usada no provisionamento é encerrada antes de liberar a operação. O frontend filtra navegação e links pela allowlist operacional fixa; a API continua como autoridade final usando `authKind = terminal` e política deny-by-default por método e rota normalizada.

O identificador de instalação serve apenas para correlação. A confiança vem do enrollment P-256 existente, com assinatura, timestamp, nonce, rotação e revogação. O perfil do terminal continua definindo tela inicial, modo compacto, equipamentos e ações rápidas; ele não cria uma segunda matriz de permissões.

Rotas permitidas no SmartPOS permanecem na allowlist operacional existente: início, salão, balcão e KDS.

Rotas bloqueadas incluem Estoque, Compras, Pessoas, Cardápio administrativo, gestão completa de caixa, Financeiro, Relatórios, Fiscal, Contador, Assinatura, Configurações e Plataforma. Pagamento permanece sujeito à matriz de compatibilidade, certificação, kill switch e homologação existentes.

## Fluxos

### Conceder ou alterar funções

1. O responsável abre Pessoas na unidade explícita.
2. Seleciona uma ou mais **Funções autorizadas**; nenhuma vem pré-selecionada.
3. A API bloqueia a pessoa/unidade, confere `expectedRevision` e valida concessões e remoções individualmente, incluindo step-up quando necessário.
4. Se uma função não puder ser alterada, toda a operação falha.
5. Assignments e bindings são atualizados atomicamente.
6. Auditoria registra conjunto anterior, novo conjunto, ator, unidade e revisão, sem segredos.

### Convite

O convite geral permanece singular. Para Pessoas, as funções pendentes ficam nos assignments ligados ao acesso. No aceite, a API usa o conjunto pendente vigente no instante do lock, revalida convite, expiração, revogação e política, e cria todos os bindings atomicamente. Replay idempotente não duplica grants.

### Suspensão, reativação e desligamento

- Suspensão é por unidade, preserva assignments e remove todos os bindings exatos daquela unidade.
- Grant global aplicável bloqueia a suspensão sem alterar estado.
- Reativação mostra previamente todas as funções que serão restauradas, destacando as sensíveis.
- Desligamento encerra assignments, bindings, sessões e demais dependências conforme o preflight existente.

## Experiência

- A UI usa “Funções autorizadas”, não “função do turno”.
- Organização e unidade permanecem visíveis durante edição, suspensão e reativação.
- Acesso habilitado exige ao menos uma função.
- SmartPOS não apresenta módulos bloqueados; uma rota administrativa direta retorna à área operacional.
- Conflitos informam que outro responsável alterou o cadastro e que nada local foi salvo.
- Erros de revogação orientam atualizar, trocar operador ou procurar o responsável, em vez de expor apenas códigos técnicos.

## Migração e rollout

1. Aplicar a migração `0077`, que adiciona tabela, índices, revisão e backfill dos bindings exatos existentes.
2. Publicar backend e frontend compatíveis no mesmo release.
3. Mutação sem revisão continua válida em acesso singular, mas é rejeitada em acesso multifunção para impedir que cliente antigo remova funções silenciosamente.
4. Depois de habilitar multi-função, rollback para backend antigo não é suportado; usar release compatível ou forward fix.
5. Remover os campos singulares legados somente em uma mudança futura, após confirmar que não há consumidores antigos.

## Validação obrigatória

- Unitários: união de papéis, allowlist terminal deny-by-default e projeção da navegação.
- PostgreSQL: backfill, convite/aceite, grant/revoke, suspensão/reativação, offboarding, global grant bloqueando suspensão, binding órfão rejeitado, isolamento tenant/unidade e concorrência.
- Sessão aberta: revogação vale na próxima operação.
- Frontend: seleção múltipla, erro integral, conflito, desktop com união e SmartPOS sem módulos administrativos.
- Links/API: URL direta e chamada direta retornam bloqueio no terminal.
- Responsividade e acessibilidade: 360/375 px, light/dark, teclado, foco, leitores de tela e ausência de overflow.
- Contratos: OpenAPI e clientes TypeScript/C# regenerados sem diff pendente.
- Produção: migração limpa/reaplicada, rollback/restore e jornada em SmartPOS físico homologado.

## Decision Log

| Decisão | Alternativas | Objeções | Resolução |
|---|---|---|---|
| Um login e um PIN com várias funções | login/PIN por função; função por turno | duplicidade e carga gerencial | funções permanentes por unidade e PIN da membership |
| União no navegador e restrição no SmartPOS | todos os módulos em qualquer tela; app separado | layout pequeno e acesso por URL | sessão terminal + allowlist fixa; navegador comum permanece sem restrição do aparelho |
| Assignments desejados + bindings efetivos | usar apenas campo singular; usar apenas roleBindings genéricos | suspensão, provenance e bindings órfãos | bijeção v2, owner único e writers convergidos |
| Convite geral permanece singular | alterar todo convite da organização | blast radius e rollback | funções pendentes ficam no domínio Pessoas e são aplicadas no aceite |
| Suspensão por unidade | suspender membership inteira | papel global poderia manter acesso | grant global bloqueia suspensão parcial e exige fluxo organizacional |
| Allowlist fixa | matriz dinâmica por perfil | YAGNI e drift | reutilizar `terminalRequestAllowed`; perfil cuida apenas da apresentação/equipamentos |
| Migração aditiva | troca direta ou dual-read indefinido | perda silenciosa e rollback inseguro | backfill, compatibilidade de leitura e apenas rollback compatível após ativação |

## Revisão estruturada

O desenho passou por Skeptic/Challenger, Constraint Guardian, User Advocate e Integrator/Arbiter. As objeções bloqueadoras sobre fronteira SmartPOS, identidade confiável do dispositivo, suspensão multi-role, grants globais, bindings órfãos, convite concorrente, replay offline e migração foram incorporadas. Disposição final do árbitro: **APPROVED**.
