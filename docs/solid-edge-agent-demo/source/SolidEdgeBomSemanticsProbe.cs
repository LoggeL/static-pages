using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using SolidEdge.Draft.Interop;

internal static class SolidEdgeBomSemanticsProbe
{
    private const string AssemblyTemplate = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric assembly.asm";
    private const string DraftTemplate = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric draft.dft";
    private const string SourcePart = @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\oven-demo\library\IV_OVN_CONTROL.par";
    private const string DefaultRoot = @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\bom-semantics\runs";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };

    private sealed class FixturePaths
    {
        public string Directory;
        public string Prefix;
        public string PartA;
        public string PartB;
        public string Subassembly;
        public string TopAssembly;
        public string Draft;
    }

    private sealed class ChildState
    {
        public string root_occurrence;
        public string child_name;
        public string child_file;
        public bool exclude_from_reports;
        public bool this_as_occurrence_include_in_bom;
        public bool this_as_occurrence_reference_only;
        public bool visible;
        public string definition_owner;
    }

    private sealed class PartsListEvidence
    {
        public int list_type;
        public string list_type_name;
        public bool is_up_to_date;
        public int row_count;
        public int column_count;
        public int file_name_column;
        public int quantity_column;
        public List<Dictionary<string, object>> columns = new List<Dictionary<string, object>>();
        public List<List<string>> rows = new List<List<string>>();
        public Dictionary<string, double> quantities = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
    }

