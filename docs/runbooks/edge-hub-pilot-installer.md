# Instalador piloto do Conector GiroMesa

Este fluxo permite que uma organização piloto baixe e instale o Conector pelo Ops sem expor o arquivo publicamente. A assinatura é provisória: ela protege a integridade do binário, mas não cria confiança pública no Windows.

## Gerar o pacote no Windows

1. Crie uma vez o certificado piloto e guarde o identificador exibido:

   ```powershell
   ./scripts/new-edge-hub-pilot-certificate.ps1
   ```

2. Gere o instalador usando o mesmo certificado em todas as atualizações do piloto:

   ```powershell
   ./scripts/build-edge-hub-local-installer.ps1 -SigningCertificateThumbprint <identificador>
   ```

O pacote e seu SHA-256 ficam em `apps/backends/edge-hub-installer/bin/local-test`. O diretório é regenerável e não deve ser versionado.

## Disponibilizar na VPS

1. Copie `GiroMesa-Conector-Setup-PILOTO.exe` para o caminho persistente `/srv/apps/giromesa-v2/shared/edge-hub-installer/GiroMesa-Conector-Setup.exe`.
2. No arquivo de ambiente protegido da VPS, configure:

   ```dotenv
   EDGE_HUB_WINDOWS_INSTALLER_CHANNEL=pilot
   EDGE_HUB_WINDOWS_INSTALLER_VERSION=<identificador desta compilação, por exemplo 0.2.8-pilot.1>
   EDGE_HUB_WINDOWS_INSTALLER_SHA256=<sha256 gerado pelo script>
   EDGE_HUB_PILOT_ORGANIZATION_IDS=<uuid da organização autorizada>
   ```

3. Promova a release pelo fluxo confiável normal. A API monta o diretório como somente leitura, recalcula o SHA-256 antes de cada download e falha fechada se o arquivo divergir.

## Evidência do piloto

- A criação do código, o início do download e o pareamento ficam em auditoria.
- O Ops deriva instalação, configuração e teste dos estados reais do Hub e das impressoras.
- O retorno do cliente é persistido como `device.edge_hub_pilot_feedback`.
- Não desative Defender ou SmartScreen. O aviso de editor sem reputação pública é uma limitação conhecida da assinatura provisória.
- O piloto atual exige impressora ESC/POS em rede privada; USB permanece fora deste fluxo.
