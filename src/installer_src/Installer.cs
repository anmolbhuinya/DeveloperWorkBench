// Developer Workbench installer (self-contained: ships its own Python runtime).
//
// Asks for the installation directory (default ~\DWB), creates AI_Workspace, DeveloperWorkBench, HE_UI_Clients,
// Projects and Workspace, unpacks the Workbench + a private Python into <dir>\DeveloperWorkBench, runs "setupalltools",
// points every command wrapper in ~\.local\bin (.cmd and bash) at the new location, adds Start Menu / Desktop shortcuts
// (no terminal window) and an entry in Windows "Installed apps" (per user, no admin rights needed).
//
//   DeveloperWorkbenchSetup.exe                                          interactive
//   DeveloperWorkbenchSetup.exe /S [/DIR=~\DWB] [/NOSHORTCUTS] [/NOSETUP]  silent
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Developer Workbench Setup")]
[assembly: AssemblyProduct("Developer Workbench")]
[assembly: AssemblyVersion("1.2.0.0")]

static class Program
{
    public static readonly string[] Folders = { "AI_Workspace", "DeveloperWorkBench", "HE_UI_Clients", "Projects", "Workspace" };

    [STAThread]
    static int Main(string[] args)
    {
        string dir = @"~\DWB";
        bool silent = false, shortcuts = true, setup = true;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase) || a.Equals("/silent", StringComparison.OrdinalIgnoreCase)) silent = true;
            else if (a.Equals("/NOSHORTCUTS", StringComparison.OrdinalIgnoreCase)) shortcuts = false;
            else if (a.Equals("/NOSETUP", StringComparison.OrdinalIgnoreCase)) setup = false;
            else if (a.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase)) dir = a.Substring(5).Trim('"');
        }

        if (silent)
        {
            try { Installer.Install(dir, shortcuts, setup, null); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm(dir));
        return 0;
    }
}

static class Installer
{
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\DeveloperWorkbench";
    public const string AppName = "Developer Workbench";

    // "~" means the user's profile folder; %VARS% are expanded too
    public static string ExpandPath(string p)
    {
        p = Environment.ExpandEnvironmentVariables((p ?? "").Trim().Trim('"'));
        if (p == "~" || p.StartsWith("~\\") || p.StartsWith("~/"))
            p = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + p.Substring(1);
        return p;
    }

