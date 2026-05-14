using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Forms;

namespace CloudPiOvt.NativeHost;

internal sealed class HostRequest
{
    [JsonPropertyName("command")]
    public string Command { get; init; } = "";

    [JsonPropertyName("existingPath")]
    public string ExistingPath { get; init; } = "";

    [JsonPropertyName("executablePath")]
    public string ExecutablePath { get; init; } = "";

    [JsonPropertyName("argumentsTemplate")]
    public string ArgumentsTemplate { get; init; } = "";

    [JsonPropertyName("targetPath")]
    public string TargetPath { get; init; } = "";
}

internal sealed class HostResponse
{
    [JsonPropertyName("ok")]
    public bool Ok { get; init; }

    [JsonPropertyName("cancelled")]
    public bool Cancelled { get; init; }

    [JsonPropertyName("error")]
    public string Error { get; init; } = "";

    [JsonPropertyName("hostName")]
    public string HostName { get; init; } = "";

    [JsonPropertyName("version")]
    public string Version { get; init; } = "";

    [JsonPropertyName("executablePath")]
    public string ExecutablePath { get; init; } = "";

    [JsonPropertyName("displayName")]
    public string DisplayName { get; init; } = "";

    [JsonPropertyName("directoryPath")]
    public string DirectoryPath { get; init; } = "";
}

internal static class Program
{
    private const string HostName = "com.cloudpiovt.editor_helper";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    [STAThread]
    private static int Main()
    {
        try
        {
            using var stdin = Console.OpenStandardInput();
            using var stdout = Console.OpenStandardOutput();

            while (true)
            {
                var request = ReadMessage(stdin);
                if (request is null)
                {
                    return 0;
                }

                var response = HandleRequest(request);
                WriteMessage(stdout, response);
            }
        }
        catch
        {
            return 1;
        }
    }

    private static HostRequest? ReadMessage(Stream input)
    {
        var lengthBuffer = new byte[4];
        var read = input.Read(lengthBuffer, 0, 4);
        if (read == 0)
        {
            return null;
        }

        if (read < 4)
        {
            throw new EndOfStreamException("Invalid native messaging frame header.");
        }

        var length = BitConverter.ToInt32(lengthBuffer, 0);
        if (length <= 0)
        {
            return null;
        }

        var payloadBuffer = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            var chunkRead = input.Read(payloadBuffer, offset, length - offset);
            if (chunkRead <= 0)
            {
                throw new EndOfStreamException("Unexpected end of native messaging payload.");
            }

            offset += chunkRead;
        }

        var json = Encoding.UTF8.GetString(payloadBuffer);
        return JsonSerializer.Deserialize<HostRequest>(json, JsonOptions);
    }

    private static void WriteMessage(Stream output, HostResponse response)
    {
        var json = JsonSerializer.Serialize(response, JsonOptions);
        var payload = Encoding.UTF8.GetBytes(json);
        var lengthBuffer = BitConverter.GetBytes(payload.Length);
        output.Write(lengthBuffer, 0, lengthBuffer.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }

    private static HostResponse HandleRequest(HostRequest? request)
    {
        if (request is null)
        {
            return new HostResponse { Ok = false, Error = "Empty request." };
        }

        return request.Command switch
        {
            "ping" => new HostResponse
            {
                Ok = true,
                HostName = HostName,
                Version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "1.0.0"
            },
            "pick_editor" => PickEditor(request.ExistingPath),
            "pick_directory" => PickDirectory(request.ExistingPath),
            "launch_native_editor" => LaunchNativeEditor(
                request.ExecutablePath,
                request.ArgumentsTemplate,
                request.TargetPath
            ),
            _ => new HostResponse
            {
                Ok = false,
                Error = $"Unsupported command: {request.Command}"
            }
        };
    }

    private static HostResponse PickEditor(string existingPath)
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "Executables|*.exe;*.cmd;*.bat|All files|*.*",
            Title = "选择本机编辑器或 IDE",
            CheckFileExists = true,
            Multiselect = false
        };

        if (!string.IsNullOrWhiteSpace(existingPath))
        {
            TryApplyInitialPath(dialog, existingPath);
        }

        var result = dialog.ShowDialog();
        if (result != DialogResult.OK || string.IsNullOrWhiteSpace(dialog.FileName))
        {
            return new HostResponse
            {
                Ok = false,
                Cancelled = true,
                Error = "User cancelled editor selection."
            };
        }

        var executablePath = Path.GetFullPath(dialog.FileName);
        return new HostResponse
        {
            Ok = true,
            ExecutablePath = executablePath,
            DisplayName = Path.GetFileNameWithoutExtension(executablePath)
        };
    }

    private static HostResponse PickDirectory(string existingPath)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择目标文件夹",
            UseDescriptionForTitle = true
        };

        if (!string.IsNullOrWhiteSpace(existingPath))
        {
            try
            {
                var normalized = Path.GetFullPath(existingPath);
                if (Directory.Exists(normalized))
                {
                    dialog.InitialDirectory = normalized;
                }
            }
            catch
            {
                // Ignore invalid path and let the dialog use defaults.
            }
        }

        var result = dialog.ShowDialog();
        if (result != DialogResult.OK || string.IsNullOrWhiteSpace(dialog.SelectedPath))
        {
            return new HostResponse
            {
                Ok = false,
                Cancelled = true,
                Error = "User cancelled directory selection."
            };
        }

        return new HostResponse
        {
            Ok = true,
            DirectoryPath = Path.GetFullPath(dialog.SelectedPath)
        };
    }

    private static void TryApplyInitialPath(OpenFileDialog dialog, string existingPath)
    {
        try
        {
            var normalized = Path.GetFullPath(existingPath);
            if (File.Exists(normalized))
            {
                dialog.InitialDirectory = Path.GetDirectoryName(normalized) ?? "";
                dialog.FileName = normalized;
            }
        }
        catch
        {
            // Ignore invalid path and let the dialog use defaults.
        }
    }

    private static HostResponse LaunchNativeEditor(
        string executablePath,
        string argumentsTemplate,
        string targetPath
    )
    {
        var normalizedExecutablePath = string.IsNullOrWhiteSpace(executablePath)
            ? ""
            : Path.GetFullPath(executablePath);
        var normalizedTargetPath = string.IsNullOrWhiteSpace(targetPath)
            ? ""
            : Path.GetFullPath(targetPath);

        if (string.IsNullOrWhiteSpace(normalizedExecutablePath) || !File.Exists(normalizedExecutablePath))
        {
            return new HostResponse
            {
                Ok = false,
                Error = "Executable path is missing or does not exist."
            };
        }

        if (string.IsNullOrWhiteSpace(normalizedTargetPath) || !Directory.Exists(normalizedTargetPath))
        {
            return new HostResponse
            {
                Ok = false,
                Error = "Target directory is missing or does not exist."
            };
        }

        var template = string.IsNullOrWhiteSpace(argumentsTemplate) ? "\"{path}\"" : argumentsTemplate;
        var arguments = template
            .Replace("{path}", normalizedTargetPath.Replace("\\", "/"), StringComparison.Ordinal)
            .Replace("{rawPath}", normalizedTargetPath, StringComparison.Ordinal);

        var startInfo = new ProcessStartInfo
        {
            FileName = normalizedExecutablePath,
            Arguments = arguments,
            UseShellExecute = true,
            WorkingDirectory = normalizedTargetPath
        };

        Process.Start(startInfo);

        return new HostResponse
        {
            Ok = true,
            ExecutablePath = normalizedExecutablePath,
            DisplayName = Path.GetFileNameWithoutExtension(normalizedExecutablePath)
        };
    }
}
