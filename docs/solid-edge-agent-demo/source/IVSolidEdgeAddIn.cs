using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using SolidEdge.Framework.Interop;

namespace InnovaVento.SolidEdge
{
    [ComVisible(true)]
    [Guid("D2D70C23-11EE-4A75-9080-C286A4BC15A6")]
    [ProgId("InnovaVento.SolidEdgeAddIn")]
    [ClassInterface(ClassInterfaceType.None)]
    [ComDefaultInterface(typeof(ISolidEdgeAddIn))]
    public sealed class IVSolidEdgeAddIn : ISolidEdgeAddIn
    {
        private const int HelloWorldCommandId = 41001;
        private const int SaveAllCommandId = 41002;
        private const string PartEnvironment = "{26618396-09D6-11D1-BA07-080036230602}";
        private const string AssemblyEnvironment = "{26618395-09D6-11D1-BA07-080036230602}";

        private object _application;
        private AddIn _addIn;
        private DISEAddInEvents_Event _events;
        private int _helloWorldCommandId = HelloWorldCommandId;
        private int _saveAllCommandId = SaveAllCommandId;

        public void OnConnection(object application, SeConnectMode connectMode, AddIn addInInstance)
        {
            Log("OnConnection entered mode=" + connectMode);
            _application = application;
            _addIn = addInInstance;

            _events = (DISEAddInEvents_Event)_addIn.AddInEvents;
            _events.OnCommand += HandleCommand;
            _events.OnCommandUpdateUI += HandleCommandUpdateUi;

            Log("OnConnection event sink attached");
        }