    public static string Install(string dir, bool shortcuts, bool setup, Action<int, string> progress)
    {
        dir = ExpandPath(dir);
        if (!Path.IsPathRooted(dir)) throw new Exception("Enter a full path such as C:\\Users\\you\\DWB (or ~\\DWB).");
        dir = Path.GetFullPath(dir);

        Directory.CreateDirectory(dir);
        foreach (string f in Program.Folders)
        {
            Directory.CreateDirectory(Path.Combine(dir, f));
            if (progress != null) progress(0, "Created " + f);
        }

        string target = Path.Combine(dir, "DeveloperWorkBench");
        StopRunning(target);

        using (Stream res = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        {
            if (res == null) throw new Exception("The installer payload is missing - rebuild the installer.");
            using (ZipArchive zip = new ZipArchive(res, ZipArchiveMode.Read))
            {
                int n = 0, total = zip.Entries.Count;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    n++;
                    // entries under "_root/" go to the DWB folder itself (CreateInstaller.exe), everything else into DeveloperWorkBench\
                    bool toRoot = e.FullName.StartsWith("_root/", StringComparison.Ordinal);
                    string baseDir = toRoot ? dir : target;
                    string relName = toRoot ? e.FullName.Substring(6) : e.FullName;
                    string dest = Path.GetFullPath(Path.Combine(baseDir, relName.Replace('/', Path.DirectorySeparatorChar)));
                    if (!dest.StartsWith(baseDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        continue;                                           // never write outside the target folder
                    if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    // keep the user's settings and credentials when re-installing over an existing copy
                    if (File.Exists(dest) && IsUserData(e.FullName)) continue;
                    try { e.ExtractToFile(dest, true); }
                    catch (IOException ex) { throw new Exception("Could not write " + dest + " (is the Workbench still running?): " + ex.Message); }
                    if (progress != null && (n % 50 == 0 || n == total)) progress((int)(100.0 * n / total), "Copying files... " + n + " / " + total);
                }
            }
        }
        File.WriteAllText(Path.Combine(target, "install.txt"),
            "Installed " + DateTime.Now.ToString("yyyy-MM-dd HH:mm") + "\r\nDWB directory: " + dir + "\r\n");

        if (setup)
        {
            if (progress != null) progress(100, "Setting up the command-line tools (setupalltools) - this can take a few minutes...");
            RunSetup(target, progress);
        }

        if (progress != null) progress(100, "Creating shortcuts...");
        if (shortcuts)                      // /NOSHORTCUTS = no Windows integration at all (also no Installed-apps entry)
        {
            RegisterUninstall(target, dir);
            CreateShortcuts(target);
        }
        return dir;
    }

    static bool IsUserData(string rel)
    {
        string n = rel.Replace('\\', '/').ToLowerInvariant();
        return n == "secrets.xlsx" || n == "vms.xlsx" || n.EndsWith("/config.xlsx") || n.EndsWith("setup_config.xlsx");
    }

    // a running Workbench would keep its python.exe / DLLs locked
    static void StopRunning(string target)
    {
        string stop = Path.Combine(target, "stop_developer_workbench.bat");
        if (!File.Exists(stop)) return;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c \"" + stop + "\"") { CreateNoWindow = true, UseShellExecute = false };
            using (Process p = Process.Start(psi)) { p.WaitForExit(20000); }
        }
        catch { /* best effort */ }
    }

    // setupalltools (creates / refreshes the command wrappers, checks dependencies), then sync_wrappers.py which points every
    // wrapper in ~/.local/bin at THIS installation. Never fails the install: details go to setup_all_tools.log.
    static void RunSetup(string target, Action<int, string> progress)
    {
        string python = Path.Combine(target, "python", "python.exe");
        string log = Path.Combine(target, "setup_all_tools.log");
        string bin = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin");
        try
        {
            Directory.CreateDirectory(bin);
            string userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
            bool onPath = false;
            foreach (string p in userPath.Split(';')) if (p.Trim().TrimEnd('\\').Equals(bin, StringComparison.OrdinalIgnoreCase)) onPath = true;
            // DWB_HOME = the DWB folder (parent of DeveloperWorkBench\); config paths such as {DWB_HOME}\HE_UI_Clients\Local resolve from it
            string dwbHome = Path.GetDirectoryName(target.TrimEnd('\\'));
            if (!string.IsNullOrEmpty(dwbHome)) Environment.SetEnvironmentVariable("DWB_HOME", dwbHome, EnvironmentVariableTarget.User);
            if (!onPath) Environment.SetEnvironmentVariable("Path", (userPath.TrimEnd(';') + ";" + bin).TrimStart(';'), EnvironmentVariableTarget.User);
        }
        catch { /* the wrappers are still created */ }

        File.WriteAllText(log, "");
        RunPython(python, target, Path.Combine("scripts", "setup_all_tools.py"), log, 25 * 60 * 1000);
        if (progress != null) progress(100, "Pointing the command wrappers at this installation...");
        RunPython(python, target, Path.Combine("scripts", "sync_wrappers.py"), log, 5 * 60 * 1000);
    }

