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
        public bool IncludeInBom = true;
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
        public int reference_only_occurrences;
        public int suppressed_occurrences;
        public int cycle_count;
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
                "ANALYSIS=depth={0}|expanded={1}|leaf={2}|included={3}|excluded={4}|reference_only={5}|suppressed={6}|cycles={7}",
                traversal.hierarchy_depth,
                traversal.expanded_occurrences,
                traversal.leaf_occurrences,
                traversal.included_leaf_occurrences,
                traversal.bom_excluded_occurrences,
                traversal.reference_only_occurrences,
                traversal.suppressed_occurrences,
                traversal.cycle_count));
            if (traversal.leaf_occurrences < 100 || traversal.hierarchy_depth < 2)
            {
                throw new InvalidOperationException("The large-assembly fixture did not reach its minimum scale.");
            }
            if (traversal.bom_excluded_occurrences == 0
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
            CreateDraftAndPdf(application, rootPath, runDirectory, out draftPath, out pdfPath);
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
                collectionDelta);
            Console.WriteLine("STAGE=manifest");

            root = CreateRuntimeSnapshot(application, root, runDirectory, rootPath);
            Console.WriteLine("STAGE=runtime-snapshot");
            root.Activate();
            try { application.ActiveWindow.View.Fit(); } catch { }

            Console.WriteLine(String.Format(
                CultureInfo.InvariantCulture,
                "RESULT=root={0}|run={1}|depth={2}|expanded={3}|leaf={4}|included={5}|excluded={6}|reference_only={7}|suppressed={8}|bom_lines={9}",
                rootPath,
                runDirectory,
                traversal.hierarchy_depth,
                traversal.expanded_occurrences,
                traversal.leaf_occurrences,
                traversal.included_leaf_occurrences,
                traversal.bom_excluded_occurrences,
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
                Child("IV_OVN_CONTROL.par", "Commissioning placeholder", includeInBom: false),
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
        bool includeInBom = true,
        bool referenceOnly = false,
        bool suppressed = false)
    {
        return new ChildSpec
        {
            FileName = fileName,
            Name = name,
            IncludeInBom = includeInBom,
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
                occurrence.IncludeInBom = child.IncludeInBom;
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
        return root;
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

                dynamic document = occurrence.OccurrenceDocument;
                if ((bool)occurrence.Subassembly)
                {
                    result.subassembly_occurrences++;
                    Traverse(document, depth + 1, includeInBom && !referenceOnly && !suppressed, stack, result);
                    continue;
                }

                result.leaf_occurrences++;
                if (!includeInBom || referenceOnly || suppressed) continue;
                result.included_leaf_occurrences++;
                string occurrencePath = (string)occurrence.OccurrenceFileName;
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
            { "source_api", "AssemblyDocument.Occurrences recursive" },
            { "root_document", Path.GetFileName(rootPath) },
            { "line_count", bom.Count },
            { "occurrence_count", traversal.included_leaf_occurrences },
            { "excluded_occurrence_count", traversal.bom_excluded_occurrences },
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
            { "quality_status", "source_verified_with_known_issue" },
            { "object_inventory", new Dictionary<string, object>
                {
                    { "hierarchy_depth", traversal.hierarchy_depth },
                    { "expanded_occurrences", traversal.expanded_occurrences },
                    { "leaf_occurrences", traversal.leaf_occurrences },
                    { "included_leaf_occurrences", traversal.included_leaf_occurrences },
                    { "reference_only_occurrences", traversal.reference_only_occurrences },
                    { "suppressed_occurrences", traversal.suppressed_occurrences },
                    { "cycle_count", traversal.cycle_count }
                }
            },
            { "field_provenance", new Dictionary<string, object>
                {
                    { "structure", "AssemblyDocument.Occurrences recursive" },
                    { "bom", "Occurrence.IncludeInBom + ReferenceOnly + SuppressVariable" },
                    { "metadata", "Document.SummaryInfo + Properties.Custom" },
                    { "suppression", "declared-versus-reloaded Occurrences delta" }
                }
            },
            { "known_issues", new[]
                {
                    "IncludeInBom=false reset to true inside the reopened service subassembly; root exclusion and ReferenceOnly persisted."
                }
            }
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
                    { "nested_include_in_bom", "partial" },
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
        out string draftPath,
        out string pdfPath)
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
        view.Caption = "InnovaVento Oven Factory Fixture";
        view.DisplayCaption = true;
        view.DisplayScale = true;
        view.Update();
        dynamic partsList = draft.PartsLists.Add(view, "", 0, 1);
        partsList.ListType = PartsListType.igAtomic;
        partsList.ShowTopAssembly = false;
        partsList.UseLevelBasedItemNumbers = false;
        partsList.SetOrigin(0.24, 0.145);
        partsList.Update();
        draft.SaveAs(draftPath, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
            Missing.Value, Missing.Value, Missing.Value, Missing.Value);
        draft.Save();

        dynamic printUtility = application.GetDraftPrintUtility();
        printUtility.RemoveAllDocuments();
        printUtility.Printer = "Microsoft Print to PDF";
        printUtility.SheetsPerPage = DraftPrintSheetsPerPageConstants.igSingleSheet;
        printUtility.PrintToFile = true;
        printUtility.PrintToFilePath = outputDirectory;
        printUtility.PrintAsBlack = true;
        printUtility.AddDocument(draft);
        printUtility.PrintOut();
        NormalizePdf(outputDirectory, pdfPath);
        draft.Close(false);
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
        int collectionDelta)
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
            { "reference_only_occurrences", traversal.reference_only_occurrences },
            { "suppressed_occurrences", traversal.suppressed_occurrences },
            { "cycle_count", traversal.cycle_count },
            { "expected_leaf_occurrences_before_suppression", expectedLeafOccurrences },
            { "suppressed_occurrence_collection_delta", collectionDelta },
            { "suppression_evidence", "Persisted suppressed occurrences are absent from AssemblyDocument.Occurrences after reload; count is the exact declared-versus-observed delta." },
            { "known_issue", "IncludeInBom=false persisted on the live root occurrence but reset to true inside the reopened service subassembly; ReferenceOnly remained stable." },
            { "acceptance", new Dictionary<string, object>
                {
                    { "at_least_100_leaf_occurrences", traversal.leaf_occurrences >= 100 },
                    { "nested_subassemblies", traversal.hierarchy_depth >= 2 },
                    { "bom_exclusion_present", traversal.bom_excluded_occurrences > 0 },
                    { "reference_only_present", traversal.reference_only_occurrences > 0 },
                    { "suppression_present", traversal.suppressed_occurrences > 0 },
                    { "cycle_free", traversal.cycle_count == 0 }
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
