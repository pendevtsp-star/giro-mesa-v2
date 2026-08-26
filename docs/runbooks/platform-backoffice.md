# Back office da plataforma

Central interna da equipe GiroMesa para localizar tenants, acompanhar ativação e cobrança, investigar saúde técnica e fiscal e tratar incidentes. Ela não substitui o Financeiro operacional do restaurante nem comprova homologação de provedor, SEFAZ ou terminal físico.

## Acesso e perfis

- O acesso exige sessão individual, conta ativa e MFA verificado. Contas compartilhadas são proibidas.
- Viewer consulta tenants sem executar mutações.
- Suporte consulta tenants, saúde e incidentes.
- Financeiro consulta assinatura, faturas e eventos de cobrança do assinante; não acessa o caixa do restaurante por este painel.
- Fiscal consulta integrações e incidentes fiscais; credenciais e certificados nunca são exibidos.
- Engenharia investiga falhas técnicas e pode assumir, adiar, resolver ou reprocessar eventos quando houver causa conhecida.
- Administração possui todas as capacidades e é o único perfil autorizado a revelar PII sob motivo. Perfis e operadores autorizados são configurados no ambiente/deploy; aplique sempre o menor privilégio.

Configure `PLATFORM_ADMIN_ROLES` no deploy com entradas `email=perfil`, usando `viewer`, `support`, `finance`, `fiscal`, `engineering` ou `admin`. `PLATFORM_ADMIN_EMAILS` existe apenas para compatibilidade e concede `admin`; migre a allowlist legada para perfis explícitos.

Revogue imediatamente o acesso de quem sair da equipe ou mudar de função. Não use a central enquanto o MFA estiver indisponível; recupere a conta pelo fluxo de segurança antes de continuar.

### Bootstrap do responsável da plataforma

Para provisionar `pendevtsp@gmail.com`, configure no deploy `PLATFORM_ADMIN_ROLES=pendevtsp@gmail.com=admin` e reinicie apenas o processo da API pelo procedimento de release. Não use `PLATFORM_ADMIN_EMAILS`, senha em `.env`, seed, código ou mensagem de chat.

1. Crie a conta individual pelo fluxo normal de cadastro/login com uma senha aleatória longa gerada e guardada diretamente no gerenciador de senhas do responsável. Se a conta já existir, use o fluxo de recuperação de senha; nunca entregue uma senha temporária em repositório, log ou ticket.
2. Faça login, cadastre o TOTP em **Segurança**, confirme o primeiro código e guarde os códigos de recuperação fora da VPS. A API exige um fator MFA verificado para toda rota `/v1/platform`; a allowlist isolada não basta.
3. Em uma nova sessão, abra a Central de controle e confirme o perfil `admin` e o selo de MFA. Se não abrir, revise exatamente o e-mail normalizado na variável, o cadastro ativo e o fator MFA; não reduza o guard para recuperar acesso.

`MFA_ENCRYPTION_KEY` deve estar configurada e estável antes do cadastro do TOTP. A troca dessa chave sem uma migração de fatores invalida a recuperação dos segredos MFA existentes.

### Acesso piloto de seis meses

Somente `admin` possui `billing:write` para conceder acesso piloto. O procedimento não cria conta compartilhada, não cria assinatura nem confirma cobrança no provedor.

1. O tenant deve concluir o onboarding e ativar o trial normal; a Central aceita somente um tenant em `trial_active` com trial persistido. Isso preserva os gates de ativação do produto.
2. Abra a Visão 360º, confira o tenant e a data de **Acesso piloto até**, clique em **Conceder 6 meses**, informe o motivo objetivo e confirme a ação.
3. A API grava a data final em `trials.endsAt` como o maior valor entre a data atual acrescida de seis meses-calendário e a data já existente. Portanto, uma nova concessão nunca encurta um acesso maior.
4. Confirme a data retornada pela API e a linha do tempo. A ação registra ator, tenant, trial, motivo, datas anterior/final e se houve extensão; a chave idempotente impede uma repetição de rede.

Se a API retornar `PLATFORM_PILOT_ACCESS_REQUIRES_ACTIVE_TRIAL`, conclua/ative o onboarding ou trate a assinatura existente; não altere diretamente o banco. `PLATFORM_PILOT_ACCESS_TRIAL_REQUIRED` indica inconsistência de dados que deve ser investigada antes de qualquer nova tentativa.

