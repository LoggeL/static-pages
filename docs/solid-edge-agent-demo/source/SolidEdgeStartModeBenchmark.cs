using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class SolidEdgeStartModeBenchmark
{
    private const string AddInClassId = "{D2D70C23-11EE-4A75-9080-C286A4BC15A6}";
    private const int AddInPollMilliseconds = 20;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };

    private sealed class StructureCount
    {
        public int ExpandedOccurrences;
        public int IncludedInBom;
        public int HierarchyDepth;
        public int Cycles;
    }

    private sealed class StageStatus
    {
        public bool application_ready;
        public bool document_ready;
        public bool structure_valid;
        public bool addin_ready;
        public bool cleanup_complete;
    }

    private sealed class TimingResult
    {
        public double? application_ready_ms;
        public double? document_ready_ms;
        public double? occurrence_read_ms;
        public double? addin_ready_observed_ms;
        public double? total_ms;
    }

    private sealed class AddInResult
    {
        public string status;
        public bool log_marker_observed;
        public string log_marker;
        public int observer_poll_interval_ms;
        public bool? connect;
        public int? command_count;
        public string[] command_captions;
    }

    private sealed class CleanupResult
    {
        public bool quit_requested;
        public bool edge_exit_observed;
        public bool forced_termination;
        public string error;
    }

    private sealed class Result
    {
        public int schema_version = 1;
        public string run_id;
        public string timestamp_utc;
        public string fixture_path;
        public string fixture_sha256;
        public string start_mode;
        public string warm_state = "cold";
        public string api = "solid_edge_com";
        public string process_start_mechanism;
        public int iteration;
        public bool success;
        public int expected_occurrences;
        public int actual_occurrences;
        public int included_in_bom;
        public int hierarchy_depth;
        public int cycles;
        public string actual_document_path;
        public int? owned_edge_process_id;
        public double? process_cpu_ms;
        public long? peak_working_set_bytes;
        public StageStatus stages = new StageStatus();
        public TimingResult timings_ms = new TimingResult();
        public AddInResult addin = new AddInResult
        {
            status = "not_observed",
            log_marker = "Registered command bar enabled",
            observer_poll_interval_ms = AddInPollMilliseconds,
            command_captions = new string[0]
        };
        public CleanupResult cleanup = new CleanupResult();
        public string error_stage;
        public string error_type;
        public string error_message;
        public string timing_note = "Monotonic Stopwatch timestamps; add-in readiness is the first file-observer detection of a new readiness marker and therefore includes at most one polling interval of observer delay.";
    }

    private sealed class AddInLogWatcher : IDisposable
    {
        private readonly string _path;
        private readonly long _initialLength;
        private readonly ManualResetEvent _start = new ManualResetEvent(false);
        private readonly ManualResetEvent _stop = new ManualResetEvent(false);
        private readonly Thread _thread;
        private long _startTicks;
        private long _observedTicks;

        public AddInLogWatcher(string path)
        {
            _path = path;
            _initialLength = File.Exists(path) ? new FileInfo(path).Length : 0;
            _thread = new Thread(Watch) { IsBackground = true, Name = "SolidEdgeAddInLogWatcher" };
            _thread.Start();
        }

        public void Start(long startTicks)
        {
            _startTicks = startTicks;
            _start.Set();
        }

        public double? ObservedMilliseconds
        {
            get
            {
                long observed = Interlocked.Read(ref _observedTicks);
                return observed == 0 ? (double?)null : TicksToMilliseconds(observed - _startTicks);
            }
        }

        private void Watch()
        {
            _start.WaitOne();
            while (!_stop.WaitOne(AddInPollMilliseconds))
            {
                try
                {
                    if (!File.Exists(_path)) continue;
                    using (var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    {
                        if (stream.Length <= _initialLength) continue;
                        stream.Position = Math.Min(_initialLength, stream.Length);
                        using (var reader = new StreamReader(stream, Encoding.UTF8, true, 1024, false))
                        {
                            string appended = reader.ReadToEnd();
                            if (appended.IndexOf("Registered command bar enabled", StringComparison.Ordinal) < 0) continue;
                            Interlocked.CompareExchange(ref _observedTicks, Stopwatch.GetTimestamp(), 0);
                            return;
                        }
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }

        public void Dispose()
        {
            _stop.Set();
            if (!_thread.Join(1000)) { }
            _start.Dispose();
            _stop.Dispose();
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 6)
        {
            Console.Error.WriteLine("Usage: IV.SolidEdge.StartModeBenchmark.exe <fixture> <result.json> <run-id> <start-mode> <iteration> <expected-occurrences> [Edge.exe]");
            return 1;
        }

        ColdOleMessageFilter.Register();
        string fixturePath = Path.GetFullPath(args[0]);
        string resultPath = Path.GetFullPath(args[1]);
        string runId = args[2];
        string startMode = args[3];
        int iteration = Int32.Parse(args[4], CultureInfo.InvariantCulture);
        int expectedOccurrences = Int32.Parse(args[5], CultureInfo.InvariantCulture);
        string edgePath = args.Length > 6 ? Path.GetFullPath(args[6]) : @"C:\Program Files\Siemens\Solid Edge 2026\Program\Edge.exe";

        var result = new Result
        {
            run_id = runId,
            timestamp_utc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            fixture_path = fixturePath,
            start_mode = startMode,
            iteration = iteration,
            expected_occurrences = expectedOccurrences
        };

        dynamic application = null;
        dynamic document = null;
        AddInLogWatcher watcher = null;
        string stage = "preflight";
        long startedTicks = 0;
        try
        {
            if (!File.Exists(fixturePath)) throw new FileNotFoundException("Benchmark fixture not found.", fixturePath);
            if (expectedOccurrences < 1) throw new ArgumentOutOfRangeException("expectedOccurrences");
            if (Process.GetProcessesByName("Edge").Length != 0)
            {
                throw new InvalidOperationException("Application-cold preflight requires zero running Edge.exe processes. No process was stopped by the probe.");
            }
            if (startMode != "interactive_normal" && startMode != "interactive_file_open" && startMode != "automation_spawned")
            {
                throw new ArgumentException("Unsupported start mode: " + startMode, "startMode");
            }
            if (startMode != "automation_spawned" && !File.Exists(edgePath)) throw new FileNotFoundException("Edge.exe not found.", edgePath);

            result.fixture_sha256 = Sha256(fixturePath);
            string logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "iV-Connect", "SolidEdgeAddIn", "addin.log");
            watcher = new AddInLogWatcher(logPath);
            startedTicks = Stopwatch.GetTimestamp();
            watcher.Start(startedTicks);

            stage = "start_application";
            if (startMode == "automation_spawned")
            {
                result.process_start_mechanism = "Activator.CreateInstance(SolidEdge.Application)";
                Type type = Type.GetTypeFromProgID("SolidEdge.Application", true);
                application = Activator.CreateInstance(type);
                application.Visible = true;
            }
            else
            {
                result.process_start_mechanism = startMode == "interactive_file_open" ? "Edge.exe <fixture>" : "Edge.exe";
                string arguments = startMode == "interactive_file_open" ? QuoteArgument(fixturePath) : String.Empty;
                Process.Start(new ProcessStartInfo(edgePath, arguments) { UseShellExecute = true });
                application = WaitForActiveApplication(TimeSpan.FromSeconds(120));
            }

            string version = Convert.ToString(application.Version, CultureInfo.InvariantCulture);
            GC.KeepAlive(version);
            result.timings_ms.application_ready_ms = TicksToMilliseconds(Stopwatch.GetTimestamp() - startedTicks);
            result.stages.application_ready = true;
            result.owned_edge_process_id = SingleEdgeProcessId();

            stage = "open_document";
            if (startMode == "interactive_file_open")
            {
                document = WaitForOpenDocument(application.Documents, fixturePath, TimeSpan.FromSeconds(120));
            }
            else
            {
                document = application.Documents.Open(fixturePath);
            }
            result.actual_document_path = Convert.ToString(document.FullName, CultureInfo.InvariantCulture);
            if (!SamePath(result.actual_document_path, fixturePath))
            {
                throw new InvalidOperationException("Solid Edge opened a different document than the hashed fixture: " + result.actual_document_path);
            }
            result.timings_ms.document_ready_ms = TicksToMilliseconds(Stopwatch.GetTimestamp() - startedTicks);
            result.stages.document_ready = true;

            stage = "read_occurrences";
            long readStarted = Stopwatch.GetTimestamp();
            StructureCount structure = ReadOccurrenceStructure(document);
            result.timings_ms.occurrence_read_ms = TicksToMilliseconds(Stopwatch.GetTimestamp() - readStarted);
            result.actual_occurrences = structure.ExpandedOccurrences;
            result.included_in_bom = structure.IncludedInBom;
            result.hierarchy_depth = structure.HierarchyDepth;
            result.cycles = structure.Cycles;
            result.stages.structure_valid = structure.ExpandedOccurrences == expectedOccurrences && structure.Cycles == 0;
            if (!result.stages.structure_valid)
            {
                throw new InvalidOperationException(String.Format(
                    CultureInfo.InvariantCulture,
                    "Occurrence validation failed: expected={0}; actual={1}; cycles={2}.",
                    expectedOccurrences, structure.ExpandedOccurrences, structure.Cycles));
            }

            stage = "observe_addin_ready";
            WaitForAddInReadyObservation(watcher, TimeSpan.FromSeconds(30));
            result.timings_ms.addin_ready_observed_ms = watcher.ObservedMilliseconds;
            result.addin.log_marker_observed = result.timings_ms.addin_ready_observed_ms.HasValue;
            InspectAddIn(application, result.addin);
            result.stages.addin_ready = result.addin.log_marker_observed && result.addin.connect == true && result.addin.command_count.GetValueOrDefault() >= 2;
            result.addin.status = result.stages.addin_ready ? "observed_ready" : "not_ready";
            result.timings_ms.total_ms = TicksToMilliseconds(Stopwatch.GetTimestamp() - startedTicks);
        }
        catch (Exception exception)
        {
            result.error_stage = stage;
            result.error_type = exception.GetType().FullName;
            result.error_message = exception.Message;
            if (startedTicks != 0) result.timings_ms.total_ms = TicksToMilliseconds(Stopwatch.GetTimestamp() - startedTicks);
        }
        finally
        {
            CaptureProcessResources(result);
            Cleanup(document, application, result.cleanup);
            result.stages.cleanup_complete = result.cleanup.quit_requested && result.cleanup.edge_exit_observed && !result.cleanup.forced_termination;
            result.success = result.error_type == null
                && result.stages.application_ready
                && result.stages.document_ready
                && result.stages.structure_valid
                && result.stages.addin_ready
                && result.stages.cleanup_complete;
            if (watcher != null) watcher.Dispose();
            Directory.CreateDirectory(Path.GetDirectoryName(resultPath));
            File.WriteAllText(resultPath, Json.Serialize(result), new UTF8Encoding(false));
            ColdOleMessageFilter.Revoke();
        }

        Console.WriteLine("RESULT=" + resultPath);
        Console.WriteLine("START_MODE=" + result.start_mode + "|iteration=" + result.iteration + "|success=" + result.success.ToString().ToLowerInvariant());
        return result.success ? 0 : 2;
    }

    private static void InspectAddIn(dynamic application, AddInResult result)
    {
        dynamic addIn = null;
        try
        {
            addIn = application.AddIns.Item(AddInClassId);
            result.connect = (bool)addIn.Connect;
            dynamic environment = application.Environments.Item("Assembly");
            var captions = new List<string>();
            foreach (dynamic bar in environment.CommandBars)
            {
                string name = Convert.ToString(bar.Name, CultureInfo.InvariantCulture);
                if (!name.StartsWith("iV-Connect", StringComparison.OrdinalIgnoreCase)) continue;
                foreach (dynamic control in bar.Controls)
                {
                    captions.Add(Convert.ToString(control.Caption, CultureInfo.InvariantCulture));
                    ReleaseCom((object)control);
                }
                ReleaseCom((object)bar);
            }
            ReleaseCom((object)environment);
            result.command_captions = captions.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToArray();
            result.command_count = result.command_captions.Length;
        }
        catch
        {
            result.connect = false;
            result.command_count = 0;
            result.command_captions = new string[0];
        }
        finally { ReleaseCom((object)addIn); }
    }

    private static void WaitForAddInReadyObservation(AddInLogWatcher watcher, TimeSpan timeout)
    {
        Stopwatch wait = Stopwatch.StartNew();
        while (!watcher.ObservedMilliseconds.HasValue && wait.Elapsed < timeout) Thread.Sleep(AddInPollMilliseconds);
    }

    private static dynamic WaitForActiveApplication(TimeSpan timeout)
    {
        Stopwatch wait = Stopwatch.StartNew();
        Exception last = null;
        while (wait.Elapsed < timeout)
        {
            try { return Marshal.GetActiveObject("SolidEdge.Application"); }
            catch (COMException exception) { last = exception; }
            Thread.Sleep(100);
        }
        throw new TimeoutException("SolidEdge.Application did not enter the ROT within " + timeout.TotalSeconds + " seconds.", last);
    }

    private static dynamic WaitForOpenDocument(dynamic documents, string path, TimeSpan timeout)
    {
        Stopwatch wait = Stopwatch.StartNew();
        while (wait.Elapsed < timeout)
        {
            dynamic document = FindOpenDocument(documents, path);
            if (document != null) return document;
            Thread.Sleep(100);
        }
        throw new TimeoutException("The startup document was not open within " + timeout.TotalSeconds + " seconds: " + path);
    }

    private static dynamic FindOpenDocument(dynamic documents, string path)
    {
        for (int index = 1; index <= (int)documents.Count; index++)
        {
            dynamic candidate = documents.Item(index);
            try
            {
                string fullName = Convert.ToString(candidate.FullName, CultureInfo.InvariantCulture);
                if (SamePath(fullName, path)) return candidate;
            }
            catch { }
            ReleaseCom((object)candidate);
        }
        return null;
    }

    private static StructureCount ReadOccurrenceStructure(dynamic document)
    {
        var result = new StructureCount();
        TraverseOccurrences(document, 1, new HashSet<string>(StringComparer.OrdinalIgnoreCase), result);
        return result;
    }

    private static void TraverseOccurrences(dynamic assembly, int depth, HashSet<string> stack, StructureCount result)
    {
        string assemblyPath = Convert.ToString(assembly.FullName, CultureInfo.InvariantCulture);
        if (!stack.Add(assemblyPath)) { result.Cycles++; return; }
        result.HierarchyDepth = Math.Max(result.HierarchyDepth, depth);
        try
        {
            int count = (int)assembly.Occurrences.Count;
            for (int index = 1; index <= count; index++)
            {
                dynamic occurrence = assembly.Occurrences.Item(index);
                dynamic occurrenceDocument = null;
                try
                {
                    result.ExpandedOccurrences++;
                    if ((bool)occurrence.IncludeInBom) result.IncludedInBom++;
                    if ((bool)occurrence.Subassembly)
                    {
                        occurrenceDocument = occurrence.OccurrenceDocument;
                        TraverseOccurrences(occurrenceDocument, depth + 1, stack, result);
                    }
                }
                finally
                {
                    ReleaseCom((object)occurrenceDocument);
                    ReleaseCom((object)occurrence);
                }
            }
        }
        finally { stack.Remove(assemblyPath); }
    }

    private static void Cleanup(dynamic document, dynamic application, CleanupResult cleanup)
    {
        try
        {
            if (!Object.ReferenceEquals((object)document, null)) document.Close(false);
        }
        catch (Exception exception) { cleanup.error = "document_close=" + exception.Message; }
        finally { ReleaseCom((object)document); }

        try
        {
            if (!Object.ReferenceEquals((object)application, null))
            {
                application.Quit();
                cleanup.quit_requested = true;
            }
        }
        catch (Exception exception)
        {
            cleanup.error = String.IsNullOrWhiteSpace(cleanup.error) ? "application_quit=" + exception.Message : cleanup.error + ";application_quit=" + exception.Message;
        }
        finally { ReleaseCom((object)application); }

        Stopwatch wait = Stopwatch.StartNew();
        while (Process.GetProcessesByName("Edge").Length != 0 && wait.Elapsed < TimeSpan.FromSeconds(45)) Thread.Sleep(100);
        cleanup.edge_exit_observed = Process.GetProcessesByName("Edge").Length == 0;
        cleanup.forced_termination = false;
        if (!cleanup.edge_exit_observed)
        {
            cleanup.error = String.IsNullOrWhiteSpace(cleanup.error) ? "Edge.exe did not exit within 45 seconds; no forced termination was used." : cleanup.error + ";Edge.exe did not exit within 45 seconds; no forced termination was used.";
        }
    }

    private static int? SingleEdgeProcessId()
    {
        Process[] processes = Process.GetProcessesByName("Edge");
        return processes.Length == 1 ? (int?)processes[0].Id : null;
    }

    private static void CaptureProcessResources(Result result)
    {
        if (!result.owned_edge_process_id.HasValue) return;
        try
        {
            using (Process process = Process.GetProcessById(result.owned_edge_process_id.Value))
            {
                process.Refresh();
                result.process_cpu_ms = process.TotalProcessorTime.TotalMilliseconds;
                result.peak_working_set_bytes = process.PeakWorkingSet64;
            }
        }
        catch { }
    }

    private static bool SamePath(string left, string right)
    {
        if (String.IsNullOrWhiteSpace(left) || String.IsNullOrWhiteSpace(right)) return false;
        return String.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
    }

    private static string QuoteArgument(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

    private static string Sha256(string path)
    {
        using (var stream = File.OpenRead(path))
        using (var sha = SHA256.Create())
        {
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", String.Empty).ToLowerInvariant();
        }
    }

    private static double TicksToMilliseconds(long ticks) { return ticks * 1000.0 / Stopwatch.Frequency; }

    private static void ReleaseCom(object value)
    {
        try
        {
            if (value == null || !Marshal.IsComObject(value)) return;
            Marshal.FinalReleaseComObject(value);
        }
        catch { }
    }
}

[ComImport]
[Guid("00000016-0000-0000-C000-000000000046")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IColdOleMessageFilter
{
    [PreserveSig]
    int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo);
    [PreserveSig]
    int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType);
    [PreserveSig]
    int MessagePending(IntPtr taskCallee, int tickCount, int pendingType);
}

internal sealed class ColdOleMessageFilter : IColdOleMessageFilter
{
    [DllImport("Ole32.dll")]
    private static extern int CoRegisterMessageFilter(IColdOleMessageFilter newFilter, out IColdOleMessageFilter oldFilter);

    public static void Register()
    {
        IColdOleMessageFilter oldFilter;
        CoRegisterMessageFilter(new ColdOleMessageFilter(), out oldFilter);
    }

    public static void Revoke()
    {
        IColdOleMessageFilter oldFilter;
        CoRegisterMessageFilter(null, out oldFilter);
    }

    public int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo) { return 0; }
    public int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType) { return rejectType == 2 ? 100 : -1; }
    public int MessagePending(IntPtr taskCallee, int tickCount, int pendingType) { return 2; }
}