    [STAThread]
    private static int Main(string[] args)
    {
        string outputPath = args.Length > 0
            ? Path.GetFullPath(args[0])
            : Path.Combine(DefaultRoot, "bom-semantics-latest.json");
        bool variant1Only = args.Length > 1
            && String.Equals(args[1], "--variant1-only", StringComparison.OrdinalIgnoreCase);
        string runId = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture)
            + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        string runDirectory = Path.Combine(DefaultRoot, runId);
        Directory.CreateDirectory(runDirectory);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));

        var payload = new Dictionary<string, object>
        {
            { "schema_version", "1.0" },
            { "probe", "solid-edge-nested-bom-semantics" },
            { "run_id", runId },
            { "generated_at_utc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
            { "run_directory", runDirectory },
            { "source_part", SourcePart },
            { "write_scope", "Only newly created GUID-prefixed files below run_directory." },
            { "golden_fixture_write_attempted", false },
            { "mode", variant1Only ? "variant1-only" : "all-variants" }
        };

        dynamic application = null;
        OleMessageFilter.Register();
        try
        {
            if (!File.Exists(SourcePart)) throw new FileNotFoundException("Source part is missing.", SourcePart);
            application = Marshal.GetActiveObject("SolidEdge.Application");
            payload["solid_edge_version"] = Convert.ToString(application.Version, CultureInfo.InvariantCulture);
            payload["type_library"] = TypeLibraryEvidence();

            var variants = new List<Dictionary<string, object>>();
            variants.Add(RunVariant(application, runDirectory, "suboccurrence_exclude_from_reports", true));
            if (!variant1Only)
            {
                variants.Add(RunVariant(application, runDirectory, "this_as_occurrence_include_in_bom", false));
            }
            payload["variants"] = variants;

            bool complete = variants.All(variant => GetBoolean(variant, "measurement_complete"));
            payload["acceptance"] = new Dictionary<string, object>
            {
                { "requested_variant_count", variants.Count },
                { "all_requested_variants_measured", complete },
                { "native_atomic_parts_list_read", variants.All(variant => GetBoolean(variant, "native_oracle_read")) },
                { "isolated_guid_directories", variants.All(variant => GetBoolean(variant, "isolated_directory")) },
                { "pass", complete && variants.All(variant => GetBoolean(variant, "native_oracle_read")) }
            };
            WriteJson(outputPath, payload);
            Console.WriteLine("OUTPUT=" + outputPath);
            foreach (Dictionary<string, object> variant in variants)
            {
                Console.WriteLine(String.Format(
                    CultureInfo.InvariantCulture,
                    "VARIANT={0}|classification={1}|complete={2}|oracle={3}",
                    variant["variant"], variant["classification"], variant["measurement_complete"], variant["native_oracle_read"]));
            }
            return complete ? 0 : 3;
        }
        catch (Exception exception)
        {
            payload["fatal_error"] = ExceptionEvidence(exception);
            WriteJson(outputPath, payload);
            Console.Error.WriteLine("ERROR=" + exception);
            Console.Error.WriteLine("OUTPUT=" + outputPath);
            return 1;
        }
        finally
        {
            ReleaseCom((object)application);
            OleMessageFilter.Revoke();
        }
    }

    private static Dictionary<string, object> RunVariant(
        dynamic application,
        string runDirectory,
        string variantName,
        bool useExcludeFromReports)
    {
        FixturePaths paths = NewFixturePaths(runDirectory, variantName);
        var evidence = new Dictionary<string, object>
        {
            { "variant", variantName },
            { "operation", useExcludeFromReports ? "SubOccurrence.ExcludeFromReports=true" : "SubOccurrence.ThisAsOccurrence.IncludeInBom=false" },
            { "directory", paths.Directory },
            { "isolated_directory", paths.Directory.StartsWith(runDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) },
            { "measurement_complete", false },
            { "native_oracle_read", false }
        };

        dynamic top = null;
        try
        {
            Checkpoint(evidence, paths, "creating_fixture");
            CreateFixture(application, paths);
            Checkpoint(evidence, paths, "fixture_created");
            top = OpenDocument(application, paths.TopAssembly);
            Checkpoint(evidence, paths, "top_opened_before_write");
            List<ChildState> before = ReadTargetStates(top, paths.PartB);
            evidence["before_write"] = before;
            RequireTwoCleanInstances(before);
            Checkpoint(evidence, paths, "baseline_read");

            bool immediate;
            string verifiedOwner = null;
            if (useExcludeFromReports)
            {
                dynamic firstRoot = top.Occurrences.Item(1);
                dynamic target = FindSubOccurrence(firstRoot, paths.PartB);
                target.ExcludeFromReports = true;
                immediate = (bool)target.ExcludeFromReports;
                evidence["immediate_readback_matched_write"] = immediate;
                Checkpoint(evidence, paths, "exclude_from_reports_written_live");
                top.Save();
                Checkpoint(evidence, paths, "top_saved_after_write");
            }
            else
            {
                dynamic firstRoot = top.Occurrences.Item(1);
                dynamic target = FindSubOccurrence(firstRoot, paths.PartB);
                dynamic definitionOccurrence = target.ThisAsOccurrence;
                dynamic ownerOccurrences = definitionOccurrence.Parent;
                dynamic ownerDocument = ownerOccurrences.Parent;
                verifiedOwner = Convert.ToString(ownerDocument.FullName, CultureInfo.InvariantCulture);
                if (!PathsEqual(verifiedOwner, paths.Subassembly))
                {
                    throw new InvalidOperationException(
                        "ThisAsOccurrence owner mismatch. Expected " + paths.Subassembly + " but got " + verifiedOwner + ".");
                }
                definitionOccurrence.IncludeInBom = false;
                immediate = !(bool)definitionOccurrence.IncludeInBom;
                evidence["immediate_readback_matched_write"] = immediate;
                Checkpoint(evidence, paths, "this_as_occurrence_written_live");
                ownerDocument.Save();
                Checkpoint(evidence, paths, "definition_owner_saved_after_write");
                top.Save();
                Checkpoint(evidence, paths, "top_saved_after_definition_write");
            }
            evidence["verified_definition_owner"] = verifiedOwner;
            evidence["immediate_readback_matched_write"] = immediate;
            if (!immediate)
            {
                evidence["immediate_readback_warning"] =
                    "The COM setter returned without an exception, but the property read back its original value. Save/reopen and the native PartsList are still measured.";
                Checkpoint(evidence, paths, "immediate_readback_mismatch_continuing");
            }

            CloseDocument(top, false);
            top = null;
            CloseDocumentByPath(application, paths.TopAssembly);
            CloseDocumentByPath(application, paths.Subassembly);

            top = OpenDocument(application, paths.TopAssembly);
            Checkpoint(evidence, paths, "top_reopened");
            List<ChildState> after = ReadTargetStates(top, paths.PartB);
            evidence["after_reopen"] = after;
            evidence["measurement_complete"] = after.Count == 2;
            evidence["classification"] = ClassifyStateOnly(after);
            Checkpoint(evidence, paths, "save_reopen_readback_complete");

            try
            {
                Checkpoint(evidence, paths, "native_atomic_parts_list_starting");
                PartsListEvidence partsList = CreateAtomicPartsList(application, paths, top);
                evidence["atomic_parts_list"] = partsList;
                evidence["native_oracle_read"] = partsList.is_up_to_date
                    && partsList.quantities.ContainsKey(Path.GetFileNameWithoutExtension(paths.PartA))
                    && partsList.quantities.ContainsKey(Path.GetFileNameWithoutExtension(paths.PartB));
                evidence["classification"] = Classify(after, partsList, paths.PartB, useExcludeFromReports);
                Checkpoint(evidence, paths, "native_atomic_parts_list_complete");
            }
            catch (Exception oracleException)
            {
                evidence["native_oracle_read"] = false;
                evidence["native_oracle_error"] = ExceptionEvidence(oracleException);
                Checkpoint(evidence, paths, "native_atomic_parts_list_failed");
            }
            return evidence;
        }
        catch (Exception exception)
        {
            evidence["classification"] = "probe_failed";
            evidence["error"] = ExceptionEvidence(exception);
            Checkpoint(evidence, paths, "variant_failed");
            return evidence;
        }
        finally
        {
            CloseDocument(top, false);
            ReleaseCom((object)top);
            Checkpoint(evidence, paths, "variant_finished");
        }
    }

    private static FixturePaths NewFixturePaths(string runDirectory, string variantName)
    {
        string token = Guid.NewGuid().ToString("N").Substring(0, 12).ToUpperInvariant();
        string prefix = "BOMSEM_" + token;
        string directory = Path.Combine(runDirectory, variantName + "_" + token);
        Directory.CreateDirectory(directory);
        return new FixturePaths
        {
            Directory = directory,
            Prefix = prefix,
            PartA = Path.Combine(directory, prefix + "_A.par"),
            PartB = Path.Combine(directory, prefix + "_B.par"),
            Subassembly = Path.Combine(directory, prefix + "_SUB.asm"),
            TopAssembly = Path.Combine(directory, prefix + "_TOP.asm"),
            Draft = Path.Combine(directory, prefix + "_ORACLE.dft")
        };
    }

    private static void CreateFixture(dynamic application, FixturePaths paths)
    {
        File.Copy(SourcePart, paths.PartA, false);
        File.Copy(SourcePart, paths.PartB, false);

        dynamic subassembly = null;
        dynamic topAssembly = null;
        try
        {
            subassembly = NewAssembly(application, paths.Subassembly);
            dynamic a = subassembly.Occurrences.AddByFilename(paths.PartA, Missing.Value);
            a.Name = paths.Prefix + "_A";
            a.IncludeInBom = true;
            dynamic b = subassembly.Occurrences.AddByFilename(paths.PartB, Missing.Value);
            b.Name = paths.Prefix + "_B";
            b.IncludeInBom = true;
            b.Move(0.55, 0.0, 0.0);
            subassembly.Save();
            CloseDocument(subassembly, false);
            subassembly = null;

            topAssembly = NewAssembly(application, paths.TopAssembly);
            dynamic first = topAssembly.Occurrences.AddByFilename(paths.Subassembly, Missing.Value);
            first.Name = paths.Prefix + "_S1";
            first.IncludeInBom = true;
            dynamic second = topAssembly.Occurrences.AddByFilename(paths.Subassembly, Missing.Value);
            second.Name = paths.Prefix + "_S2";
            second.IncludeInBom = true;
            second.Move(1.2, 0.0, 0.0);
            topAssembly.Save();
        }
        finally
        {
            CloseDocument(topAssembly, false);
            CloseDocument(subassembly, false);
            ReleaseCom((object)topAssembly);
            ReleaseCom((object)subassembly);
        }
        CloseDocumentByPath(application, paths.TopAssembly);
        CloseDocumentByPath(application, paths.Subassembly);
    }

    private static dynamic NewAssembly(dynamic application, string path)
    {
        dynamic document = application.Documents.Add("SolidEdge.AssemblyDocument", AssemblyTemplate);
        document.SaveAs(path, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
            Missing.Value, Missing.Value, Missing.Value, Missing.Value);
        return document;
    }

    private static dynamic OpenDocument(dynamic application, string path)
    {
        return application.Documents.Open(path);
    }

    private static List<ChildState> ReadTargetStates(dynamic top, string targetPartPath)
    {
        var states = new List<ChildState>();
        for (int index = 1; index <= (int)top.Occurrences.Count; index++)
        {
            dynamic rootOccurrence = top.Occurrences.Item(index);
            if (!(bool)rootOccurrence.Subassembly) continue;
            dynamic child = FindSubOccurrence(rootOccurrence, targetPartPath);
            dynamic definitionOccurrence = child.ThisAsOccurrence;
            states.Add(new ChildState
            {
                root_occurrence = Convert.ToString(rootOccurrence.Name, CultureInfo.InvariantCulture),
                child_name = Convert.ToString(child.Name, CultureInfo.InvariantCulture),
                child_file = Convert.ToString(child.SubOccurrenceFileName, CultureInfo.InvariantCulture),
                exclude_from_reports = (bool)child.ExcludeFromReports,
                this_as_occurrence_include_in_bom = (bool)definitionOccurrence.IncludeInBom,
                this_as_occurrence_reference_only = (bool)definitionOccurrence.ReferenceOnly,
                visible = (bool)child.Visible,
                definition_owner = TryDefinitionOwner(definitionOccurrence)
            });
        }
        return states;
    }

    private static dynamic FindSubOccurrence(dynamic rootOccurrence, string targetPartPath)
    {
        dynamic children = rootOccurrence.SubOccurrences;
        for (int index = 1; index <= (int)children.Count; index++)
        {
            dynamic child = children.Item(index);
            string path = Convert.ToString(child.SubOccurrenceFileName, CultureInfo.InvariantCulture);
            if (PathsEqual(path, targetPartPath)) return child;
        }
        throw new InvalidOperationException("Target SubOccurrence not found: " + targetPartPath);
    }

    private static string TryDefinitionOwner(dynamic definitionOccurrence)
    {
        try
        {
            dynamic ownerOccurrences = definitionOccurrence.Parent;
            dynamic ownerDocument = ownerOccurrences.Parent;
            return Convert.ToString(ownerDocument.FullName, CultureInfo.InvariantCulture);
        }
        catch (Exception exception)
        {
            return "unavailable:" + exception.GetType().Name + ":" + exception.Message;
        }
    }

    private static void RequireTwoCleanInstances(List<ChildState> states)
    {
        if (states.Count != 2) throw new InvalidOperationException("Expected two subassembly instances, got " + states.Count + ".");
        if (states.Any(state => state.exclude_from_reports || !state.this_as_occurrence_include_in_bom))
        {
            throw new InvalidOperationException("Fixture baseline is not clean before the write.");
        }
    }

    private static PartsListEvidence CreateAtomicPartsList(dynamic application, FixturePaths paths, dynamic top)
    {
        dynamic draft = null;
        try
        {
            draft = application.Documents.Add("SolidEdge.DraftDocument", DraftTemplate);
            dynamic modelLink = draft.ModelLinks.Add(paths.TopAssembly);
            dynamic sheet = draft.ActiveSheet;
            dynamic view = sheet.DrawingViews.AddAssemblyView(
                modelLink,
                ViewOrientationConstants.igFrontView,
                0.2,
                0.12,
                0.12,
                AssemblyDrawingViewTypeConstants.seAssemblyDesignedView,
                Missing.Value,
                Missing.Value,
                Missing.Value);
            view.Update();
            dynamic partsList = draft.PartsLists.Add(view, "", 0, 1);
            partsList.ListType = PartsListType.igAtomic;
            partsList.ShowTopAssembly = false;
            partsList.UseLevelBasedItemNumbers = false;
            partsList.Update();
            draft.SaveAs(paths.Draft, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
                Missing.Value, Missing.Value, Missing.Value, Missing.Value);
            draft.Save();

            var result = new PartsListEvidence
            {
                list_type = (int)partsList.ListType,
                list_type_name = Convert.ToString(partsList.ListType, CultureInfo.InvariantCulture),
                is_up_to_date = (bool)partsList.IsUpToDate,
                row_count = (int)partsList.Rows.Count,
                column_count = (int)partsList.Columns.Count
            };
            for (int columnIndex = 1; columnIndex <= result.column_count; columnIndex++)
            {
                dynamic column = partsList.Columns.Item(columnIndex);
                result.columns.Add(new Dictionary<string, object>
                {
                    { "index", columnIndex },
                    { "header", Convert.ToString(column.Header, CultureInfo.InvariantCulture) },
                    { "property_text", Convert.ToString(column.PropertyText, CultureInfo.InvariantCulture) },
                    { "show", (bool)column.Show }
                });
            }
            for (int rowIndex = 1; rowIndex <= result.row_count; rowIndex++)
            {
                var row = new List<string>();
                for (int columnIndex = 1; columnIndex <= result.column_count; columnIndex++)
                {
                    row.Add(Convert.ToString(partsList.Cell[rowIndex, columnIndex].value, CultureInfo.InvariantCulture));
                }
                result.rows.Add(row);
            }

            string partAName = Path.GetFileNameWithoutExtension(paths.PartA);
            string partBName = Path.GetFileNameWithoutExtension(paths.PartB);
            result.file_name_column = FindFileNameColumn(result.rows, partAName, partBName);
            result.quantity_column = FindQuantityColumn(result.columns);
            if (result.file_name_column <= 0 || result.quantity_column <= 0)
            {
                throw new InvalidOperationException("Could not identify file-name and quantity columns in the native PartsList.");
            }
            foreach (List<string> row in result.rows)
            {
                string fileName = row[result.file_name_column - 1];
                double quantity;
                if (!TryParseQuantity(row[result.quantity_column - 1], out quantity)) continue;
                result.quantities[fileName] = quantity;
            }
            return result;
        }
        finally
        {
            CloseDocument(draft, false);
            ReleaseCom((object)draft);
        }
    }

    private static int FindFileNameColumn(List<List<string>> rows, string partAName, string partBName)
    {
        if (rows.Count == 0) return 0;
        for (int columnIndex = 0; columnIndex < rows[0].Count; columnIndex++)
        {
            bool a = rows.Any(row => String.Equals(row[columnIndex], partAName, StringComparison.OrdinalIgnoreCase));
            bool b = rows.Any(row => String.Equals(row[columnIndex], partBName, StringComparison.OrdinalIgnoreCase));
            if (a && b) return columnIndex + 1;
        }
        return 0;
    }

    private static int FindQuantityColumn(List<Dictionary<string, object>> columns)
    {
        foreach (Dictionary<string, object> column in columns)
        {
            string text = (Convert.ToString(column["header"], CultureInfo.InvariantCulture) + " "
                + Convert.ToString(column["property_text"], CultureInfo.InvariantCulture)).ToLowerInvariant();
            if (text.Contains("menge") || text.Contains("quantity"))
            {
                return Convert.ToInt32(column["index"], CultureInfo.InvariantCulture);
            }
        }
        return 0;
    }

    private static bool TryParseQuantity(string value, out double quantity)
    {
        return Double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out quantity)
            || Double.TryParse(value, NumberStyles.Float, CultureInfo.CurrentCulture, out quantity);
    }

    private static string Classify(
        List<ChildState> states,
        PartsListEvidence partsList,
        string partBPath,
        bool useExcludeFromReports)
    {
        if (states.Count != 2) return "incomplete_readback";
        double quantity;
        string partBName = Path.GetFileNameWithoutExtension(partBPath);
        if (!partsList.quantities.TryGetValue(partBName, out quantity)) return "native_row_missing";
        bool firstExcluded = useExcludeFromReports
            ? states[0].exclude_from_reports
            : !states[0].this_as_occurrence_include_in_bom;
        bool secondExcluded = useExcludeFromReports
            ? states[1].exclude_from_reports
            : !states[1].this_as_occurrence_include_in_bom;
        if (firstExcluded && !secondExcluded && quantity == 1.0) return "persistent_per_instance";
        if (firstExcluded && secondExcluded && quantity == 0.0) return "persistent_definition_wide";
        if (!firstExcluded && !secondExcluded && quantity == 2.0) return "not_persisted";
        return "state_or_oracle_mismatch";
    }

    private static string ClassifyStateOnly(List<ChildState> states)
    {
        if (states.Count != 2) return "incomplete_readback";
        bool firstExcluded = states[0].exclude_from_reports || !states[0].this_as_occurrence_include_in_bom;
        bool secondExcluded = states[1].exclude_from_reports || !states[1].this_as_occurrence_include_in_bom;
        if (firstExcluded && !secondExcluded) return "persistent_per_instance_state_only";
        if (firstExcluded && secondExcluded) return "persistent_definition_wide_state_only";
        if (!firstExcluded && !secondExcluded) return "not_persisted_state_only";
        return "unexpected_second_instance_only_state";
    }

    private static void Checkpoint(
        Dictionary<string, object> evidence,
        FixturePaths paths,
        string stage)
    {
        try
        {
            evidence["last_stage"] = stage;
            evidence["last_stage_at_utc"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            WriteJson(Path.Combine(paths.Directory, "variant-evidence.json"), evidence);
            Console.WriteLine("STAGE=" + evidence["variant"] + "|" + stage);
        }
        catch (Exception checkpointException)
        {
            Console.Error.WriteLine("CHECKPOINT_ERROR=" + checkpointException.Message);
        }
    }

    private static Dictionary<string, object> TypeLibraryEvidence()
    {
        Type subOccurrence = typeof(SolidEdge.Assembly.Interop.SubOccurrence);
        Type occurrence = typeof(SolidEdge.Assembly.Interop.Occurrence);
        Type partsList = typeof(SolidEdge.Draft.Interop.PartsList);
        return new Dictionary<string, object>
        {
            { "assembly_interop_version", subOccurrence.Assembly.GetName().Version.ToString() },
            { "draft_interop_version", partsList.Assembly.GetName().Version.ToString() },
            { "SubOccurrence.ExcludeFromReports", PropertyEvidence(subOccurrence, "ExcludeFromReports") },
            { "SubOccurrence.ThisAsOccurrence", PropertyEvidence(subOccurrence, "ThisAsOccurrence") },
            { "Occurrence.IncludeInBom", PropertyEvidence(occurrence, "IncludeInBom") },
            { "PartsList.Cell", PropertyEvidence(partsList, "Cell") },
            { "PartsList.ListType", PropertyEvidence(partsList, "ListType") }
        };
    }

    private static Dictionary<string, object> PropertyEvidence(Type type, string name)
    {
        PropertyInfo property = type.GetProperty(name);
        return new Dictionary<string, object>
        {
            { "found", property != null },
            { "type", property == null ? null : property.PropertyType.FullName },
            { "read", property != null && property.CanRead },
            { "write", property != null && property.CanWrite }
        };
    }

    private static Dictionary<string, object> ExceptionEvidence(Exception exception)
    {
        return new Dictionary<string, object>
        {
            { "type", exception.GetType().FullName },
            { "hresult", "0x" + exception.HResult.ToString("X8", CultureInfo.InvariantCulture) },
            { "message", exception.Message },
            { "stack", exception.StackTrace }
        };
    }

    private static bool PathsEqual(string left, string right)
    {
        if (String.IsNullOrWhiteSpace(left) || String.IsNullOrWhiteSpace(right)) return false;
        return String.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
    }

    private static void CloseDocumentByPath(dynamic application, string path)
    {
        try
        {
            for (int index = (int)application.Documents.Count; index >= 1; index--)
            {
                dynamic document = application.Documents.Item(index);
                string fullName = null;
                try { fullName = Convert.ToString(document.FullName, CultureInfo.InvariantCulture); } catch { }
                if (PathsEqual(fullName, path))
                {
                    try { document.Close(false); } catch { }
                }
            }
        }
        catch { }
    }

    private static void CloseDocument(dynamic document, bool save)
    {
        if (Object.ReferenceEquals((object)document, null)) return;
        try { document.Close(save); } catch { }
    }

    private static bool GetBoolean(Dictionary<string, object> values, string key)
    {
        object value;
        return values.TryGetValue(key, out value) && Convert.ToBoolean(value, CultureInfo.InvariantCulture);
    }

    private static void WriteJson(string path, Dictionary<string, object> payload)
    {
        File.WriteAllText(path, Json.Serialize(payload), new UTF8Encoding(false));
    }

    private static void ReleaseCom(object value)
    {
        if (value == null || !Marshal.IsComObject(value)) return;
        try { Marshal.FinalReleaseComObject(value); } catch { }
    }

    [ComImport]
    [Guid("00000016-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IOleMessageFilter
    {
        [PreserveSig]
        int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo);

        [PreserveSig]
        int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType);

        [PreserveSig]
        int MessagePending(IntPtr taskCallee, int tickCount, int pendingType);
    }

    private sealed class OleMessageFilter : IOleMessageFilter
    {
        public static void Register()
        {
            IOleMessageFilter current = new OleMessageFilter();
            CoRegisterMessageFilter(current, out current);
        }

        public static void Revoke()
        {
            IOleMessageFilter current;
            CoRegisterMessageFilter(null, out current);
        }

        public int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo)
        {
            return 0;
        }

        public int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType)
        {
            return rejectType == 2 ? 100 : -1;
        }

        public int MessagePending(IntPtr taskCallee, int tickCount, int pendingType)
        {
            return 2;
        }

        [DllImport("Ole32.dll")]
        private static extern int CoRegisterMessageFilter(IOleMessageFilter newFilter, out IOleMessageFilter oldFilter);
    }
}
