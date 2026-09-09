# Implementação da revisão operacional

Pedido autorizado em 09/09/2026: implementar todas as correções e melhorias do relatório `frontend-operacao-producao-2026-09-09.md`.

Implementação local concluída. Este registro descreve escopo, integração e validação; não constitui evidência de deploy ou homologação física.

## Entregas

- [x] Salão/comanda: densidade, ordenação, CTA monetário, divisão explícita.
- [x] Recepção: data/telefone, conflitos, grupos e conclusão coerente.
- [x] Rodada selecionada, ruptura assistida e liberação de etapas.
- [x] QR: acompanhamento completo, total por etapa, alergia estruturada persistida.
- [x] Sino: perfil Delivery, escopos claros e destinos específicos.
- [x] Visão geral: destinos específicos e pré-fechamento do turno.
- [x] Passagem de turno: pendências e ciência persistida sem transferência financeira implícita.
- [x] Caixa: comprovante histórico, conferência por perfil e alertas únicos.
- [x] Financeiro: upload privado, filtro por turno e divergências.
- [x] Equipe: pagamento documentado com vínculo financeiro e bloqueadores.
- [x] KDS: linguagem, hierarquia, ETA e entrega parcial.
- [x] Delivery: consistência POS/Growth, cobrança, falha/devolução/nova tentativa.
- [x] Equipamentos: recuperação contextual, nomes e atualização contínua.
- [x] Cardápio: disponibilidade e edição diária, ações secundárias e rótulos.
- [x] QR das mesas: sequência de geração, impacto da rotação e navegação.
- [x] Estoque: visão de turno e confirmações contextualizadas.
- [x] Compras: recebimento móvel e agenda de entregas.
- [x] Pessoas: fuso da unidade, equipe do turno e correções pendentes.
- [x] Relatórios: Hoje/Turno e escopo das visões.
- [x] Fiscal/Contador: pendências e confirmações com motivo/impacto.
- [x] CRM: precisa responder e cliente contextual.
- [x] Multiunidade: comparativo operacional e acesso autorizado à unidade.
- [x] Configurações: seções, prontidão por canal e evidências.
- [x] Assinatura: vencimento, consulta do pagamento no provedor e efeitos de plano/meio disponível.
- [x] Plataforma: prioridade de incidentes, pilotos com problemas e filtros salvos por administrador neste navegador.
- [x] Contratos/clientes gerados, migrations, mapa/grafo.
- [x] Checks proporcionais, builds, UI 375/desktop/light/dark.

## Validação

`scratch/` e dados existentes preservados. Nenhum pedido ou pagamento de produção foi usado nos testes. Integrações PostgreSQL executam persistência real; jornadas de navegador usam APIs controladas e não representam homologação externa.

| Check | Resultado |
|---|---|
| API completa em PostgreSQL 17.11 | 307/307, zero pulados |
| Ops completo | 342/342; 26 testes dirigidos também passaram na integração |
| Contratos | 20/20 |
| DB | 27/27 |
| Customer | 21/21 e build de produção |
| Edge Hub .NET | 67/67 |
| Builds | API, Ops, Customer, worker e cliente C# passaram |
| OpenAPI e clientes | OpenAPI, TypeScript e C# regenerados; C# sem erros/avisos de compilação |
| Migrations | 0–82 aplicadas no banco vazio `giromesa_frontend_final`; reaplicação sem alterações passou |

