# GiroMesa Ops Shell

Aplicativo .NET MAUI que empacota o bundle React de `apps/frontends/ops` e fornece uma bridge nativa para identidade do dispositivo, armazenamento seguro e pareamento com o hub.

## Empacotamento

1. Execute o build de `@giromesa/ops`.
2. Execute `sync-ops-bundle.ps1`.
3. Compile o target Windows. Para incluir Android/iOS, instale os respectivos workloads e passe `-p:GiroMesaMobileTargets=true`.

O SDK .NET 10 e os workloads MAUI do alvo precisam estar instalados. Para validar o pacote Windows, execute `dotnet build apps/native/ops-shell/GiroMesa.OpsShell.csproj` a partir da raiz do repositório.
