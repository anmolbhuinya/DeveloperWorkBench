// ExportProjects.exe - exports everything the Developer Workbench needs to move or restore your work:
// settings, workflow / GP / clone / sprint / AI Analyzer projects, saved queries, run history, VM and app configuration.
// The code, the bundled Python and the UI are NOT exported (the installer provides those).
// Result: one compressed zip (default ~\Downloads\DeveloperWorkbench_Export_<date>.zip) for ImportProjects.exe.
//
//   ExportProjects.exe                                 interactive
//   ExportProjects.exe /S [/OUT=C:\folder] [/SECRETS]   silent  (/SECRETS also exports secrets.xlsx incl. passwords and tokens)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Developer Workbench - Export Projects")]
[assembly: AssemblyProduct("Developer Workbench")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string dwb = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string outDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        bool silent = false, secrets = false;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            else if (a.Equals("/SECRETS", StringComparison.OrdinalIgnoreCase)) secrets = true;
            else if (a.StartsWith("/OUT=", StringComparison.OrdinalIgnoreCase)) outDir = Exporter.Expand(a.Substring(5));
        }
        if (silent) return Exporter.Run(dwb, outDir, secrets, Console.Out.WriteLine) != null ? 0 : 1;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm(dwb, outDir));
        return 0;
    }
}

static class Exporter
{
    // data lives in these folders (everything inside is exported) ...
    static readonly string[] DataDirs = { "Data", "stats", "projects", "Sprints", "PreviousSprints", "Projects", "Tasks", "configured_servers",
                                          "remote_images", "output", "Sonar_Report", "docker_state", "dockercompose", "remote_deployed_info" };
    // ... or is a file of these types anywhere outside the code folders
    static readonly string[] DataExt = { ".xlsx", ".xls", ".json", ".sql", ".xml", ".csv", ".txt" };
    static readonly string[] SkipDirs = { "python", "node_modules", "__pycache__", "static", "ui", "installer_src", "tests", "wrappers", ".git",
                                          "docker_scripts", "secrets_management", "scripts" };
    static readonly string[] SkipExt = { ".log", ".pid", ".lock", ".tmp", ".exe", ".pyc" };
    static readonly string[] CodeExt = { ".js", ".jsx", ".py", ".ps1", ".sh", ".cmd", ".bat", ".cs", ".md", ".css", ".html", ".map", ".svg", ".png", ".ico", ".yaml", ".yml" };
    static readonly string[] SkipNames = { "README.txt", "install.txt", "package.json", "package-lock.json", ".secrets_path" };

    public static string Expand(string p)
    {
        p = Environment.ExpandEnvironmentVariables((p ?? "").Trim().Trim('"'));
        if (p == "~" || p.StartsWith("~\\") || p.StartsWith("~/")) p = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + p.Substring(1);
        return p;
    }

    static bool Wanted(string rel, bool secrets)
    {
        string[] parts = rel.Split('\\');
        string name = parts[parts.Length - 1], ext = Path.GetExtension(name).ToLowerInvariant();
        if (name.Equals("secrets.xlsx", StringComparison.OrdinalIgnoreCase)) return secrets && parts.Length == 1;
        bool dcDir = rel.IndexOf("dockercompose\\", StringComparison.OrdinalIgnoreCase) >= 0;   // saved compose files are data
        if (Array.IndexOf(CodeExt, ext) >= 0 && !dcDir) return false;                           // never code, even inside a data folder
        if (Array.IndexOf(SkipExt, ext) >= 0 || Array.IndexOf(SkipNames, name) >= 0 || name.IndexOf(".bak", StringComparison.OrdinalIgnoreCase) >= 0) return false;
        if (rel.Equals("Internal_Developer_Tool\\scripts\\idp_config.json", StringComparison.OrdinalIgnoreCase)) return true;   // server settings
        bool inData = false;
        for (int i = 0; i < parts.Length - 1; i++)
        {
            if (Array.IndexOf(DataDirs, parts[i]) >= 0) inData = true;
            else if (!inData && Array.IndexOf(SkipDirs, parts[i]) >= 0) return false;
        }
        if (inData) return true;
        return Array.IndexOf(DataExt, ext) >= 0;
    }

