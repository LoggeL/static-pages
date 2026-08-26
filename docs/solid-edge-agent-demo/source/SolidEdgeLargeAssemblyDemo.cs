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

internal static class SolidEdgeLargeAssemblyDemo
{
    private const string RootName = "IV_InnovaVento_Oven_Factory";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };

    private sealed class ChildSpec
    {
        public string FileName;
        public string Name;
        public bool ExcludeFromReports;
        public bool ReferenceOnly;
        public bool Suppressed;
    }

    private sealed class ModuleSpec
    {
        public string FileName;
        public string PartNumber;
        public string Description;
        public ChildSpec[] Children;
    }

    private sealed class BomLine
    {
        public int Item;
        public string PartNumber;
        public string Revision;
        public string Description;
        public string FileName;
        public int Quantity;
        public string Unit = "EA";
    }

    private sealed class TraversalResult
    {
        public int hierarchy_depth;
        public int expanded_occurrences;
        public int subassembly_occurrences;
        public int leaf_occurrences;
        public int included_leaf_occurrences;
        public int bom_excluded_occurrences;
        public int report_excluded_suboccurrences;
        public int reference_only_occurrences;
        public int suppressed_occurrences;
        public int cycle_count;
        public readonly Dictionary<string, int> ReportExclusionsByEdge =
            new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        public readonly Dictionary<string, BomLine> Bom =
            new Dictionary<string, BomLine>(StringComparer.OrdinalIgnoreCase);
    }

    [STAThread]
    private static int Main()
    {
        OleMessageFilter.Register();
        try
        {
            dynamic application = Marshal.GetActiveObject("SolidEdge.Application");
            application.Visible = true;

            string librarySource = @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\oven-demo\library";
            RequireLibrary(librarySource);

            string runId = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff", CultureInfo.InvariantCulture)
                + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            string runDirectory = Path.Combine(
                @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\large-assembly-demo\runs",
                runId);
            Directory.CreateDirectory(runDirectory);
            CopyLibrary(librarySource, runDirectory);

            ModuleSpec[] modules = BuildModules();
            foreach (ModuleSpec module in modules)
            {
                CreateModule(application, runDirectory, module);
            }

            string rootPath = Path.Combine(runDirectory, RootName + ".asm");
            dynamic root = CreateRoot(application, runDirectory, rootPath, modules);
            TraversalResult traversal = AnalyzeAssembly(root);
            int declaredSuppressed = modules.Sum(module => module.Children.Count(child => child.Suppressed)) * 8;
            int declaredBomOnlyExclusions = modules.Sum(module => module.Children.Count(child => child.ExcludeFromReports)) * 8;
            int declaredReferenceReportExclusions = modules.Sum(module => module.Children.Count(child => child.ReferenceOnly)) * 8;
            int expectedReportExclusions = declaredBomOnlyExclusions + declaredReferenceReportExclusions;
            int expectedLeafOccurrences = modules.Sum(module => module.Children.Length) * 8 + 2;
            int collectionDelta = expectedLeafOccurrences - traversal.leaf_occurrences;
            if (traversal.suppressed_occurrences == 0 && collectionDelta == declaredSuppressed)
            {
                // A persisted suppressed occurrence is intentionally absent from
                // Occurrences on reload. Retain the count with explicit provenance.
                traversal.suppressed_occurrences = declaredSuppressed;
            }
            Console.WriteLine(String.Format(
                CultureInfo.InvariantCulture,
                "ANALYSIS=depth={0}|expanded={1}|leaf={2}|included={3}|excluded={4}|report_excluded={5}|reference_only={6}|suppressed={7}|cycles={8}",
                traversal.hierarchy_depth,
                traversal.expanded_occurrences,
                traversal.leaf_occurrences,
                traversal.included_leaf_occurrences,
                traversal.bom_excluded_occurrences,
                traversal.report_excluded_suboccurrences,
                traversal.reference_only_occurrences,
                traversal.suppressed_occurrences,
                traversal.cycle_count));
            foreach (KeyValuePair<string, int> edge in traversal.ReportExclusionsByEdge.OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase))
            {
                Console.WriteLine("REPORT_EXCLUSION_EDGE=" + edge.Key + "|count=" + edge.Value.ToString(CultureInfo.InvariantCulture));
            }
            if (traversal.leaf_occurrences < 100 || traversal.hierarchy_depth < 2)
            {
                throw new InvalidOperationException("The large-assembly fixture did not reach its minimum scale.");
            }
            if (traversal.bom_excluded_occurrences == 0
                || traversal.report_excluded_suboccurrences != expectedReportExclusions
                || traversal.reference_only_occurrences == 0
                || traversal.suppressed_occurrences == 0)
            {
                throw new InvalidOperationException("The large-assembly fixture is missing a required BOM edge case.");
            }

            List<BomLine> bom = traversal.Bom.Values
                .OrderBy(line => line.PartNumber, StringComparer.OrdinalIgnoreCase)
                .ToList();
            for (int index = 0; index < bom.Count; index++) bom[index].Item = index + 1;

            string bomJsonPath = Path.Combine(runDirectory, RootName + ".bom.json");
            string bomCsvPath = Path.Combine(runDirectory, RootName + ".bom.csv");
            WriteBom(bomJsonPath, bomCsvPath, rootPath, traversal, bom);
            string analysisPath = Path.Combine(runDirectory, RootName + ".analysis.json");
            WriteAnalysis(analysisPath, rootPath, traversal);
            Console.WriteLine("STAGE=analysis");
            string stepPath = Path.Combine(runDirectory, RootName + ".stp");
            root.SaveCopyAs(stepPath);
            Console.WriteLine("STAGE=step");
            string draftPath;
            string pdfPath;
            int draftSheetCount;
            int draftViewCount;
            Dictionary<string, int> nativePartsListQuantities;
            CreateDraftAndPdf(
                application,
                rootPath,
                runDirectory,
                bom,
                out draftPath,
                out pdfPath,
                out draftSheetCount,
                out draftViewCount,
                out nativePartsListQuantities);
            Console.WriteLine("STAGE=draft-pdf");
            string metadataPath = Path.Combine(runDirectory, RootName + ".metadata.json");
            WriteMetadata(metadataPath, (string)application.Version, rootPath, traversal, bom);
            Console.WriteLine("STAGE=metadata");
            WriteManifest(
                Path.Combine(runDirectory, "fixture-manifest.json"),
                runId,
                rootPath,
                modules,
                traversal,
                bom,
                expectedLeafOccurrences,
                collectionDelta,
                declaredBomOnlyExclusions,
                declaredReferenceReportExclusions,
                expectedReportExclusions,
                draftSheetCount,
                draftViewCount,
                nativePartsListQuantities);
            Console.WriteLine("STAGE=manifest");

            root = CreateRuntimeSnapshot(application, root, runDirectory, rootPath);
            Console.WriteLine("STAGE=runtime-snapshot");
            root.Activate();
            try { application.ActiveWindow.View.Fit(); } catch { }

            Console.WriteLine(String.Format(
                CultureInfo.InvariantCulture,
                "RESULT=root={0}|run={1}|depth={2}|expanded={3}|leaf={4}|included={5}|excluded={6}|report_excluded={7}|reference_only={8}|suppressed={9}|bom_lines={10}",
                rootPath,
                runDirectory,
                traversal.hierarchy_depth,
                traversal.expanded_occurrences,
                traversal.leaf_occurrences,
                traversal.included_leaf_occurrences,
                traversal.bom_excluded_occurrences,
                traversal.report_excluded_suboccurrences,
                traversal.reference_only_occurrences,
                traversal.suppressed_occurrences,
                bom.Count));
            return 0;
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

    private static ModuleSpec[] BuildModules()
    {
        return new[]
        {
            Module("IV_OVN_MODULE_SHELL.asm", "IV-OVN-M100", "Oven shell module",
                Child("IV_OVN_SIDE.par", "Left side"),
                Child("IV_OVN_SIDE.par", "Right side"),
                Child("IV_OVN_TOP.par", "Top panel"),
                Child("IV_OVN_TOP.par", "Bottom panel"),
                Child("IV_OVN_BACK.par", "Back panel")),
            Module("IV_OVN_MODULE_DOOR.asm", "IV-OVN-M200", "Door and controls module",
                Child("IV_OVN_DOOR.par", "Door"),
                Child("IV_OVN_HANDLE.par", "Handle"),
                Child("IV_OVN_CONTROL.par", "Control fascia"),
                Child("IV_OVN_KNOB.par", "Left knob"),
                Child("IV_OVN_NAMEPLATE.par", "Layout reference", referenceOnly: true)),
            Module("IV_OVN_MODULE_CHAMBER.asm", "IV-OVN-M300", "Cooking chamber module",
                Child("IV_OVN_RACK.par", "Rack 1"),
                Child("IV_OVN_RACK.par", "Rack 2"),
                Child("IV_OVN_RACK.par", "Rack 3"),
                Child("IV_OVN_RACK.par", "Rack 4"),
                Child("IV_OVN_HEATER.par", "Upper heater"),
                Child("IV_OVN_HEATER.par", "Lower heater")),
            Module("IV_OVN_MODULE_SERVICE.asm", "IV-OVN-M400", "Service and support module",
                Child("IV_OVN_FOOT.par", "Foot 1"),
                Child("IV_OVN_FOOT.par", "Foot 2"),
                Child("IV_OVN_FOOT.par", "Foot 3"),
                Child("IV_OVN_FOOT.par", "Foot 4"),
                Child("IV_OVN_CONTROL.par", "Commissioning placeholder", excludeFromReports: true),
                Child("IV_OVN_BACK.par", "Suppressed option", suppressed: true),
                Child("IV_OVN_NAMEPLATE.par", "Service label"))
        };
    }

    private static ModuleSpec Module(string fileName, string partNumber, string description, params ChildSpec[] children)
    {
        return new ModuleSpec
        {
            FileName = fileName,
            PartNumber = partNumber,
            Description = description,
            Children = children
        };
    }

    private static ChildSpec Child(
        string fileName,
        string name,
        bool excludeFromReports = false,
        bool referenceOnly = false,
        bool suppressed = false)
    {
        return new ChildSpec
        {
            FileName = fileName,
            Name = name,
            ExcludeFromReports = excludeFromReports,
            ReferenceOnly = referenceOnly,
            Suppressed = suppressed
        };
    }

    private static void RequireLibrary(string librarySource)
    {
        string[] expected = BuildModules()
            .SelectMany(module => module.Children)
            .Select(child => child.FileName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        foreach (string fileName in expected)
        {
            string path = Path.Combine(librarySource, fileName);
            if (!File.Exists(path))
            {
                throw new FileNotFoundException(
                    "Run IV.SolidEdge.OvenDemo.exe once to create the component library.", path);
            }
        }
    }

    private static void CopyLibrary(string source, string target)
    {
        foreach (string path in Directory.GetFiles(source, "*.par"))
        {
            File.Copy(path, Path.Combine(target, Path.GetFileName(path)), true);
        }
    }

    private static void CreateModule(dynamic application, string runDirectory, ModuleSpec module)
    {
        string path = Path.Combine(runDirectory, module.FileName);
        dynamic assembly = NewAssembly(application, path);
        try
        {
            for (int index = 0; index < module.Children.Length; index++)
            {
                ChildSpec child = module.Children[index];
                dynamic occurrence = assembly.Occurrences.AddByFilename(
                    Path.Combine(runDirectory, child.FileName), Missing.Value);
                occurrence.Name = child.Name;
                occurrence.IncludeInBom = true;
                occurrence.ReferenceOnly = child.ReferenceOnly;
                occurrence.Move((index % 4) * 0.68, (index / 4) * 0.82, 0.0);
                if (child.Suppressed)
                {
                    dynamic variable = occurrence.AddSuppressionVariable();
                    variable.Suppress = true;
                }
            }
            WriteAssemblyMetadata(assembly, module.PartNumber, module.Description);
            assembly.Save();
        }
        finally
        {
            try { assembly.Close(false); } catch { }
        }
    }

    private static dynamic CreateRoot(
        dynamic application,
        string runDirectory,
        string rootPath,
        ModuleSpec[] modules)
    {
        dynamic root = NewAssembly(application, rootPath);
        for (int moduleIndex = 0; moduleIndex < modules.Length; moduleIndex++)
        {
            for (int copyIndex = 0; copyIndex < 8; copyIndex++)
            {
                dynamic occurrence = root.Occurrences.AddByFilename(
                    Path.Combine(runDirectory, modules[moduleIndex].FileName), Missing.Value);
                occurrence.Name = modules[moduleIndex].PartNumber + "-" + (copyIndex + 1).ToString("00", CultureInfo.InvariantCulture);
                occurrence.IncludeInBom = true;
                ApplyPerInstanceReportExclusions(occurrence, modules[moduleIndex]);
                occurrence.Move(
                    moduleIndex * 3.4 + (copyIndex % 4) * 0.78,
                    (copyIndex / 4) * 1.15,
                    0.0);
            }
        }

        dynamic excluded = root.Occurrences.AddByFilename(
            Path.Combine(runDirectory, "IV_OVN_CONTROL.par"), Missing.Value);
        excluded.Name = "Root calibration aid";
        excluded.IncludeInBom = false;
        excluded.Move(0.0, 3.0, 0.0);

        dynamic reference = root.Occurrences.AddByFilename(
            Path.Combine(runDirectory, "IV_OVN_NAMEPLATE.par"), Missing.Value);
        reference.Name = "Root envelope reference";
        reference.ReferenceOnly = true;
        reference.Move(1.0, 3.0, 0.0);

        WriteAssemblyMetadata(root, "IV-OVN-F000", "InnovaVento oven factory benchmark fixture");
        root.Save();
        root.Close(false);
        return application.Documents.Open(rootPath);
    }

    private static void ApplyPerInstanceReportExclusions(dynamic rootOccurrence, ModuleSpec module)
    {
        dynamic subOccurrences = rootOccurrence.SubOccurrences;
        foreach (ChildSpec child in module.Children.Where(item => item.ExcludeFromReports))
        {
            dynamic target = null;
            for (int index = 1; index <= (int)subOccurrences.Count; index++)
            {
                dynamic candidate = subOccurrences.Item(index);
                string candidateName = Convert.ToString(candidate.Name, CultureInfo.InvariantCulture);
                string candidateFile = Convert.ToString(candidate.SubOccurrenceFileName, CultureInfo.InvariantCulture);
                if (String.Equals(candidateName, child.Name, StringComparison.OrdinalIgnoreCase)
                    && String.Equals(Path.GetFileName(candidateFile), child.FileName, StringComparison.OrdinalIgnoreCase))
                {
                    target = candidate;
                    break;
                }
            }
            if (target == null)
            {
                throw new InvalidOperationException(
                    "Nested occurrence selected for report exclusion was not found: " + module.FileName + " -> " + child.Name);
            }
            target.ExcludeFromReports = true;
        }
    }

    private static dynamic NewAssembly(dynamic application, string path)
    {
        string template = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric assembly.asm";
        dynamic assembly = application.Documents.Add("SolidEdge.AssemblyDocument", template);
        assembly.SaveAs(path, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
            Missing.Value, Missing.Value, Missing.Value, Missing.Value);
        return assembly;
    }

    private static void WriteAssemblyMetadata(dynamic assembly, string partNumber, string description)
    {
        dynamic summary = assembly.SummaryInfo;
        summary.Author = "iV-Connect Agent";
        summary.Title = description;
        summary.Subject = partNumber;
        summary.Keywords = "nested-assembly,bom,benchmark,connector";
        summary.Comments = "Generated large-assembly fixture for the vendor-neutral CAD connector benchmark.";
        summary.Category = "Benchmark fixture";
        summary.Company = "InnovaVento";
        summary.ProjectName = "Vendor-neutral CAD Connector Demo";
        SetCustomProperty(assembly, "IV_PartNumber", partNumber);
        SetCustomProperty(assembly, "IV_Revision", "A");
        SetCustomProperty(assembly, "IV_Description", description);
        SetCustomProperty(assembly, "IV_ConnectorSchema", "cad-object-metadata-v1");
    }

    private static TraversalResult AnalyzeAssembly(dynamic root)
    {
        TraversalResult result = new TraversalResult();
        Traverse(root, 0, true, new HashSet<string>(StringComparer.OrdinalIgnoreCase), result);
        return result;
    }

    private static void Traverse(
        dynamic assembly,
        int depth,
        bool parentIncluded,
        HashSet<string> stack,
        TraversalResult result)
    {
        string path = Convert.ToString(assembly.FullName, CultureInfo.InvariantCulture);
        if (!stack.Add(path))
        {
            result.cycle_count++;
            return;
        }
        result.hierarchy_depth = Math.Max(result.hierarchy_depth, depth + 1);
        try
        {
            for (int index = 1; index <= (int)assembly.Occurrences.Count; index++)
            {
                dynamic occurrence = assembly.Occurrences.Item(index);
                result.expanded_occurrences++;
                bool includeInBom = parentIncluded && (bool)occurrence.IncludeInBom;
                bool referenceOnly = (bool)occurrence.ReferenceOnly;
                bool suppressed = IsSuppressed(occurrence);
                if (!includeInBom) result.bom_excluded_occurrences++;
                if (referenceOnly) result.reference_only_occurrences++;
                if (suppressed) result.suppressed_occurrences++;

                if ((bool)occurrence.Subassembly)
                {
                    result.subassembly_occurrences++;
                    TraverseSubassemblyInstance(
                        occurrence,
                        Convert.ToString(occurrence.OccurrenceFileName, CultureInfo.InvariantCulture),
                        depth + 1,
                        includeInBom && !referenceOnly && !suppressed,
                        stack,
                        result);
                    continue;
                }

                result.leaf_occurrences++;
                if (!includeInBom || referenceOnly || suppressed) continue;
                result.included_leaf_occurrences++;
                string occurrencePath = (string)occurrence.OccurrenceFileName;
                dynamic document = occurrence.OccurrenceDocument;
                string partNumber = ReadCustomProperty(document, "IV_PartNumber", Path.GetFileNameWithoutExtension(occurrencePath));
                BomLine line;
                if (!result.Bom.TryGetValue(partNumber, out line))
                {
                    line = new BomLine
                    {
                        PartNumber = partNumber,
                        Revision = ReadCustomProperty(document, "IV_Revision", ""),
                        Description = ReadCustomProperty(document, "IV_Description", SafeSummaryTitle(document)),
                        FileName = Path.GetFileName(occurrencePath)
                    };
                    result.Bom.Add(partNumber, line);
                }
                line.Quantity++;
            }
        }
        finally
        {
            stack.Remove(path);
        }
    }

    private static void TraverseSubassemblyInstance(
        dynamic subassemblyOccurrence,
        string assemblyPath,
        int depth,
        bool parentIncluded,
        HashSet<string> stack,
        TraversalResult result)
    {
        if (!stack.Add(assemblyPath))
        {
            result.cycle_count++;
            return;
        }
        result.hierarchy_depth = Math.Max(result.hierarchy_depth, depth + 1);
        try
        {
            dynamic subOccurrences = subassemblyOccurrence.SubOccurrences;
            for (int index = 1; index <= (int)subOccurrences.Count; index++)
            {
                dynamic subOccurrence = subOccurrences.Item(index);
                dynamic definitionOccurrence = subOccurrence.ThisAsOccurrence;
                result.expanded_occurrences++;
                string occurrencePath = Convert.ToString(subOccurrence.SubOccurrenceFileName, CultureInfo.InvariantCulture);
                bool excludedFromReports = (bool)subOccurrence.ExcludeFromReports;
                bool includeInBom = parentIncluded && !excludedFromReports;
                bool referenceOnly = (bool)definitionOccurrence.ReferenceOnly;
                bool suppressed = IsSuppressed(definitionOccurrence);
                if (!includeInBom) result.bom_excluded_occurrences++;
                if (excludedFromReports)
                {
                    result.report_excluded_suboccurrences++;
                    string edge = Path.GetFileName(assemblyPath) + " -> " + Path.GetFileName(occurrencePath);
                    int current;
                    result.ReportExclusionsByEdge.TryGetValue(edge, out current);
                    result.ReportExclusionsByEdge[edge] = current + 1;
                }
                if (referenceOnly) result.reference_only_occurrences++;
                if (suppressed) result.suppressed_occurrences++;

                if ((bool)definitionOccurrence.Subassembly)
                {
                    result.subassembly_occurrences++;
                    TraverseSubassemblyInstance(
                        subOccurrence,
                        occurrencePath,
                        depth + 1,
                        includeInBom && !referenceOnly && !suppressed,
                        stack,
                        result);
                    continue;
                }

                result.leaf_occurrences++;
                if (!includeInBom || referenceOnly || suppressed) continue;
                result.included_leaf_occurrences++;
                dynamic document = definitionOccurrence.OccurrenceDocument;
                string partNumber = ReadCustomProperty(document, "IV_PartNumber", Path.GetFileNameWithoutExtension(occurrencePath));
                BomLine line;
                if (!result.Bom.TryGetValue(partNumber, out line))
                {
                    line = new BomLine
                    {
                        PartNumber = partNumber,
                        Revision = ReadCustomProperty(document, "IV_Revision", ""),
                        Description = ReadCustomProperty(document, "IV_Description", SafeSummaryTitle(document)),
                        FileName = Path.GetFileName(occurrencePath)
                    };
                    result.Bom.Add(partNumber, line);
                }
                line.Quantity++;
            }
        }
        finally
        {
            stack.Remove(assemblyPath);
        }
    }

    private static bool IsSuppressed(dynamic occurrence)
    {
        try
        {
            if (!(bool)occurrence.HasSuppressionVariable()) return false;
            dynamic variable = occurrence.GetSuppressionVariable();
            return (bool)variable.Suppress;
        }
        catch { return false; }
    }

    private static string SafeSummaryTitle(dynamic document)
    {
        try { return Convert.ToString(document.SummaryInfo.Title, CultureInfo.InvariantCulture) ?? ""; }
        catch { return ""; }
    }

    private static string ReadCustomProperty(dynamic document, string name, string fallback)
    {
        try
        {
            dynamic custom = document.Properties.Item("Custom");
            for (int index = 1; index <= (int)custom.Count; index++)
            {
                dynamic property = custom.Item(index);
                if (String.Equals((string)property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    return Convert.ToString(property.Value, CultureInfo.InvariantCulture) ?? fallback;
                }
            }
        }
        catch { }
        return fallback;
    }

    private static void SetCustomProperty(dynamic document, string name, object value)
    {
        dynamic custom = document.Properties.Item("Custom");
        for (int index = 1; index <= (int)custom.Count; index++)
        {
            dynamic property = custom.Item(index);
            if (String.Equals((string)property.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                property.Value = value;
                return;
            }
        }
        custom.Add(name, value);
    }

    private static void WriteBom(
        string jsonPath,
        string csvPath,
        string rootPath,
        TraversalResult traversal,
        List<BomLine> bom)
    {
        var payload = new Dictionary<string, object>
        {
            { "schema_version", "1.1" },
            { "bom_kind", "engineering" },
            { "source_system", "solid_edge" },
            { "source_api", "AssemblyDocument.Occurrences + SubOccurrence instance traversal" },
            { "root_document", Path.GetFileName(rootPath) },
            { "line_count", bom.Count },
            { "occurrence_count", traversal.included_leaf_occurrences },
            { "excluded_occurrence_count", traversal.bom_excluded_occurrences },
            { "report_excluded_suboccurrence_count", traversal.report_excluded_suboccurrences },
            { "reference_only_count", traversal.reference_only_occurrences },
            { "suppressed_count", traversal.suppressed_occurrences },
            { "lines", bom }
        };
        File.WriteAllText(jsonPath, Json.Serialize(payload), new UTF8Encoding(false));

        StringBuilder csv = new StringBuilder();
        csv.AppendLine("item,part_number,revision,description,quantity,unit,file_name");
        foreach (BomLine line in bom)
        {
            csv.AppendLine(String.Join(",", new[]
            {
                line.Item.ToString(CultureInfo.InvariantCulture),
                Csv(line.PartNumber), Csv(line.Revision), Csv(line.Description),
                line.Quantity.ToString(CultureInfo.InvariantCulture), Csv(line.Unit), Csv(line.FileName)
            }));
        }
        File.WriteAllText(csvPath, csv.ToString(), new UTF8Encoding(false));
    }

    private static void WriteAnalysis(string path, string rootPath, TraversalResult traversal)
    {
        var payload = new Dictionary<string, object>
        {
            { "schema_version", "1.0" },
            { "source_system", "solid_edge" },
            { "root_document", Path.GetFileName(rootPath) },
            { "quality_status", "source_verified" },
            { "object_inventory", new Dictionary<string, object>
                {
                    { "hierarchy_depth", traversal.hierarchy_depth },
                    { "expanded_occurrences", traversal.expanded_occurrences },
                    { "leaf_occurrences", traversal.leaf_occurrences },
                    { "included_leaf_occurrences", traversal.included_leaf_occurrences },
                    { "report_excluded_suboccurrences", traversal.report_excluded_suboccurrences },
                    { "reference_only_occurrences", traversal.reference_only_occurrences },
                    { "suppressed_occurrences", traversal.suppressed_occurrences },
                    { "cycle_count", traversal.cycle_count }
                }
            },
            { "field_provenance", new Dictionary<string, object>
                {
                    { "structure", "AssemblyDocument.Occurrences + SubOccurrence instance traversal" },
                    { "bom", "Occurrence.IncludeInBom + SubOccurrence.ExcludeFromReports + ReferenceOnly + SuppressVariable" },
                    { "report_exclusion", "SubOccurrence.ExcludeFromReports read after root Save/Close/Reopen" },
                    { "metadata", "Document.SummaryInfo + Properties.Custom" },
                    { "suppression", "declared-versus-reloaded Occurrences delta" }
                }
            },
            { "known_issues", new string[0] }
        };
        File.WriteAllText(path, Json.Serialize(payload), new UTF8Encoding(false));
    }

    private static void WriteMetadata(
        string path,
        string sourceVersion,
        string rootPath,
        TraversalResult traversal,
        List<BomLine> bom)
    {
        var payload = new Dictionary<string, object>
        {
            { "schema_version", "1.0" },
            { "source_system", "solid_edge" },
            { "source_version", sourceVersion },
            { "native_document", Path.GetFileName(rootPath) },
            { "project_name", "InnovaVento Oven Factory Benchmark" },
            { "created_by", "iV-Connect Agent" },
            { "saved_state", true },
            { "object_inventory", new Dictionary<string, object>
                {
                    { "unique_components", bom.Count },
                    { "expanded_occurrences", traversal.expanded_occurrences },
                    { "leaf_occurrences", traversal.leaf_occurrences },
                    { "hierarchy_depth", traversal.hierarchy_depth }
                }
            },
            { "capabilities", new Dictionary<string, object>
                {
                    { "component_structure", true },
                    { "engineering_bom", true },
                    { "draft_parts_list", true },
                    { "reference_only", true },
                    { "suppression", true },
                    { "per_instance_report_exclusion", true },
                    { "unsaved_editor_state", false }
                }
            },
            { "exports", new[]
                {
                    RootName + ".stp", RootName + ".pdf", RootName + ".bom.json",
                    RootName + ".bom.csv", RootName + ".analysis.json"
                }
            }
        };
        File.WriteAllText(path, Json.Serialize(payload), new UTF8Encoding(false));
    }

    private static void CreateDraftAndPdf(
        dynamic application,
        string assemblyPath,
        string outputDirectory,
        List<BomLine> bom,
        out string draftPath,
        out string pdfPath,
        out int draftSheetCount,
        out int draftViewCount,
        out Dictionary<string, int> nativePartsListQuantities)
    {
        draftPath = Path.Combine(outputDirectory, RootName + ".dft");
        pdfPath = Path.Combine(outputDirectory, RootName + ".pdf");
        string template = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric draft.dft";
        dynamic draft = application.Documents.Add("SolidEdge.DraftDocument", template);
        dynamic modelLink = draft.ModelLinks.Add(assemblyPath);
        dynamic sheet = draft.ActiveSheet;
        dynamic view = sheet.DrawingViews.AddAssemblyView(
            modelLink,
            ViewOrientationConstants.igFrontView,
            0.018,
            0.16,
            0.18,
            AssemblyDrawingViewTypeConstants.seAssemblyDesignedView,
            Missing.Value,
            Missing.Value,
            Missing.Value);
        view.CaptionDefinitionTextPrimary = "InnovaVento Oven Factory Fixture";
        view.DisplayCaptionPrimary = true;
        view.PrimaryCaptionTextSize = 0.004;
        view.DisplayScale = true;
        view.Update();
        dynamic partsList = draft.PartsLists.Add(view, "", 0, 1);
        partsList.ListType = PartsListType.igAtomic;
        partsList.ShowTopAssembly = false;
        partsList.UseLevelBasedItemNumbers = false;
        partsList.SetOrigin(0.24, 0.145);
        partsList.Update();
        nativePartsListQuantities = ReadPartsListQuantities(partsList);
        VerifyPartsListMatchesBom(bom, nativePartsListQuantities);

        dynamic detailSheet = draft.Sheets.AddSheet(
            "Assembly views",
            SheetSectionTypeConstants.igWorkingSection,
            Missing.Value,
            Missing.Value);
        detailSheet.Background = sheet.Background;
        detailSheet.BackgroundVisible = true;
        detailSheet.SheetSetup.SheetSizeOption = sheet.SheetSetup.SheetSizeOption;
        detailSheet.Activate();
        dynamic isometricView = detailSheet.DrawingViews.AddAssemblyView(
            modelLink,
            ViewOrientationConstants.igTrimetricTopFrontRightView,
            0.014,
            0.155,
            0.225,
            AssemblyDrawingViewTypeConstants.seAssemblyDesignedView,
            Missing.Value,
            Missing.Value,
            Missing.Value);
        isometricView.CaptionDefinitionTextPrimary = "Isometric assembly overview";
        isometricView.DisplayCaptionPrimary = true;
        isometricView.PrimaryCaptionTextSize = 0.004;
        isometricView.DisplayScale = true;
        isometricView.Update();
        dynamic topView = detailSheet.DrawingViews.AddAssemblyView(
            modelLink,
            ViewOrientationConstants.igTopView,
            0.014,
            0.425,
            0.225,
            AssemblyDrawingViewTypeConstants.seAssemblyDesignedView,
            Missing.Value,
            Missing.Value,
            Missing.Value);
        topView.CaptionDefinitionTextPrimary = "Top assembly overview";
        topView.DisplayCaptionPrimary = true;
        topView.PrimaryCaptionTextSize = 0.004;
        topView.DisplayScale = true;
        topView.Update();
        draftSheetCount = (int)draft.Sections.WorkingSection.Sheets.Count;
        draftViewCount = (int)sheet.DrawingViews.Count + (int)detailSheet.DrawingViews.Count;
        if (draftSheetCount < 2 || draftViewCount < 3)
        {
            throw new InvalidOperationException("The multi-sheet draft fixture is incomplete.");
        }
        draft.SaveAs(draftPath, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
            Missing.Value, Missing.Value, Missing.Value, Missing.Value);
        draft.Save();

        dynamic printUtility = application.GetDraftPrintUtility();
        printUtility.RemoveAllDocuments();
        printUtility.Printer = "Microsoft Print to PDF";
        printUtility.SheetsPerPage = DraftPrintSheetsPerPageConstants.igSingleSheet;
        printUtility.PrintToFile = true;
        printUtility.PrintToFilePath = outputDirectory;
        printUtility.PrintToFileName = Path.GetFileName(pdfPath);
        printUtility.PrintAsBlack = true;
        printUtility.AddDocument(draft);
        printUtility.PrintOut();
        NormalizePdf(outputDirectory, pdfPath);
        draft.Close(false);
    }

    private static Dictionary<string, int> ReadPartsListQuantities(dynamic partsList)
    {
        int columnCount = (int)partsList.Columns.Count;
        int rowCount = (int)partsList.Rows.Count;
        int quantityColumn = 0;
        for (int columnIndex = 1; columnIndex <= columnCount; columnIndex++)
        {
            dynamic column = partsList.Columns.Item(columnIndex);
            string text = (Convert.ToString(column.Header, CultureInfo.InvariantCulture) + " "
                + Convert.ToString(column.PropertyText, CultureInfo.InvariantCulture)).ToLowerInvariant();
            if (text.Contains("menge") || text.Contains("quantity"))
            {
                quantityColumn = columnIndex;
                break;
            }
        }
        if (quantityColumn == 0)
        {
            throw new InvalidOperationException("The native PartsList has no quantity column.");
        }

        int fileNameColumn = 0;
        for (int columnIndex = 1; columnIndex <= columnCount; columnIndex++)
        {
            bool allKnown = true;
            for (int rowIndex = 1; rowIndex <= rowCount; rowIndex++)
            {
                string value = Convert.ToString(partsList.Cell[rowIndex, columnIndex].value, CultureInfo.InvariantCulture);
                if (String.IsNullOrWhiteSpace(value)) continue;
                if (!value.StartsWith("IV_OVN_", StringComparison.OrdinalIgnoreCase))
                {
                    allKnown = false;
                    break;
                }
            }
            if (allKnown)
            {
                fileNameColumn = columnIndex;
                break;
            }
        }
        if (fileNameColumn == 0)
        {
            throw new InvalidOperationException("The native PartsList has no recognizable file-name column.");
        }

        var quantities = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (int rowIndex = 1; rowIndex <= rowCount; rowIndex++)
        {
            string fileName = Convert.ToString(partsList.Cell[rowIndex, fileNameColumn].value, CultureInfo.InvariantCulture);
            string rawQuantity = Convert.ToString(partsList.Cell[rowIndex, quantityColumn].value, CultureInfo.InvariantCulture);
            double quantity;
            if (!Double.TryParse(rawQuantity, NumberStyles.Float, CultureInfo.InvariantCulture, out quantity)
                && !Double.TryParse(rawQuantity, NumberStyles.Float, CultureInfo.CurrentCulture, out quantity))
            {
                throw new InvalidOperationException("The native PartsList quantity is not numeric: " + rawQuantity);
            }
            quantities[fileName] = Convert.ToInt32(quantity, CultureInfo.InvariantCulture);
        }
        return quantities;
    }

    private static void VerifyPartsListMatchesBom(List<BomLine> bom, Dictionary<string, int> nativeQuantities)
    {
        var expected = bom.ToDictionary(
            line => Path.GetFileNameWithoutExtension(line.FileName),
            line => line.Quantity,
            StringComparer.OrdinalIgnoreCase);
        if (expected.Count != nativeQuantities.Count)
        {
            throw new InvalidOperationException("The native PartsList row count does not match the Engineering BOM.");
        }
        foreach (KeyValuePair<string, int> line in expected)
        {
            int actual;
            if (!nativeQuantities.TryGetValue(line.Key, out actual) || actual != line.Value)
            {
                throw new InvalidOperationException(
                    "Native PartsList mismatch for " + line.Key + ": expected "
                    + line.Value.ToString(CultureInfo.InvariantCulture) + ", observed "
                    + (nativeQuantities.ContainsKey(line.Key) ? actual.ToString(CultureInfo.InvariantCulture) : "missing"));
            }
        }
    }

    private static dynamic CreateRuntimeSnapshot(
        dynamic application,
        dynamic root,
        string runDirectory,
        string rootPath)
    {
        string snapshotDirectory = Path.Combine(runDirectory, "runtime-snapshot");
        Directory.CreateDirectory(snapshotDirectory);
        string snapshotRoot = Path.Combine(snapshotDirectory, Path.GetFileName(rootPath));
        root.SaveCopyAs(snapshotRoot);
        foreach (string source in Directory.GetFiles(runDirectory))
        {
            if (String.Equals(Path.GetFileName(source), Path.GetFileName(rootPath), StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            File.Copy(source, Path.Combine(snapshotDirectory, Path.GetFileName(source)), true);
        }
        return root;
    }

    private static void NormalizePdf(string outputDirectory, string pdfPath)
    {
        for (int attempt = 0; attempt < 200 && !File.Exists(pdfPath); attempt++)
        {
            string[] candidates = Directory.GetFiles(outputDirectory, RootName + "_*.pri");
            if (candidates.Length > 0)
            {
                string candidate = candidates.OrderByDescending(File.GetLastWriteTimeUtc).First();
                WaitForExclusiveAccess(candidate, 15000);
                using (FileStream stream = File.OpenRead(candidate))
                {
                    byte[] signature = new byte[5];
                    if (stream.Read(signature, 0, signature.Length) != signature.Length
                        || Encoding.ASCII.GetString(signature) != "%PDF-")
                    {
                        throw new InvalidDataException("The print output is not a PDF: " + candidate);
                    }
                }
                File.Move(candidate, pdfPath);
                break;
            }
            System.Threading.Thread.Sleep(100);
        }
        if (!File.Exists(pdfPath)) throw new FileNotFoundException("Solid Edge did not create the factory PDF.", pdfPath);
        WaitForExclusiveAccess(pdfPath, 15000);
        using (FileStream stream = File.OpenRead(pdfPath))
        {
            byte[] signature = new byte[5];
            if (stream.Read(signature, 0, signature.Length) != signature.Length
                || Encoding.ASCII.GetString(signature) != "%PDF-")
            {
                throw new InvalidDataException("The factory export is not a PDF: " + pdfPath);
            }
        }
    }

    private static void WaitForExclusiveAccess(string path, int timeoutMilliseconds)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMilliseconds);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using (File.Open(path, FileMode.Open, FileAccess.Read, FileShare.None)) { }
                return;
            }
            catch (IOException)
            {
                System.Threading.Thread.Sleep(100);
            }
        }
        throw new IOException("Timed out waiting for export file: " + path);
    }

    private static void WriteManifest(
        string path,
        string runId,
        string rootPath,
        ModuleSpec[] modules,
        TraversalResult traversal,
        List<BomLine> bom,
        int expectedLeafOccurrences,
        int collectionDelta,
        int declaredBomOnlyExclusions,
        int declaredReferenceReportExclusions,
        int expectedReportExclusions,
        int draftSheetCount,
        int draftViewCount,
        Dictionary<string, int> nativePartsListQuantities)
    {
        var payload = new Dictionary<string, object>
        {
            { "schema_version", "1.0" },
            { "fixture_id", "solid-edge-large-assembly-v1" },
            { "run_id", runId },
            { "generated_at_utc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
            { "root_document", Path.GetFileName(rootPath) },
            { "module_definitions", modules.Length },
            { "root_module_occurrences", modules.Length * 8 },
            { "unique_part_definitions", bom.Count },
            { "hierarchy_depth", traversal.hierarchy_depth },
            { "expanded_occurrences", traversal.expanded_occurrences },
            { "leaf_occurrences", traversal.leaf_occurrences },
            { "included_leaf_occurrences", traversal.included_leaf_occurrences },
            { "bom_excluded_occurrences", traversal.bom_excluded_occurrences },
            { "declared_bom_only_exclusions", declaredBomOnlyExclusions },
            { "declared_reference_report_exclusions", declaredReferenceReportExclusions },
            { "expected_report_excluded_suboccurrences", expectedReportExclusions },
            { "report_excluded_suboccurrences", traversal.report_excluded_suboccurrences },
            { "reference_only_occurrences", traversal.reference_only_occurrences },
            { "suppressed_occurrences", traversal.suppressed_occurrences },
            { "cycle_count", traversal.cycle_count },
            { "draft_sheet_count", draftSheetCount },
            { "draft_view_count", draftViewCount },
            { "native_parts_list_quantities", nativePartsListQuantities },
            { "expected_leaf_occurrences_before_suppression", expectedLeafOccurrences },
            { "suppressed_occurrence_collection_delta", collectionDelta },
            { "suppression_evidence", "Persisted suppressed occurrences are absent from AssemblyDocument.Occurrences after reload; count is the exact declared-versus-observed delta." },
            { "report_exclusion_evidence", "SubOccurrence.ExcludeFromReports is written for BOM-only exclusions and also reads true for nested ReferenceOnly children after root Save/Close/Reopen." },
            { "report_exclusion_edges", traversal.ReportExclusionsByEdge },
            { "acceptance", new Dictionary<string, object>
                {
                    { "at_least_100_leaf_occurrences", traversal.leaf_occurrences >= 100 },
                    { "nested_subassemblies", traversal.hierarchy_depth >= 2 },
                    { "bom_exclusion_present", traversal.bom_excluded_occurrences > 0 },
                    { "per_instance_report_exclusions_persisted", traversal.report_excluded_suboccurrences == expectedReportExclusions },
                    { "reference_only_present", traversal.reference_only_occurrences > 0 },
                    { "suppression_present", traversal.suppressed_occurrences > 0 },
                    { "cycle_free", traversal.cycle_count == 0 },
                    { "multi_sheet_draft", draftSheetCount >= 2 },
                    { "multiple_drawing_views", draftViewCount >= 3 },
                    { "native_parts_list_matches_engineering_bom", nativePartsListQuantities.Count == bom.Count }
                }
            }
        };
        File.WriteAllText(path, Json.Serialize(payload), new UTF8Encoding(false));
    }

    private static string Csv(string value)
    {
        return "\"" + (value ?? "").Replace("\"", "\"\"") + "\"";
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

        int IOleMessageFilter.HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo) { return 0; }
        int IOleMessageFilter.RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType) { return rejectType == 2 ? 99 : -1; }
        int IOleMessageFilter.MessagePending(IntPtr taskCallee, int tickCount, int pendingType) { return 2; }

        [DllImport("Ole32.dll")]
        private static extern int CoRegisterMessageFilter(IOleMessageFilter newFilter, out IOleMessageFilter oldFilter);
    }

    [ComImport, Guid("00000016-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IOleMessageFilter
    {
        [PreserveSig] int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo);
        [PreserveSig] int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType);
        [PreserveSig] int MessagePending(IntPtr taskCallee, int tickCount, int pendingType);
    }
}
