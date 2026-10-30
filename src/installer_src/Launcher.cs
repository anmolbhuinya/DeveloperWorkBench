// DeveloperWorkbench.exe - starts / stops the Developer Workbench with its bundled Python WITHOUT opening a terminal window.
//   DeveloperWorkbench.exe           start the server and open the browser
//   DeveloperWorkbench.exe --stop    stop it
//   (any other arguments are passed on to idp_server.py)
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Developer Workbench")]
[assembly: AssemblyProduct("Developer Workbench")]
[assembly: AssemblyVersion("1.1.0.0")]

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string home = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string python = Path.Combine(home, "python", "python.exe");
        string script = Path.Combine(home, "Internal_Developer_Tool", "scripts", "idp_server.py");
        if (!File.Exists(python) || !File.Exists(script))
        {
            MessageBox.Show("The Developer Workbench files were not found next to this program:\r\n" + home, "Developer Workbench", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        string cmdline = "\"" + script + "\"";
        foreach (string a in args) cmdline += " " + (a.IndexOf(' ') >= 0 ? "\"" + a + "\"" : a);

        ProcessStartInfo psi = new ProcessStartInfo(python, cmdline)
        {
            WorkingDirectory = home,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.EnvironmentVariables["PATH"] = Path.Combine(home, "python") + ";" + Path.Combine(home, "python", "Scripts") + ";" + Environment.GetEnvironmentVariable("PATH");
        psi.EnvironmentVariables["PYTHONUTF8"] = "1";
        psi.EnvironmentVariables.Remove("PYTHONHOME");

        try
        {
            using (Process p = Process.Start(psi))
            {
                // idp_server starts the server in the background and returns; read the output so the pipes never block
                string err = "";
                p.OutputDataReceived += delegate { };
                p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) err += e.Data + "\r\n"; };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(60000)) return 0;       // still running in the foreground: nothing more to do
                if (p.ExitCode != 0)
                {
                    MessageBox.Show("The Developer Workbench could not be started.\r\n\r\n" + (err.Length > 1500 ? err.Substring(err.Length - 1500) : err),
                                    "Developer Workbench", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return p.ExitCode;
                }
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Developer Workbench", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }
}