    // returns the zip path, or null
    public static string Run(string dwbRoot, string outDir, bool secrets, Action<string> log)
    {
        string src = Path.Combine(dwbRoot, "DeveloperWorkBench");
        if (!Directory.Exists(src)) { log("ERROR: " + src + " not found. ExportProjects.exe must sit in the DWB folder, next to DeveloperWorkBench\\."); return null; }
        outDir = Expand(outDir);
        if (outDir.Length == 0 || !Path.IsPathRooted(outDir)) { log("ERROR: enter a full output folder."); return null; }
        try
        {
            Directory.CreateDirectory(outDir);
            string zip = Path.Combine(outDir, "DeveloperWorkbench_Export_" + DateTime.Now.ToString("yyyy-MM-dd_HHmm") + ".zip");
            if (File.Exists(zip)) File.Delete(zip);
            List<string> files = new List<string>();
            Collect(src, src, secrets, files);
            log("Exporting " + files.Count + " files from " + src + " ...");
            long total = 0;
            using (ZipArchive z = ZipFile.Open(zip, ZipArchiveMode.Create))
            {
                foreach (string rel in files)
                {
                    string full = Path.Combine(src, rel);
                    try
                    {
                        // read with sharing so a running Workbench does not block the export
                        using (FileStream fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                        {
                            ZipArchiveEntry e = z.CreateEntry("data/" + rel.Replace('\\', '/'), CompressionLevel.Optimal);
                            e.LastWriteTime = File.GetLastWriteTime(full);
                            using (Stream es = e.Open()) fs.CopyTo(es);
                            total += fs.Length;
                        }
                    }
                    catch (IOException ex) { log("  skipped (in use): " + rel + " - " + ex.Message); }
                }
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string manifest = "{\n  \"app\": \"DeveloperWorkbench\",\n  \"format\": 1,\n  \"created\": \"" + DateTime.Now.ToString("yyyy-MM-dd HH:mm") + "\",\n" +
                    "  \"machine\": \"" + J(Environment.MachineName) + "\",\n  \"user\": \"" + J(Environment.UserName) + "\",\n" +
                    "  \"home\": \"" + J(home) + "\",\n  \"dwb_root\": \"" + J(dwbRoot) + "\",\n  \"files\": " + files.Count + ",\n  \"secrets\": " + (secrets ? "true" : "false") + "\n}\n";
                ZipArchiveEntry m = z.CreateEntry("manifest.json");
                using (StreamWriter w = new StreamWriter(m.Open(), new UTF8Encoding(false))) w.Write(manifest);
            }
            log("Created " + zip + " (" + (new FileInfo(zip).Length / 1024) + " KB from " + (total / 1024) + " KB)" + (secrets ? " - contains secrets.xlsx: keep it private" : ""));
            return zip;
        }
        catch (Exception ex) { log("ERROR: " + ex.Message); return null; }
    }

    static string J(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }

    static void Collect(string root, string dir, bool secrets, List<string> files)
    {
        foreach (string f in Directory.GetFiles(dir))
        {
            string rel = f.Substring(root.Length + 1);
            if (Wanted(rel, secrets)) files.Add(rel);
        }
        foreach (string d in Directory.GetDirectories(dir))
        {
            string name = Path.GetFileName(d);
            if (name == "python" || name == "node_modules" || name == "__pycache__" || name == ".git") continue;
            Collect(root, d, secrets, files);
        }
    }
}

class MainForm : Form
{
    readonly string dwb;
    TextBox txtOut, log;
    CheckBox chkSecrets;
    Button btnBrowse, btnExport, btnClose;
    ProgressBar bar;
    Label hint;
    string created;

    public MainForm(string dwb, string outDir)
    {
        this.dwb = dwb;
        Text = "Developer Workbench - Export Projects";
        ClientSize = new Size(620, 400);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Controls.Add(new Label { Text = "Export projects and settings", Font = new Font("Segoe UI", 14F, FontStyle.Bold), Left = 20, Top = 14, Width = 580, Height = 28 });
        Controls.Add(new Label
        {
            Text = "Saves your Workbench data as one compressed zip: settings, workflow / GP / clone / sprint / AI Analyzer projects,\r\nsaved queries and run history. Code and the bundled Python are not included. Restore it with ImportProjects.exe.",
            Left = 20, Top = 46, Width = 580, Height = 44
        });
        Controls.Add(new Label { Text = "Save the zip in:   (~ = your user folder)", Left = 20, Top = 96, Width = 400 });
        txtOut = new TextBox { Left = 20, Top = 118, Width = 490, Text = outDir };
        btnBrowse = new Button { Text = "Browse...", Left = 520, Top = 116, Width = 80 };
        btnBrowse.Click += delegate
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog { Description = "Where should the export be saved?", SelectedPath = Exporter.Expand(txtOut.Text) })
                if (d.ShowDialog(this) == DialogResult.OK) txtOut.Text = d.SelectedPath;
        };
        chkSecrets = new CheckBox { Text = "Also export secrets.xlsx (contains passwords and tokens - keep the zip private)", Left = 20, Top = 150, Width = 580, Checked = false };
        bar = new ProgressBar { Left = 20, Top = 180, Width = 580, Height = 14, Visible = false, Style = ProgressBarStyle.Marquee };
        log = new TextBox { Left = 20, Top = 202, Width = 580, Height = 150, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.White, Font = new Font("Consolas", 8.5F) };
        hint = new Label { Left = 20, Top = 362, Width = 400, Height = 30, ForeColor = Color.DimGray };
        btnExport = new Button { Text = "Export", Left = 430, Top = 364, Width = 90 };
        btnClose = new Button { Text = "Close", Left = 526, Top = 364, Width = 74 };
        btnClose.Click += delegate { Close(); };
        btnExport.Click += OnExport;
        AcceptButton = btnExport;
        Controls.AddRange(new Control[] { txtOut, btnBrowse, chkSecrets, bar, log, hint, btnExport, btnClose });
    }

    void OnExport(object sender, EventArgs e)
    {
        if (created != null) { Process.Start("explorer.exe", "/select,\"" + created + "\""); return; }
        string outDir = Exporter.Expand(txtOut.Text);
        bool secrets = chkSecrets.Checked;
        btnExport.Enabled = btnBrowse.Enabled = txtOut.Enabled = chkSecrets.Enabled = false;
        bar.Visible = true; log.Clear(); hint.ForeColor = Color.DimGray; hint.Text = "Exporting...";
        Thread t = new Thread(delegate ()
        {
            string res = Exporter.Run(dwb, outDir, secrets, delegate (string line) { BeginInvoke((Action)delegate { log.AppendText(line + "\r\n"); }); });
            BeginInvoke((Action)delegate
            {
                bar.Visible = false;
                if (res != null) { created = res; hint.ForeColor = Color.ForestGreen; hint.Text = "Done."; btnExport.Text = "Show in folder"; btnExport.Enabled = true; }
                else { hint.ForeColor = Color.Firebrick; hint.Text = "The export failed - see the log."; btnExport.Enabled = btnBrowse.Enabled = txtOut.Enabled = chkSecrets.Enabled = true; }
            });
        });
        t.IsBackground = true;
        t.Start();
    }
}
