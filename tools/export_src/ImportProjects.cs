// ImportProjects.exe - restores a zip made by ExportProjects.exe into this Developer Workbench installation.
//  * asks for the zip (default folder: ~\Downloads)
//  * stops the Workbench while it copies (and starts it again afterwards) so no file is in use
//  * every file it replaces is first copied to <DWB>\import_backup\<date-time>\
//  * if the export came from another user / folder, C:\Users\<old> and the old DWB folder inside the imported
//    spreadsheets, JSON, SQL and text files are rewritten to this machine's paths
//
//   ImportProjects.exe                         interactive
//   ImportProjects.exe /S /ZIP=<file> [/NORESTART]   silent
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Developer Workbench - Import Projects")]
[assembly: AssemblyProduct("Developer Workbench")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string dwb = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string zip = "";
        bool silent = false, restart = true;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            else if (a.Equals("/NORESTART", StringComparison.OrdinalIgnoreCase)) restart = false;
            else if (a.StartsWith("/ZIP=", StringComparison.OrdinalIgnoreCase)) zip = a.Substring(5).Trim('"');
        }
        if (silent) return Importer.Run(dwb, zip, restart, Console.Out.WriteLine) ? 0 : 1;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm(dwb));
        return 0;
    }
}

class Manifest
{
    public string Created = "", Machine = "", User = "", Home = "", DwbRoot = "", SrcRoot = "";
    public int Files; public bool Secrets;
}

static class Importer
{
    static readonly string[] TextExt = { ".json", ".sql", ".xml", ".csv", ".txt", ".properties" };


