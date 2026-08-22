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
2. Ao fechar uma comanda, a mesma transação grava o evento `pos.tab.closed`. O worker cloud reivindica o evento com retry/dead-letter, monta o snapshot fiscal a partir dos itens, pagamentos e classificações vigentes e cria uma referência idempotente por comanda.
3. O worker usa exclusivamente o token cifrado da emitente e do ambiente ativo para enviar a NFC-e à Focus. Estados `processing` ou contingência são reconciliados pela fila; respostas de negócio não-retryable encerram como rejeição auditável.
4. Em autorização ou cancelamento, outro evento baixa XML e DANFE apenas dos hosts Focus permitidos, valida assinatura/tamanho e persiste os arquivos no volume compartilhado. O PostgreSQL guarda metadados, `taxCents`, hashes SHA-256 e histórico, não o binário integral.
5. A API oferece consulta/reconciliação, cancelamento e inutilização de faixa com permissão, idempotência e escopo por unidade. O XML da inutilização também é armazenado com hash.
6. O fechamento mensal bloqueia documentos pendentes, em processamento, contingência, rejeitados ou sem XML obrigatório. O download contábil é um ZIP com `manifesto.json`, `documentos.csv`, XMLs de autorização/cancelamento e DANFEs disponíveis, identificado por SHA-256.
7. O contador consulta o pacote ZIP e troca solicitações auditadas com a operação. Esse pacote é evidência interna e não substitui obrigações oficiais.

## Segurança e operação

- Valores monetários permanecem em centavos.
- `FOCUS_NFE_PRIMARY_TOKEN` e `FISCAL_CREDENTIALS_ENCRYPTION_KEY` pertencem ao secret manager de produção; não use variáveis `VITE_*` ou `NEXT_PUBLIC_*` para esses valores.
- Segredos, XML integral e resposta bruta do provedor não entram na fila de sincronização.
- API e worker usam o mesmo `MEDIA_ROOT=/app/data/media`, montado no volume persistente `media_data`. O deploy vincula o diretório de backup a esse mount, executa um probe de escrita/leitura entre containers e valida a migration 0050 antes de promover a release.
- Cancelamento e inutilização exigem proprietário ou gerente no snapshot local vigente.
- O perfil `accountant` é somente de consulta/colaboração e não recebe permissões operacionais do PDV.
- A emissão automática atual aceita somente CNPJ numérico com 14 dígitos. Cadastros alfanuméricos devem permanecer bloqueados até o payload, as validações e a compatibilidade Focus serem implementados e homologados ponta a ponta.

## Limites de homologação

O pacote ZIP é evidência contábil interna; ele não substitui SPED, EFD, e-CAC ou obrigações municipais. `FISCAL_RELEASE_ENV=homologation` é o padrão fail-closed. Produção permanece bloqueada até existirem credenciais reais, certificado válido, CSC, classificação revisada pelo contador, homologação por UF/município e evidência imutável em `config/fiscal-release.json`. NFC-e é síncrona na Focus; NF-e e NFS-e exigem polling ou webhook para o estado terminal.
