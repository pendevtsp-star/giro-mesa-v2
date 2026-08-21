# Fiscal e Contador

O GiroMesa mantém um único domínio fiscal, com duas experiências e permissões separadas:

- **Fiscal**: configuração tributária, documentos, pendências, competências e fechamento.
- **Contador**: consulta por competência, pacote contábil e solicitações ao estabelecimento.

O livro fiscal canônico fica no PostgreSQL. O Edge Hub apenas executa e reconcilia operações no provedor homologado; organização, unidade e ator são derivados do dispositivo e do snapshot vigente, nunca do corpo enviado pelo terminal.

## Onboarding Focus NFe

O GiroMesa opera como integrador: o cliente permanece no Ops e não precisa criar ou acessar uma conta na Focus.

1. A API usa `FOCUS_NFE_PRIMARY_TOKEN`, exclusivo do backend, para validar (`dry_run=1`) e cadastrar ou atualizar a emitente em `https://api.focusnfe.com.br/v2/empresas`.
2. O cadastro usa a entidade legal, o perfil fiscal, endereço, IE, certificado A1, CSC e modelos selecionados. O certificado e a senha são enviados à Focus e não são persistidos pelo GiroMesa.
3. A Focus devolve tokens de homologação e produção próprios da empresa. A API os cifra com `FISCAL_CREDENTIALS_ENCRYPTION_KEY` e os isola por organização, unidade e ambiente.
4. Repetições usam `Idempotency-Key`, lock transacional e reconciliação por CNPJ antes de criar, evitando emitentes duplicadas.
5. A tela exibe somente saúde, ambientes habilitados, validade do certificado e próxima ação; tokens e respostas fiscais brutas nunca chegam ao navegador.

## Emissão e escrituração

1. Cada emissão usa o token da empresa e do ambiente escolhido no perfil; o token principal nunca emite documentos.
2. O sync autenticado recebe somente a credencial da sua unidade e do ambiente ativo. O Edge a mantém em memória, sem incluí-la no snapshot ou no banco local; `Hub__Focus__Token` permanece apenas como fallback operacional explícito.
3. O Edge Hub emite NFC-e com referência idempotente, consulta, cancela e inutiliza. A API também consulta e cancela documentos já registrados usando a credencial cifrada da unidade.
4. Resultados confirmados e estados `processing` viram eventos `fiscal.*` idempotentes. O sync valida ator e escopo antes de atualizar o livro fiscal.
5. A API mantém documento, itens, histórico imutável, auditoria e a classificação tributária vigente associada ao item.
6. O fechamento mensal bloqueia documentos pendentes, em processamento, contingência ou rejeitados e gera pacote contábil com hash SHA-256.
7. O contador consulta o pacote e troca solicitações auditadas com a operação.

## Segurança e operação

- Valores monetários permanecem em centavos.
- `FOCUS_NFE_PRIMARY_TOKEN` e `FISCAL_CREDENTIALS_ENCRYPTION_KEY` pertencem ao secret manager de produção; não use variáveis `VITE_*` ou `NEXT_PUBLIC_*` para esses valores.
- Segredos, XML integral e resposta bruta do provedor não entram na fila de sincronização.
- Cancelamento e inutilização exigem proprietário ou gerente no snapshot local vigente.
- O perfil `accountant` é somente de consulta/colaboração e não recebe permissões operacionais do PDV.
- CNPJ aceita o formato alfanumérico de 14 posições, com os dois dígitos verificadores finais numéricos.

## Limites de homologação

O pacote JSON é evidência contábil interna; ele não substitui SPED, EFD, e-CAC ou obrigações municipais. Produção permanece bloqueada até existirem credenciais reais, certificado válido, CSC, classificação revisada pelo contador e homologação por UF/município. NFC-e é síncrona na Focus; NF-e e NFS-e exigem polling ou webhook para o estado terminal.