    // Project data used to live inside the program folder; it now lives in <DWB>\Projects\<type>.
    // Returns the path below Projects\ for a legacy program-relative path, or null when it is not project data.
    public static string MapLegacy(string rel)
    {
        string r = rel.Replace('/', '\\');
        string[][] simple = {
            new string[] { @"WorkFlows\GP_Build\", "GP_Build" }, new string[] { @"WorkFlows\Jenkins_BaseLine\", "Jenkins_BaseLine" },
            new string[] { @"WorkFlows\Jenkins_IT_Regression\", "Jenkins_IT_Regression" }, new string[] { @"WorkFlows\Jenkins_Commit_Job\", "Jenkins_Commit_Job" },
            new string[] { @"WorkFlows\Jenkins_Payor_Utils_Certification\", "Payor_Utils_Certification" }, new string[] { @"WorkFlows\Clone_WorkFlow\", "Clone_Workflow" } };
        foreach (string[] p in simple)
            if (r.StartsWith(p[0], StringComparison.OrdinalIgnoreCase))
            {
                string t = r.Substring(p[0].Length);
                if (t.Equals("projects.xlsx", StringComparison.OrdinalIgnoreCase) || t.StartsWith(@"projects\", StringComparison.OrdinalIgnoreCase)) return p[0] + t;
            }
        if (r.StartsWith(@"Remote_Setup\", StringComparison.OrdinalIgnoreCase))
        {
            string t = r.Substring(13);
            if (t.Equals("projects.xlsx", StringComparison.OrdinalIgnoreCase) || t.StartsWith(@"configured_servers\", StringComparison.OrdinalIgnoreCase)) return @"Remote_Setup\" + t;
        }
        if (r.StartsWith(@"WorkFlows\Remote_Melissa_Data_Update_License\", StringComparison.OrdinalIgnoreCase))
        {
            string t = r.Substring(@"WorkFlows\Remote_Melissa_Data_Update_License\".Length);
            if (t.Equals("projects.xlsx", StringComparison.OrdinalIgnoreCase) || t.StartsWith(@"remote_images\", StringComparison.OrdinalIgnoreCase)) return @"WorkFlows\Remote_Melissa_Data_Update_License\" + t;
        }
        if (r.StartsWith(@"WorkFlows\Local_Clone_Tool\", StringComparison.OrdinalIgnoreCase))
        {
            string t = r.Substring(@"WorkFlows\Local_Clone_Tool\".Length);
            if (t.Equals("projects.xlsx", StringComparison.OrdinalIgnoreCase) || t.StartsWith(@"projects\", StringComparison.OrdinalIgnoreCase)) return @"WorkFlows\Local_Clone_Tool\" + t;
        }
        if (r.StartsWith(@"WorkFlows\Remote_Regression_Jenkins_IT_Failure\", StringComparison.OrdinalIgnoreCase))
        {
            string t = r.Substring(@"WorkFlows\Remote_Regression_Jenkins_IT_Failure\".Length);
            if (t.Equals("projects.xlsx", StringComparison.OrdinalIgnoreCase)) return @"WorkFlows\Remote_Regression_Jenkins_IT_Failure\projects.xlsx";
            if (t.StartsWith(@"projects\", StringComparison.OrdinalIgnoreCase))
            {
                string[] q = t.Split('\\');                       // projects \ <app> \ (projects|output|logs) \ ...
                if (q.Length > 3 && (q[2] == "projects" || q[2] == "output" || q[2] == "logs")) return @"WorkFlows\Remote_Regression_Jenkins_IT_Failure\" + string.Join("\\", q, 1, q.Length - 1);
            }
        }
        if (r.StartsWith(@"Project_Management\Sprint\", StringComparison.OrdinalIgnoreCase))
        {
            string t = r.Substring(@"Project_Management\Sprint\".Length);
            foreach (string d in new string[] { @"Sprints\", @"PreviousSprints\", @"Projects\", @"Tasks\" })
                if (t.StartsWith(d, StringComparison.OrdinalIgnoreCase)) return @"Project_Management\Sprint\" + t;
        }
        if (r.Equals(@"Tools\AIAnalyzer\projects.xlsx", StringComparison.OrdinalIgnoreCase)) return @"Tools\AIAnalyzer\projects.xlsx";
        return null;
    }

    static string Field(string json, string name)
    {
        Match m = Regex.Match(json, "\"" + name + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        return m.Success ? Regex.Unescape(m.Groups[1].Value) : "";
    }

    public static Manifest ReadManifest(string zipPath)
    {
        using (ZipArchive z = ZipFile.OpenRead(zipPath))
        {
            ZipArchiveEntry e = z.GetEntry("manifest.json");
            if (e == null) return null;
            string json; using (StreamReader r = new StreamReader(e.Open(), Encoding.UTF8)) json = r.ReadToEnd();
            Manifest m = new Manifest { Created = Field(json, "created"), Machine = Field(json, "machine"), User = Field(json, "user"), Home = Field(json, "home"), DwbRoot = Field(json, "dwb_root"), SrcRoot = Field(json, "src_root") };
            Match f = Regex.Match(json, "\"files\"\\s*:\\s*(\\d+)"); if (f.Success) m.Files = int.Parse(f.Groups[1].Value);
            m.Secrets = Regex.IsMatch(json, "\"secrets\"\\s*:\\s*true");
            return m;
        }
    }

    // old -> new for every spelling a path can have inside the files (C:\x, C:/x, C:\\x)
    static string Rewrite(string text, List<string[]> pairs)
    {
        foreach (string[] p in pairs)
        {
            text = Regex.Replace(text, Regex.Escape(p[0]), p[1].Replace("$", "$$"), RegexOptions.IgnoreCase);
            text = Regex.Replace(text, Regex.Escape(p[0].Replace("\\", "/")), p[1].Replace("\\", "/").Replace("$", "$$"), RegexOptions.IgnoreCase);
            text = Regex.Replace(text, Regex.Escape(p[0].Replace("\\", "\\\\")), p[1].Replace("\\", "\\\\").Replace("$", "$$"), RegexOptions.IgnoreCase);
        }
        return text;
    }

    // is THIS installation's server running?  (its own ui.pid names a live python.exe from this folder - another
    // Workbench on the same port, e.g. a second installation, does not count)
    static bool IsRunning(string src)
    {
        try
        {
            string pidFile = Path.Combine(src, "Internal_Developer_Tool", "ui.pid");
            if (!File.Exists(pidFile)) return false;
            int pid = int.Parse(File.ReadAllText(pidFile).Trim());
            using (Process p = Process.GetProcessById(pid))
                return !p.HasExited && p.MainModule.FileName.StartsWith(src, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    static int Port(string src)
    {
        try
        {
            string cfg = Path.Combine(src, "Internal_Developer_Tool", "scripts", "idp_config.json");
            if (File.Exists(cfg)) { Match m = Regex.Match(File.ReadAllText(cfg), "\"server_port\"\\s*:\\s*(\\d+)"); if (m.Success) return int.Parse(m.Groups[1].Value); }
        }
        catch { }
        return 5556;
    }

    static void Launcher(string src, string args)
    {
        string exe = Path.Combine(src, "DeveloperWorkbench.exe");
        if (!File.Exists(exe)) return;
        ProcessStartInfo psi = new ProcessStartInfo(exe, args) { WorkingDirectory = src, UseShellExecute = false, CreateNoWindow = true };
        using (Process p = Process.Start(psi)) { p.WaitForExit(60000); }
    }

    public static bool Run(string dwbRoot, string zipPath, bool restart, Action<string> log)
    {
        string src = Path.Combine(dwbRoot, "DeveloperWorkBench");
        if (!Directory.Exists(src)) { log("ERROR: " + src + " not found. ImportProjects.exe must sit in the DWB folder, next to DeveloperWorkBench\\."); return false; }
        if (string.IsNullOrEmpty(zipPath) || !File.Exists(zipPath)) { log("ERROR: choose an export zip."); return false; }
        bool wasUp = false;
        try
        {
            Manifest m = ReadManifest(zipPath);
            if (m == null) { log("ERROR: this zip has no manifest.json - it was not made by ExportProjects.exe."); return false; }
            log("Export from " + m.User + "@" + m.Machine + ", " + m.Created + " (" + m.Files + " files" + (m.Secrets ? ", includes secrets.xlsx" : "") + ")");

            // path rewrite rules (longest first)
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            List<string[]> pairs = new List<string[]>();
            // the exported program folder (DeveloperWorkBench, or an old DeveloperPlatform) -> this installation's program folder
            if (m.SrcRoot.Length > 0 && !m.SrcRoot.Equals(src, StringComparison.OrdinalIgnoreCase)) pairs.Add(new string[] { m.SrcRoot, src });
            if (m.DwbRoot.Length > 0 && !m.DwbRoot.Equals(dwbRoot, StringComparison.OrdinalIgnoreCase)) pairs.Add(new string[] { m.DwbRoot, dwbRoot });
            if (m.Home.Length > 0 && !m.Home.Equals(home, StringComparison.OrdinalIgnoreCase)) pairs.Add(new string[] { m.Home, home });
            if (pairs.Count > 0) log("Paths from the export will be rewritten: " + string.Join("  ", pairs.ConvertAll(delegate (string[] p) { return p[0] + " -> " + p[1]; }).ToArray()));

            int port = Port(src);
            wasUp = IsRunning(src);
            if (wasUp) { log("Stopping the Workbench while the data is copied ..."); Launcher(src, "--stop"); Thread.Sleep(2500); }

            string backup = Path.Combine(dwbRoot, "import_backup", DateTime.Now.ToString("yyyyMMdd_HHmmss"));
            string projRoot = Path.Combine(dwbRoot, "Projects");
            int added = 0, replaced = 0, rewritten = 0;
            using (ZipArchive z = ZipFile.OpenRead(zipPath))
            {
                foreach (ZipArchiveEntry e in z.Entries)
                {
                    if (e.FullName.StartsWith("skeleton/", StringComparison.Ordinal))
                    {
                        string sd = Path.GetFullPath(Path.Combine(dwbRoot, e.FullName.Substring(9).Replace('/', '\\')));
                        if (sd.StartsWith(dwbRoot + "\\", StringComparison.OrdinalIgnoreCase)) Directory.CreateDirectory(sd);
                        continue;
                    }
                    if (e.FullName.EndsWith("/")) continue;
                    bool isProj = e.FullName.StartsWith("projects/", StringComparison.Ordinal);
                    if (!isProj && !e.FullName.StartsWith("data/", StringComparison.Ordinal)) continue;
                    string rel = e.FullName.Substring(isProj ? 9 : 5).Replace('/', '\\');
                    string baseDir = src;
                    if (isProj) baseDir = projRoot;                                     // <DWB>\Projects\<type>\...
                    else { string mp = MapLegacy(rel); if (mp != null) { rel = mp; baseDir = projRoot; } }   // older exports kept project data inside the program folder
                    string dest = Path.GetFullPath(Path.Combine(baseDir, rel));
                    if (!dest.StartsWith(baseDir + "\\", StringComparison.OrdinalIgnoreCase)) continue;      // never write outside the installation
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    if (File.Exists(dest))
                    {
                        string b = Path.Combine(backup, isProj || baseDir == projRoot ? "Projects" : "DeveloperWorkBench", rel);
                        Directory.CreateDirectory(Path.GetDirectoryName(b));
                        File.Copy(dest, b, true);
                        replaced++;
                    }
                    else added++;

                    string ext = Path.GetExtension(dest).ToLowerInvariant();
                    if (pairs.Count > 0 && Array.IndexOf(TextExt, ext) >= 0)
                    {
                        string t; using (StreamReader r = new StreamReader(e.Open(), Encoding.UTF8)) t = r.ReadToEnd();
                        string t2 = Rewrite(t, pairs);
                        File.WriteAllText(dest, t2, new UTF8Encoding(false));
                        if (t2 != t) rewritten++;
                    }
                    else
                    {
                        e.ExtractToFile(dest, true);
                        if (pairs.Count > 0 && (ext == ".xlsx" || ext == ".docx") && RewriteOffice(dest, pairs)) rewritten++;
                    }
                    File.SetLastWriteTime(dest, e.LastWriteTime.LocalDateTime);
                }
            }
            log("Imported: " + added + " new, " + replaced + " replaced" + (pairs.Count > 0 ? ", " + rewritten + " with rewritten paths" : "") + ".");
            if (replaced > 0) log("Replaced files were saved in " + backup);
            if (m.Secrets) log("secrets.xlsx was imported.");
            else if (!File.Exists(Path.Combine(src, "secrets.xlsx"))) log("Note: the export has no secrets.xlsx - fill in the values in " + Path.Combine(src, "secrets.xlsx") + ".");

            if (wasUp && restart) { log("Starting the Workbench again ..."); Launcher(src, "--port " + port); }
            else if (wasUp) log("The Workbench was stopped - start it from the shortcut.");
            return true;
        }
        catch (Exception ex)
        {
            log("ERROR: " + ex.Message);
            return false;
        }
    }

    // spreadsheets / documents are zip packages: rewrite the strings inside
    static bool RewriteOffice(string file, List<string[]> pairs)
    {
        bool any = false;
        using (ZipArchive z = ZipFile.Open(file, ZipArchiveMode.Update))
        {
            foreach (ZipArchiveEntry e in new List<ZipArchiveEntry>(z.Entries))
            {
                if (!e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)) continue;
                string t; using (StreamReader r = new StreamReader(e.Open(), Encoding.UTF8)) t = r.ReadToEnd();
                string t2 = Rewrite(t, pairs);
                if (t2 == t) continue;
                string name = e.FullName; e.Delete();
                ZipArchiveEntry ne = z.CreateEntry(name);
                using (StreamWriter w = new StreamWriter(ne.Open(), new UTF8Encoding(false))) w.Write(t2);
                any = true;
            }
        }
        return any;
    }
}

class MainForm : Form
{
    readonly string dwb;
    TextBox txtZip, log;
    CheckBox chkRestart;
    Button btnBrowse, btnImport, btnClose;
    ProgressBar bar;
    Label info, hint;
    bool done;

    public MainForm(string dwb)
    {
        this.dwb = dwb;
        Text = "Developer Workbench - Import Projects";
        ClientSize = new Size(620, 430);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Controls.Add(new Label { Text = "Import projects and settings", Font = new Font("Segoe UI", 14F, FontStyle.Bold), Left = 20, Top = 14, Width = 580, Height = 28 });
        Controls.Add(new Label { Text = "Choose a zip made by ExportProjects.exe. Files that already exist are replaced; the old versions are kept in\r\n" + Path.Combine(dwb, "import_backup") + "\\<date-time>.", Left = 20, Top = 46, Width = 580, Height = 40 });
        Controls.Add(new Label { Text = "Export zip:", Left = 20, Top = 94, Width = 400 });
        txtZip = new TextBox { Left = 20, Top = 116, Width = 490 };
        btnBrowse = new Button { Text = "Browse...", Left = 520, Top = 114, Width = 80 };
        btnBrowse.Click += delegate
        {
            using (OpenFileDialog d = new OpenFileDialog
            {
                Title = "Select the export zip", Filter = "Workbench export (*.zip)|*.zip|All files|*.*",
                InitialDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads")
            })
                if (d.ShowDialog(this) == DialogResult.OK) { txtZip.Text = d.FileName; ShowInfo(); }
        };
        txtZip.Leave += delegate { ShowInfo(); };
        info = new Label { Left = 20, Top = 146, Width = 580, Height = 34, ForeColor = Color.DimGray };
        chkRestart = new CheckBox { Text = "Start the Workbench again afterwards (if it was running)", Left = 20, Top = 184, Width = 560, Checked = true };
        bar = new ProgressBar { Left = 20, Top = 212, Width = 580, Height = 14, Visible = false, Style = ProgressBarStyle.Marquee };
        log = new TextBox { Left = 20, Top = 234, Width = 580, Height = 150, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.White, Font = new Font("Consolas", 8.5F) };
        hint = new Label { Left = 20, Top = 392, Width = 400, Height = 30, ForeColor = Color.DimGray };
        btnImport = new Button { Text = "Import", Left = 430, Top = 394, Width = 90 };
        btnClose = new Button { Text = "Close", Left = 526, Top = 394, Width = 74 };
        btnClose.Click += delegate { Close(); };
        btnImport.Click += OnImport;
        AcceptButton = btnImport;
        Controls.AddRange(new Control[] { txtZip, btnBrowse, info, chkRestart, bar, log, hint, btnImport, btnClose });
    }

    void ShowInfo()
    {
        info.Text = "";
        try
        {
            if (!File.Exists(txtZip.Text)) return;
            Manifest m = Importer.ReadManifest(txtZip.Text);
            info.ForeColor = m == null ? Color.Firebrick : Color.DimGray;
            info.Text = m == null ? "This zip was not made by ExportProjects.exe." :
                "From " + m.User + "@" + m.Machine + " on " + m.Created + " - " + m.Files + " files" + (m.Secrets ? " (includes secrets.xlsx)" : "");
        }
        catch (Exception ex) { info.ForeColor = Color.Firebrick; info.Text = ex.Message; }
    }

    void OnImport(object sender, EventArgs e)
    {
        if (done) { Close(); return; }
        string zip = txtZip.Text.Trim().Trim('"');
        if (!File.Exists(zip)) { MessageBox.Show(this, "Choose the export zip first (Browse...).", Text); return; }
        if (MessageBox.Show(this, "Import this export into " + Path.Combine(dwb, "DeveloperWorkBench") + "?\r\n\r\nExisting files with the same name are replaced (a backup is kept). The Workbench is stopped while the data is copied.",
                            Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        bool restart = chkRestart.Checked;
        btnImport.Enabled = btnBrowse.Enabled = txtZip.Enabled = chkRestart.Enabled = false;
        bar.Visible = true; log.Clear(); hint.ForeColor = Color.DimGray; hint.Text = "Importing...";
        Thread t = new Thread(delegate ()
        {
            bool ok = Importer.Run(dwb, zip, restart, delegate (string line) { BeginInvoke((Action)delegate { log.AppendText(line + "\r\n"); }); });
            BeginInvoke((Action)delegate
            {
                bar.Visible = false;
                if (ok) { done = true; hint.ForeColor = Color.ForestGreen; hint.Text = "Done."; btnImport.Text = "Close"; btnImport.Enabled = true; }
                else { hint.ForeColor = Color.Firebrick; hint.Text = "The import failed - see the log."; btnImport.Enabled = btnBrowse.Enabled = txtZip.Enabled = chkRestart.Enabled = true; }
            });
        });
        t.IsBackground = true;
        t.Start();
    }
}
