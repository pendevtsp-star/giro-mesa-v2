using Android.App;
using Android.Runtime;

namespace GiroMesa.OpsShell;

[Application]
public sealed class MainApplication(IntPtr handle, JniHandleOwnership ownership)
    : MauiApplication(handle, ownership)
{
    protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}
