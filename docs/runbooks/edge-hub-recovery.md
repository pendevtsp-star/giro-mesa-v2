# Recuperação e reinstalação do Edge Hub

## Invariantes

- Cada instalação recebe um `Hub:InstallationId` UUID exclusivo e uma identidade persistida no banco SQLCipher. Nunca reutilize esse UUID em outra máquina.
- Quando `Hub:RequireMutualTls=true`, o Hub abre somente o listener HTTPS próprio. O certificado do servidor, o certificado cliente usado contra a nuvem e os certificados clientes confiáveis dos dispositivos têm pins SHA-256 distintos; o processo recusa configuração ausente ou reutilizada entre papéis.
- O arquivo `hub-installation.anchor.json` fica junto ao diretório de dados, mas fora do banco. Ele é autenticado por HMAC com `Hub:DatabaseKey` e ancora a geração monotônica. Não o regenere manualmente.
- Divergência de instalação, certificado ou unidade falha fechada. Geração do anchor maior que a do banco é rollback e impede a inicialização.
- Backups contêm o banco criptografado, manifesto assinado, hash e geração. PAN, CVV, token de pareamento e chave do banco nunca devem entrar em ticket, log ou cópia separada.

## Configuração mínima

Defina por secret store/ACL do serviço, não no repositório:

- `Hub:InstallationId`, `Hub:UnitId` e `Hub:DatabaseKey`;
- `Hub:RequireMutualTls=true`, `Hub:HttpsPort`, `Hub:ServerCertificateThumbprint` e `Hub:ServerCertificateStoreLocation`;
- `Hub:CloudClientCertificateThumbprint` e `Hub:CloudClientCertificateStoreLocation` para a conexão de saída com a nuvem;
- a allowlist `Hub:DeviceClientCertificateThumbprints` para os dispositivos que podem parear e chamar o Hub;
- `Hub:DataDirectory`, `Hub:BackupDirectory`, `Hub:MinimumFreeDiskBytes` e `Hub:MaximumClockSkewSeconds`;
- endpoint HTTPS da nuvem e credencial de sync quando a sincronização estiver habilitada.

Os certificados de servidor e cliente da nuvem devem possuir chave privada no repositório `My`; os pins de dispositivos são apenas confiança de entrada. Conceda leitura de cada chave privada somente à conta do serviço. O endpoint da nuvem deve ser HTTPS. Não reutilize um certificado de dispositivo como identidade da nuvem ou do servidor.

## Backup operacional

1. Confirme `/health` com `status=ok`, identidade `ready`, relógio sem desvio e disco acima do limite.
2. Em cliente autenticado por mTLS e token pareado, execute `POST /v1/backups`.
3. Copie juntos o `.db` e o `.manifest.json` retornados para armazenamento criptografado com retenção e ACL. Não copie `Hub:DatabaseKey` para o mesmo destino.
4. Valide hash, HMAC, instalação e geração por `HubIdentity.ValidateBackupAsync` durante o drill controlado. Manifesto inválido ou geração anterior à identidade atual não é restaurável automaticamente.
5. Registre horário, geração, hash, operador e destino; nunca registre segredo ou payload.

## Revogação e suspeita de clone

1. Isole a máquina da rede de dispositivos e da nuvem.
2. Preserve banco, anchor, logs allowlisted e certificado para investigação.
3. Com sessão local ainda autenticada, `POST /v1/identity/revoke` com motivo não vazio. A geração sobe, o anchor é regravado e novas autenticações falham.
4. Revogue também o certificado na autoridade emissora e a credencial de sync no control plane.
5. Um erro `HUB_CLONE_DETECTED`, `HUB_ROLLBACK_DETECTED`, `HUB_DATABASE_ROLLBACK_DETECTED`, `HUB_ANCHOR_TAMPERED` ou `HUB_CERTIFICATE_IDENTITY_MISMATCH` não deve ser contornado copiando ou editando arquivos.

## Restore controlado

1. Pare o serviço e confirme que não há processo com o banco aberto.
2. Preserve o diretório atual inteiro como evidência recuperável.
3. Valide manifesto e banco antes da troca. A instalação/unidade devem coincidir e a geração não pode ser inferior ao anchor vigente.
4. Substitua banco, arquivos `-wal`/`-shm` correspondentes quando existentes e manifesto somente dentro do diretório aprovado. Preserve o anchor vigente.
5. Inicie o serviço sem liberar tráfego. Exija `/health=ok`, banco `ready`, identidade `ready`, relógio e disco saudáveis.
6. Valide fila pendente, DLQ de dispatch, snapshot e reconciliação antes de reabrir dispositivos.

Nunca reduza a geração do anchor para aceitar backup antigo. Se o backup viola a geração monotônica, trate como perda/rollback e reconcilie a partir da autoridade PostgreSQL.

## Reinstalação

1. Revogue identidade, certificado, tokens pareados e credencial de sync da instalação anterior.
2. Remova a máquina antiga do tráfego e preserve a evidência conforme retenção.
3. Instale em diretório vazio com novo `InstallationId`, novo certificado/chave privada e nova credencial de sync. Não clone banco+anchor para criar outra instalação.
4. Para restaurar a mesma instalação após falha física, use o procedimento de restore com identidade e geração validadas pelo control plane; ausência de anchor exige recuperação explícita, nunca recriação silenciosa.
5. Repareie terminais, execute teste offline/restart, impressão/KDS por destino e reconciliação completa.

O resultado local comprova `software-ready`. Certificado emitido, restore drill no hardware piloto, relógio/NTP, disco real e revogação no control plane continuam obrigatórios para `pilot-approved`.
