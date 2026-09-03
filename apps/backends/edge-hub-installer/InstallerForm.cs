using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using GiroMesa.EdgeHub.Enrollment;
using GiroMesa.EdgeHub.Security;

namespace GiroMesa.EdgeHub.Installer;

public sealed class InstallerForm : Form
{
    private const string ServiceName = "GiroMesaEdgeHub";
    private readonly TextBox _code = new() { CharacterCasing = CharacterCasing.Upper, MaxLength = 12 };
    private readonly Button _install = new() { AutoSize = true };
    private readonly Label _status = new() { AutoSize = true, MaximumSize = new Size(430, 0) };
    private MachineConfiguration? _configuration = MachineConfigurationStore.TryLoad();

    public InstallerForm()
    {
        Text = "Conector GiroMesa";
        ClientSize = new Size(480, 300);
        MinimumSize = new Size(420, 300);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10);

        var title = new Label
        {
            AutoSize = true,
            Font = new Font(Font, FontStyle.Bold),
            Text = _configuration is null ? "Conectar este computador" : "Reparar o Conector GiroMesa",
        };
        var explanation = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(430, 0),
            Text = _configuration is null
                ? "Digite o código mostrado em Configurações > Impressoras no GiroMesa."
                : "Este computador já está conectado. Clique abaixo para reparar e reiniciar o serviço.",
        };
        var codeLabel = new Label { AutoSize = true, Text = "Código de conexão" };
        _code.AccessibleName = "Código de conexão";
        _code.PlaceholderText = "ABCD2345";
        _code.Width = 220;
        _code.Visible = _configuration is null;
        codeLabel.Visible = _configuration is null;
        _install.Text = _configuration is null ? "Conectar" : "Reparar conexão";
        _install.Click += async (_, _) => await InstallAsync();

        var layout = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            Padding = new Padding(24),
            WrapContents = false,
        };
        layout.Controls.Add(title);
        layout.Controls.Add(explanation);
        layout.Controls.Add(codeLabel);
        layout.Controls.Add(_code);
        layout.Controls.Add(_install);
        layout.Controls.Add(_status);
        Controls.Add(layout);
        AcceptButton = _install;
    }

    private async Task InstallAsync()
    {
        _install.Enabled = false;
        _status.ForeColor = SystemColors.ControlText;
        _status.Text = "Preparando a conexão…";
        try
        {
            var payload = ReadPayload();
            var configuration = _configuration ?? await EnrollAsync();
            MachineConfigurationStore.Save(configuration);
            _configuration = configuration;
            await StopServiceIfPresentAsync();
            var executable = InstallPayload(payload);
            await ProtectConfigurationDirectoryAsync();
            await ConfigureAndStartServiceAsync(executable);
            _status.Text = "Serviço instalado. Aguardando o primeiro contato com o GiroMesa…";
            var connected = await WaitForCloudConnectionAsync();
            _status.ForeColor = connected ? Color.DarkGreen : Color.DarkGoldenrod;
            _status.Text = connected
                ? "Pronto. Este computador está conectado ao GiroMesa. Você já pode fechar esta janela."
                : "O serviço foi instalado e continuará tentando se conectar automaticamente. Você pode fechar esta janela e acompanhar o último contato no GiroMesa.";
            _install.Text = "Concluído";
        }
        catch (Exception exception)
        {
            _status.ForeColor = Color.DarkRed;
            _status.Text = exception.Message;
            _install.Enabled = true;
        }
    }

    private async Task<MachineConfiguration> EnrollAsync()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        var apiBaseUrl = new Uri(ApiBaseUrl(), UriKind.Absolute);
        var enrollment = await CloudEnrollmentClient.RedeemAsync(client, apiBaseUrl, _code.Text);
        var dataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "GiroMesa",
            "EdgeHub",
            "data");
        return new MachineConfiguration(
            enrollment.DeviceId,
            enrollment.OrganizationId,
            enrollment.UnitId,
            apiBaseUrl.ToString(),
            enrollment.SyncKey,
            Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)),
            dataDirectory);
    }

    private static async Task<bool> WaitForCloudConnectionAsync()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                using var response = await client.GetAsync("http://127.0.0.1:5000/health");
                using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync());
                if (document.RootElement.TryGetProperty("lastSuccessfulSyncAt", out var lastSync) &&
                    lastSync.ValueKind == JsonValueKind.String)
                    return true;
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
            {
                // The Windows service keeps retrying; the installer only waits for the first confirmation.
            }
            await Task.Delay(1_000);
        }
        return false;
    }

    private static byte[] ReadPayload()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("GiroMesa.EdgeHub.exe")
            ?? throw new InvalidOperationException("O instalador está incompleto. Baixe-o novamente.");
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return memory.ToArray();
    }

    private static string InstallPayload(byte[] payload)
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "GiroMesa",
            "EdgeHub");
        Directory.CreateDirectory(directory);
        var target = Path.Combine(directory, "GiroMesa.EdgeHub.exe");
        var temporary = $"{target}.{Guid.NewGuid():N}.tmp";
        File.WriteAllBytes(temporary, payload);
        File.Move(temporary, target, true);
        return target;
    }

    private static async Task StopServiceIfPresentAsync()
    {
        if (await RunScAsync("query", ServiceName) != 0) return;
        await RunScAsync("stop", ServiceName);
        for (var attempt = 0; attempt < 20; attempt += 1)
        {
            await Task.Delay(500);
            var processes = Process.GetProcessesByName("GiroMesa.EdgeHub");
            try
            {
                if (processes.Length == 0) return;
            }
            finally
            {
                foreach (var process in processes) process.Dispose();
            }
        }
        throw new InvalidOperationException("Não foi possível parar a versão anterior do Conector.");
    }

    private static async Task ConfigureAndStartServiceAsync(string executable)
    {
        var quotedPath = $"\"{executable}\"";
        if (await RunScAsync("query", ServiceName) == 0)
        {
            await RequireScAsync("config", ServiceName, "binPath=", quotedPath, "start=", "auto");
        }
        else
        {
            await RequireScAsync(
                "create",
                ServiceName,
                "binPath=",
                quotedPath,
                "start=",
                "auto",
                "DisplayName=",
                "GiroMesa Conector");
        }
        await RequireScAsync("failure", ServiceName, "reset=", "86400", "actions=", "restart/5000/restart/15000/restart/60000");
        await RequireScAsync("start", ServiceName);
    }

    private static async Task ProtectConfigurationDirectoryAsync()
    {
        var directory = Path.GetDirectoryName(MachineConfigurationStore.ConfigurationPath)!;
        var start = new ProcessStartInfo("icacls.exe") { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(directory);
        start.ArgumentList.Add("/inheritance:r");
        start.ArgumentList.Add("/grant:r");
        start.ArgumentList.Add("*S-1-5-18:(OI)(CI)F");
        start.ArgumentList.Add("*S-1-5-32-544:(OI)(CI)F");
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Falha ao proteger a configuração.");
        await process.WaitForExitAsync();
        if (process.ExitCode != 0) throw new InvalidOperationException("Falha ao proteger a configuração.");
    }

    private static async Task RequireScAsync(params string[] arguments)
    {
        if (await RunScAsync(arguments) != 0)
            throw new InvalidOperationException("O Windows não conseguiu instalar o serviço do Conector.");
    }

    private static async Task<int> RunScAsync(params string[] arguments)
    {
        var start = new ProcessStartInfo("sc.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("O serviço do Windows não está disponível.");
        await process.WaitForExitAsync();
        return process.ExitCode;
    }

    private static string ApiBaseUrl() =>
        typeof(InstallerForm).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .Single(attribute => attribute.Key == "EdgeHubApiBaseUrl")
            .Value
        ?? throw new InvalidOperationException("O endereço do GiroMesa não foi incluído no instalador.");
}
