# GiroMesa Ops Shell

Aplicativo .NET MAUI que empacota o bundle React de `apps/ops` e fornece uma bridge nativa para identidade do dispositivo, armazenamento seguro e pareamento com o hub.

## Empacotamento

1. Execute o build de `@giromesa/ops`.
2. Execute `sync-ops-bundle.ps1`.
3. Compile o target Windows. Para incluir Android/iOS, instale os respectivos workloads e passe `-p:GiroMesaMobileTargets=true`.

O SDK .NET 10 e os workloads MAUI precisam estar instalados. O ambiente atual ainda não possui `dotnet` no PATH, portanto a compilação nativa será validada após essa dependência externa ser disponibilizada.
