# SmartPOS: instalação, pareamento e cobrança

## O que está disponível

- `/instalar` no site público oferece a PWA em navegadores comuns e encaminha SmartPOS compatíveis à loja oficial configurada.
- A PWA instala o atendimento. Ela não aprova pagamentos nem guarda autenticação, API ou resultados financeiros no service worker.
- O APK usa a mesma interface operacional, mas a bridge recebe somente identificadores. Valor, método, parcelas, provedor e ação vêm novamente da API.
- Rede, PayGo, Stone, Getnet, Cielo e PagBank permanecem bloqueados até existir adaptador, terminal físico, credenciais, assinatura de APK e homologação da combinação exata.

## Publicação

1. Publique API, Ops e site em HTTPS e configure `API_URL`, `VITE_API_URL` e `NEXT_PUBLIC_OPS_URL` com URLs públicas coerentes.
2. Configure somente links oficiais recebidos dos fornecedores:
   - `NEXT_PUBLIC_REDE_STORE_URL`
   - `NEXT_PUBLIC_PAYGO_STORE_URL`
   - `NEXT_PUBLIC_STONE_STORE_URL`
3. Sem link oficial, o portal oferece solicitação de homologação e não promete compatibilidade.
4. Sincronize o bundle do Ops com o shell, gere um APK por integração aceita e assine-o com a chave exigida pela loja do fornecedor. Compile `SmartPosApiBaseUrl` com a mesma origem HTTPS pública de `API_URL`; o APK rejeita QR Codes que apontem para outra origem.

As variáveis `NEXT_PUBLIC_*` entram no bundle durante o build. Alterar uma URL exige novo build e nova publicação do site; não edite o JavaScript já gerado. A URL da loja precisa ser HTTPS absoluta e não pode conter usuário ou senha.

O estado publicável de cada fornecedor está em `config/smartpos-release.json`. Um fornecedor `blocked` permanece sem URL e desabilitado. Para mudar para `homologated`, vincule no mesmo manifesto a combinação exata do terminal, identidade/assinatura do aplicativo e referências imutáveis do aceite do fornecedor, execução em hardware e rollback. Depois configure a mesma URL oficial no ambiente e execute:

```text
pnpm smartpos:release-check
```

Em CI/release, use `SMARTPOS_RELEASE_ENV=production`. O gate então exige `APP_URL`, `API_URL`, `VITE_API_URL` e `NEXT_PUBLIC_OPS_URL` em HTTPS, confere a origem pública da API, o manifesto/ícones, a versão do cache e impede publicar uma loja antes da homologação declarada.

Para Rede, o gate externo começa pelo cadastro da software house no programa Conexão Itaú, acesso aos materiais/credenciais aplicáveis e canal de publicação da Laranjinha Store. Para PayGo, é necessário abrir o atendimento de integração, receber credenciais, confirmar a compatibilidade da combinação terminal/adquirente e entregar roteiro/evidências para homologação. Nenhum desses passos é substituído pelo manifesto interno.

## Atualização e rollback da PWA

- O service worker é registrado somente no build publicado; desenvolvimento Vite não cria um novo cache local.
- O navegador busca atualização ao iniciar, a cada quinze minutos, ao voltar para o aplicativo e ao recuperar a rede. A ativação continua explícita para não interromper uma cobrança ou comanda em uso.
- O nome do cache contém a mesma versão de `apps/frontends/ops/package.json`; o gate falha se elas divergirem. Dados de autenticação, `/v1`, `/auth` e pagamentos nunca entram no cache.
- Para rollback, republique o artefato web anterior e sua versão de service worker, valide a atualização em uma instalação de teste e só então libere o operador para aplicar a versão. Rollback web não troca nem homologa o APK do fornecedor.

## Pareamento seguro

1. Um owner/manager abre **Dispositivo e instalação > SmartPOS** e gera um código temporário de oito caracteres, válido por dois a quinze minutos.
2. O QR contém somente a URL pública da API e o código de uso único. O código manual é o fallback.
3. O APK coleta fabricante, modelo, Android, firmware, versão, package e hash do certificado do aplicativo; gera uma chave P-256 e envia apenas a chave pública no resgate.
4. A API consome o código atomicamente, cria ou atualiza o enrollment e grava o diagnóstico como **reportado pelo dispositivo**. A chave privada fica protegida pelo SecureStorage/Keystore do terminal.
5. Depois do pareamento, toda chamada do dispositivo leva credential id, timestamp, nonce e assinatura ECDSA P-256. A API rejeita assinatura inválida, relógio fora da janela e nonce repetido.
6. A credencial gira após o período configurado. A anterior permanece válida por dez minutos para evitar inutilizar o terminal se o aplicativo cair durante a troca.
7. Revogar o enrollment bloqueia imediatamente claims e resultados posteriores. Limpar o pareamento local remove a chave privada, mas o suporte também deve revogar o enrollment.

