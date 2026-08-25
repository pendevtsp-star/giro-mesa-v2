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
7. Emissão, reconciliação, cancelamento, fechamento e reabertura usam o mesmo lock por competência. Uma competência fechada é imutável; o ZIP é validado contra o snapshot, armazenado uma vez e invalidado somente por uma reabertura auditada.
8. O contador consulta o pacote ZIP e troca solicitações paginadas e auditadas com a operação. Cada solicitação declara se aguarda o contador ou o estabelecimento; somente a parte destinatária pode resolvê-la. A fila permite filtrar abertas, vencidas e resolvidas, independentemente da competência selecionada.
9. Anexos PDF, XML, CSV, JPEG e PNG de até 3 MiB são verificados pelo ClamAV antes de entrar no armazenamento controlado pelo servidor, com hash SHA-256 e download autenticado no mesmo tenant e unidade. A API projeta somente metadados de negócio, nunca chaves de armazenamento, retenção, idempotência ou identidades internas.
10. Criação e resolução publicam eventos no outbox. O worker notifica por e-mail somente a audiência correta, exclui o próprio ator e não inclui descrição, prazo ou resolução na mensagem.

## Segurança e operação

- Valores monetários permanecem em centavos.
- `FOCUS_NFE_PRIMARY_TOKEN` e `FISCAL_CREDENTIALS_ENCRYPTION_KEY` pertencem ao secret manager de produção; não use variáveis `VITE_*` ou `NEXT_PUBLIC_*` para esses valores.
- Segredos, XML integral e resposta bruta do provedor não entram na fila de sincronização.
- API e worker usam o mesmo `MEDIA_ROOT=/app/data/media`, montado no volume persistente `media_data`. O deploy vincula o diretório de backup a esse mount, executa um probe de escrita/leitura entre containers e valida a migration 0061 e a evidência de recovery contra a migration mais recente antes de promover a release.
- Produção executa o ClamAV oficial em rede interna, sem publicar a porta 3310, com base de assinaturas persistente e imagem travada por digest. A API só inicia após o scanner ficar saudável e continua bloqueando uploads quando a verificação não está disponível.
- Anexos contábeis/fiscais são preservados por no mínimo 1.827 dias (cinco anos, cobrindo anos bissextos). O worker remove anexos expirados uma vez por dia; processo administrativo ou judicial exige `legal hold`, aplicado ou removido somente pela administração da plataforma e sempre auditado. A política segue o prazo mínimo fiscal indicado pelo [CTN, art. 195](https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm) e pela [orientação oficial de guarda de notas fiscais](https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/perguntas-frequentes/nota-fiscal-inscricao-estadual-e-ou-municipal/as-notas-fiscais-emitidas-e).
- Cancelamento e inutilização exigem proprietário ou gerente no snapshot local vigente.
- O perfil `accountant` é somente de consulta/colaboração e não recebe permissões operacionais do PDV.
- O domínio aceita o CNPJ alfanumérico oficial e envia as 14 posições em maiúsculas à Focus. A compatibilidade efetiva do provedor continua sendo um item obrigatório da homologação antes de liberar produção.
- `cstIbsCbs` e `cClassTrib` são enviados nos campos correspondentes da Focus quando cadastrados. O GiroMesa não inventa alíquota, base ou enquadramento: a classificação continua sob validação do contador.

## Limites de homologação

O pacote ZIP é evidência contábil interna; ele não substitui SPED, EFD, e-CAC ou obrigações municipais. `FISCAL_RELEASE_ENV=homologation` é o padrão fail-closed aplicado em runtime pela API e pelo worker. Produção permanece bloqueada até existirem credenciais reais, certificado válido, CSC, classificação revisada pelo contador, homologação por UF/município e evidência imutável em `config/fiscal-release.json`. NFC-e é síncrona na Focus; NF-e e NFS-e exigem polling ou webhook para o estado terminal.