    static void RunPython(string python, string target, string script, string log, int timeoutMs)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(python, "\"" + Path.Combine(target, script) + "\"")
            {
                WorkingDirectory = target, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            };
            psi.EnvironmentVariables["PATH"] = Path.Combine(target, "python") + ";" + Path.Combine(target, "python", "Scripts") + ";" + Environment.GetEnvironmentVariable("PATH");
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            psi.EnvironmentVariables["DWB_INSTALLER"] = "1";
            psi.EnvironmentVariables.Remove("PYTHONHOME");
            object gate = new object();
            using (Process p = Process.Start(psi))
            {
                DataReceivedEventHandler h = delegate (object s, DataReceivedEventArgs e)
                { if (e.Data != null) lock (gate) File.AppendAllText(log, e.Data + "\r\n"); };
                p.OutputDataReceived += h; p.ErrorDataReceived += h;
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                p.StandardInput.Close();                         // prompts (e.g. "Install Playwright now?") take their defaults
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch { }
                    lock (gate) File.AppendAllText(log, "\r\n[installer] " + script + " timed out and was stopped.\r\n");
                }
            }
        }
        catch (Exception ex) { try { File.AppendAllText(log, "\r\n[installer] " + script + " failed: " + ex.Message + "\r\n"); } catch { } }
    }

    static void RegisterUninstall(string target, string dir)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", AppName);
                k.SetValue("DisplayVersion", "1.2.0");
                k.SetValue("Publisher", "HealthEdge");
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", "\"" + Path.Combine(target, "uninstall.bat") + "\"");
                k.SetValue("DisplayIcon", Path.Combine(target, "DeveloperWorkbench.exe"));
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
        catch { /* the app still works without the Installed-apps entry */ }
    }

    static void CreateShortcuts(string target)
    {
        string launcher = Path.Combine(target, "DeveloperWorkbench.exe");      // starts Python hidden: no terminal window
        string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
        Directory.CreateDirectory(menu);
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        MakeLink(Path.Combine(menu, "Developer Workbench.lnk"), launcher, "", target, "Start the Developer Workbench", launcher);
        MakeLink(Path.Combine(menu, "Stop Developer Workbench.lnk"), launcher, "--stop", target, "Stop the Developer Workbench", launcher);
        MakeLink(Path.Combine(menu, "Uninstall Developer Workbench.lnk"), Path.Combine(target, "uninstall.bat"), "", target, "Remove the Developer Workbench", launcher);
        MakeLink(Path.Combine(desktop, "Developer Workbench.lnk"), launcher, "", target, "Start the Developer Workbench", launcher);
    }

    static void MakeLink(string path, string targetFile, string arguments, string workDir, string description, string icon)
    {
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object sh = Activator.CreateInstance(t);
            object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { path });
            Type lt = lnk.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { targetFile });
            lt.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { arguments });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workDir });
            lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { description });
            lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { icon + ",0" });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
        }
        catch (Exception ex)
        {
            // shortcuts are optional, but say why one failed
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "dwb_installer.log"), "shortcut " + path + ": " + (ex.InnerException ?? ex).Message + "\r\n"); } catch { }
        }
    }
}

class SetupForm : Form
{
    TextBox txtDir;
    Button btnInstall, btnBrowse, btnCancel;
    CheckBox chkShortcuts;
    ProgressBar bar;
    Label status;
    string installedDir;

