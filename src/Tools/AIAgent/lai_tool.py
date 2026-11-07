"""
lai — Launch AI Agent
Reads AI_Agent.xlsx, cds to Workspace, runs the Login command, then on confirmation runs Command.
"""
import sys
import os
import subprocess
from pathlib import Path

XLSX = Path(__file__).parent / "AI_Agent.xlsx"
os.environ.setdefault("DWB_HOME", str(Path(__file__).resolve().parents[3]))      # Tools\AIAgent -> DeveloperWorkBench -> {DWB_HOME}

BOLD   = '\x1b[1m'
TEAL   = '\x1b[36m'
GREEN  = '\x1b[32m'
YELLOW = '\x1b[33m'
GREY   = '\x1b[90m'
RED    = '\x1b[31m'
RESET  = '\x1b[0m'

def bold(s):   return BOLD + s + RESET
def teal(s):   return TEAL + s + RESET
def green(s):  return GREEN + s + RESET
def yellow(s): return YELLOW + s + RESET
def grey(s):   return GREY + s + RESET
def red(s):    return RED + s + RESET


def read_config():
    try:
        import openpyxl
    except ImportError:
        sys.exit(red("openpyxl is required: pip install openpyxl"))
    if not XLSX.exists():
        sys.exit(red(f"Config not found: {XLSX}"))
    wb = openpyxl.load_workbook(str(XLSX), read_only=True, data_only=True)
    ws = wb.active
    data = {}
    for row in ws.iter_rows(values_only=True):
        if row and row[0] and len(row) >= 2 and row[1] is not None:
            data[str(row[0]).strip()] = str(row[1]).strip()
    wb.close()
    return data


def parse_args(argv):
    """lai [--workspace DIR] [--resume NAME | --name NAME] [--add-dir DIR] [--context TEXT]   (anything else is passed on to the Command)"""
    opts, rest, i = {}, [], 0
    while i < len(argv):
        a = argv[i]
        if a in ("--workspace", "--resume", "--name", "--add-dir", "--context") and i + 1 < len(argv):
            opts[a[2:]] = argv[i + 1]
            i += 2
        else:
            rest.append(a)
            i += 1
    return opts, rest


def ps_quote(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    cfg = read_config()
    opts, rest = parse_args(sys.argv[1:])

    workspace     = os.path.expanduser(os.path.expandvars((opts.get("workspace") or cfg.get("Workspace", "")).strip()))   # %USERPROFILE% / ~ allowed
    login_base    = cfg.get("Login", "").strip()
    profile       = cfg.get("Profile", "").strip()
    command       = cfg.get("Command", "").strip()

    if not workspace:
        sys.exit(red("'Workspace' not set in AI_Agent.xlsx"))
    if not command:
        sys.exit(red("'Command' not set in AI_Agent.xlsx"))
    if opts.get("resume"):                                  # resume the session of that name
        command += " --resume " + ps_quote(opts["resume"])
    elif opts.get("name"):                                  # new session, named
        command += " --name " + ps_quote(opts["name"])
    if opts.get("add-dir"):                                 # extra folder the agent may work in
        command += " --add-dir " + ps_quote(opts["add-dir"])
    if opts.get("context"):                                 # what the agent should know about this session
        command += " --append-system-prompt " + ps_quote(opts["context"])
    if rest:
        command += " " + " ".join(rest)

    login_cmd = (login_base + " " + profile).strip() if profile else login_base

    print()
    print(bold(teal("  ==  AI Agent Launcher  ==")))
    print(grey("  " + "─" * 44))
    print(f"  {grey('Workspace :')} {workspace}")
    if login_cmd:
        print(f"  {grey('Login     :')} {login_cmd}")
    print(f"  {grey('Command   :')} {bold(command)}")
    print(grey("  " + "─" * 44))
    print()

    # 1. Verify workspace exists
    ws_path = Path(workspace)
    if not ws_path.exists() and "AI_Workspace" in ws_path.parts:
        ws_path.mkdir(parents=True, exist_ok=True)
    if not ws_path.exists():
        sys.exit(red(f"Workspace directory not found: {workspace}"))
    print(green(f"  OK  Workspace: {workspace}"))

    # 2. Run login command (aws sso login works in cmd.exe)
    if login_cmd:
        print(f"\n  {bold('Running login...')}")
        print(grey(f"  > {login_cmd}"))
        print()
        sys.stdout.flush()
        ret = subprocess.run(login_cmd, shell=True)
        if ret.returncode != 0:
            print()
            print(yellow("  !! Login exited with code " + str(ret.returncode)))
        else:
            print()
            print(green("  OK  Login complete"))

    # 3. Run immediately, no confirmation
    print()
    print(f"  Running  {bold(command)}  in {workspace}")

    # 4. Run command via PowerShell so PS aliases/functions (e.g. claudep) are available.
    #    Set-Location first so the session starts in the workspace directory.
    ws_escaped = workspace.replace("'", "''")
    # the command is NOT inside a quoted string here, so its own quotes (session name, system prompt) must stay as they are
    ps_cmd = f"Set-Location '{ws_escaped}'; {command}"
    print()
    print(grey(f"  > powershell -NoLogo -Command \"{ps_cmd}\""))
    print()
    sys.stdout.flush()
    subprocess.run(
        ['powershell.exe', '-NoLogo', '-Command', ps_cmd]
    )


if __name__ == "__main__":
    main()
