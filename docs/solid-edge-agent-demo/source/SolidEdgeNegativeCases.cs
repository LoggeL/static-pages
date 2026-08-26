using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using RevisionApplication = SolidEdge.RevisionManager.Interop.ApplicationClass;

internal static class SolidEdgeNegativeCases
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };

    private sealed class LinkEdge
    {
        public string Source;
        public string Target;
        public bool Exists;
        public bool Local;
    }

    private sealed class LinkGraphResult
    {
        public int AssemblyCount;
        public int LinkCount;
        public int LocalLinks;
        public int ExternalLinks;
        public int MissingLinks;
        public List<LinkEdge> Edges = new List<LinkEdge>();
        public bool Pass { get { return AssemblyCount > 0 && LinkCount > 0 && ExternalLinks == 0 && MissingLinks == 0; } }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: IV.SolidEdge.NegativeCases.exe <positive-fixture-directory> <output-json>");
            return 2;
        }

        string positiveDirectory = Path.GetFullPath(args[0]);
        string outputPath = Path.GetFullPath(args[1]);
        string workingRoot = Path.Combine(Path.GetDirectoryName(positiveDirectory), "generated-negative-cases");
        string missingDirectory = Path.Combine(workingRoot, "missing-reference");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));

        OleMessageFilter.Register();
        try
        {
            LinkGraphResult positive = InspectLinkGraph(positiveDirectory);
            ReplaceDirectory(missingDirectory, positiveDirectory);
            string removedDependency = Path.Combine(missingDirectory, "IV_OVN_SIDE.par");
            if (!File.Exists(removedDependency)) throw new FileNotFoundException("Expected dependency for the negative case is missing.", removedDependency);
            File.Delete(removedDependency);
            LinkGraphResult missing = InspectLinkGraph(missingDirectory);
            Dictionary<string, object> cycle = ProbeSelfCycle(Path.Combine(workingRoot, "cycle-probe"));

            bool missingDetected = missing.MissingLinks > 0 || missing.ExternalLinks > 0 || !missing.Pass;
            bool cycleRejected = Convert.ToBoolean(cycle["creation_rejected"], CultureInfo.InvariantCulture);
            bool pass = positive.Pass && missingDetected && cycleRejected;
            var payload = new Dictionary<string, object>
            {
                { "schema_version", "1.0" },
                { "run_id", DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture) },
                { "positive_fixture", positiveDirectory },
                { "positive_link_graph", positive },
                { "missing_reference", new Dictionary<string, object>
                    {
                        { "removed_dependency", Path.GetFileName(removedDependency) },
                        { "detected", missingDetected },
                        { "link_graph", missing }
                    }
                },
                { "cycle_probe", cycle },
                { "acceptance", new Dictionary<string, object>
                    {
                        { "all_positive_links_local_and_present", positive.Pass },
                        { "missing_reference_detected", missingDetected },
                        { "self_cycle_rejected_by_solid_edge", cycleRejected },
                        { "pass", pass }
                    }
                }
            };
            File.WriteAllText(outputPath, Json.Serialize(payload));
            Console.WriteLine("OUTPUT=" + outputPath);
            Console.WriteLine(String.Format(CultureInfo.InvariantCulture, "POSITIVE=assemblies:{0}|links:{1}|local:{2}|external:{3}|missing:{4}", positive.AssemblyCount, positive.LinkCount, positive.LocalLinks, positive.ExternalLinks, positive.MissingLinks));
            Console.WriteLine(String.Format(CultureInfo.InvariantCulture, "MISSING=links:{0}|local:{1}|external:{2}|missing:{3}|detected:{4}", missing.LinkCount, missing.LocalLinks, missing.ExternalLinks, missing.MissingLinks, missingDetected.ToString().ToLowerInvariant()));
            Console.WriteLine("CYCLE_REJECTED=" + cycleRejected.ToString().ToLowerInvariant());
            return pass ? 0 : 3;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine("ERROR=" + exception);
            return 1;
        }
        finally
        {
            OleMessageFilter.Revoke();
        }
    }

    private static LinkGraphResult InspectLinkGraph(string directory)
    {
        var result = new LinkGraphResult();
        dynamic application = null;
        try
        {
            application = new RevisionApplication();
            application.Visible = 0;
            application.DisplayAlerts = 0;
            string expectedDirectory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
            foreach (string assemblyPath in Directory.GetFiles(directory, "*.asm").OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
            {
                dynamic document = null;
                dynamic links = null;
                result.AssemblyCount++;
                try
                {
                    document = application.Open(assemblyPath, Type.Missing, Type.Missing);
                    try { links = document.LinkedDocuments(Type.Missing); }
                    catch { links = document.get_LinkedDocuments(Type.Missing); }
                    int count = (int)links.Count;
                    for (int index = 1; index <= count; index++)
                    {
                        dynamic linked = null;
                        try
                        {
                            linked = links.Item(index);
                            string target = Convert.ToString(linked.FullName, CultureInfo.InvariantCulture);
                            string normalized = String.IsNullOrWhiteSpace(target) ? target : Path.GetFullPath(target);
                            bool exists = !String.IsNullOrWhiteSpace(normalized) && File.Exists(normalized);
                            bool local = exists && String.Equals(Path.GetDirectoryName(normalized).TrimEnd(Path.DirectorySeparatorChar), expectedDirectory, StringComparison.OrdinalIgnoreCase);
                            result.LinkCount++;
                            if (local) result.LocalLinks++; else result.ExternalLinks++;
                            if (!exists) result.MissingLinks++;
                            result.Edges.Add(new LinkEdge { Source = Path.GetFileName(assemblyPath), Target = normalized, Exists = exists, Local = local });
                        }
                        finally { ReleaseCom((object)linked); }
                    }
                }
                finally
                {
                    if (!Object.ReferenceEquals((object)document, null)) { try { document.Close(); } catch { } }
                    ReleaseCom((object)links);
                    ReleaseCom((object)document);
                }
            }
            return result;
        }
        finally
        {
            if (!Object.ReferenceEquals((object)application, null)) { try { application.Quit(); } catch { } }
            ReleaseCom((object)application);
        }
    }

    private static Dictionary<string, object> ProbeSelfCycle(string directory)
    {
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, "IV_Self_Cycle_Probe.asm");
        dynamic application = null;
        dynamic document = null;
        bool rejected = false;
        string errorType = null;
        string errorMessage = null;
        string hresult = null;
        try
        {
            application = Marshal.GetActiveObject("SolidEdge.Application");
            document = application.Documents.Add("SolidEdge.AssemblyDocument");
            document.SaveAs(path);
            Array matrix = IdentityMatrix();
            try
            {
                document.Occurrences.AddByFilename(path, ref matrix);
            }
            catch (Exception exception)
            {
                rejected = true;
                errorType = exception.GetType().FullName;
                errorMessage = exception.Message;
                hresult = "0x" + exception.HResult.ToString("X8", CultureInfo.InvariantCulture);
            }
        }
        finally
        {
            if (!Object.ReferenceEquals((object)document, null)) { try { document.Close(false); } catch { } }
            ReleaseCom((object)document);
            ReleaseCom((object)application);
        }
        try { Directory.Delete(directory, true); } catch { }
        return new Dictionary<string, object>
        {
            { "attempt", "AssemblyDocument.Occurrences.AddByFilename(self)" },
            { "creation_rejected", rejected },
            { "error_type", errorType },
            { "hresult", hresult },
            { "message", errorMessage },
            { "connector_rule", "Reject repeated canonical document paths during recursive traversal even though Solid Edge rejects direct self-cycles." }
        };
    }

    private static Array IdentityMatrix()
    {
        var values = new double[16];
        values[0] = values[5] = values[10] = values[15] = 1.0;
        return values;
    }

    private static void ReplaceDirectory(string destination, string source)
    {
        if (Directory.Exists(destination)) Directory.Delete(destination, true);
        Directory.CreateDirectory(destination);
        foreach (string path in Directory.GetFiles(source))
        {
            string extension = Path.GetExtension(path);
            if (!String.Equals(extension, ".asm", StringComparison.OrdinalIgnoreCase)
                && !String.Equals(extension, ".par", StringComparison.OrdinalIgnoreCase)) continue;
            File.Copy(path, Path.Combine(destination, Path.GetFileName(path)), true);
        }
    }

    private static void ReleaseCom(object value)
    {
        try
        {
            if (value != null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
        }
        catch { }
    }
}

[ComImport]
[Guid("00000016-0000-0000-C000-000000000046")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IOleMessageFilterNegative
{
    [PreserveSig] int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo);
    [PreserveSig] int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType);
    [PreserveSig] int MessagePending(IntPtr taskCallee, int tickCount, int pendingType);
}

internal sealed class OleMessageFilter : IOleMessageFilterNegative
{
    [DllImport("Ole32.dll")]
    private static extern int CoRegisterMessageFilter(IOleMessageFilterNegative newFilter, out IOleMessageFilterNegative oldFilter);
    public static void Register() { IOleMessageFilterNegative oldFilter; CoRegisterMessageFilter(new OleMessageFilter(), out oldFilter); }
    public static void Revoke() { IOleMessageFilterNegative oldFilter; CoRegisterMessageFilter(null, out oldFilter); }
    public int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo) { return 0; }
    public int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType) { return rejectType == 2 ? 100 : -1; }
    public int MessagePending(IntPtr taskCallee, int tickCount, int pendingType) { return 2; }
}
