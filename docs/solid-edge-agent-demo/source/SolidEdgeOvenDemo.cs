using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using SolidEdge.Assembly.Interop;
using SolidEdge.Draft.Interop;
using SolidEdge.Part.Interop;
using Path = System.IO.Path;

internal static class SolidEdgeOvenDemo
{
    private const int ProfileClosed = 1;
    private const int LineStart = 0;
    private const int LineEnd = 1;
    private const string RootName = "IV_InnovaVento_Oven";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };

    private sealed class PartSpec
    {
        public string FileName;
        public string PartNumber;
        public string Description;
        public string Category;
        public string Material;
        public string MakeBuy;
        public string Process;
        public string Revision;
        public string Shape;
        public double X;
        public double Y;
        public double Z;
        public bool Nameplate;
        public string[] AnalysisTags;
    }

    private sealed class Placement
    {
        public PartSpec Part;
        public string InstanceName;
        public double X;
        public double Y;
        public double Z;
    }

    private sealed class BomLine
    {
        public int Item;
        public string PartNumber;
        public string Revision;
        public string Description;
        public int Quantity;
        public string Unit;
        public string Material;
        public string Category;
        public string MakeBuy;
        public string ManufacturingProcess;
        public string FileName;
        public string SourcePath;
        public bool IncludeInBom;
        public string[] AnalysisTags;
        public int Models;
        public int Protrusions;
        public int Cutouts;
    }

    [STAThread]
    private static int Main()
    {
        OleMessageFilter.Register();
        try
        {
            dynamic application = Marshal.GetActiveObject("SolidEdge.Application");
            application.Visible = true;

            string outputDirectory = @"C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\oven-demo";
            string libraryDirectory = Path.Combine(outputDirectory, "library");
            string snapshotDirectory = Path.Combine(
                outputDirectory,
                "runtime-snapshots",
                DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff", CultureInfo.InvariantCulture)
                    + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(outputDirectory);
            Directory.CreateDirectory(libraryDirectory);
            Directory.CreateDirectory(snapshotDirectory);
            string assemblyPath = Path.Combine(outputDirectory, RootName + ".asm");
            CloseDocumentByPath(application, Path.Combine(outputDirectory, RootName + ".dft"));
            CloseDocumentByPath(application, assemblyPath);

            Stage("attach", String.Format(
                CultureInfo.InvariantCulture,
                "{0} {1}; output={2}", application.Name, application.Version, outputDirectory));

            PartSpec[] parts = BuildLibraryDefinition();
            foreach (PartSpec part in parts)
            {
                string path = Path.Combine(libraryDirectory, part.FileName);
                CreateOrReplacePart(application, part, path);
            }

            Placement[] placements = BuildPlacements(parts);
            dynamic assembly = CreateOrReplaceAssembly(application, assemblyPath, libraryDirectory, placements);
            List<BomLine> bom = ReadBomFromAssembly(assembly);
            if (bom.Count < 8 || bom.Sum(line => line.Quantity) < 16)
            {
                throw new InvalidOperationException("The generated oven BOM is unexpectedly small.");
            }

            string bomJsonPath = Path.Combine(outputDirectory, RootName + ".bom.json");
            string bomCsvPath = Path.Combine(outputDirectory, RootName + ".bom.csv");
            WriteBom(bomJsonPath, bomCsvPath, assemblyPath, bom);

            IDictionary<string, object> physical = ReadAssemblyPhysicalProperties(assembly);
            string analysisPath = Path.Combine(outputDirectory, RootName + ".analysis.json");
            WriteAnalysis(analysisPath, assemblyPath, bom, physical, placements);

            string draftPath;
            string pdfPath;
            CreateDraftAndPdf(application, assemblyPath, outputDirectory, out draftPath, out pdfPath);

            string stepPath = Path.Combine(outputDirectory, RootName + ".stp");
            DeleteIfPresent(stepPath);
            Stage("step-export", stepPath);
            assembly.SaveCopyAs(stepPath);
            Stage("step-result", DescribeFile(stepPath));

            string metadataPath = Path.Combine(outputDirectory, RootName + ".metadata.json");
            WriteMetadata(
                metadataPath,
                (string)application.Version,
                assemblyPath,
                bom,
                physical,
                placements);

            string snapshotAssemblyPath = Path.Combine(snapshotDirectory, RootName + ".asm");
            assembly.SaveCopyAs(snapshotAssemblyPath);
            Stage("native-snapshot-assembly", DescribeFile(snapshotAssemblyPath));
            foreach (PartSpec part in parts)
            {
                CopyReplacing(
                    Path.Combine(libraryDirectory, part.FileName),
                    Path.Combine(snapshotDirectory, part.FileName));
            }
            CopyReplacing(draftPath, Path.Combine(snapshotDirectory, RootName + ".dft"));
            CopyReplacing(stepPath, Path.Combine(snapshotDirectory, RootName + ".stp"));
            CopyReplacing(pdfPath, Path.Combine(snapshotDirectory, RootName + ".pdf"));
            CopyReplacing(metadataPath, Path.Combine(snapshotDirectory, RootName + ".metadata.json"));
            CopyReplacing(bomJsonPath, Path.Combine(snapshotDirectory, RootName + ".bom.json"));
            CopyReplacing(bomCsvPath, Path.Combine(snapshotDirectory, RootName + ".bom.csv"));
            CopyReplacing(analysisPath, Path.Combine(snapshotDirectory, RootName + ".analysis.json"));

            assembly.Activate();
            try
            {
                application.ActiveWindow.View.Fit();
                Stage("fit-view", "success");
            }
            catch (Exception exception)
            {
                Stage("fit-view", "warning=" + exception.Message);
            }

            Stage("runtime-snapshot", snapshotAssemblyPath);
            Console.WriteLine(String.Format(
                CultureInfo.InvariantCulture,
                "RESULT=assembly={0}|unique_parts={1}|occurrences={2}|bom_lines={3}|snapshot={4}",
                assemblyPath,
                bom.Count,
                bom.Sum(line => line.Quantity),
                bom.Count,
                snapshotAssemblyPath));
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

    private static PartSpec[] BuildLibraryDefinition()
    {
        return new[]
        {
            Part("IV_OVN_SIDE.par", "IV-OVN-1001", "Oven side panel", "Housing", "Stainless steel 1.4301", "make", "laser-cut-and-bend", 0.020, 0.600, 0.800, "box", "sheet-metal", "thermal-envelope"),
            Part("IV_OVN_TOP.par", "IV-OVN-1002", "Oven top and bottom panel", "Housing", "Stainless steel 1.4301", "make", "laser-cut-and-bend", 0.600, 0.600, 0.020, "box", "sheet-metal", "thermal-envelope"),
            Part("IV_OVN_BACK.par", "IV-OVN-1003", "Oven back panel", "Housing", "Galvanized steel", "make", "laser-cut-and-bend", 0.560, 0.020, 0.760, "box", "sheet-metal", "service-access"),
            Part("IV_OVN_DOOR.par", "IV-OVN-2001", "Insulated front door", "Door module", "Stainless steel / glass", "make", "assembly", 0.560, 0.040, 0.650, "box", "safety-critical", "thermal-envelope", "user-interface"),
            Part("IV_OVN_CONTROL.par", "IV-OVN-3001", "Control fascia", "Controls", "Brushed stainless steel", "make", "laser-cut-and-bend", 0.560, 0.045, 0.105, "box", "user-interface", "electrical-interface"),
            Part("IV_OVN_RACK.par", "IV-OVN-4001", "Reusable cooking rack", "Cooking chamber", "Chrome-plated steel", "make", "wire-forming", 0.500, 0.470, 0.008, "box", "food-contact", "removable"),
            Part("IV_OVN_HANDLE.par", "IV-OVN-2002", "Door handle", "Door module", "Anodized aluminium", "buy", "extrusion", 0.400, 0.030, 0.030, "box", "ergonomic", "user-interface"),
            Part("IV_OVN_FOOT.par", "IV-OVN-5001", "Adjustable appliance foot", "Purchased hardware", "PA6 / steel", "buy", "purchased", 0.045, 0.045, 0.080, "box", "load-bearing", "adjustable"),
            Part("IV_OVN_KNOB.par", "IV-OVN-3002", "Control knob", "Controls", "PA6 GF30", "buy", "injection-moulded", 0.035, 0.035, 0.025, "cylinder", "user-interface", "replaceable"),
            Nameplate("IV_OVN_NAMEPLATE.par", "IV-OVN-9001", "InnovaVento nameplate", 0.220, 0.008, 0.055),
            Part("IV_OVN_HEATER.par", "IV-OVN-6001", "Heating element representation", "Heating", "Incoloy 800", "buy", "purchased", 0.450, 0.020, 0.020, "box", "thermal", "safety-critical", "service-part")
        };
    }

    private static PartSpec Part(
        string fileName,
        string partNumber,
        string description,
        string category,
        string material,
        string makeBuy,
        string process,
        double x,
        double y,
        double z,
        string shape,
        params string[] tags)
    {
        return new PartSpec
        {
            FileName = fileName,
            PartNumber = partNumber,
            Description = description,
            Category = category,
            Material = material,
            MakeBuy = makeBuy,
            Process = process,
            Revision = "A",
            Shape = shape,
            X = x,
            Y = y,
            Z = z,
            AnalysisTags = tags
        };
    }

    private static PartSpec Nameplate(string fileName, string partNumber, string description, double x, double y, double z)
    {
        PartSpec part = Part(
            fileName,
            partNumber,
            description,
            "Branding",
            "Anodized aluminium",
            "buy",
            "laser-etched",
            x,
            y,
            z,
            "box",
            "branding",
            "traceability",
            "serialisation");
        part.Nameplate = true;
        return part;
    }

    private static Placement[] BuildPlacements(PartSpec[] parts)
    {
        Dictionary<string, PartSpec> byNumber = parts.ToDictionary(part => part.PartNumber);
        List<Placement> result = new List<Placement>();
        AddPlacement(result, byNumber["IV-OVN-1001"], "Left side", -0.290, 0.000, 0.000);
        AddPlacement(result, byNumber["IV-OVN-1001"], "Right side", 0.290, 0.000, 0.000);
        AddPlacement(result, byNumber["IV-OVN-1002"], "Top panel", 0.000, 0.000, 0.390);
        AddPlacement(result, byNumber["IV-OVN-1002"], "Bottom panel", 0.000, 0.000, -0.390);
        AddPlacement(result, byNumber["IV-OVN-1003"], "Back panel", 0.000, -0.290, 0.000);
        AddPlacement(result, byNumber["IV-OVN-2001"], "Front door", 0.000, 0.320, -0.030);
        AddPlacement(result, byNumber["IV-OVN-3001"], "Control fascia", 0.000, 0.330, 0.335);
        AddPlacement(result, byNumber["IV-OVN-4001"], "Upper rack", 0.000, 0.000, 0.090);
        AddPlacement(result, byNumber["IV-OVN-4001"], "Lower rack", 0.000, 0.000, -0.120);
        AddPlacement(result, byNumber["IV-OVN-2002"], "Door handle", 0.000, 0.365, 0.180);
        AddPlacement(result, byNumber["IV-OVN-9001"], "InnovaVento nameplate", 0.000, 0.357, 0.305);
        AddPlacement(result, byNumber["IV-OVN-3002"], "Left control knob", -0.120, 0.365, 0.335);
        AddPlacement(result, byNumber["IV-OVN-3002"], "Right control knob", 0.120, 0.365, 0.335);
        AddPlacement(result, byNumber["IV-OVN-6001"], "Upper heating element", 0.000, -0.245, 0.230);
        AddPlacement(result, byNumber["IV-OVN-6001"], "Lower heating element", 0.000, -0.245, -0.250);
        AddPlacement(result, byNumber["IV-OVN-5001"], "Front left foot", -0.250, 0.230, -0.440);
        AddPlacement(result, byNumber["IV-OVN-5001"], "Front right foot", 0.250, 0.230, -0.440);
        AddPlacement(result, byNumber["IV-OVN-5001"], "Rear left foot", -0.250, -0.230, -0.440);
        AddPlacement(result, byNumber["IV-OVN-5001"], "Rear right foot", 0.250, -0.230, -0.440);
        return result.ToArray();
    }

    private static void AddPlacement(List<Placement> placements, PartSpec part, string name, double x, double y, double z)
    {
        placements.Add(new Placement { Part = part, InstanceName = name, X = x, Y = y, Z = z });
    }

    private static void CreateOrReplacePart(dynamic application, PartSpec spec, string path)
    {
        CloseDocumentByPath(application, path);
        DeleteIfPresent(path);
        string template = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric part.par";
        dynamic part = application.Documents.Add("SolidEdge.PartDocument", template);
        try
        {
            if (spec.Nameplate)
            {
                CreateNameplate(part, spec.X, spec.Y, spec.Z);
            }
            else if (spec.Shape == "cylinder")
            {
                CreateCylinder(part, spec.X / 2.0, spec.Z);
            }
            else
            {
                CreateBox(part, spec.X, spec.Y, spec.Z);
            }
            WritePartMetadata(part, spec);
            part.SaveAs(path, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
                Missing.Value, Missing.Value, Missing.Value, Missing.Value);
            part.Save();
            Stage("library-part", spec.PartNumber + "|" + DescribeFile(path));
        }
        finally
        {
            try { part.Close(false); } catch { }
        }
    }

    private static void CreateBox(dynamic part, double x, double y, double z)
    {
        dynamic profileSet = part.ProfileSets.Add();
        dynamic profile = profileSet.Profiles.Add(part.RefPlanes.Item(1));
        dynamic lines = profile.Lines2d;
        dynamic line1 = lines.AddBy2Points(-x / 2.0, -y / 2.0, x / 2.0, -y / 2.0);
        dynamic line2 = lines.AddBy2Points(x / 2.0, -y / 2.0, x / 2.0, y / 2.0);
        dynamic line3 = lines.AddBy2Points(x / 2.0, y / 2.0, -x / 2.0, y / 2.0);
        dynamic line4 = lines.AddBy2Points(-x / 2.0, y / 2.0, -x / 2.0, -y / 2.0);
        dynamic relations = profile.Relations2d;
        relations.AddKeypoint(line1, LineEnd, line2, LineStart);
        relations.AddKeypoint(line2, LineEnd, line3, LineStart);
        relations.AddKeypoint(line3, LineEnd, line4, LineStart);
        relations.AddKeypoint(line4, LineEnd, line1, LineStart);
        EndProfile(profile);
        AddExtrusion(part, profile, z);
    }

    private static void CreateCylinder(dynamic part, double radius, double height)
    {
        dynamic profileSet = part.ProfileSets.Add();
        dynamic profile = profileSet.Profiles.Add(part.RefPlanes.Item(1));
        profile.Circles2d.AddByCenterRadius(0.0, 0.0, radius);
        EndProfile(profile);
        AddExtrusion(part, profile, height);
    }

    private static void CreateNameplate(dynamic part, double width, double thickness, double height)
    {
        // RefPlane 3 is the native XZ/front plane. Its normal is -Y, so the
        // symmetric protrusion's top cap is the installed +Y outward face.
        const int frontPlaneIndex = 3;
        CreateBoxOnPlane(part, frontPlaneIndex, width, height, thickness);
        AddCircularCutout(part, frontPlaneIndex, -0.090, 0.000, 0.0025);
        AddCircularCutout(part, frontPlaneIndex, 0.090, 0.000, 0.0025);
        AddEngravedWordmark(part, "INNOVAVENTO");
    }

    private static void CreateBoxOnPlane(dynamic part, int planeIndex, double width, double height, double depth)
    {
        dynamic profileSet = part.ProfileSets.Add();
        dynamic profile = profileSet.Profiles.Add(part.RefPlanes.Item(planeIndex));
        dynamic lines = profile.Lines2d;
        dynamic line1 = lines.AddBy2Points(-width / 2.0, -height / 2.0, width / 2.0, -height / 2.0);
        dynamic line2 = lines.AddBy2Points(width / 2.0, -height / 2.0, width / 2.0, height / 2.0);
        dynamic line3 = lines.AddBy2Points(width / 2.0, height / 2.0, -width / 2.0, height / 2.0);
        dynamic line4 = lines.AddBy2Points(-width / 2.0, height / 2.0, -width / 2.0, -height / 2.0);
        dynamic relations = profile.Relations2d;
        relations.AddKeypoint(line1, LineEnd, line2, LineStart);
        relations.AddKeypoint(line2, LineEnd, line3, LineStart);
        relations.AddKeypoint(line3, LineEnd, line4, LineStart);
        relations.AddKeypoint(line4, LineEnd, line1, LineStart);
        EndProfile(profile);
        AddExtrusion(part, profile, depth);
    }

    private static void AddEngravedWordmark(dynamic part, string text)
    {
        const int glyphColumns = 5;
        const int glyphRows = 7;
        const double dotPitch = 0.00225;
        const double dotRadius = 0.00072;
        const double engravingDepth = 0.0006;

        int totalColumns = text.Length * glyphColumns + (text.Length - 1);
        double startX = -(totalColumns - 1) * dotPitch / 2.0;
        double startY = (glyphRows - 1) * dotPitch / 2.0;

        dynamic model = part.Models.Item(1);
        dynamic outwardFace = model.ExtrudedProtrusions.Item(1).TopCap;
        dynamic frontPlane = part.RefPlanes.AddParallelByDistance(
            outwardFace,
            0.0,
            1,
            Missing.Value,
            Missing.Value,
            Missing.Value,
            Missing.Value);

        dynamic profileSet = part.ProfileSets.Add();
        dynamic profile = profileSet.Profiles.Add(frontPlane);
        for (int characterIndex = 0; characterIndex < text.Length; characterIndex++)
        {
            string[] glyph = GetDotGlyph(text[characterIndex]);
            int characterColumn = characterIndex * (glyphColumns + 1);
            for (int row = 0; row < glyphRows; row++)
            {
                for (int column = 0; column < glyphColumns; column++)
                {
                    if (glyph[row][column] == '#')
                    {
                        profile.Circles2d.AddByCenterRadius(
                            startX + (characterColumn + column) * dotPitch,
                            startY - row * dotPitch,
                            dotRadius);
                    }
                }
            }
        }
        EndProfile(profile);
        model.ExtrudedCutouts.AddFinite(
            profile,
            FeaturePropertyConstants.igRight,
            FeaturePropertyConstants.igLeft,
            engravingDepth);
        profile.Visible = false;
    }

    private static string[] GetDotGlyph(char character)
    {
        switch (Char.ToUpperInvariant(character))
        {
            case 'I':
                return new[]
                {
                    "#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"
                };
            case 'N':
                return new[]
                {
                    "#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"
                };
            case 'O':
                return new[]
                {
                    ".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."
                };
            case 'V':
                return new[]
                {
                    "#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."
                };
            case 'A':
                return new[]
                {
                    ".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"
                };
            case 'E':
                return new[]
                {
                    "#####", "#....", "#....", "####.", "#....", "#....", "#####"
                };
            case 'T':
                return new[]
                {
                    "#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."
                };
            default:
                throw new InvalidOperationException("Unsupported wordmark character: " + character);
        }
    }

    private static void EndProfile(dynamic profile)
    {
        int status = (int)profile.End(ProfileClosed);
        if (status != 0)
        {
            throw new InvalidOperationException("Profile validation failed: " + status);
        }
    }

    private static void AddExtrusion(dynamic part, dynamic profile, double distance)
    {
        Array profileArray = Array.CreateInstance(typeof(object), 1);
        profileArray.SetValue(profile, 0);
        Models models = (Models)part.Models;
        object missing = Missing.Value;
        models.AddFiniteExtrudedProtrusion(
            1,
            ref profileArray,
            FeaturePropertyConstants.igSymmetric,
            distance,
            missing,
            missing,
            missing,
            missing);
        profile.Visible = false;
    }

    private static void AddCircularCutout(dynamic part, int planeIndex, double x, double y, double radius)
    {
        dynamic model = part.Models.Item(1);
        dynamic profileSet = part.ProfileSets.Add();
        dynamic profile = profileSet.Profiles.Add(part.RefPlanes.Item(planeIndex));
        profile.Circles2d.AddByCenterRadius(x, y, radius);
        EndProfile(profile);
        model.ExtrudedCutouts.AddThroughAll(
            profile,
            FeaturePropertyConstants.igLeft,
            FeaturePropertyConstants.igBoth);
        profile.Visible = false;
    }

    private static void WritePartMetadata(dynamic part, PartSpec spec)
    {
        dynamic summary = part.SummaryInfo;
        summary.Author = "iV-Connect Agent";
        summary.Title = spec.Description;
        summary.Subject = spec.PartNumber;
        summary.Keywords = String.Join(",", spec.AnalysisTags);
        summary.Comments = "Generated library component for the InnovaVento oven connector demo.";
        summary.Category = spec.Category;
        summary.Company = "InnovaVento";
        summary.ProjectName = "Vendor-neutral CAD Connector Demo";
        SetCustomProperty(part, "IV_PartNumber", spec.PartNumber);
        SetCustomProperty(part, "IV_Revision", spec.Revision);
        SetCustomProperty(part, "IV_Description", spec.Description);
        SetCustomProperty(part, "IV_LibraryCategory", spec.Category);
        SetCustomProperty(part, "IV_Material", spec.Material);
        SetCustomProperty(part, "IV_MakeBuy", spec.MakeBuy);
        SetCustomProperty(part, "IV_ManufacturingProcess", spec.Process);
        SetCustomProperty(part, "IV_AnalysisTags", String.Join(",", spec.AnalysisTags));
        SetCustomProperty(part, "IV_ConnectorSchema", "cad-object-metadata-v1");
        if (spec.Nameplate)
        {
            SetCustomProperty(part, "IV_BrandingGeometry", "engraved-dot-matrix-wordmark-v1");
            SetCustomProperty(part, "IV_BrandingText", "INNOVAVENTO");
        }
        try { part.Properties.Save(); } catch { }
    }

    private static void SetCustomProperty(dynamic document, string name, object value)
    {
        try
        {
            dynamic sets = document.Properties;
            dynamic custom = sets.Item("Custom");
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
        catch (Exception exception)
        {
            Stage("custom-property", "warning=" + name + ":" + exception.Message);
        }
    }

    private static dynamic CreateOrReplaceAssembly(
        dynamic application,
        string assemblyPath,
        string libraryDirectory,
        Placement[] placements)
    {
        CloseDocumentByPath(application, assemblyPath);
        DeleteIfPresent(assemblyPath);
        string template = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric assembly.asm";
        dynamic assembly = application.Documents.Add("SolidEdge.AssemblyDocument", template);
        assembly.SaveAs(assemblyPath, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
            Missing.Value, Missing.Value, Missing.Value, Missing.Value);

        foreach (Placement placement in placements)
        {
            string partPath = Path.Combine(libraryDirectory, placement.Part.FileName);
            dynamic occurrence = assembly.Occurrences.AddByFilename(partPath, Missing.Value);
            occurrence.Name = placement.InstanceName;
            occurrence.IncludeInBom = true;
            occurrence.Move(placement.X, placement.Y, placement.Z);
            Stage("occurrence", String.Format(
                CultureInfo.InvariantCulture,
                "{0}|part={1}|x={2:F3}|y={3:F3}|z={4:F3}",
                placement.InstanceName,
                placement.Part.PartNumber,
                placement.X,
                placement.Y,
                placement.Z));
        }

        dynamic summary = assembly.SummaryInfo;
        summary.Author = "iV-Connect Agent";
        summary.Title = "InnovaVento Oven Assembly";
        summary.Subject = "Vendor-neutral CAD connector and BOM demonstration";
        summary.Keywords = "oven,assembly,bom,component-library,analysis,connector";
        summary.Comments = "Generated as a multi-component Solid Edge API and SaveALL fixture.";
        summary.Category = "Demo assembly";
        summary.Company = "InnovaVento";
        summary.ProjectName = "Vendor-neutral CAD Connector Demo";
        SetCustomProperty(assembly, "IV_PartNumber", "IV-OVN-0000");
        SetCustomProperty(assembly, "IV_Revision", "A");
        SetCustomProperty(assembly, "IV_Description", "InnovaVento freestanding oven");
        SetCustomProperty(assembly, "IV_ConnectorSchema", "cad-object-metadata-v1");
        assembly.Save();
        Stage("assembly", DescribeFile(assemblyPath) + "; occurrences=" + (int)assembly.Occurrences.Count);
        return assembly;
    }

    private static List<BomLine> ReadBomFromAssembly(dynamic assembly)
    {
        Dictionary<string, BomLine> lines = new Dictionary<string, BomLine>(StringComparer.OrdinalIgnoreCase);
        for (int index = 1; index <= (int)assembly.Occurrences.Count; index++)
        {
            dynamic occurrence = assembly.Occurrences.Item(index);
            if (!(bool)occurrence.IncludeInBom)
            {
                continue;
            }
            string path = (string)occurrence.OccurrenceFileName;
            dynamic document = occurrence.OccurrenceDocument;
            dynamic summary = document.SummaryInfo;
            string partNumber = ReadCustomProperty(document, "IV_PartNumber", Path.GetFileNameWithoutExtension(path));
            BomLine line;
            if (!lines.TryGetValue(partNumber, out line))
            {
                line = new BomLine
                {
                    PartNumber = partNumber,
                    Revision = ReadCustomProperty(document, "IV_Revision", ""),
                    Description = ReadCustomProperty(document, "IV_Description", SafeString(summary.Title)),
                    Quantity = 0,
                    Unit = "EA",
                    Material = ReadCustomProperty(document, "IV_Material", ""),
                    Category = ReadCustomProperty(document, "IV_LibraryCategory", SafeString(summary.Category)),
                    MakeBuy = ReadCustomProperty(document, "IV_MakeBuy", ""),
                    ManufacturingProcess = ReadCustomProperty(document, "IV_ManufacturingProcess", ""),
                    FileName = Path.GetFileName(path),
                    SourcePath = path,
                    IncludeInBom = true,
                    AnalysisTags = SplitTags(ReadCustomProperty(document, "IV_AnalysisTags", SafeString(summary.Keywords)))
                };
                try
                {
                    line.Models = (int)document.Models.Count;
                    if (line.Models > 0)
                    {
                        dynamic model = document.Models.Item(1);
                        line.Protrusions = (int)model.ExtrudedProtrusions.Count;
                        line.Cutouts = (int)model.ExtrudedCutouts.Count;
                    }
                }
                catch { }
                lines.Add(partNumber, line);
            }
            line.Quantity += 1;
        }

        List<BomLine> result = lines.Values.OrderBy(line => line.PartNumber, StringComparer.OrdinalIgnoreCase).ToList();
        for (int index = 0; index < result.Count; index++)
        {
            result[index].Item = index + 1;
        }
        Stage("bom-read", "lines=" + result.Count + "; occurrences=" + result.Sum(line => line.Quantity));
        return result;
    }

    private static string ReadCustomProperty(dynamic document, string name, string fallback)
    {
        try
        {
            dynamic sets = document.Properties;
            dynamic custom = sets.Item("Custom");
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

    private static string[] SplitTags(string value)
    {
        return (value ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(item => item.Trim())
            .Where(item => item.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static void WriteBom(string jsonPath, string csvPath, string assemblyPath, List<BomLine> bom)
    {
        var payload = new Dictionary<string, object>
        {
            { "schema_version", "1.0" },
            { "bom_kind", "engineering" },
            { "source_system", "solid_edge" },
            { "source_api", "SolidEdgeAssembly.Occurrences" },
            { "root_document", Path.GetFileName(assemblyPath) },
            { "generated_at", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
            { "line_count", bom.Count },
            { "occurrence_count", bom.Sum(line => line.Quantity) },
            { "lines", bom }
        };
        File.WriteAllText(jsonPath, Json.Serialize(payload), Encoding.UTF8);

        StringBuilder csv = new StringBuilder();
        csv.AppendLine("item,part_number,revision,description,quantity,unit,material,category,make_buy,manufacturing_process,file_name");
        foreach (BomLine line in bom)
        {
            csv.AppendLine(String.Join(",", new[]
            {
                line.Item.ToString(CultureInfo.InvariantCulture),
                Csv(line.PartNumber),
                Csv(line.Revision),
                Csv(line.Description),
                line.Quantity.ToString(CultureInfo.InvariantCulture),
                Csv(line.Unit),
                Csv(line.Material),
                Csv(line.Category),
                Csv(line.MakeBuy),
                Csv(line.ManufacturingProcess),
                Csv(line.FileName)
            }));
        }
        File.WriteAllText(csvPath, csv.ToString(), new UTF8Encoding(false));
        Stage("bom-files", DescribeFile(jsonPath) + "|" + DescribeFile(csvPath));
    }

    private static IDictionary<string, object> ReadAssemblyPhysicalProperties(dynamic assembly)
    {
        Dictionary<string, object> result = new Dictionary<string, object>();
        try
        {
            SolidEdge.Assembly.Interop.PhysicalProperties physical = assembly.PhysicalProperties;
            physical.Update();
            double mass = 0;
            double volume = 0;
            double area = 0;
            Array centerOfMass = Array.CreateInstance(typeof(double), 3);
            Array centerOfVolume = Array.CreateInstance(typeof(double), 3);
            Array globalMoments = Array.CreateInstance(typeof(double), 6);
            Array principalAxis1 = Array.CreateInstance(typeof(double), 3);
            Array principalAxis2 = Array.CreateInstance(typeof(double), 3);
            Array principalAxis3 = Array.CreateInstance(typeof(double), 3);
            Array principalMoments = Array.CreateInstance(typeof(double), 3);
            Array radiiOfGyration = Array.CreateInstance(typeof(double), 3);
            bool isSick = false;
            bool updateStatus = false;
            physical.GetAssemblyPhysicalProperties(
                out mass,
                out volume,
                out area,
                ref centerOfMass,
                ref centerOfVolume,
                ref globalMoments,
                ref principalAxis1,
                ref principalAxis2,
                ref principalAxis3,
                ref principalMoments,
                ref radiiOfGyration,
                out isSick,
                out updateStatus);
            bool volumeValid = volume > 0;
            double inferredDensity = volumeValid ? mass / volume : 0;
            bool massValid = volumeValid && mass > 0 && inferredDensity >= 50 && inferredDensity <= 30000;
            bool areaValid = area > 0;
            result["available"] = true;
            result["quality_status"] = massValid && areaValid ? "validated" : "partial";
            result["quality_reason"] = massValid && areaValid
                ? "api_values_passed_basic_plausibility_checks"
                : "material_density_or_surface_data_not_configured_for_all_components";
            result["raw_mass_value"] = mass;
            result["volume_m3"] = volume;
            result["raw_area_value"] = area;
            result["inferred_density_kg_m3"] = inferredDensity;
            result["mass_valid"] = massValid;
            result["volume_valid"] = volumeValid;
            result["surface_area_valid"] = areaValid;
            if (massValid) result["mass_kg"] = mass;
            if (areaValid) result["area_m2"] = area;
            result["center_of_mass_m"] = ToDoubleArray(centerOfMass);
            result["is_sick"] = isSick;
            result["update_status"] = updateStatus;
            result["source_api"] = "AssemblyDocument.PhysicalProperties.GetAssemblyPhysicalProperties";
        }
        catch (Exception exception)
        {
            result["available"] = false;
            result["reason"] = exception.Message;
            result["source_api"] = "AssemblyDocument.PhysicalProperties";
            Stage("physical-properties", "warning=" + exception.Message);
        }
        return result;
    }

    private static double[] ToDoubleArray(Array value)
    {
        if (value == null) return new double[0];
        List<double> result = new List<double>();
        foreach (object item in value) result.Add(Convert.ToDouble(item, CultureInfo.InvariantCulture));
        return result.ToArray();
    }

    private static void WriteAnalysis(
        string path,
        string assemblyPath,
        List<BomLine> bom,
        IDictionary<string, object> physical,
        Placement[] placements)
    {
        var materials = bom.GroupBy(line => line.Material).OrderBy(group => group.Key).Select(group => new
        {
            material = group.Key,
            unique_parts = group.Count(),
            occurrences = group.Sum(line => line.Quantity)
        }).ToArray();
        var categories = bom.GroupBy(line => line.Category).OrderBy(group => group.Key).Select(group => new
        {
            category = group.Key,
            unique_parts = group.Count(),
            occurrences = group.Sum(line => line.Quantity)
        }).ToArray();
        var risks = bom.Where(line => line.AnalysisTags.Contains("safety-critical")).Select(line => new
        {
            line.PartNumber,
            line.Description,
            line.Quantity,
            tags = line.AnalysisTags
        }).ToArray();
        var payload = new Dictionary<string, object>
        {
            { "schema_version", "1.0" },
            { "analysis_profile", "cad-connector-object-analysis-v1" },
            { "source_system", "solid_edge" },
            { "root_document", Path.GetFileName(assemblyPath) },
            { "object_inventory", new { unique_components = bom.Count, occurrences = bom.Sum(line => line.Quantity), subassemblies = 0, models = bom.Sum(line => line.Models), protrusions = bom.Sum(line => line.Protrusions), cutouts = bom.Sum(line => line.Cutouts) } },
            { "design_envelope_mm", new { width = 600, depth = 730, height = 920, provenance = "fixture-placement-contract" } },
            { "physical_properties", physical },
            { "material_distribution", materials },
            { "library_categories", categories },
            { "make_buy", new { make_occurrences = bom.Where(line => line.MakeBuy == "make").Sum(line => line.Quantity), buy_occurrences = bom.Where(line => line.MakeBuy == "buy").Sum(line => line.Quantity) } },
            { "safety_critical_components", risks },
            { "reused_components", bom.Where(line => line.Quantity > 1).Select(line => new { line.PartNumber, line.Description, line.Quantity }).ToArray() },
            { "metadata_completeness", new { required_fields = 8, complete_lines = bom.Count(line => !String.IsNullOrWhiteSpace(line.PartNumber) && !String.IsNullOrWhiteSpace(line.Revision) && !String.IsNullOrWhiteSpace(line.Description) && !String.IsNullOrWhiteSpace(line.Material) && !String.IsNullOrWhiteSpace(line.Category) && !String.IsNullOrWhiteSpace(line.MakeBuy) && !String.IsNullOrWhiteSpace(line.ManufacturingProcess) && line.AnalysisTags.Length > 0), total_lines = bom.Count } },
            { "field_provenance", new Dictionary<string, object> { { "structure", "AssemblyDocument.Occurrences" }, { "standard_metadata", "Document.SummaryInfo" }, { "domain_metadata", "Document.Properties.Custom" }, { "features", "PartDocument.Models" }, { "physical", "AssemblyDocument.PhysicalProperties" }, { "placement", "Occurrence.Move / fixture contract" } } }
        };
        File.WriteAllText(path, Json.Serialize(payload), Encoding.UTF8);
        Stage("analysis-file", DescribeFile(path));
    }

    private static void WriteMetadata(
        string path,
        string version,
        string assemblyPath,
        List<BomLine> bom,
        IDictionary<string, object> physical,
        Placement[] placements)
    {
        var payload = new Dictionary<string, object>
        {
            { "schema_version", "2.0" },
            { "connector_contract_version", "cad-project-snapshot-v1" },
            { "source_system", "solid_edge" },
            { "source_version", version },
            { "document_type", "assembly" },
            { "native_document", Path.GetFileName(assemblyPath) },
            { "project_name", "InnovaVento Oven Connector Demo" },
            { "created_by", "iV-Connect Agent" },
            { "saved_state", true },
            { "object_inventory", new { unique_components = bom.Count, occurrences = bom.Sum(line => line.Quantity), nameplate_part_number = "IV-OVN-9001" } },
            { "capabilities", new { active_document = true, unsaved_editor_state = false, component_structure = true, engineering_bom = true, draft_parts_list = true, geometry_features = true, physical_properties_api = physical.ContainsKey("available") && Convert.ToBoolean(physical["available"]), physical_properties_quality = physical.ContainsKey("quality_status") ? Convert.ToString(physical["quality_status"], CultureInfo.InvariantCulture) : "unavailable", custom_properties = true } },
            { "exports", new[] { RootName + ".stp", RootName + ".pdf", RootName + ".bom.json", RootName + ".bom.csv", RootName + ".analysis.json" } },
            { "api_provenance", new[] { "SolidEdge.Application", "AssemblyDocument.Occurrences", "Occurrence.OccurrenceDocument", "SummaryInfo", "PropertySets.Custom", "PhysicalProperties", "Draft.PartsLists", "SaveCopyAs" } }
        };
        File.WriteAllText(path, Json.Serialize(payload), Encoding.UTF8);
        Stage("metadata-file", DescribeFile(path));
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
        CloseDocumentByPath(application, draftPath);
        DeleteIfPresent(draftPath);
        DeleteIfPresent(pdfPath);
        string template = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric draft.dft";
        dynamic draft = application.Documents.Add("SolidEdge.DraftDocument", template);
        dynamic modelLink = draft.ModelLinks.Add(assemblyPath);
        dynamic sheet = draft.ActiveSheet;
        dynamic view = sheet.DrawingViews.AddAssemblyView(
            modelLink,
            ViewOrientationConstants.igFrontView,
            0.30,
            0.13,
            0.15,
            AssemblyDrawingViewTypeConstants.seAssemblyDesignedView,
            Missing.Value,
            Missing.Value,
            Missing.Value);
        view.Caption = "InnovaVento Oven";
        view.DisplayCaption = true;
        view.DisplayScale = true;
        view.Update();
        try
        {
            dynamic partsList = draft.PartsLists.Add(view, "", 0, 1);
            partsList.SetOrigin(0.27, 0.15);
            partsList.Update();
            Stage("draft-parts-list", "created; rows=" + (int)partsList.Rows.Count);
        }
        catch (Exception exception)
        {
            Stage("draft-parts-list", "warning=" + exception.Message);
        }
        draft.SaveAs(draftPath, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
            Missing.Value, Missing.Value, Missing.Value, Missing.Value);
        draft.Save();
        Stage("draft-result", DescribeFile(draftPath));

        foreach (string stale in Directory.GetFiles(outputDirectory, RootName + "_*.pri")) DeleteIfPresent(stale);
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
        Stage("pdf-result", DescribeFile(pdfPath));
    }

    private static void NormalizePdf(string outputDirectory, string pdfPath)
    {
        for (int attempt = 0; attempt < 150 && !File.Exists(pdfPath); attempt++)
        {
            string[] candidates = Directory.GetFiles(outputDirectory, RootName + "_*.pri");
            if (candidates.Length > 0)
            {
                string candidate = candidates.OrderByDescending(File.GetLastWriteTimeUtc).First();
                WaitForExclusiveAccess(candidate, 10000);
                using (FileStream stream = File.OpenRead(candidate))
                {
                    byte[] signature = new byte[5];
                    if (stream.Read(signature, 0, signature.Length) != signature.Length ||
                        Encoding.ASCII.GetString(signature) != "%PDF-")
                    {
                        throw new InvalidDataException("The print output is not a PDF: " + candidate);
                    }
                }
                File.Move(candidate, pdfPath);
                break;
            }
            System.Threading.Thread.Sleep(100);
        }
        if (!File.Exists(pdfPath)) throw new FileNotFoundException("Solid Edge did not create the oven PDF.", pdfPath);
    }

    private static void CloseDocumentByPath(dynamic application, string path)
    {
        try
        {
            dynamic documents = application.Documents;
            for (int index = (int)documents.Count; index >= 1; index--)
            {
                dynamic document = documents.Item(index);
                string fullName = SafeString(document.FullName);
                if (fullName.Length > 0 && String.Equals(Path.GetFullPath(fullName), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))
                {
                    document.Close(false);
                }
            }
        }
        catch { }
    }

    private static void DeleteIfPresent(string path)
    {
        if (File.Exists(path)) File.Delete(path);
    }

    private static void CopyReplacing(string source, string destination)
    {
        DeleteIfPresent(destination);
        File.Copy(source, destination);
        Stage("snapshot-copy", DescribeFile(destination));
    }

    private static void WaitForExclusiveAccess(string path, int timeoutMilliseconds)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMilliseconds);
        IOException last = null;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using (new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None)) return;
            }
            catch (IOException exception)
            {
                last = exception;
                System.Threading.Thread.Sleep(100);
            }
        }
        throw new IOException("Timed out waiting for file: " + path, last);
    }

    private static string Csv(string value)
    {
        string text = value ?? "";
        return "\"" + text.Replace("\"", "\"\"") + "\"";
    }

    private static string SafeString(object value)
    {
        return value == null ? "" : Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
    }

    private static string DescribeFile(string path)
    {
        FileInfo file = new FileInfo(path);
        return String.Format(CultureInfo.InvariantCulture, "{0}; exists={1}; bytes={2}", path, file.Exists, file.Exists ? file.Length : 0);
    }

    private static void Stage(string name, string detail)
    {
        Console.WriteLine("STAGE=" + name + "|" + detail);
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
