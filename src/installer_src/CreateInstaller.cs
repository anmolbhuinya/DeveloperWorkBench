// CreateInstaller.exe - builds DeveloperWorkbenchSetup.exe from the CURRENT contents of this DWB installation.
//
// Lives in the DWB folder (e.g. C:\Users\you\DWB\CreateInstaller.exe, next to DeveloperWorkBench\). It packs
// <DWB>\DeveloperWorkBench (the Workbench, its bundled Python, the current command wrappers) together with itself
// into a new installer, so every change made in the installed copy ends up in the next installer.
// secrets.xlsx is packed as a template only: sheets, keys and notes - never the values.
//
//   CreateInstaller.exe                              interactive (output folder defaults to ~\Downloads)
//   CreateInstaller.exe /S [/OUT=C:\folder]          silent
//
// The installer sources (build_installer.py, Installer.cs, Launcher.cs, dwb.ico) are embedded in this exe; the C# compiler
// that ships with Windows (.NET Framework csc.exe) and the Workbench's bundled Python do the work - nothing else is needed.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Developer Workbench - Create Installer")]
[assembly: AssemblyProduct("Developer Workbench")]
[assembly: AssemblyVersion("1.1.0.0")]

static class Program
{
    public static readonly string[] Resources = { "build_installer.py", "Installer.cs", "Launcher.cs", "dwb.ico" };

    [STAThread]
    static int Main(string[] args)
    {
        string dwbRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string outDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        bool silent = false;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            else if (a.StartsWith("/OUT=", StringComparison.OrdinalIgnoreCase)) outDir = Builder.Expand(a.Substring(5));
        }

        if (silent)
        {
            string res = Builder.Build(dwbRoot, outDir, Console.Out.WriteLine);
            return res == null ? 1 : 0;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm(dwbRoot, outDir));
        return 0;
    }
}

static class Builder
{
    public static string Expand(string p)
    {
        p = Environment.ExpandEnvironmentVariables((p ?? "").Trim().Trim('"'));
        if (p == "~" || p.StartsWith("~\\") || p.StartsWith("~/"))
            p = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + p.Substring(1);
        return p;
    }

    // returns the path of the new installer, or null (errors are reported through `log`)
    public static string Build(string dwbRoot, string outDir, Action<string> log)
    {
        string src = Path.Combine(dwbRoot, "DeveloperWorkBench");
        string python = Path.Combine(src, "python", "python.exe");
        if (!File.Exists(python)) { log("ERROR: " + python + " not found. CreateInstaller.exe must sit in the DWB folder, next to DeveloperWorkBench\\."); return null; }
        outDir = Expand(outDir);
        if (outDir.Length == 0 || !Path.IsPathRooted(outDir)) { log("ERROR: enter a full output folder."); return null; }

        string work = Path.Combine(Path.GetTempPath(), "dwb_create_installer_" + Guid.NewGuid().ToString("N").Substring(0, 8));
        try
        {
            Directory.CreateDirectory(outDir);
            Directory.CreateDirectory(work);
            foreach (string name in Program.Resources)
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
                {
                    if (s == null) { log("ERROR: embedded file missing: " + name); return null; }
                    using (FileStream f = File.Create(Path.Combine(work, name))) s.CopyTo(f);
                }
            }

            string output = Path.Combine(outDir, "DeveloperWorkbenchSetup.exe");
            string self = Assembly.GetExecutingAssembly().Location;
            string cmdline = "\"" + Path.Combine(work, "build_installer.py") + "\" --src \"" + src + "\" --out \"" + output + "\" --work \"" + work + "\" --create-installer \"" + self + "\"";
            log("Packing " + src + " ...");
            ProcessStartInfo psi = new ProcessStartInfo(python, cmdline)
            {
                WorkingDirectory = work, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            };
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            psi.EnvironmentVariables.Remove("PYTHONHOME");
            psi.EnvironmentVariables["DWB_WRAPPER_BIN"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin");
            using (Process p = Process.Start(psi))
            {
                DataReceivedEventHandler h = delegate (object s, DataReceivedEventArgs e) { if (e.Data != null && e.Data.Trim().Length > 0) log(e.Data); };
                p.OutputDataReceived += h; p.ErrorDataReceived += h;
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                p.StandardInput.Close();
                if (!p.WaitForExit(20 * 60 * 1000)) { try { p.Kill(); } catch { } log("ERROR: building the installer timed out."); return null; }
                p.WaitForExit();
                if (p.ExitCode != 0) { log("ERROR: the build failed (exit " + p.ExitCode + ")."); return null; }
            }
            if (!File.Exists(output)) { log("ERROR: the installer was not created."); return null; }
            log("Created " + output + " (" + (new FileInfo(output).Length / 1048576) + " MB)");
            return output;
        }
        catch (Exception ex) { log("ERROR: " + ex.Message); return null; }
        finally { try { Directory.Delete(work, true); } catch { } }
    }
}

