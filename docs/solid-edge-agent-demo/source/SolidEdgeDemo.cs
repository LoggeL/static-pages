using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using SolidEdge.Draft.Interop;
using SolidEdge.Part.Interop;

internal static class SolidEdgeDemo
{
    private const int PartDocumentType = 1;
    private const int ProfileClosed = 1;
    private const int LineStart = 0;
    private const int LineEnd = 1;

    [STAThread]
    private static int Main()
    {
        OleMessageFilter.Register();
        try
        {
            dynamic application = Marshal.GetActiveObject("SolidEdge.Application");
            dynamic part = FindDocumentByType(application, PartDocumentType);
            part.Activate();

            Stage("attach", String.Format(
                "{0} {1}; part={2}", application.Name, application.Version, part.FullName));

            if ((int)part.Type != PartDocumentType)
            {
                throw new InvalidOperationException("The active document is not a Solid Edge Part document.");
            }

            if ((int)part.Models.Count == 0)
            {
                while ((int)part.ProfileSets.Count > 0)
                {
                    part.ProfileSets.Item(1).Delete();
                }

                Stage("profile", "Create an 80 x 50 mm closed rectangle on RefPlane_1");
                dynamic profileSet = part.ProfileSets.Add();
                dynamic profile = profileSet.Profiles.Add(part.RefPlanes.Item(1));
                dynamic lines = profile.Lines2d;

                dynamic line1 = lines.AddBy2Points(-0.04, -0.025, 0.04, -0.025);
                dynamic line2 = lines.AddBy2Points(0.04, -0.025, 0.04, 0.025);
                dynamic line3 = lines.AddBy2Points(0.04, 0.025, -0.04, 0.025);
                dynamic line4 = lines.AddBy2Points(-0.04, 0.025, -0.04, -0.025);

                dynamic relations = profile.Relations2d;
                relations.AddKeypoint(line1, LineEnd, line2, LineStart);
                relations.AddKeypoint(line2, LineEnd, line3, LineStart);
                relations.AddKeypoint(line3, LineEnd, line4, LineStart);
                relations.AddKeypoint(line4, LineEnd, line1, LineStart);

                int validationStatus = (int)profile.End(ProfileClosed);
                Stage("profile-validation", "status=" + validationStatus);
                if (validationStatus != 0)
                {
                    throw new InvalidOperationException("The base profile is invalid: " + validationStatus);
                }

                Array profileArray = Array.CreateInstance(typeof(object), 1);
                profileArray.SetValue(profile, 0);

                Stage("extrude", "Create a symmetric 30 mm base protrusion");
                Models models = (Models)part.Models;
                object missing = Missing.Value;
                dynamic model = models.AddFiniteExtrudedProtrusion(
                    1,
                    ref profileArray,
                    FeaturePropertyConstants.igSymmetric,
                    0.03,
                    missing,
                    missing,
                    missing,
                    missing);
                profile.Visible = false;
                Stage("extrude-result", String.Format(
                    "models={0}; protrusions={1}", part.Models.Count, model.ExtrudedProtrusions.Count));
            }
            else
            {
                Stage("extrude", "Skipped; an existing model is present");
            }

            dynamic activeModel = part.Models.Item(1);
            if ((int)activeModel.ExtrudedCutouts.Count == 0)
            {
                Stage("cutout-profile", "Create a centered 12 mm circular profile");
                dynamic cutoutProfileSet = part.ProfileSets.Add();
                dynamic cutoutProfile = cutoutProfileSet.Profiles.Add(part.RefPlanes.Item(1));
                cutoutProfile.Circles2d.AddByCenterRadius(0.0, 0.0, 0.006);
                int cutoutValidationStatus = (int)cutoutProfile.End(ProfileClosed);
                Stage("cutout-validation", "status=" + cutoutValidationStatus);
                if (cutoutValidationStatus != 0)
                {
                    throw new InvalidOperationException("The cutout profile is invalid: " + cutoutValidationStatus);
                }

                Stage("cutout", "Create a through-all center hole");
                dynamic cutout = activeModel.ExtrudedCutouts.AddThroughAll(
                    cutoutProfile,
                    FeaturePropertyConstants.igLeft,
                    FeaturePropertyConstants.igBoth);
                cutoutProfile.Visible = false;
                Stage("cutout-result", String.Format(
                    "cutouts={0}; status={1}", activeModel.ExtrudedCutouts.Count, cutout.Status));
            }
            else
            {
                Stage("cutout", "Skipped; an existing cutout is present");
            }

            WriteDocumentMetadata(part);

            part.Save();
            Stage("save", (string)part.FullName);

            string outputDirectory = Path.GetDirectoryName((string)part.FullName);
            string snapshotDirectory = Path.Combine(outputDirectory, "runtime-snapshot");
            Directory.CreateDirectory(snapshotDirectory);
            string snapshotPartPath = Path.Combine(snapshotDirectory, "IV_Demo_Block.par");
            DeleteIfPresent(snapshotPartPath);
            part.SaveCopyAs(snapshotPartPath);
            Stage("native-snapshot-part", DescribeFile(snapshotPartPath));

            string stepPath = Path.Combine(outputDirectory, "IV_Demo_Block.stp");
            if (File.Exists(stepPath))
            {
                File.Delete(stepPath);
            }
            Stage("step-export", stepPath);
            part.SaveCopyAs(stepPath);
            Stage("step-result", DescribeFile(stepPath));

            string pdfPath = CreateDraftAndPdf(
                application,
                (string)part.FullName,
                outputDirectory,
                snapshotDirectory);
            Stage("pdf-result", DescribeFile(pdfPath));

            string metadataPath = Path.Combine(outputDirectory, "IV_Demo_Block.metadata.json");
            File.WriteAllText(
                metadataPath,
                "{\r\n" +
                "  \"schema_version\": \"1.0\",\r\n" +
                "  \"source_system\": \"solid_edge\",\r\n" +
                "  \"source_version\": \"" + EscapeJson((string)application.Version) + "\",\r\n" +
                "  \"created_by\": \"iV-Connect Agent\",\r\n" +
                "  \"component_context\": \"Demo component / block with center hole\",\r\n" +
                "  \"native_document\": \"IV_Demo_Block.par\",\r\n" +
                "  \"exports\": [\"IV_Demo_Block.stp\", \"IV_Demo_Block.pdf\"]\r\n" +
                "}\r\n");
            Stage("metadata-file", DescribeFile(metadataPath));

            CopyReplacing(stepPath, Path.Combine(snapshotDirectory, "IV_Demo_Block.stp"));
            CopyReplacing(pdfPath, Path.Combine(snapshotDirectory, "IV_Demo_Block.pdf"));
            CopyReplacing(metadataPath, Path.Combine(snapshotDirectory, "IV_Demo_Block.metadata.json"));
            Stage("runtime-snapshot", snapshotPartPath);

            part.Activate();

            try
            {
                application.ActiveWindow.View.Fit();
                Stage("fit-view", "success");
            }
            catch (Exception exception)
            {
                Stage("fit-view", "warning=" + exception.Message);
            }

            Console.WriteLine(String.Format(
                "RESULT=models={0}|profiles={1}|file={2}",
                part.Models.Count,
                part.ProfileSets.Count,
                part.FullName));
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

    private static void Stage(string name, string detail)
    {
        Console.WriteLine("STAGE=" + name + "|" + detail);
    }

    private static void WriteDocumentMetadata(dynamic part)
    {
        try
        {
            dynamic summary = part.SummaryInfo;
            summary.Author = "iV-Connect Agent";
            summary.Title = "IV Demo Block with Center Hole";
            summary.Comments = "Generated through the Mac-controlled Solid Edge demo flow.";
            summary.ProjectName = "Solid Edge Agent Demo";
            Stage("native-metadata", "Author, Title, Comments and Project updated");
        }
        catch (Exception exception)
        {
            Stage("native-metadata", "warning=" + exception.Message);
        }
    }

    private static string CreateDraftAndPdf(
        dynamic application,
        string partPath,
        string outputDirectory,
        string snapshotDirectory)
    {
        string draftPath = Path.Combine(outputDirectory, "IV_Demo_Block.dft");
        string pdfPath = Path.Combine(outputDirectory, "IV_Demo_Block.pdf");
        string draftTemplate = @"C:\Program Files\Siemens\Solid Edge 2026\Template\ISO Metric\iso metric draft.dft";

        dynamic documents = application.Documents;
        dynamic draft = FindOpenDocumentByPath(application, draftPath);
        if (draft == null && File.Exists(draftPath))
        {
            Stage("draft", "Open the existing Solid Edge drawing");
            draft = documents.Open(draftPath);
        }
        if (draft == null)
        {
            Stage("draft", "Create a Solid Edge drawing from the Part document");
            draft = documents.Add("SolidEdge.DraftDocument", draftTemplate);
            dynamic modelLink = draft.ModelLinks.Add(partPath);
            dynamic sheet = draft.ActiveSheet;
            dynamic drawingView = sheet.DrawingViews.AddPartView(
                modelLink,
                ViewOrientationConstants.igFrontView,
                1.0,
                0.14,
                0.12,
                PartDrawingViewTypeConstants.sePartDesignedView);
            drawingView.Caption = "IV Demo Block";
            drawingView.DisplayCaption = true;
            drawingView.Update();
            draft.SaveAs(draftPath, Missing.Value, Missing.Value, Missing.Value, Missing.Value,
                Missing.Value, Missing.Value, Missing.Value, Missing.Value);
        }
        draft.Activate();
        dynamic activeSheet = draft.ActiveSheet;
        if ((int)activeSheet.DrawingViews.Count > 0)
        {
            dynamic primaryView = activeSheet.DrawingViews.Item(1);
            primaryView.ScaleFactor = 4.0;
            primaryView.SetOrigin(0.18, 0.18);
            primaryView.DisplayCaption = true;
            primaryView.DisplayScale = true;
            primaryView.Update();
            draft.Save();
            Stage("draft-layout", "primary view scale=4:1; origin=180 x 180 mm");
        }
        Stage("draft-result", DescribeFile(draftPath));

        string snapshotDraftPath = Path.Combine(snapshotDirectory, "IV_Demo_Block.dft");
        DeleteIfPresent(snapshotDraftPath);
        draft.SaveCopyAs(snapshotDraftPath);
        Stage("native-snapshot-draft", DescribeFile(snapshotDraftPath));

        if (File.Exists(pdfPath))
        {
            File.Delete(pdfPath);
        }
        foreach (string stalePrintFile in Directory.GetFiles(outputDirectory, "IV_Demo_Block_*.pri"))
        {
            File.Delete(stalePrintFile);
        }
        Stage("pdf-export", pdfPath);
        dynamic printUtility = application.GetDraftPrintUtility();
        Stage("pdf-print-utility", "acquired");
        printUtility.RemoveAllDocuments();
        Stage("pdf-print-utility", "queue-cleared");
        printUtility.Printer = "Microsoft Print to PDF";
        Stage("pdf-print-utility", "printer-selected");
        printUtility.SheetsPerPage = DraftPrintSheetsPerPageConstants.igSingleSheet;
        Stage("pdf-print-utility", "single-sheet-mode");
        printUtility.PrintToFile = true;
        Stage("pdf-print-utility", "print-to-file-enabled");
        printUtility.PrintToFilePath = outputDirectory;
        Stage("pdf-print-utility", "target-directory=" + outputDirectory);
        printUtility.PrintAsBlack = true;
        Stage("pdf-print-utility", "black-lines-enabled");
        printUtility.AddDocument(draft);
        Stage("pdf-print-utility", "draft-queued");
        printUtility.PrintOut();
        Stage("pdf-print-utility", "print-complete");

        if (!File.Exists(pdfPath))
        {
            for (int attempt = 0; attempt < 100; attempt++)
            {
                if (Directory.GetFiles(outputDirectory, "IV_Demo_Block_*.pri").Length > 0)
                {
                    break;
                }
                System.Threading.Thread.Sleep(100);
            }

            FileInfo newestPdf = null;
            string[] candidatePaths = Directory.GetFiles(outputDirectory, "*.pdf");
            if (candidatePaths.Length == 0)
            {
                candidatePaths = Directory.GetFiles(outputDirectory, "IV_Demo_Block_*.pri");
            }
            foreach (string candidatePath in candidatePaths)
            {
                FileInfo candidate = new FileInfo(candidatePath);
                if (newestPdf == null || candidate.LastWriteTimeUtc > newestPdf.LastWriteTimeUtc)
                {
                    newestPdf = candidate;
                }
            }
            if (newestPdf != null && !String.Equals(newestPdf.FullName, pdfPath, StringComparison.OrdinalIgnoreCase))
            {
                WaitForExclusiveAccess(newestPdf.FullName, 10000);
                using (FileStream stream = newestPdf.OpenRead())
                {
                    byte[] signature = new byte[5];
                    if (stream.Read(signature, 0, signature.Length) != signature.Length ||
                        System.Text.Encoding.ASCII.GetString(signature) != "%PDF-")
                    {
                        throw new InvalidDataException("The print output is not a PDF: " + newestPdf.FullName);
                    }
                }
                File.Move(newestPdf.FullName, pdfPath);
            }
        }
        return pdfPath;
    }

    private static void DeleteIfPresent(string path)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }
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
        IOException lastException = null;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using (FileStream stream = new FileStream(
                    path,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.None))
                {
                    return;
                }
            }
            catch (IOException exception)
            {
                lastException = exception;
                System.Threading.Thread.Sleep(100);
            }
        }
        throw new IOException("Timed out waiting for the print output: " + path, lastException);
    }

    private static object FindDocumentByType(dynamic application, int documentType)
    {
        dynamic documents = application.Documents;
        for (int index = 1; index <= (int)documents.Count; index++)
        {
            dynamic document = documents.Item(index);
            if ((int)document.Type == documentType)
            {
                return document;
            }
        }
        throw new InvalidOperationException("No open Solid Edge Part document was found.");
    }

    private static object FindOpenDocumentByPath(dynamic application, string path)
    {
        dynamic documents = application.Documents;
        for (int index = 1; index <= (int)documents.Count; index++)
        {
            dynamic document = documents.Item(index);
            string fullName = (string)document.FullName;
            if (!String.IsNullOrEmpty(fullName) && String.Equals(
                Path.GetFullPath(fullName),
                Path.GetFullPath(path),
                StringComparison.OrdinalIgnoreCase))
            {
                return document;
            }
        }
        return null;
    }

    private static string DescribeFile(string path)
    {
        FileInfo file = new FileInfo(path);
        return String.Format("{0}; exists={1}; bytes={2}", path, file.Exists, file.Exists ? file.Length : 0);
    }

    private static string EscapeJson(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
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
}
