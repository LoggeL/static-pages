using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using SolidEdge.PropAuto.Interop;
using RevisionApplication = SolidEdge.RevisionManager.Interop.ApplicationClass;

internal static class SolidEdgeApiBenchmark
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };

    private sealed class ProbeResult
    {
        public int Count;
        public string Detail;
    }

    private sealed class StructureCount
    {
        public int ExpandedOccurrences;
        public int IncludedInBom;
        public int ResolvedDocuments;
        public int SubassemblyOccurrences;
        public int ReferenceOnlyOccurrences;
        public int HierarchyDepth;
        public int Cycles;
    }

    private sealed class RunRow
    {
        public string run_id;
        public string timestamp_utc;
        public string fixture_path;
        public string fixture_sha256;
        public string api;
        public string operation;
        public bool warmup;
        public int iteration;
        public double elapsed_ms;
        public bool success;
        public int result_count;
        public string detail;
        public string error_type;
        public string error_message;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        OleMessageFilter.Register();
        try
        {
            string fixturePath = args.Length > 0
                ? Path.GetFullPath(args[0])
                : @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\api-benchmark-fixture\IV_InnovaVento_Oven_Benchmark.asm";
            string outputDirectory = args.Length > 1
                ? Path.GetFullPath(args[1])
                : @"Z:\output\solid-edge-oven";
            int iterations = args.Length > 2 ? Int32.Parse(args[2], CultureInfo.InvariantCulture) : 7;
            int warmups = args.Length > 3 ? Int32.Parse(args[3], CultureInfo.InvariantCulture) : 2;
            string activeSourcePath = args.Length > 4 && !String.IsNullOrWhiteSpace(args[4])
                ? Path.GetFullPath(args[4])
                : null;

            if (!File.Exists(fixturePath)) throw new FileNotFoundException("Oven fixture not found.", fixturePath);
            if (iterations < 1) throw new ArgumentOutOfRangeException("iterations");
            if (warmups < 0) throw new ArgumentOutOfRangeException("warmups");
            Directory.CreateDirectory(outputDirectory);

            string fixtureHash = Sha256(fixturePath);
            string runId = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture);
            var rows = new List<RunRow>();
            int conflictingDocumentsClosed = PrepareSolidEdgeFixture(fixturePath);
            bool activeSourceOpenedByHarness = EnsureActiveSourceOpen(activeSourcePath);

            RunSeries(rows, runId, fixturePath, fixtureHash, "propauto", "closed_file_metadata_read", warmups, iterations,
                delegate { return ProbePropAuto(fixturePath); });
            RunSeries(rows, runId, fixturePath, fixtureHash, "solid_edge_com", "open_snapshot_copy_and_occurrence_read", warmups, iterations,
                delegate { return ProbeSolidEdgeOpenAndRead(fixturePath); });
            RunSeries(rows, runId, fixturePath, fixtureHash, "solid_edge_com", "active_source_occurrence_read", warmups, iterations,
                delegate { return ProbeSolidEdgeActiveSourceRead(activeSourcePath); });
            RunSeries(rows, runId, fixturePath, fixtureHash, "revision_manager", "linked_document_read", warmups, iterations,
                delegate { return ProbeRevisionManager(fixturePath); });

            string csvPath = Path.Combine(outputDirectory, "api-benchmark-runs.csv");
            string jsonPath = Path.Combine(outputDirectory, "api-benchmark-runs.json");
            string summaryPath = Path.Combine(outputDirectory, "api-benchmark-summary.json");
            string environmentPath = Path.Combine(outputDirectory, "api-benchmark-environment.json");
            string capabilitiesPath = Path.Combine(outputDirectory, "api-capabilities.json");

            File.WriteAllText(csvPath, ToCsv(rows), new UTF8Encoding(false));
            File.WriteAllText(jsonPath, Json.Serialize(rows), new UTF8Encoding(false));
            File.WriteAllText(summaryPath, Json.Serialize(BuildSummary(runId, fixturePath, fixtureHash, rows)), new UTF8Encoding(false));
            File.WriteAllText(environmentPath, Json.Serialize(BuildEnvironment(runId, fixturePath, fixtureHash, outputDirectory, conflictingDocumentsClosed, activeSourcePath, activeSourceOpenedByHarness)), new UTF8Encoding(false));
            File.WriteAllText(capabilitiesPath, Json.Serialize(BuildCapabilities()), new UTF8Encoding(false));

            Console.WriteLine("RUN_ID=" + runId);
            Console.WriteLine("FIXTURE=" + fixturePath);
            Console.WriteLine("FIXTURE_SHA256=" + fixtureHash);
            Console.WriteLine("ROWS=" + rows.Count.ToString(CultureInfo.InvariantCulture));
            Console.WriteLine("OUTPUT=" + outputDirectory);
            foreach (var group in rows.Where(row => !row.warmup).GroupBy(row => row.api + "/" + row.operation))
            {
                RunRow[] successful = group.Where(row => row.success).ToArray();
                Console.WriteLine(String.Format(
                    CultureInfo.InvariantCulture,
                    "SUMMARY={0}|success={1}/{2}|median_ms={3}|p95_ms={4}",
                    group.Key,
                    successful.Length,
                    group.Count(),
                    successful.Length == 0 ? "unsupported" : Median(successful.Select(row => row.elapsed_ms).ToArray()).ToString("F3", CultureInfo.InvariantCulture),
                    successful.Length == 0 ? "unsupported" : Percentile(successful.Select(row => row.elapsed_ms).ToArray(), 0.95).ToString("F3", CultureInfo.InvariantCulture)));
            }
            return rows.Any(row => !row.warmup && !row.success) ? 2 : 0;
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

    private static void RunSeries(
        IList<RunRow> rows,
        string runId,
        string fixturePath,
        string fixtureHash,
        string api,
        string operation,
        int warmups,
        int iterations,
        Func<ProbeResult> probe)
    {
        for (int index = 1; index <= warmups + iterations; index++)
        {
            bool warmup = index <= warmups;
            var row = new RunRow
            {
                run_id = runId,
                timestamp_utc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                fixture_path = fixturePath,
                fixture_sha256 = fixtureHash,
                api = api,
                operation = operation,
                warmup = warmup,
                iteration = warmup ? index : index - warmups
            };

            Stopwatch stopwatch = Stopwatch.StartNew();
            try
            {
                ProbeResult result = probe();
                stopwatch.Stop();
                row.elapsed_ms = ElapsedMilliseconds(stopwatch);
                row.success = true;
                row.result_count = result.Count;
                row.detail = result.Detail;
            }
            catch (Exception exception)
            {
                stopwatch.Stop();
                row.elapsed_ms = ElapsedMilliseconds(stopwatch);
                row.success = false;
                row.error_type = exception.GetType().FullName;
                row.error_message = exception.Message;
            }
            rows.Add(row);
            Console.WriteLine(String.Format(
                CultureInfo.InvariantCulture,
                "PROBE={0}/{1}|warmup={2}|iteration={3}|success={4}|count={5}|elapsed_ms={6:F3}",
                api,
                operation,
                warmup.ToString().ToLowerInvariant(),
                row.iteration,
                row.success.ToString().ToLowerInvariant(),
                row.result_count,
                row.elapsed_ms));
        }
    }

    private static ProbeResult ProbePropAuto(string fixturePath)
    {
        dynamic sets = null;
        int propertyCount = 0;
        int unreadableProperties = 0;
        int setCount = 0;
        string stage = "create_property_sets";
        try
        {
            sets = new PropertySetsClass();
            stage = "open_read_only";
            sets.Open(fixturePath, true);
            setCount = (int)sets.Count;
            stage = "enumerate_property_sets";
            foreach (dynamic properties in sets)
            {
                int count = (int)properties.Count;
                propertyCount += count;
                stage = "enumerate_properties";
                foreach (dynamic property in properties)
                {
                    try
                    {
                        string name = Convert.ToString(property.Name, CultureInfo.InvariantCulture);
                        object value = property.Value;
                        GC.KeepAlive(name);
                        GC.KeepAlive(value);
                    }
                    catch
                    {
                        unreadableProperties++;
                    }
                    finally { ReleaseCom((object)property); }
                }
                ReleaseCom((object)properties);
            }
            return new ProbeResult
            {
                Count = propertyCount,
                Detail = String.Format(CultureInfo.InvariantCulture, "property_sets={0};properties={1};unreadable={2};open_read_only=true", setCount, propertyCount, unreadableProperties)
            };
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException("propauto_stage=" + stage + ": " + exception.Message, exception);
        }
        finally
        {
            if (!Object.ReferenceEquals((object)sets, null))
            {
                try { sets.Close(); } catch { }
                ReleaseCom((object)sets);
            }
        }
    }

    private static int PrepareSolidEdgeFixture(string fixturePath)
    {
        dynamic application = null;
        int closed = 0;
        try
        {
            application = Marshal.GetActiveObject("SolidEdge.Application");
            dynamic documents = application.Documents;
            string expectedPath = Path.GetFullPath(fixturePath);
            string expectedName = Path.GetFileName(fixturePath);
            for (int index = (int)documents.Count; index >= 1; index--)
            {
                dynamic document = documents.Item(index);
                string name = Convert.ToString(document.Name, CultureInfo.InvariantCulture);
                string fullName = Convert.ToString(document.FullName, CultureInfo.InvariantCulture);
                if (String.Equals(name, expectedName, StringComparison.OrdinalIgnoreCase) &&
                    !String.Equals(Path.GetFullPath(fullName), expectedPath, StringComparison.OrdinalIgnoreCase))
                {
                    bool dirty = (bool)document.Dirty;
                    if (dirty) throw new InvalidOperationException("Refusing to close conflicting unsaved Solid Edge document: " + fullName);
                    document.Close(false);
                    closed++;
                }
                ReleaseCom((object)document);
            }
            ReleaseCom((object)documents);
            return closed;
        }
        finally { ReleaseCom((object)application); }
    }

    private static bool EnsureActiveSourceOpen(string activeSourcePath)
    {
        if (String.IsNullOrWhiteSpace(activeSourcePath)) return false;
        dynamic application = null;
        dynamic documents = null;
        dynamic document = null;
        try
        {
            application = Marshal.GetActiveObject("SolidEdge.Application");
            documents = application.Documents;
            document = FindOpenDocument(documents, activeSourcePath);
            if (document != null)
            {
                document.Activate();
                return false;
            }
            document = documents.Open(activeSourcePath);
            document.Activate();
            return true;
        }
        finally
        {
            ReleaseCom((object)document);
            ReleaseCom((object)documents);
            ReleaseCom((object)application);
        }
    }

    private static ProbeResult ProbeRevisionManager(string fixturePath)
    {
        dynamic application = null;
        dynamic document = null;
        dynamic linkedDocuments = null;
        int linkedCount = 0;
        int resolvedPaths = 0;
        int localPaths = 0;
        int externalPaths = 0;
        int missingPaths = 0;
        var linkedPathSamples = new List<string>();
        string stage = "create_application";
        try
        {
            application = new RevisionApplication();
            stage = "configure_application";
            application.Visible = 0;
            application.DisplayAlerts = 0;
            stage = "open_document";
            document = application.Open(fixturePath, Type.Missing, Type.Missing);
            stage = "read_linked_documents";
            try
            {
                linkedDocuments = document.LinkedDocuments(Type.Missing);
            }
            catch
            {
                linkedDocuments = document.get_LinkedDocuments(Type.Missing);
            }
            linkedCount = (int)linkedDocuments.Count;
            for (int index = 1; index <= linkedCount; index++)
            {
                dynamic linkedDocument = linkedDocuments.Item(index);
                try
                {
                    string fullName = Convert.ToString(linkedDocument.FullName, CultureInfo.InvariantCulture);
                    if (!String.IsNullOrWhiteSpace(fullName))
                    {
                        resolvedPaths++;
                        string normalized = Path.GetFullPath(fullName);
                        string fixtureDirectory = Path.GetDirectoryName(Path.GetFullPath(fixturePath));
                        if (String.Equals(Path.GetDirectoryName(normalized), fixtureDirectory, StringComparison.OrdinalIgnoreCase))
                        {
                            localPaths++;
                        }
                        else
                        {
                            externalPaths++;
                        }
                        if (!File.Exists(normalized)) missingPaths++;
                        if (linkedPathSamples.Count < 12) linkedPathSamples.Add(normalized);
                    }
                }
                finally
                {
                    ReleaseCom((object)linkedDocument);
                }
            }
            return new ProbeResult
            {
                Count = linkedCount,
                Detail = String.Format(
                    CultureInfo.InvariantCulture,
                    "linked_documents={0};resolved_paths={1};local_paths={2};external_paths={3};missing_paths={4};paths={5};semantic_bom=not_supported",
                    linkedCount,
                    resolvedPaths,
                    localPaths,
                    externalPaths,
                    missingPaths,
                    String.Join("|", linkedPathSamples))
            };
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException("revision_manager_stage=" + stage + ": " + exception.Message, exception);
        }
        finally
        {
            if (!Object.ReferenceEquals((object)document, null))
            {
                try { document.Close(); } catch { }
            }
            ReleaseCom((object)linkedDocuments);
            ReleaseCom((object)document);
            if (!Object.ReferenceEquals((object)application, null))
            {
                try { application.Quit(); } catch { }
            }
            ReleaseCom((object)application);
        }
    }

    private static ProbeResult ProbeSolidEdgeOpenAndRead(string fixturePath)
    {
        dynamic application = null;
        dynamic document = null;
        bool openedByProbe = false;
        string actualDocumentPath = null;
        string sourceMatch = "exact";
        string stage = "get_active_application";
        try
        {
            application = Marshal.GetActiveObject("SolidEdge.Application");
            stage = "find_open_document";
            dynamic documents = application.Documents;
            document = FindOpenDocument(documents, fixturePath);
            if (document == null)
            {
                stage = "open_document";
                document = documents.Open(fixturePath);
                openedByProbe = true;
            }
            stage = "enumerate_occurrences";
            actualDocumentPath = Convert.ToString(document.FullName, CultureInfo.InvariantCulture);
            StructureCount structure = ReadOccurrenceStructure(document);
            return new ProbeResult
            {
                Count = structure.ExpandedOccurrences,
                Detail = StructureDetail(structure) + String.Format(CultureInfo.InvariantCulture, ";opened_by_probe={0};source_match={1};actual_document={2}", openedByProbe.ToString().ToLowerInvariant(), sourceMatch, actualDocumentPath)
            };
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException("solid_edge_com_stage=" + stage + ": " + exception.Message, exception);
        }
        finally
        {
            if (openedByProbe && !Object.ReferenceEquals((object)document, null))
            {
                try { document.Close(false); } catch { }
            }
            ReleaseCom((object)document);
            ReleaseCom((object)application);
        }
    }

    private static ProbeResult ProbeSolidEdgeActiveSourceRead(string activeSourcePath)
    {
        dynamic application = null;
        dynamic document = null;
        try
        {
            application = Marshal.GetActiveObject("SolidEdge.Application");
            dynamic documents = application.Documents;
            document = String.IsNullOrWhiteSpace(activeSourcePath)
                ? FindOpenDocumentByExactName(documents, "IV_InnovaVento_Oven.asm")
                : FindOpenDocument(documents, activeSourcePath);
            if (document == null) throw new InvalidOperationException(
                String.IsNullOrWhiteSpace(activeSourcePath)
                    ? "The generated oven source assembly is not open in Solid Edge."
                    : "The requested active source assembly is not open in Solid Edge: " + activeSourcePath);
            StructureCount structure = ReadOccurrenceStructure(document);
            return new ProbeResult
            {
                Count = structure.ExpandedOccurrences,
                Detail = StructureDetail(structure) + String.Format(CultureInfo.InvariantCulture, ";actual_document={0};unsaved_editor_state_available=true", Convert.ToString(document.FullName, CultureInfo.InvariantCulture))
            };
        }
        finally
        {
            ReleaseCom((object)document);
            ReleaseCom((object)application);
        }
    }

    private static StructureCount ReadOccurrenceStructure(dynamic document)
    {
        var result = new StructureCount();
        TraverseOccurrences(document, 1, new HashSet<string>(StringComparer.OrdinalIgnoreCase), result);
        return result;
    }

    private static void TraverseOccurrences(
        dynamic assembly,
        int depth,
        HashSet<string> pathStack,
        StructureCount result)
    {
        string assemblyPath = Convert.ToString(assembly.FullName, CultureInfo.InvariantCulture);
        if (!pathStack.Add(assemblyPath))
        {
            result.Cycles++;
            return;
        }
        result.HierarchyDepth = Math.Max(result.HierarchyDepth, depth);
        try
        {
            int occurrenceCount = (int)assembly.Occurrences.Count;
            for (int index = 1; index <= occurrenceCount; index++)
            {
                dynamic occurrence = assembly.Occurrences.Item(index);
                dynamic occurrenceDocument = null;
                try
                {
                    result.ExpandedOccurrences++;
                    if ((bool)occurrence.IncludeInBom) result.IncludedInBom++;
                    try { if ((bool)occurrence.ReferenceOnly) result.ReferenceOnlyOccurrences++; } catch { }
                    string occurrencePath = Convert.ToString(occurrence.OccurrenceFileName, CultureInfo.InvariantCulture);
                    if (!String.IsNullOrWhiteSpace(occurrencePath)) result.ResolvedDocuments++;
                    if ((bool)occurrence.Subassembly)
                    {
                        result.SubassemblyOccurrences++;
                        occurrenceDocument = occurrence.OccurrenceDocument;
                        TraverseOccurrences(occurrenceDocument, depth + 1, pathStack, result);
                    }
                }
                finally
                {
                    ReleaseCom((object)occurrenceDocument);
                    ReleaseCom((object)occurrence);
                }
            }
        }
        finally
        {
            pathStack.Remove(assemblyPath);
        }
    }

    private static string StructureDetail(StructureCount structure)
    {
        return String.Format(
            CultureInfo.InvariantCulture,
            "expanded_occurrences={0};include_in_bom={1};resolved_documents={2};subassemblies={3};reference_only={4};hierarchy_depth={5};cycles={6}",
            structure.ExpandedOccurrences,
            structure.IncludedInBom,
            structure.ResolvedDocuments,
            structure.SubassemblyOccurrences,
            structure.ReferenceOnlyOccurrences,
            structure.HierarchyDepth,
            structure.Cycles);
    }

    private static dynamic FindOpenDocument(dynamic documents, string fixturePath)
    {
        string expected = Path.GetFullPath(fixturePath);
        int count = (int)documents.Count;
        for (int index = 1; index <= count; index++)
        {
            dynamic candidate = documents.Item(index);
            try
            {
                string fullName = Convert.ToString(candidate.FullName, CultureInfo.InvariantCulture);
                if (!String.IsNullOrWhiteSpace(fullName) && String.Equals(Path.GetFullPath(fullName), expected, StringComparison.OrdinalIgnoreCase))
                {
                    return candidate;
                }
            }
            catch { }
            ReleaseCom((object)candidate);
        }
        return null;
    }

    private static dynamic FindOpenDocumentByExactName(dynamic documents, string fileName)
    {
        int count = (int)documents.Count;
        for (int index = 1; index <= count; index++)
        {
            dynamic candidate = documents.Item(index);
            try
            {
                string name = Convert.ToString(candidate.Name, CultureInfo.InvariantCulture);
                if (String.Equals(name, fileName, StringComparison.OrdinalIgnoreCase)) return candidate;
            }
            catch { }
            ReleaseCom((object)candidate);
        }
        return null;
    }

    private static object BuildSummary(string runId, string fixturePath, string fixtureHash, IEnumerable<RunRow> rows)
    {
        var summaries = new List<object>();
        foreach (var group in rows.Where(row => !row.warmup).GroupBy(row => new { row.api, row.operation }))
        {
            RunRow[] successful = group.Where(row => row.success).ToArray();
            double[] values = successful.Select(row => row.elapsed_ms).ToArray();
            summaries.Add(new
            {
                api = group.Key.api,
                operation = group.Key.operation,
                attempts = group.Count(),
                successes = successful.Length,
                failures = group.Count() - successful.Length,
                result_count_values = successful.Select(row => row.result_count).Distinct().OrderBy(value => value).ToArray(),
                median_ms = values.Length == 0 ? (double?)null : Median(values),
                p95_ms = values.Length == 0 ? (double?)null : Percentile(values, 0.95),
                min_ms = values.Length == 0 ? (double?)null : values.Min(),
                max_ms = values.Length == 0 ? (double?)null : values.Max()
            });
        }
        return new
        {
            schema_version = 1,
            run_id = runId,
            generated_at_utc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            fixture_path = fixturePath,
            fixture_sha256 = fixtureHash,
            statistics_exclude_warmups = true,
            summaries = summaries
        };
    }

    private static object BuildEnvironment(
        string runId,
        string fixturePath,
        string fixtureHash,
        string outputDirectory,
        int conflictingDocumentsClosed,
        string activeSourcePath,
        bool activeSourceOpenedByHarness)
    {
        string solidEdgeVersion = null;
        bool solidEdgeRunning = false;
        dynamic application = null;
        try
        {
            application = Marshal.GetActiveObject("SolidEdge.Application");
            solidEdgeRunning = true;
            solidEdgeVersion = Convert.ToString(application.Version, CultureInfo.InvariantCulture);
        }
        catch { }
        finally { ReleaseCom((object)application); }

        string windowsProductName = null;
        string windowsDisplayVersion = null;
        string windowsBuild = null;
        object windowsUbr = null;
        try
        {
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
            {
                if (key != null)
                {
                    windowsProductName = Convert.ToString(key.GetValue("ProductName"), CultureInfo.InvariantCulture);
                    windowsDisplayVersion = Convert.ToString(key.GetValue("DisplayVersion"), CultureInfo.InvariantCulture);
                    windowsBuild = Convert.ToString(key.GetValue("CurrentBuildNumber"), CultureInfo.InvariantCulture);
                    windowsUbr = key.GetValue("UBR");
                }
            }
        }
        catch { }

        bool outputOnSharedRepository = String.Equals(Path.GetPathRoot(outputDirectory), @"Z:\", StringComparison.OrdinalIgnoreCase);
        return new
        {
            schema_version = 1,
            run_id = runId,
            captured_at_utc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            machine_name = Environment.MachineName,
            user_name = Environment.UserName,
            os_version = Environment.OSVersion.VersionString,
            windows_product_name = windowsProductName,
            windows_display_version = windowsDisplayVersion,
            windows_build = windowsBuild,
            windows_ubr = windowsUbr,
            process_is_64_bit = Environment.Is64BitProcess,
            processor_architecture = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE"),
            processor_identifier = Environment.GetEnvironmentVariable("PROCESSOR_IDENTIFIER"),
            logical_processors = Environment.ProcessorCount,
            clr_version = Environment.Version.ToString(),
            solid_edge_running = solidEdgeRunning,
            solid_edge_version = solidEdgeVersion,
            fixture_path = fixturePath,
            fixture_sha256 = fixtureHash,
            fixture_bytes = new FileInfo(fixturePath).Length,
            active_source_path = activeSourcePath,
            active_source_opened_by_harness = activeSourceOpenedByHarness,
            conflicting_same_name_documents_closed_before_measurement = conflictingDocumentsClosed,
            benchmark_output_path = outputDirectory,
            storage_note = outputOnSharedRepository
                ? "fixture on local VM disk; benchmark raw output written through Parallels shared repository drive Z:"
                : "fixture and benchmark raw output written on the local VM disk; artifacts are copied byte-for-byte to the repository after the run",
            temperature_note = "two in-process warmups per API; application was already running; no OS-cold measurement",
            unsupported_environment_fields = new[] { "host_mac_model", "parallels_version", "vm_cpu_allocation", "vm_ram_allocation", "energy_mode", "background_load" }
        };
    }

    private static object BuildCapabilities()
    {
        return new object[]
        {
            new
            {
                api = "propauto",
                measured_operation = "closed_file_metadata_read",
                requires_solid_edge_process = false,
                supports_closed_file_metadata = true,
                unsupported = new[] { "unsaved_editor_state", "geometry_extraction", "semantic_bom", "step_export", "pdf_export", "native_save" },
                note = "Read-only Open(FileName, OpenReadOnly=true); property sets and property values are enumerated."
            },
            new
            {
                api = "revision_manager",
                measured_operation = "linked_document_read",
                requires_solid_edge_process = false,
                supports_closed_file_links = true,
                unsupported = new[] { "unsaved_editor_state", "geometry_extraction", "semantic_bom", "step_export", "pdf_export" },
                note = "LinkedDocuments measures document references, not a normalized engineering BOM."
            },
            new
            {
                api = "solid_edge_com",
                measured_operations = new[] { "open_snapshot_copy_and_occurrence_read", "active_source_occurrence_read" },
                requires_solid_edge_process = true,
                supports_occurrence_structure = true,
                not_measured = new[] { "cold_process_start", "addin_load", "geometry_extraction", "step_export", "pdf_export", "native_save", "core_transport" },
                note = "One probe opens the exact byte-identical snapshot working copy; a separate probe measures the already-open generated oven source. Failures remain separate from successful active-document latency."
            }
        };
    }

    private static string ToCsv(IEnumerable<RunRow> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine("run_id,timestamp_utc,fixture_path,fixture_sha256,api,operation,warmup,iteration,elapsed_ms,success,result_count,detail,error_type,error_message");
        foreach (RunRow row in rows)
        {
            string[] values =
            {
                row.run_id, row.timestamp_utc, row.fixture_path, row.fixture_sha256, row.api, row.operation,
                row.warmup.ToString().ToLowerInvariant(), row.iteration.ToString(CultureInfo.InvariantCulture),
                row.elapsed_ms.ToString("F6", CultureInfo.InvariantCulture), row.success.ToString().ToLowerInvariant(),
                row.result_count.ToString(CultureInfo.InvariantCulture), row.detail, row.error_type, row.error_message
            };
            builder.AppendLine(String.Join(",", values.Select(CsvEscape)));
        }
        return builder.ToString();
    }

    private static string CsvEscape(string value)
    {
        value = value ?? String.Empty;
        if (value.IndexOfAny(new[] { ',', '"', '\r', '\n' }) < 0) return value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private static string Sha256(string path)
    {
        using (var stream = File.OpenRead(path))
        using (var sha = SHA256.Create())
        {
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", String.Empty).ToLowerInvariant();
        }
    }

    private static double ElapsedMilliseconds(Stopwatch stopwatch)
    {
        return stopwatch.ElapsedTicks * 1000.0 / Stopwatch.Frequency;
    }

    private static double Median(double[] values)
    {
        double[] sorted = values.OrderBy(value => value).ToArray();
        int middle = sorted.Length / 2;
        return sorted.Length % 2 == 0 ? (sorted[middle - 1] + sorted[middle]) / 2.0 : sorted[middle];
    }

    private static double Percentile(double[] values, double percentile)
    {
        double[] sorted = values.OrderBy(value => value).ToArray();
        int rank = Math.Max(1, (int)Math.Ceiling(percentile * sorted.Length));
        return sorted[rank - 1];
    }

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
internal interface IOleMessageFilter
{
    [PreserveSig]
    int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo);
    [PreserveSig]
    int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType);
    [PreserveSig]
    int MessagePending(IntPtr taskCallee, int tickCount, int pendingType);
}

internal sealed class OleMessageFilter : IOleMessageFilter
{
    [DllImport("Ole32.dll")]
    private static extern int CoRegisterMessageFilter(IOleMessageFilter newFilter, out IOleMessageFilter oldFilter);

    public static void Register()
    {
        IOleMessageFilter oldFilter;
        CoRegisterMessageFilter(new OleMessageFilter(), out oldFilter);
    }

    public static void Revoke()
    {
        IOleMessageFilter oldFilter;
        CoRegisterMessageFilter(null, out oldFilter);
    }

    public int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo) { return 0; }
    public int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType) { return rejectType == 2 ? 100 : -1; }
    public int MessagePending(IntPtr taskCallee, int tickCount, int pendingType) { return 2; }
}
