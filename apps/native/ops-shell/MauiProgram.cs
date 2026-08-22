using Microsoft.Extensions.Logging;

namespace GiroMesa.OpsShell;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder.UseMauiApp<App>();
        builder.Services.AddSingleton<SmartPosPendingPaymentStore>();
        builder.Services.AddSingleton<SmartPosDeviceCredentialStore>();
        builder.Services.AddSingleton<SmartPosResultOutbox>();
        builder.Services.AddSingleton<SmartPosRequestSigner>();
        builder.Services.AddSingleton<ISmartPosDeviceDiagnosticsProvider, MauiSmartPosDeviceDiagnosticsProvider>();
        builder.Services.AddSingleton(new HttpClient { Timeout = TimeSpan.FromSeconds(20) });
        builder.Services.AddSingleton<SmartPosDeviceApiClient>();
        builder.Services.AddSingleton<ISmartPosResultSink>(serviceProvider =>
            serviceProvider.GetRequiredService<SmartPosDeviceApiClient>());
        builder.Services.AddSingleton<ISmartPosPaymentAttemptResolver, DeviceApiSmartPosPaymentAttemptResolver>();
        builder.Services.AddSingleton<ISmartPosReversalResolver, DeviceApiSmartPosReversalResolver>();
        builder.Services.AddSingleton(serviceProvider => SmartPosPaymentService.Create(
            serviceProvider.GetRequiredService<SmartPosPendingPaymentStore>(),
            serviceProvider.GetRequiredService<ISmartPosPaymentAttemptResolver>(),
            serviceProvider.GetRequiredService<SmartPosResultOutbox>(),
            serviceProvider.GetRequiredService<ISmartPosResultSink>(),
            serviceProvider.GetRequiredService<ISmartPosReversalResolver>()));
        builder.Services.AddSingleton(serviceProvider => new NativeBridge(
            serviceProvider.GetRequiredService<SmartPosPaymentService>(),
            serviceProvider.GetRequiredService<SmartPosDeviceApiClient>(),
            serviceProvider.GetRequiredService<SmartPosDeviceCredentialStore>()));
        builder.Services.AddSingleton<MainPage>();

#if DEBUG
        builder.Services.AddHybridWebViewDeveloperTools();
        builder.Logging.AddDebug();
#endif

        return builder.Build();
    }
}