Re-parear um `installationId` existente revoga as credenciais anteriores e zera certificação, provedor e capacidades financeiras do perfil. O terminal volta a `pending` e precisa de nova liberação interna; ele nunca herda a homologação da chave anterior.

O re-pareamento é bloqueado enquanto houver cobrança ou estorno ativo para a instalação. Finalize ou recupere a operação original antes de trocar a credencial; isso evita que uma nova chave assuma uma transação em andamento.

Pareamento não é homologação. Modelo, firmware, versão e assinatura são diagnóstico reportado; sem atestação do fornecedor, não constituem prova criptográfica do hardware.

## Matriz de compatibilidade e kill switch

Certificação e kill switch são rotas internas protegidas por `x-internal-api-key`; nenhuma sessão de tenant pode homologar o próprio terminal. A capacidade efetiva é a interseção de:

- enrollment não revogado e credencial válida;
- perfil do terminal;
- certificação interna da combinação exata;
- diagnóstico reportado igual à certificação;
- métodos, parcelas e operações permitidos pelos dois lados;
- kill switch desligado.

Qualquer divergência devolve `available=false` com um motivo operacional. O Ops apenas exibe esse estado.

## Fluxo de cobrança

1. O Ops compara capacidades da API e do APK.
2. A API reserva o saldo da comanda sob lock e cria uma tentativa idempotente.
3. O APK reivindica a tentativa com uma chamada assinada. A resposta confiável contém valor, método, parcelas, provedor e `action` (`start`, `recover` ou `cancel`).
4. Somente então o adaptador homologado abre o aplicativo do fornecedor. Retorno genérico de Activity/Intent nunca significa aprovação.
5. O resultado sanitizado entra primeiro na outbox criptografada do APK e depois é enviado com assinatura. Se a outbox atingir o limite seguro, novas cobranças são bloqueadas.
6. A API confere organização, unidade, instalação, tentativa, transição, duplicidade e referência do provedor.
7. Somente `approved` cria uma vez o pagamento `terminal` verificado, com auditoria e outbox na mesma transação.

Referências opacas também passam por allowlist e detecção Luhn para impedir persistência acidental de PAN. Resposta divergente ou insegura do fornecedor vira `unknown`; falha permanente de envio vai para dead-letter durável sem bloquear os resultados seguintes.

Estados: `created`, `processing`, `approved`, `declined`, `canceled`, `unknown` e `reversed`. Em `unknown`, não cobre novamente: use **Verificar pagamento**.

## Estorno e conciliação

- Owner/manager solicita estorno idempotente do pagamento verificado. O dispositivo precisa reivindicar a operação com assinatura e o adaptador precisa declarar suporte.
- Aprovação de estorno preserva o pagamento original, registra resultado próprio, marca a tentativa como `reversed` e publica auditoria/outbox. Nada é apagado.
- A conciliação interna associa a referência do provedor ao pagamento e registra bruto, taxa, líquido, previsão, crédito efetivo, origem e estado.
- Repetição idêntica é idempotente; conteúdo conflitante é rejeitado. Mudanças de estado seguem somente transições financeiras permitidas.
- Até existir webhook/API oficial, a ingestão de conciliação permanece em rota interna; arquivos ou dados externos devem ser previamente validados e auditados.

Sem adaptador homologado da Rede, o fluxo existe mas `CanStart=false` e estorno integrado continua indisponível.

## Operação e suporte

O painel SmartPOS mostra dispositivos, diagnóstico reportado, certificação efetiva, kill switch, resultados desconhecidos, processamentos antigos, terminais offline e divergências de conciliação. O roteiro de homologação registra checklist e referência de evidência, mas não altera a certificação.

- Dispositivo perdido: revogue o enrollment.
- Queda após cobrar: reabra a mesma tentativa e use recuperação; não crie outra tentativa.
- Referência duplicada ou callback conflitante: preserve os registros e trate como incidente financeiro; não edite o banco para forçar aprovação.
- Resultado pendente na outbox: restabeleça a internet e use a sincronização; nunca apague a fila antes da confirmação da API.
- Resultado em dead-letter: preserve o registro, investigue o código permanente retornado pela API e recupere a operação original; nunca refaça a cobrança por suposição.
- Kill switch acionado: interrompa novas operações, preserve resultados já obtidos e siga o rollback do APK/firmware certificado.

## Gate de produção

Registre adquirente, modelo, Android, firmware, versão/assinatura do APK e roteiro executado no terminal físico. O aceite exige cobrança, recusa, cancelamento, queda de rede, recuperação, reinício do app, replay, estorno quando suportado, conciliação, atualização pela loja e rollback.

Emulador, checklist manual, diagnóstico reportado ou deeplink isolado não homologam um provedor. Para o piloto Rede ainda são necessários SDK/contrato privado, credenciais, terminal de desenvolvimento, publicação na Laranjinha Store e aceite do fornecedor.

O gate automatizado comprova somente coerência interna do release. A promoção do piloto continua bloqueada sem os artefatos externos acima e sem o terminal real da combinação registrada.
