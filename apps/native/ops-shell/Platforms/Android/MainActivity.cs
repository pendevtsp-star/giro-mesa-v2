using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;

namespace GiroMesa.OpsShell;

[Activity(
    Theme = "@style/Maui.SplashTheme",
    MainLauncher = true,
    Exported = true,
    LaunchMode = LaunchMode.SingleTop,
    ConfigurationChanges = ConfigChanges.ScreenSize |
        ConfigChanges.Orientation |
        ConfigChanges.UiMode |
        ConfigChanges.ScreenLayout |
        ConfigChanges.SmallestScreenSize |
        ConfigChanges.Density)]
[IntentFilter(
    [Intent.ActionView],
    Categories = [Intent.CategoryDefault, Intent.CategoryBrowsable],
    DataScheme = "giromesa",
    DataHost = "smartpos",
    DataPath = "/pair")]
public sealed class MainActivity : MauiAppCompatActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);
        SmartPosPairingDeepLinkInbox.TryCapture(Intent?.DataString);
    }

    protected override void OnNewIntent(Intent? intent)
    {
        base.OnNewIntent(intent);
        if (intent is null) return;
        Intent = intent;
        SmartPosPairingDeepLinkInbox.TryCapture(intent.DataString);
    }

    protected override void OnActivityResult(int requestCode, Result resultCode, Intent? data)
    {
        SmartPosActivityResultBroker.TryComplete(requestCode, resultCode);
        base.OnActivityResult(requestCode, resultCode, data);
    }
}
