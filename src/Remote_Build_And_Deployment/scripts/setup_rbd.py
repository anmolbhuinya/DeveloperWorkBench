#!/usr/bin/env python3
"""
setup_rbd.py — setupremotebuildanddeploymenttool / setuprbdtool command

Sets up the Remote Build and Deployment Tool for all applications
(Payor, Classic, Connector, Enrollment, PIK).

Usage:
  setupremotebuildanddeploymenttool
  setuprbdtool
"""

import sys
import json
import subprocess
from pathlib import Path

SCRIPT_DIR  = Path(__file__).resolve().parent
TOOL_ROOT   = SCRIPT_DIR.parent           # Remote_Build_And_Deployment/
APPS_ROOT   = TOOL_ROOT / "Applications"
CMD_DIR     = Path.home() / ".local" / "bin"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"

APPS = {
    "Payor":      {"container": "payor-tc",      "port": 7001,
                   "props_path": "/home/weblogic/domains/healthedge/runtime.properties",
                   "git_pattern": "hrp.payer.core-*",
                   "log_dir": "/home/weblogic/healthedge-logs",
                   "app_url": "http://{vm_ip}:7001/web-services/",
                   "description": "HealthRules Payor — core adjudication engine"},
    "Classic":    {"container": "classic-tc",    "port": 7002,
                   "props_path": "/home/weblogic/domains/healthedge/runtime.properties",
                   "git_pattern": "classic-*",
                   "log_dir": "/home/weblogic/healthedge-logs",
                   "app_url": "http://{vm_ip}:7002/HealthEdge/",
                   "description": "HealthRules Classic — legacy adjudication platform"},
    "Connector":  {"container": "connector",     "port": 8080,
                   "props_path": "/home/connector/config/connector.properties",
                   "git_pattern": "connector-*",
                   "log_dir": "/home/connector/logs",
                   "app_url": "http://{vm_ip}:8080/connector/api/",
                   "description": "Integration Platform Connector for EDI/FHIR/HL7"},
    "Enrollment": {"container": "enrollment-tc", "port": 7003,
                   "props_path": "/home/weblogic/domains/healthedge/runtime.properties",
                   "git_pattern": "enrollment-*",
                   "log_dir": "/home/weblogic/healthedge-logs",
                   "app_url": "http://{vm_ip}:7003/Enrollment/",
                   "description": "Member enrollment and eligibility processing"},
    "PIK":        {"container": "pik-tc",        "port": 7004,
                   "props_path": "/home/weblogic/domains/healthedge/runtime.properties",
                   "git_pattern": "pik-*",
                   "log_dir": "/home/weblogic/healthedge-logs",
                   "app_url": "http://{vm_ip}:7004/pik/api/",
                   "description": "Payment Innovation Kit"},
}


def _check_paramiko():
    try:
        import paramiko
        ver = getattr(paramiko, "__version__", "?")
        print(f"  {green('[ok]')}     paramiko  {grey(ver)}")
        return True
    except ImportError:
        print(f"  {red('[missing]')} paramiko — run:  pip install paramiko")
        return False


def _ensure_global_config():
    cfg_file = TOOL_ROOT / "config.json"
    if cfg_file.exists():
        print(f"  [ok]     config.json  {grey(str(cfg_file))}")
        return True
    cfg = {
        "default_vm_ip": "10.192.251.19",
        "ssh_user": "ec2-user",
        "ssh_key_path": "",
        "description": "Remote Build and Deployment VM configuration. Set ssh_key_path to your .pem key file path."
    }
    cfg_file.write_text(json.dumps(cfg, indent=2))
    print(f"  {green('[create]')} config.json  {grey(str(cfg_file))}")
    return True


def _ensure_app_dirs():
    APPS_ROOT.mkdir(parents=True, exist_ok=True)
    for app_name in APPS:
        app_dir = APPS_ROOT / app_name
        app_dir.mkdir(parents=True, exist_ok=True)
        print(f"  [ok]     Applications/{app_name}/")
    return True


def _ensure_cmd_wrappers():
    CMD_DIR.mkdir(parents=True, exist_ok=True)
    wrappers = {
        "setupremotebuildanddeploymenttool.cmd": f'python "{SCRIPT_DIR / "setup_rbd.py"}" %*\n',
        "setuprbdtool.cmd":                      f'python "{SCRIPT_DIR / "setup_rbd.py"}" %*\n',
    }
    for name, body in wrappers.items():
        p = CMD_DIR / name
        if p.exists():
            print(f"  [ok]     {p.name}")
        else:
            p.write_text(f"@echo off\n{body}")
            print(f"  {green('[create]')} {p.name}")


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    print("\n  Remote Build and Deployment Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    print("  ── Dependencies ─────────────────────────────────────────────────")
    _check_paramiko()

    print()
    print("  ── Global config ────────────────────────────────────────────────")
    _ensure_global_config()

    print()
    print("  ── Application configs ──────────────────────────────────────────")
    _ensure_app_dirs()

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Edit config.json and set  ssh_key_path  to your .pem key")
    print("    2. Set default_vm_ip to your development VM (default: 10.192.251.19)")
    print("    3. Open IDP → Remote App Development to manage remote applications")
    print("    (App configuration is read from build_deploy_config.xlsx — no per-app config.json needed)")
    print()


if __name__ == "__main__":
    main()