    public SetupForm(string defaultDir)
    {
        Text = "Developer Workbench Setup";
        ClientSize = new Size(560, 300);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Controls.Add(new Label { Text = "Developer Workbench", Font = new Font("Segoe UI", 14F, FontStyle.Bold), Left = 20, Top = 16, Width = 520, Height = 28 });
        Controls.Add(new Label
        {
            Text = "Choose where to install. These folders will be created inside it:\r\n" + string.Join(", ", Program.Folders) +
                   "\r\nPython, the command-line tools and everything else the Workbench needs are included.",
            Left = 20, Top = 50, Width = 520, Height = 54
        });
        Controls.Add(new Label { Text = "Installation directory:   (~ = your user folder)", Left = 20, Top = 112, Width = 400 });
        txtDir = new TextBox { Left = 20, Top = 134, Width = 420, Text = defaultDir };
        btnBrowse = new Button { Text = "Browse...", Left = 450, Top = 132, Width = 90 };
        btnBrowse.Click += delegate
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog { Description = "Select the installation directory", SelectedPath = Installer.ExpandPath(txtDir.Text) })
                if (d.ShowDialog(this) == DialogResult.OK) txtDir.Text = d.SelectedPath;
        };
        chkShortcuts = new CheckBox { Text = "Create Start Menu and Desktop shortcuts", Left = 20, Top = 166, Width = 400, Checked = true };
        bar = new ProgressBar { Left = 20, Top = 198, Width = 520, Height = 18, Visible = false };
        status = new Label { Left = 20, Top = 222, Width = 520, Height = 36, ForeColor = Color.DimGray };
        btnInstall = new Button { Text = "Install", Left = 360, Top = 262, Width = 90 };
        btnCancel = new Button { Text = "Cancel", Left = 456, Top = 262, Width = 84 };
        btnCancel.Click += delegate { Close(); };
        btnInstall.Click += OnInstall;
        AcceptButton = btnInstall;
        CancelButton = btnCancel;
        Controls.AddRange(new Control[] { txtDir, btnBrowse, chkShortcuts, bar, status, btnInstall, btnCancel });
    }

    void OnInstall(object sender, EventArgs e)
    {
        if (installedDir != null)       // finished: the button now launches the Workbench (hidden Python, no terminal)
        {
            string exe = Path.Combine(installedDir, "DeveloperWorkBench", "DeveloperWorkbench.exe");
            try { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) }); }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, Text); return; }
            Close(); return;
        }

        string dir = Installer.ExpandPath(txtDir.Text);
        if (dir.Length == 0 || !Path.IsPathRooted(dir)) { MessageBox.Show(this, "Enter a full path such as C:\\Users\\you\\DWB (or ~\\DWB).", Text); return; }
        string existing = Path.Combine(dir, "DeveloperWorkBench");
        if (Directory.Exists(existing) && Directory.GetFileSystemEntries(existing).Length > 0 &&
            MessageBox.Show(this, existing + " already contains a Developer Workbench.\r\n\r\nUpdate it? Your secrets.xlsx and settings are kept.",
                            Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;

        bool shortcuts = chkShortcuts.Checked;
        btnInstall.Enabled = btnBrowse.Enabled = btnCancel.Enabled = txtDir.Enabled = chkShortcuts.Enabled = false;
        bar.Visible = true; bar.Style = ProgressBarStyle.Continuous;
        status.ForeColor = Color.DimGray; status.Text = "Installing...";

        Thread t = new Thread(delegate ()
        {
            try
            {
                string done = Installer.Install(dir, shortcuts, true, delegate (int pct, string msg)
                {
                    BeginInvoke((Action)delegate
                    {
                        if (pct > 0) bar.Value = Math.Min(100, pct);
                        if (msg.StartsWith("Setting up") || msg.StartsWith("Pointing")) bar.Style = ProgressBarStyle.Marquee;   // unknown duration
                        status.Text = msg;
                    });
                });
                BeginInvoke((Action)delegate
                {
                    installedDir = done; bar.Style = ProgressBarStyle.Continuous; bar.Value = 100;
                    status.ForeColor = Color.ForestGreen;
                    status.Text = "Installed to " + done + "\r\nFill in the values in DeveloperWorkBench\\secrets.xlsx before first use.";
                    btnInstall.Text = "Launch"; btnInstall.Enabled = true;
                    btnCancel.Text = "Close"; btnCancel.Enabled = true;
                });
            }
            catch (Exception ex)
            {
                BeginInvoke((Action)delegate
                {
                    status.ForeColor = Color.Firebrick; status.Text = "Installation failed: " + ex.Message;
                    btnInstall.Enabled = btnBrowse.Enabled = btnCancel.Enabled = txtDir.Enabled = chkShortcuts.Enabled = true;
                    bar.Style = ProgressBarStyle.Continuous; bar.Visible = false;
                });
            }
        });
        t.IsBackground = true;
        t.Start();
    }
}
