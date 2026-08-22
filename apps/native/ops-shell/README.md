# GiroMesa Ops Shell

Aplicativo .NET MAUI que empacota o bundle React de `apps/frontends/ops` e fornece uma bridge nativa para identidade do dispositivo, armazenamento seguro e pareamento com o hub.

## Empacotamento

1. Execute o build de `@giromesa/ops`.
2. Execute `sync-ops-bundle.ps1`.
3. Compile o target Windows. Para incluir Android/iOS, instale os respectivos workloads e passe `-p:GiroMesaMobileTargets=true`.

O SDK .NET 10 e os workloads MAUI do alvo precisam estar instalados. Para validar o pacote Windows, execute `dotnet build apps/native/ops-shell/GiroMesa.OpsShell.csproj` a partir da raiz do repositório.

## APK SmartPOS assinado

`publish-android-smartpos.ps1` é o comando fail-closed de empacotamento Android. Ele:

- exige configuração explícita de provider, origem HTTPS da API, package e allowlists;
- executa o build completo do Ops e sincroniza o bundle antes do `dotnet publish`;
- confirma que o painel e a bridge SmartPOS estão no bundle;
- exige keystore, alias e senhas em variáveis de ambiente;
- gera somente APK Release assinado;
- aceita hoje apenas `generic_intent` em `homologation`.

Exemplo de homologação, usando exclusivamente dados oficiais fornecidos pelo integrador:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/native/ops-shell/publish-android-smartpos.ps1 `
  -Provider generic_intent `
  -Environment homologation `
  -ProviderPackage br.com.fornecedor.smartpos `
  -AllowedPackages br.com.fornecedor.smartpos `
  -AllowedSchemes fornecedorpay `
  -Methods credit_card,debit_card,pix `
  -StartUriTemplate "fornecedorpay://payment/start?attempt={attemptId}&amount={amountCents}&method={method}" `
  -RecoverUriTemplate "fornecedorpay://payment/recover?attempt={attemptId}" `
  -CancelUriTemplate "fornecedorpay://payment/cancel?attempt={attemptId}" `
  -ApiBaseUrl https://api.giromesa.com.br `
  -KeyStorePath C:\segredos\giromesa-smartpos.keystore `
  -KeyAlias giromesa-smartpos
```

Antes da execução, injete `GIROMESA_ANDROID_KEY_PASSWORD` e `GIROMESA_ANDROID_KEYSTORE_PASSWORD` por um gerenciador de segredos. Não grave senhas no script, projeto, linha de comando ou histórico do shell. O adaptador genérico não interpreta aprovação financeira e permanece `Homologated=false`; portanto esse comando prepara um APK instalável para pareamento/diagnóstico, não libera pagamentos. Rede, Stone, PayGo ou outro provider só pode ser aceito depois que seu adaptador privado e a combinação exata de APK/terminal forem homologados.
