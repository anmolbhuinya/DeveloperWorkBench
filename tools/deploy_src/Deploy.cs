// Deploy.exe - publishes the development copy (Workspace\src) to the running installation (DeveloperWorkBench).
//
//   1. builds the React UI with the portable Node.js in Workspace\tools\node (no internet needed)
//   2. copies every changed CODE file from Workspace\src to ..\DeveloperWorkBench  (py, js, jsx, css, html, scripts ...)
//      - the built UI (Internal_Developer_Tool\static) is mirrored exactly
//      - settings and data are never overwritten: secrets.xlsx, *.xlsx, *.docx, idp_config.json, run history ...
//        (spreadsheets / documents are only copied when they do not exist yet)
//   3. restarts the Workbench (only if it was running) so the changes are live
//
//   Deploy.exe                      interactive
//   Deploy.exe /S [/NOBUILD] [/NORESTART] [/TARGET=<DeveloperWorkBench folder>] [/PORT=5556]
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Developer Workbench - Deploy")]
[assembly: AssemblyProduct("Developer Workbench")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        Options o = new Options();
        bool silent = false;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            else if (a.Equals("/NOBUILD", StringComparison.OrdinalIgnoreCase)) o.Build = false;
            else if (a.Equals("/NORESTART", StringComparison.OrdinalIgnoreCase)) o.Restart = false;
            else if (a.StartsWith("/TARGET=", StringComparison.OrdinalIgnoreCase)) o.Target = a.Substring(8).Trim('"');
            else if (a.StartsWith("/PORT=", StringComparison.OrdinalIgnoreCase)) int.TryParse(a.Substring(6), out o.Port);
        }
        if (silent)
        {
            string log = Path.Combine(Path.GetTempPath(), "dwb_deploy.log");
            File.WriteAllText(log, "");
            bool ok = Deployer.Run(o, delegate (string l) { Console.Out.WriteLine(l); File.AppendAllText(log, l + "\r\n"); });
            return ok ? 0 : 1;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm(o));
        return 0;
    }
}

class Options
{
    public bool Build = true, Restart = true;
    public string Target = "";      // default: <Workspace>\..\DeveloperWorkBench
    public int Port = 0;            // default: server_port of the installation (5556)
}

static class Deployer
{
    static readonly string[] CodeExt = { ".py", ".js", ".jsx", ".mjs", ".css", ".html", ".svg", ".ico", ".png", ".json", ".ps1", ".sh", ".bat", ".cmd", ".cs", ".md", ".txt", ".map", ".woff", ".woff2" };
    static readonly string[] DataExt = { ".xlsx", ".docx", ".xls" };
    static readonly string[] SkipDirs = { "node_modules", "__pycache__", ".git", "tests" };
    static readonly string[] NeverOverwrite = { "idp_config.json", "secrets.xlsx", "vms.xlsx", "katalon_params.xlsx", "fetch_build_params.py" };   // local copies are kept if they exist