class MainForm : Form
{
    readonly string dwbRoot;
    TextBox txtOut, log;
    Button btnBrowse, btnCreate, btnClose;
    ProgressBar bar;
    Label hint;
    string created;

    public MainForm(string dwbRoot, string outDir)
    {
        this.dwbRoot = dwbRoot;
        Text = "Developer Workbench - Create Installer";
        ClientSize = new Size(620, 380);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Controls.Add(new Label { Text = "Create Developer Workbench installer", Font = new Font("Segoe UI", 14F, FontStyle.Bold), Left = 20, Top = 14, Width = 580, Height = 28 });
        Controls.Add(new Label
        {
            Text = "Builds DeveloperWorkbenchSetup.exe from the current contents of\r\n" + Path.Combine(dwbRoot, "DeveloperWorkBench") + "\r\n(your latest changes and command wrappers; secrets.xlsx is included without its values).",
            Left = 20, Top = 46, Width = 580, Height = 52
        });
        Controls.Add(new Label { Text = "Save the installer in:   (~ = your user folder)", Left = 20, Top = 104, Width = 400 });
        txtOut = new TextBox { Left = 20, Top = 126, Width = 490, Text = outDir };
        btnBrowse = new Button { Text = "Browse...", Left = 520, Top = 124, Width = 80 };
        btnBrowse.Click += delegate
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog { Description = "Where should the installer be saved?", SelectedPath = Builder.Expand(txtOut.Text) })
                if (d.ShowDialog(this) == DialogResult.OK) txtOut.Text = d.SelectedPath;
        };
        bar = new ProgressBar { Left = 20, Top = 160, Width = 580, Height = 16, Visible = false, Style = ProgressBarStyle.Marquee };
        log = new TextBox { Left = 20, Top = 184, Width = 580, Height = 140, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.White, Font = new Font("Consolas", 8.5F) };
        hint = new Label { Left = 20, Top = 334, Width = 380, Height = 34, ForeColor = Color.DimGray };
        btnCreate = new Button { Text = "Create installer", Left = 400, Top = 338, Width = 120 };
        btnClose = new Button { Text = "Close", Left = 526, Top = 338, Width = 74 };
        btnClose.Click += delegate { Close(); };
        btnCreate.Click += OnCreate;
        AcceptButton = btnCreate;
        Controls.AddRange(new Control[] { txtOut, btnBrowse, bar, log, hint, btnCreate, btnClose });
    }

    void OnCreate(object sender, EventArgs e)
    {
        if (created != null) { Process.Start("explorer.exe", "/select,\"" + created + "\""); return; }
        string outDir = Builder.Expand(txtOut.Text);
        if (outDir.Length == 0 || !Path.IsPathRooted(outDir)) { MessageBox.Show(this, "Enter a full folder path such as C:\\Users\\you\\Downloads.", Text); return; }
        string target = Path.Combine(outDir, "DeveloperWorkbenchSetup.exe");
        if (File.Exists(target) && MessageBox.Show(this, target + " already exists. Replace it?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;

        btnCreate.Enabled = btnBrowse.Enabled = txtOut.Enabled = false;
        bar.Visible = true; log.Clear(); hint.Text = "Building... this takes about a minute.";
        Thread t = new Thread(delegate ()
        {
            string res = Builder.Build(dwbRoot, outDir, delegate (string line) { BeginInvoke((Action)delegate { log.AppendText(line + "\r\n"); }); });
            BeginInvoke((Action)delegate
            {
                bar.Visible = false;
                if (res != null)
                {
                    created = res; hint.ForeColor = Color.ForestGreen; hint.Text = "Done: " + res;
                    btnCreate.Text = "Show in folder"; btnCreate.Enabled = true;
                }
                else
                {
                    hint.ForeColor = Color.Firebrick; hint.Text = "The installer could not be created - see the log.";
                    btnCreate.Enabled = btnBrowse.Enabled = txtOut.Enabled = true;
                }
            });
        });
        t.IsBackground = true;
        t.Start();
    }
}