        public void OnConnectToEnvironment(string environmentCategoryId, object environmentDispatch, bool firstTime)
        {
            Log("OnConnectToEnvironment catid=" + environmentCategoryId + " firstTime=" + firstTime);
            if (!String.Equals(environmentCategoryId, PartEnvironment, StringComparison.OrdinalIgnoreCase)
                && !String.Equals(environmentCategoryId, AssemblyEnvironment, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            Array commandNames = new string[] { "IV Hello World", "IV SaveALL" };
            Array commandIds = new int[] { HelloWorldCommandId, SaveAllCommandId };
            Array buttonStyles = new int[]
            {
                (int)SeButtonStyle.seButtonIconAndCaptionBelow,
                (int)SeButtonStyle.seButtonIconAndCaptionBelow
            };

            ((ISEAddInEx2)_addIn).SetAddInInfoEx2(
                Assembly.GetExecutingAssembly().Location,
                environmentCategoryId,
                "iV-Connect",
                101,
                102,
                103,
                104,
                2,
                ref commandNames,
                ref commandIds,
                ref buttonStyles);
            _helloWorldCommandId = (int)commandIds.GetValue(0);
            _saveAllCommandId = (int)commandIds.GetValue(1);
            Log("Commands ready hello=" + _helloWorldCommandId + " saveAll=" + _saveAllCommandId);
            EnsureCommandBar(environmentCategoryId);
            EnableRegisteredCommands(environmentCategoryId);
        }

        public void OnDisconnection(SeDisconnectMode disconnectMode)
        {
            Log("OnDisconnection mode=" + disconnectMode);
            if (_events != null)
            {
                _events.OnCommand -= HandleCommand;
                _events.OnCommandUpdateUI -= HandleCommandUpdateUi;
            }
            _events = null;
            _addIn = null;
            _application = null;
        }

        private void HandleCommand(int commandId)
        {
            Log("OnCommand id=" + commandId);
            if (commandId == HelloWorldCommandId)
            {
                string runtime = EdgeRuntimeClient.Send("iv.hello_world", null);
                Log("Hello World runtime=" + runtime);
                MessageBox.Show(
                    "Hello World aus Solid Edge.\r\n\r\niV-Connect Add-in ist aktiv.\r\nRuntime: " + runtime,
                    "iV-Connect · Solid Edge",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            if (commandId == SaveAllCommandId)
            {
                StartSaveAll();
            }
        }

        private void HandleCommandUpdateUi(int commandId, ref int commandFlags, out string menuItemText, ref int bitmapId)
        {
            commandFlags = 1;
            bitmapId = 0;
            menuItemText = commandId == HelloWorldCommandId ? "IV Hello World" : "IV SaveALL";
        }

        private void EnableRegisteredCommands(string environmentCategoryId)
        {
            try
            {
                dynamic application = _application;
                dynamic environment = application.Environments.Item(EnvironmentName(environmentCategoryId));
                foreach (dynamic commandBar in environment.CommandBars)
                {
                    string name = (string)commandBar.Name;
                    if (!name.StartsWith("iV-Connect", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    commandBar.Visible = true;
                    foreach (dynamic control in commandBar.Controls)
                    {
                        control.Visible = true;
                        control.Enabled = true;
                    }
                }
                Log("Registered command bar enabled");
            }
            catch (Exception exception)
            {
                Log("EnableRegisteredCommands failed: " + exception.Message);
            }
        }

        private void EnsureCommandBar(string environmentCategoryId)
        {
            try
            {
                dynamic application = _application;
                dynamic environment = application.Environments.Item(EnvironmentName(environmentCategoryId));
                dynamic commandBars = environment.CommandBars;
                dynamic commandBar = null;
                foreach (dynamic candidate in commandBars)
                {
                    string candidateName = (string)candidate.Name;
                    if (candidateName.StartsWith("iV-Connect", StringComparison.OrdinalIgnoreCase))
                    {
                        commandBar = candidate;
                        break;
                    }
                }

                if (commandBar == null)
                {
                    object name = "iV-Connect";
                    object position = SeBarPosition.seBarTop;
                    object menuBar = false;
                    object temporary = false;
                    commandBar = commandBars.Add(name, position, menuBar, temporary);
                    Log("Created command bar name=" + (string)commandBar.Name);
                }

                bool hasHello = false;
                bool hasSaveAll = false;
                foreach (dynamic control in commandBar.Controls)
                {
                    string caption = (string)control.Caption;
                    hasHello = hasHello || caption == "IV Hello World";
                    hasSaveAll = hasSaveAll || caption == "IV SaveALL";
                }

                string commandBarName = (string)commandBar.Name;
                if (!hasHello)
                {
                    CommandBarButton button = _addIn.AddCommandBarButton(environmentCategoryId, commandBarName, HelloWorldCommandId);
                    if (button == null) { throw new InvalidOperationException("AddCommandBarButton returned null for Hello World."); }
                    ConfigureButton(button, "IV Hello World");
                }
                if (!hasSaveAll)
                {
                    CommandBarButton button = _addIn.AddCommandBarButton(environmentCategoryId, commandBarName, SaveAllCommandId);
                    if (button == null) { throw new InvalidOperationException("AddCommandBarButton returned null for SaveALL."); }
                    ConfigureButton(button, "IV SaveALL");
                }

                commandBar.Visible = true;
                Log("Command bar controls=" + (int)commandBar.Controls.Count);
                if ((int)commandBar.Controls.Count == 0 && String.Equals((string)commandBar.Name, "iV-Connect", StringComparison.OrdinalIgnoreCase))
                {
                    commandBar.Delete();
                    Log("Removed empty bootstrap command bar");
                }
            }
            catch (Exception exception)
            {
                Log("EnsureCommandBar failed: " + exception);
            }
        }

        private static void ConfigureButton(CommandBarButton button, string caption)
        {
            button.Caption = caption;
            button.TooltipText = caption;
            button.DescriptionText = caption + " — iV-Connect Demo";
            button.Style = SeButtonStyle.seButtonIconAndCaptionBelow;
            button.Visible = true;
            button.Enabled = true;
        }

        private static string EnvironmentName(string environmentCategoryId)
        {
            return String.Equals(environmentCategoryId, AssemblyEnvironment, StringComparison.OrdinalIgnoreCase)
                ? "Assembly"
                : "Part";
        }

        private void StartSaveAll()
        {
            string runner = @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\tools\IV.SolidEdge.OvenDemo.exe";
            string outputDirectory = @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\oven-demo";
            if (!File.Exists(runner))
            {
                MessageBox.Show(
                    "Der geprüfte Export-Runner fehlt:\r\n" + runner,
                    "IV SaveALL",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            SaveAllProgressForm progress = new SaveAllProgressForm();
            progress.Show();

            Thread worker = new Thread(delegate()
            {
                try
                {
                    ProcessStartInfo startInfo = new ProcessStartInfo(runner);
                    startInfo.UseShellExecute = false;
                    startInfo.CreateNoWindow = true;
                    startInfo.RedirectStandardOutput = true;
                    startInfo.RedirectStandardError = true;

                    Process process = Process.Start(startInfo);
                    string stdout = process.StandardOutput.ReadToEnd();
                    string stderr = process.StandardError.ReadToEnd();
                    process.WaitForExit();

                    Log("SaveALL exit=" + process.ExitCode + " stdout=" + stdout.Replace("\r", " ").Replace("\n", " | ") + " stderr=" + stderr);
                    if (process.ExitCode != 0)
                    {
                        progress.ReportFailure("Export fehlgeschlagen. Details stehen im Add-in-Log.");
                        return;
                    }

                    string snapshotDocument = ParseResultValue(stdout, "snapshot");
                    string snapshotRoot = Path.GetFullPath(Path.Combine(outputDirectory, "runtime-snapshots"))
                        .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                    string normalizedSnapshot = String.IsNullOrWhiteSpace(snapshotDocument)
                        ? ""
                        : Path.GetFullPath(snapshotDocument);
                    if (normalizedSnapshot.Length == 0
                        || !normalizedSnapshot.StartsWith(snapshotRoot, StringComparison.OrdinalIgnoreCase)
                        || !String.Equals(Path.GetExtension(normalizedSnapshot), ".asm", StringComparison.OrdinalIgnoreCase)
                        || !File.Exists(normalizedSnapshot))
                    {
                        progress.ReportFailure("Der native Runtime-Snapshot wurde nicht erzeugt.");
                        return;
                    }

                    string runtime = EdgeRuntimeClient.Send("iv.export_project_snapshot", normalizedSnapshot);
                    Log("SaveALL runtime=" + runtime);
                    progress.ReportSuccess(outputDirectory, runtime);
                    Process.Start(new ProcessStartInfo("explorer.exe", outputDirectory) { UseShellExecute = true });
                }
                catch (Exception exception)
                {
                    Log("SaveALL failed: " + exception);
                    progress.ReportFailure(exception.Message);
                }
            });
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
        }

        private static string ParseResultValue(string stdout, string key)
        {
            if (String.IsNullOrWhiteSpace(stdout) || String.IsNullOrWhiteSpace(key)) return null;
            string prefix = key + "=";
            string[] lines = stdout.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            for (int lineIndex = lines.Length - 1; lineIndex >= 0; lineIndex--)
            {
                if (!lines[lineIndex].StartsWith("RESULT=", StringComparison.Ordinal)) continue;
                string[] fields = lines[lineIndex].Substring("RESULT=".Length).Split('|');
                foreach (string field in fields)
                {
                    if (field.StartsWith(prefix, StringComparison.Ordinal))
                    {
                        return field.Substring(prefix.Length).Trim();
                    }
                }
            }
            return null;
        }

        private string ActiveDocumentPath()
        {
            try
            {
                dynamic application = _application;
                string path = (string)application.ActiveDocument.FullName;
                return String.IsNullOrWhiteSpace(path) ? null : path;
            }
            catch (Exception exception)
            {
                Log("ActiveDocumentPath failed: " + exception.Message);
                return null;
            }
        }

        private static void Log(string message)
        {
            try
            {
                string directory = Path.Combine(
                    System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
                    "iV-Connect",
                    "SolidEdgeAddIn");
                Directory.CreateDirectory(directory);
                File.AppendAllText(
                    Path.Combine(directory, "addin.log"),
                    DateTimeOffset.Now.ToString("o") + " " + message + System.Environment.NewLine);
            }
            catch
            {
            }
        }
    }

    internal sealed class SaveAllProgressForm : Form
    {
        private readonly Label _headline;
        private readonly Label _detail;
        private readonly ProgressBar _progress;
        private System.Windows.Forms.Timer _successCloseTimer;

        public SaveAllProgressForm()
        {
            Text = "iV-Connect · IV SaveALL";
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new System.Drawing.SizeF(96.0f, 96.0f);
            ClientSize = new System.Drawing.Size(640, 300);
            MinimumSize = new System.Drawing.Size(640, 300);
            StartPosition = FormStartPosition.CenterScreen;
            TopMost = true;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.Padding = new Padding(28, 24, 28, 24);
            layout.ColumnCount = 1;
            layout.RowCount = 3;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100.0f));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100.0f));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 20.0f));

            _headline = new Label();
            _headline.AutoSize = true;
            _headline.Dock = DockStyle.Top;
            _headline.Margin = new Padding(0, 0, 0, 16);
            _headline.Font = new System.Drawing.Font("Segoe UI", 14.0f, System.Drawing.FontStyle.Bold);
            _headline.Text = "IV SaveALL läuft";
            _headline.UseCompatibleTextRendering = false;

            _detail = new Label();
            _detail.AutoSize = false;
            _detail.Dock = DockStyle.Fill;
            _detail.Margin = new Padding(0, 0, 0, 18);
            _detail.Font = new System.Drawing.Font("Segoe UI", 10.5f);
            _detail.Text = "Ofen-Baugruppe, Bibliothek, BOM, Analyse, STEP, Draft und PDF werden aktualisiert.";
            _detail.TextAlign = System.Drawing.ContentAlignment.TopLeft;
            _detail.UseCompatibleTextRendering = false;

            _progress = new ProgressBar();
            _progress.Dock = DockStyle.Fill;
            _progress.Margin = new Padding(0);
            _progress.Style = ProgressBarStyle.Marquee;

            layout.Controls.Add(_headline, 0, 0);
            layout.Controls.Add(_detail, 0, 1);
            layout.Controls.Add(_progress, 0, 2);
            Controls.Add(layout);
        }

        public void ReportSuccess(string outputDirectory, string runtimeStatus)
        {
            if (IsDisposed) { return; }
            BeginInvoke((MethodInvoker)delegate
            {
                _headline.Text = "IV SaveALL abgeschlossen";
                _detail.Text = "Baugruppe, BOM, Analyse, STEP, Draft und PDF liegen in:\r\n" + outputDirectory
                    + "\r\n\r\nRuntime: " + runtimeStatus;
                _progress.Style = ProgressBarStyle.Continuous;
                _progress.Value = 100;

                // Give the operator a brief visual confirmation, then return
                // focus to Solid Edge without leaving a stale modal on top.
                _successCloseTimer = new System.Windows.Forms.Timer();
                _successCloseTimer.Interval = 1800;
                _successCloseTimer.Tick += delegate
                {
                    _successCloseTimer.Stop();
                    _successCloseTimer.Dispose();
                    _successCloseTimer = null;
                    Close();
                };
                _successCloseTimer.Start();
            });
        }

        public void ReportFailure(string message)
        {
            if (IsDisposed) { return; }
            BeginInvoke((MethodInvoker)delegate
            {
                _headline.Text = "IV SaveALL fehlgeschlagen";
                _detail.Text = message;
                _progress.Style = ProgressBarStyle.Continuous;
                _progress.Value = 0;
            });
        }
    }

    internal static class EdgeRuntimeClient
    {
        private const string Endpoint = "http://127.0.0.1:47911/v1/edge-jobs";
        private const string CredentialTarget = "edge-host-token.com.innovavento.iv-connect";

        public static string Send(string capability, string projectPath)
        {
            string token = ReadToken();
            if (String.IsNullOrWhiteSpace(token))
            {
                return "nicht konfiguriert";
            }

            Dictionary<string, object> context = new Dictionary<string, object>();
            if (!String.IsNullOrWhiteSpace(projectPath))
            {
                context["project_path"] = projectPath;
            }
            Dictionary<string, object> payload = new Dictionary<string, object>
            {
                { "schema_version", "1.0" },
                { "job_type", "host_ui_trigger" },
                { "capability", capability },
                { "correlation_id", Guid.NewGuid().ToString() },
                { "occurred_at", DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") },
                { "source", new Dictionary<string, object>
                    {
                        { "system", "solid_edge" },
                        { "editor_scope", !String.IsNullOrWhiteSpace(projectPath)
                            && String.Equals(Path.GetExtension(projectPath), ".asm", StringComparison.OrdinalIgnoreCase)
                                ? "assembly"
                                : "part" },
                        { "plugin_version", "0.1.0" }
                    }
                },
                { "context", context }
            };

            try
            {
                byte[] body = System.Text.Encoding.UTF8.GetBytes(
                    new JavaScriptSerializer().Serialize(payload));
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Endpoint);
                request.Method = "POST";
                request.ContentType = "application/json";
                request.Accept = "application/json";
                request.Timeout = 2500;
                request.ReadWriteTimeout = 2500;
                request.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
                request.ContentLength = body.Length;
                using (Stream stream = request.GetRequestStream())
                {
                    stream.Write(body, 0, body.Length);
                }
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.Accepted
                        ? "angenommen"
                        : "HTTP " + (int)response.StatusCode;
                }
            }
            catch (WebException exception)
            {
                HttpWebResponse response = exception.Response as HttpWebResponse;
                return response == null ? "offline" : "HTTP " + (int)response.StatusCode;
            }
            catch
            {
                return "offline";
            }
        }

        private static string ReadToken()
        {
            IntPtr pointer;
            if (CredRead(CredentialTarget, 1, 0, out pointer))
            {
                try
                {
                    NativeCredential credential = (NativeCredential)Marshal.PtrToStructure(
                        pointer,
                        typeof(NativeCredential));
                    if (credential.CredentialBlob != IntPtr.Zero && credential.CredentialBlobSize > 0)
                    {
                        return Marshal.PtrToStringUni(
                            credential.CredentialBlob,
                            (int)credential.CredentialBlobSize / 2).TrimEnd('\0').Trim();
                    }
                }
                finally
                {
                    CredFree(pointer);
                }
            }
            return (System.Environment.GetEnvironmentVariable("IV_CONNECT_EDGE_TOKEN") ?? "").Trim();
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NativeCredential
        {
            public uint Flags;
            public uint Type;
            public string TargetName;
            public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public uint CredentialBlobSize;
            public IntPtr CredentialBlob;
            public uint Persist;
            public uint AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias;
            public string UserName;
        }

        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

        [DllImport("advapi32.dll")]
        private static extern void CredFree(IntPtr credential);
    }
}
