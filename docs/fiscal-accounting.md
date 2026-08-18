# Fiscal e Contador

O GiroMesa mantém um único domínio fiscal, com duas experiências e permissões separadas:

- **Fiscal**: configuração tributária, documentos, pendências, competências e fechamento.
- **Contador**: consulta por competência, pacote contábil e solicitações ao estabelecimento.

O livro fiscal canônico fica no PostgreSQL. O Edge Hub apenas executa e reconcilia operações no provedor homologado; organização, unidade e ator são derivados do dispositivo e do snapshot vigente, nunca do corpo enviado pelo terminal.

## Fluxo implementado

1. O Edge Hub emite, consulta, cancela ou inutiliza numeração na Focus.
2. Resultados confirmados e estados `processing` são persistidos localmente como eventos `fiscal.*` idempotentes.
3. O sync valida ator e escopo e encaminha esses eventos ao serviço fiscal.
4. A API mantém documento, itens, histórico imutável, auditoria e a classificação tributária vigente associada ao item.
5. O fechamento mensal bloqueia documentos pendentes, em processamento, contingência ou rejeitados e gera um pacote JSON com hash SHA-256.
6. O contador consulta o pacote e troca solicitações auditadas com a operação.

## Segurança e operação

- Valores monetários permanecem em centavos.
- Segredos, XML integral e resposta bruta do provedor não entram na fila de sincronização.
- Cancelamento e inutilização exigem proprietário ou gerente no snapshot local vigente.
- O perfil `accountant` é somente de consulta/colaboração e não recebe permissões operacionais do PDV.
- CNPJ aceita o formato alfanumérico de 14 posições, com os dois dígitos verificadores finais numéricos.

## Limites de homologação

O pacote JSON é evidência contábil interna; ele não substitui SPED, EFD, e-CAC ou obrigações municipais. Formatos oficiais e transmissão direta só devem ser habilitados depois de credenciais, certificado, regras do escritório contábil e homologação por UF/município. A Focus permanece desabilitada sem token real, conforme `docs/external-dependencies.md`.