    public static bool Run(Options o, Action<string> log)
    {
        string ws = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string src = Path.Combine(ws, "src");
        string target = string.IsNullOrEmpty(o.Target) ? Path.Combine(Path.GetDirectoryName(ws), "DeveloperWorkBench") : Environment.ExpandEnvironmentVariables(o.Target);
        if (!Directory.Exists(src)) { log("ERROR: " + src + " not found."); return false; }
        if (!Directory.Exists(target)) { log("ERROR: the installation " + target + " was not found."); return false; }
        log("Workspace : " + src);
        log("Deploy to : " + target);

        // ── 1. build the UI ──
        string ui = Path.Combine(src, "Internal_Developer_Tool", "ui");
        if (o.Build)
        {
            string node = Path.Combine(ws, "tools", "node", "node.exe");
            if (!File.Exists(node)) { log("ERROR: portable Node.js missing: " + node); return false; }
            if (!Directory.Exists(Path.Combine(ui, "node_modules")))
            {
                log("node_modules missing - running npm install (needs internet) ...");
                if (Exec(node, "\"" + Path.Combine(ws, "tools", "node", "node_modules", "npm", "bin", "npm-cli.js") + "\" install", ui, log, 15) != 0) { log("ERROR: npm install failed."); return false; }
            }
            log("Building the UI ...");
            if (Exec(node, "\"" + Path.Combine(ui, "node_modules", "vite", "bin", "vite.js") + "\" build", ui, log, 10) != 0) { log("ERROR: the UI build failed - nothing was deployed."); return false; }
        }
        else log("UI build skipped.");

        // ── 2. copy changed files ──
        int copied = 0, same = 0, skipped = 0, removed = 0;
        string staticRel = Path.Combine("Internal_Developer_Tool", "static");
        foreach (string file in Walk(src))
        {
            string rel = file.Substring(src.Length + 1);
            string ext = Path.GetExtension(file).ToLowerInvariant();
            string name = Path.GetFileName(file);
            string dest = Path.Combine(target, rel);
            bool exists = File.Exists(dest);
            bool isData = Array.IndexOf(DataExt, ext) >= 0 || Array.IndexOf(NeverOverwrite, name.ToLowerInvariant()) >= 0;
            if (isData && exists) { skipped++; continue; }                         // never touch settings / data
            if (!isData && Array.IndexOf(CodeExt, ext) < 0) { skipped++; continue; }
            if (exists && SameFile(file, dest)) { same++; continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            File.Copy(file, dest, true);
            copied++;
            log("  updated  " + rel);
        }
        // the built UI is mirrored exactly (old hashed bundles are removed)
        string sSrc = Path.Combine(src, staticRel), sDst = Path.Combine(target, staticRel);
        if (Directory.Exists(sSrc) && Directory.Exists(sDst))
        {
            foreach (string f in Directory.GetFiles(sDst, "*", SearchOption.AllDirectories))
            {
                string rel = f.Substring(sDst.Length + 1);
                if (!File.Exists(Path.Combine(sSrc, rel))) { try { File.Delete(f); removed++; } catch { } }
            }
        }
        log("Files: " + copied + " updated, " + same + " unchanged, " + removed + " old UI files removed, " + skipped + " left alone (data / settings).");

        // CreateInstaller.exe lives in the DWB folder (next to DeveloperWorkBench\), built from src\installer_src
        foreach (string exeName in new string[] { "CreateInstaller.exe", "ExportProjects.exe", "ImportProjects.exe" })
        {
            string ci = Path.Combine(ws, exeName), ciDest = Path.Combine(Path.GetDirectoryName(target), exeName);
            if (File.Exists(ci) && (!File.Exists(ciDest) || !SameFile(ci, ciDest)))
            {
                try { File.Copy(ci, ciDest, true); log("  updated  " + exeName + " (DWB folder)"); }
                catch (IOException) { log("  " + exeName + " is running - close it and deploy again to update it."); }
            }
        }

        // ── 3. restart ──
        if (!o.Restart) { log("Restart skipped."); return true; }
        string launcher = Path.Combine(target, "DeveloperWorkbench.exe");
        if (!File.Exists(launcher)) { log("Deployed. (No launcher found - start the Workbench yourself.)"); return true; }
        int port = o.Port > 0 ? o.Port : ReadPort(target);
        bool wasUp = IsUp(port);
        if (!wasUp) { log("The Workbench is not running - nothing to restart. Start it from the shortcut."); return true; }
        log("Restarting the Workbench (port " + port + ") ...");
        Exec(launcher, "--stop", target, null, 1);
        Thread.Sleep(2500);
        Exec(launcher, "--port " + port, target, null, 1);
        for (int i = 0; i < 40; i++) { if (IsUp(port)) { log("Developer WorkBench is running again with the new version."); return true; } Thread.Sleep(1000); }
        log("WARNING: the Workbench did not come back within 40 s - start it from the shortcut.");
        return false;
    }

    // all files below `dir`, without descending into node_modules, caches ...
    static IEnumerable<string> Walk(string dir)
    {
        foreach (string f in Directory.GetFiles(dir)) yield return f;
        foreach (string d in Directory.GetDirectories(dir))
        {
            if (Array.IndexOf(SkipDirs, Path.GetFileName(d)) >= 0) continue;
            foreach (string f in Walk(d)) yield return f;
        }
    }

    static bool SameFile(string a, string b)
    {
        FileInfo x = new FileInfo(a), y = new FileInfo(b);
        if (x.Length != y.Length) return false;
        if (x.LastWriteTimeUtc == y.LastWriteTimeUtc) return true;
        using (var s1 = File.OpenRead(a)) using (var s2 = File.OpenRead(b))
        {
            byte[] b1 = new byte[65536], b2 = new byte[65536];
            int r1;
            while ((r1 = s1.Read(b1, 0, b1.Length)) > 0)
            {
                int r2 = 0;
                while (r2 < r1) { int k = s2.Read(b2, r2, r1 - r2); if (k <= 0) return false; r2 += k; }
                for (int i = 0; i < r1; i++) if (b1[i] != b2[i]) return false;
            }
        }
        return true;
    }

    static int ReadPort(string target)
    {
        try
        {
            string cfg = Path.Combine(target, "Internal_Developer_Tool", "scripts", "idp_config.json");
            if (File.Exists(cfg))
            {
                var m = System.Text.RegularExpressions.Regex.Match(File.ReadAllText(cfg), "\"server_port\"\\s*:\\s*(\\d+)");
                if (m.Success) return int.Parse(m.Groups[1].Value);
            }
        }
        catch { }
        return 5556;
    }

    static bool IsUp(int port)
    {
        try
        {
            HttpWebRequest r = (HttpWebRequest)WebRequest.Create("http://localhost:" + port + "/api/setup/config");
            r.Timeout = 3000;
            using (r.GetResponse()) return true;
        }
        catch { return false; }
    }

    // runs a program hidden; streams its output to `log`; returns the exit code (-1 on timeout)
    static int Exec(string exe, string args, string cwd, Action<string> log, int timeoutMin)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exe, args)
        {
            WorkingDirectory = cwd, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        psi.EnvironmentVariables["PATH"] = Path.GetDirectoryName(exe) + ";" + Environment.GetEnvironmentVariable("PATH");
        using (Process p = Process.Start(psi))
        {
            DataReceivedEventHandler h = delegate (object s, DataReceivedEventArgs e) { if (e.Data != null && log != null && e.Data.Trim().Length > 0) log("    " + e.Data); };
            p.OutputDataReceived += h; p.ErrorDataReceived += h;
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
            if (!p.WaitForExit(timeoutMin * 60 * 1000)) { try { p.Kill(); } catch { } return -1; }
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}

class MainForm : Form
{
    TextBox log;
    CheckBox chkBuild, chkRestart;
    Button btnDeploy, btnClose;
    Label hint;
    readonly Options opts;

    public MainForm(Options o)
    {
        opts = o;
        Text = "Developer Workbench - Deploy";
        ClientSize = new Size(660, 420);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Controls.Add(new Label { Text = "Deploy to Developer WorkBench", Font = new Font("Segoe UI", 14F, FontStyle.Bold), Left = 20, Top = 14, Width = 620, Height = 28 });
        Controls.Add(new Label
        {
            Text = "Publishes your changes in  Workspace\\src  to the installed DeveloperWorkBench: builds the UI, copies changed code files\r\n(settings, secrets and data are never overwritten) and restarts the Workbench.",
            Left = 20, Top = 46, Width = 620, Height = 40
        });
        chkBuild = new CheckBox { Text = "Build the UI first", Left = 20, Top = 92, Width = 180, Checked = o.Build };
        chkRestart = new CheckBox { Text = "Restart the Workbench afterwards", Left = 210, Top = 92, Width = 260, Checked = o.Restart };
        log = new TextBox { Left = 20, Top = 122, Width = 620, Height = 240, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.White, Font = new Font("Consolas", 8.5F) };
        hint = new Label { Left = 20, Top = 372, Width = 420, Height = 34, ForeColor = Color.DimGray };
        btnDeploy = new Button { Text = "Deploy", Left = 460, Top = 372, Width = 100 };
        btnClose = new Button { Text = "Close", Left = 566, Top = 372, Width = 74 };
        btnClose.Click += delegate { Close(); };
        btnDeploy.Click += OnDeploy;
        AcceptButton = btnDeploy;
        Controls.AddRange(new Control[] { chkBuild, chkRestart, log, hint, btnDeploy, btnClose });
    }

    void OnDeploy(object sender, EventArgs e)
    {
        opts.Build = chkBuild.Checked; opts.Restart = chkRestart.Checked;
        btnDeploy.Enabled = chkBuild.Enabled = chkRestart.Enabled = false;
        log.Clear(); hint.ForeColor = Color.DimGray; hint.Text = "Deploying...";
        Thread t = new Thread(delegate ()
        {
            bool ok = Deployer.Run(opts, delegate (string line) { BeginInvoke((Action)delegate { log.AppendText(line + "\r\n"); }); });
            BeginInvoke((Action)delegate
            {
                hint.ForeColor = ok ? Color.ForestGreen : Color.Firebrick;
                hint.Text = ok ? "Done." : "Not completed - see the log.";
                btnDeploy.Enabled = chkBuild.Enabled = chkRestart.Enabled = true; btnDeploy.Text = "Deploy again";
            });
        });
        t.IsBackground = true;
        t.Start();
    }
}
