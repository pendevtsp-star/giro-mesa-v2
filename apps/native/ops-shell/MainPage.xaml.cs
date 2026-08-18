using System.Text.Json;

namespace GiroMesa.OpsShell;

public partial class MainPage : ContentPage
{
    private readonly NativeBridge _bridge;

    public MainPage(NativeBridge bridge)
    {
        InitializeComponent();
        _bridge = bridge;
        Hybrid.SetInvokeJavaScriptTarget(_bridge);
    }

    private async void OnRawMessageReceived(object? sender, HybridWebViewRawMessageReceivedEventArgs eventArgs)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(eventArgs.Message))
            {
                return;
            }

            var message = JsonSerializer.Deserialize<BridgeMessage>(eventArgs.Message);
            if (message?.Type == "shell.ready")
            {
                Hybrid.SendRawMessage(JsonSerializer.Serialize(new
                {
                    type = "shell.context",
                    payload = await _bridge.GetDeviceContextAsync(),
                }));
            }
        }
        catch (JsonException)
        {
            Hybrid.SendRawMessage("{\"type\":\"shell.error\",\"code\":\"INVALID_BRIDGE_MESSAGE\"}");
        }
    }

    private sealed record BridgeMessage(string Type);
}
