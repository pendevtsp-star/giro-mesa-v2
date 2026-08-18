# GiroMesa V2 — guia de agentes

## Ordem de leitura

1. Leia `MEMORY.md` para decisões estáveis e preferências do projeto.
2. Consulte `PROJECT_MAP.md` e `.code-review-graph/wiki/index.md` antes de abrir diretórios inteiros.
3. Leia `DESIGN.md` antes de alterar qualquer frontend.
4. Abra somente os arquivos apontados pelo mapa e amplie o contexto apenas quando uma dependência exigir.

## Arquitetura e limites

- Este repositório é o V2 canônico. Nunca edite `../giro_mesa`.
- Deployables ficam em `apps/frontends`, `apps/backends` e `apps/native`; código compartilhado fica em `packages`.
- Frontends não acessam banco diretamente. Organização e unidade são resolvidas no backend após validar membership.
- Transições de estado, permissões, aprovações, cobrança e auditoria pertencem ao backend.
- Salão, balcão, QR e delivery compartilham a mesma verdade operacional.
- Integrações externas só podem ser declaradas prontas com credenciais, homologação e evidência de saúde.
- Preserve acessibilidade, validação de entrada, idempotência e auditabilidade financeira/fiscal.

## Organização de diretórios

```text
apps/
  frontends/   # site, customer e ops
  backends/    # api, worker, edge-hub e testes .NET
  native/      # shell MAUI da operação
packages/      # domain, contracts, db, ui e clientes gerados
docs/          # documentação operacional durável
tests/         # jornadas E2E e captura de mídia
```

- Crie arquivos dentro do módulo proprietário; não use a raiz como pasta de descarte.
- Componentes, tokens e padrões visuais reutilizáveis pertencem a `packages/ui`.
- Contratos compartilhados pertencem a `packages/contracts`; não importe por caminho relativo atravessando workspaces.
- Um arquivo deve ter uma responsabilidade dominante. Extraia quando misturar domínio, I/O e apresentação ou quando a leitura segura exigir contexto excessivo.
- Atualize `PROJECT_MAP.md` e o grafo quando mover entrypoints ou alterar fronteiras arquiteturais.

## Frontend e design

- O Cardápio operacional é a referência visual do produto. Siga `DESIGN.md` e reutilize `@giromesa/ui`.
- Botões novos devem entrar primeiro na biblioteca quando forem padrões reutilizáveis; páginas não devem inventar variantes locais.
- Use tokens semânticos `--gm-*`; não codifique cores de tema diretamente.
- Garanta dark mode, foco visível, teclado, leitores de tela, estados de loading/erro/vazio e ausência de overflow a partir de 375 px.
- Não confunda disponibilidade visual com persistência: fluxos locais devem dizer que não sobrevivem ao reload.

## Execução e ferramentas

- Prefixe todo comando shell com `rtk`.
- Use `pnpm` e Turborepo para workspaces TypeScript.
- Use `apply_patch` em alterações manuais. Rewrites mecânicos e formatadores podem usar ferramentas próprias.
- Pesquise com `rg`/`rg --files`; não leia pastas inteiras quando o mapa ou o grafo responderem.
- Não altere o lockfile raiz em paralelo com outro agente.
- Não use skills por proximidade temática. Use apenas as explicitamente solicitadas ou indispensáveis ao formato pedido.

## Subagentes e economia de contexto

- O agente principal é o orquestrador: define fronteiras, distribui tarefas independentes, integra diffs e executa a validação final.
- Use agentes rápidos/econômicos para inventários, buscas, formatação, renomes mecânicos e checks estreitos.
- Use agentes de capacidade intermediária para componentes isolados, testes e documentação técnica localizada.
- Reserve agentes de raciocínio avançado para arquitetura, segurança, concorrência, dados, finanças e revisão de alto risco.
- Dê a cada agente um diretório exclusivo e um resultado verificável. Não delegue a dois agentes o mesmo arquivo.
- Compartilhe referências e linhas relevantes; evite reenviar histórico inteiro quando um briefing curto bastar.
- Pare de investigar quando já houver evidência suficiente para a menor correção correta.

## Estratégia de testes

- Toda mudança recebe o menor check capaz de detectar sua regressão.
- CSS/documentação: lint ou formatter do arquivo e inspeção dirigida.
- Componente isolado: typecheck do workspace e teste estreito existente.
- Contrato, dinheiro, autorização, banco ou concorrência: testes unitários e de integração relevantes são obrigatórios.
- Mudança de paths, build ou release: valide workspaces afetados, geração de artefatos e entrypoints de execução.
- E2E completo e build global são reservados para mudanças transversais, releases ou quando checks estreitos não cobrem o risco.
- Não crie testes redundantes para código trivial; não exclua testes ativos apenas para acelerar a execução.

## Higiene do repositório

- Não versione `.next`, `dist`, `.turbo`, `test-results`, `playwright-report`, `coverage`, `bin`, `obj` ou bancos locais do grafo.
- Antes de excluir um arquivo, prove ausência de referências com `rg`, scripts, CI e package manifests.
- Planos concluídos podem ser removidos somente depois que decisões duráveis forem migradas para `README.md`, `DESIGN.md`, `MEMORY.md` ou runbooks.
- Não apague worktrees diretamente. Verifique `git worktree list`, estado limpo e commits não integrados; use `git worktree remove` apenas com autorização para descartar a cópia.
- Preserve migrations, OpenAPI, clientes gerados, runbooks de rollback e bundles nativos exigidos pelo build.
- Ao mover módulos, atualize workspace globs, tsconfig, CI, Docker, scripts, ignores, documentação e lockfile no mesmo trabalho.

## Code Review Graph

- Comece por `get_minimal_context_tool` com uma descrição curta da tarefa.
- Use respostas `detail_level="minimal"` e consulte comunidades/fluxos específicos antes do código.
- Após mudanças estruturais, execute `build_or_update_graph_tool`; gere a wiki com `generate_wiki_tool`.
- O banco local `.code-review-graph/graph.db` é regenerável e não deve ser versionado. A wiki é o mapa consultável do checkout.

## Conclusão

- Preserve alterações do usuário e não reverta trabalho fora do escopo.
- Informe o que foi validado, o que continua local/não integrado e qualquer risco residual.
- Só declare pronto quando a implementação, os checks proporcionais e a execução solicitada estiverem concluídos.