## Fluxo de atendimento

1. Pesquise pelo nome, documento, e-mail ou ID e confirme o tenant correto.
2. Abra a visão 360º e verifique unidades, assinatura, ativação, integrações, hubs, dispositivos e eventos recentes.
3. Se dados pessoais forem necessários, informe no campo de motivo o chamado ou incidente. Não copie o dado para notas sem controle de acesso.
4. Na fila, assuma o incidente antes de atuar. Registre um motivo objetivo ao adiar ou resolver.
5. Reprocesse um evento somente depois de corrigir ou confirmar a causa. Use uma nova tentativa pela interface; ela envia chave idempotente e registra auditoria.
6. Confirme o resultado na linha do tempo. Um aceite do provedor não equivale a pagamento, emissão fiscal ou impressão concluída.

Estados parciais, indisponíveis ou desatualizados permanecem explícitos. Não interprete `—`, fonte parcial ou falha de atualização como ausência de pendências.

## Auditoria

Consultas sensíveis e mutações registram ator, ação, entidade, tenant, motivo, instante e metadados de correlação. Chaves idempotentes impedem que uma repetição de rede execute novamente a mesma ação.

O motivo deve responder o que foi feito e por quê, sem senha, token, certificado, dado de cartão ou dado pessoal desnecessário. Para investigação, relacione o ID do chamado, do incidente ou do evento de outbox.

## Limites deliberados

- Não existe impersonação de usuário ou tenant. Reproduza o problema em ambiente controlado ou use as evidências auditadas da visão 360º.
- Não existe console SQL, editor genérico de banco ou exibição de segredos.
- Não confirme cobrança, fiscal ou integração sem evidência persistida do provedor correspondente.

## Validação antes de publicar

- Typecheck e testes focados do Ops e da API.
- Jornada de admin com busca, detalhe 360º, fila, motivo obrigatório, idempotência e negação por perfil.
- Estado parcial/desatualizado e falha por fonte visíveis.
- Teclado, foco, nomes acessíveis, contraste e ausência de overflow em 375 px.
- Banco migrado e integrações externas validadas separadamente com credenciais de homologação.

## Publicação do site comercial

O site consome exclusivamente a versão `published` do catálogo. Rascunhos, versões agendadas e campos internos não podem aparecer no endpoint público. A publicação deve conter todos os blocos tipados da landing, SEO, planos, ofertas calculadas, documentos legais e referências de mídia resolvidas.

- Toda imagem publicada exige URL segura e texto alternativo descritivo. IDs internos de mídia não saem no contrato público.
- O backend calcula o preço final de cada oferta mensal/anual. O site não aplica desconto, não inventa preço e rejeita catálogo cuja oferta seja inconsistente com o preço-base.
- SEO publicado define título, descrição, canonical e Open Graph. Se o bundle não for válido, a landing fica indisponível e recebe `noindex`; conteúdo ou preço anterior não é usado como fallback.
- Termos e Privacidade são texto puro em seções, cada qual com versão e vigência. Formulários ficam indisponíveis sem os dois documentos válidos.
- Trial e contato enviam consentimento, versão da landing, versões legais, campanha e UTMs. A confirmação só aparece após a API devolver `id` e `createdAt` do registro persistido.

Experimentos públicos podem alterar somente headline, descrição e CTA. Nunca configure teste de preço, desconto, entitlement ou texto legal. O visitante recebe identificador first-party anônimo; a variante é atribuída e revalidada pelo backend, que persiste apenas o hash. A consulta personalizada é privada e `no-store`.

A impressão é enviada uma vez por catálogo, experimento, variante e visitante com chave idempotente. Falha de impressão não bloqueia a landing e não vira conversão local. Relatórios devem usar apenas impressões e conversões persistidas; uma variante configurada sem impressão gravada não comprova exposição.

Antes de publicar uma versão comercial:

1. Revise preview, mídia/alt, canonical, planos e ofertas em desktop e 375 px.
2. Confirme que Termos e Privacidade aprovados são exatamente as versões vinculadas ao bundle.
3. Simule indisponibilidade e payload inválido: nenhum preço, formulário ou documento preliminar deve aparecer.
4. Se houver experimento, valide estabilidade da variante, impressão idempotente e atribuição do lead sem PII, IP ou user-agent.