O PostgreSQL isolado usou `127.0.0.1:5549`; o Docker local estava indisponível. Foram usados binários da distribuição indicada por [PostgreSQL](https://www.postgresql.org/download/windows/), sem alterar os bancos existentes. O servidor de testes foi encerrado ao concluir a validação; os dados isolados foram preservados no diretório temporário.

Cobertura funcional dirigida:

- POS/KDS/pagamentos: snapshot e ciência imutável de turno, repetição idempotente, tenant/perfil, liberação de etapa preservando dependências, alergia persistida e destino exato de aprovação no dashboard.
- Financeiro: aprovação, liquidação e cancelamento da apuração compartilham o núcleo financeiro; proteção contra alterações genéricas da conta vinculada, saldo parcial, apuração legada e comprovante privado autorizado.
- Growth: `needsReply` baseado na última entrada/saída; comparativo apenas de unidades autorizadas; diagnóstico Delivery antes/depois da projeção para expedição.
- Configurações: registro de conferência manual por canal, evidência, responsável e horário do servidor; isolamento e repetição idempotente.
- Navegador QR: solicitação → confirmação → preparo → pronto → falha 503 → recuperação → servido; recuperação após reload, alergia e total coerente, parada de polling no estado terminal; capturas em 375/1440 px claro/escuro.
- Navegador Ops: continuidade de rascunho, pagamento parcial e recuperação, dashboard de oito perfis, relatórios, catálogo, KDS/Delivery, equipamentos, configurações e plataforma. A falha inicial do fixture de back office foi corrigida e o cenário passou.
- Novas jornadas de passagem de turno e resumo do turno em Relatórios passaram em 375 px; ciência reutiliza a mesma chave após 503 e o resumo preserva o período escolhido.
- Caixa: 1 jornada desktop/375, incluindo o comprovante; Pessoas e Apuração: 6 jornadas; Financeiro e Fiscal: 3 jornadas desktop/375. Todas passaram.
- Estoque, Compras e comanda: 3 jornadas finais passaram em sequência, cobrindo visão do turno, confirmação contextual, recebimento parcial/excedente com lote/validade, rodada selecionada, ruptura assistida e liberação persistida de etapa. Estoque/Compras incluem 375/desktop e claro/escuro.
- Plataforma: 5 checks de integração/contrato passaram no PostgreSQL final; a jornada de pilotos e filtros salvos passou em desktop/375 escuro, com `status=active&activePilotOnly=true`. Pilotos futuros, expirados ou fora de `trial_active` não entram no filtro; incidentes assumidos permanecem visíveis.
- Higiene: `git diff --check` passou e Biome não apontou erros nos arquivos alterados. O grafo foi atualizado e a wiki regenerada.

## Decisões de implementação

- Passagem de turno reutiliza `audit_events` e recibos de idempotência: o encerramento persiste um snapshot; a gestão que entra registra ciência autenticada. A confirmação não altera pagamentos ou responsabilidade financeira.
- Ruptura conduz revisão do substituto e cancelamento autorizado como etapas explícitas do fluxo existente; nenhuma substituição é apresentada como atômica.
- Etapas do atendimento usam a projeção dos tickets da comanda e o comando KDS existente. Garçom/caixa só podem agir em uma comanda autorizada; espera por dependência continua válida após a liberação da etapa.
- Entrega concluída e pagamento confirmado continuam estados distintos. Falha/devolução não registra recebimento por um simples marcador de interface.
- Aprovar uma apuração cria a conta a pagar; liquidar usa as regras existentes de aprovação, saldo de gaveta, lançamento e auditoria na mesma transação. O registro não executa transferência bancária. Apurações antigas aprovadas recuperam o vínculo pelo snapshot persistido.
- Conferência de canal reutiliza auditoria e idempotência, com responsável e data do servidor. Cadastro, diagnóstico automático e resultado de teste manual são apresentados separadamente.
- O link da cobrança é chamado de consulta no provedor, pois o contrato disponível não garante que seja um recibo.
- A API e o Ops exigem schema 82. A prontidão consulta tabelas, colunas financeiras e estados de entrega; um banco antigo não é anunciado como compatível apenas pelo número da versão.
- Concluir recepção arquiva o acompanhamento da reserva; a ação explicita que comanda e conta são encerradas no Atendimento.
- A visão de pilotos usa estado e datas reais do acesso; a visão salva guarda somente filtros neste navegador, com chave por administrador. Resultados e permissões continuam sendo consultados no servidor.

## Limites para a entrada em produção

Implementação e validações são locais. Não houve commit, push, publicação de imagem, deploy ou execução em terminal físico. O bundle Ops ainda emite aviso de chunk acima de 500 kB; testes .NET têm avisos preexistentes do analisador xUnit.

Antes de ativar os canais na casa, permanece necessária a conferência com impressora real, maquininha/provedor, emissão fiscal, entrega com pagamento conciliado, retorno da internet e restauração de backup. Os registros por canal adicionados nesta entrega guardam essa evidência; testes de software não a substituem.
