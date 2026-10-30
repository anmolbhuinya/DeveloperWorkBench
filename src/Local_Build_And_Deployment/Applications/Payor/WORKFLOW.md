# Delta Jar Local Deployment — Workflow Documentation

## Overview

This workflow deploys a locally-built Payor module jar into the Docker container
running the payor server on your machine, without a full environment rebuild.

```
Local Maven build (target/<module>-*-SNAPSHOT.jar)
        │
        ▼
  [1]  Resolve jar — read SRCDIR env var / ~/.default-branch, locate SNAPSHOT jar in target/
        │             (or use override from config.xlsx → jar_location)
        ▼
  [2]  Copy jar to Windows shared folder
        │             (mounted in docker at /home/weblogic/shared)
        ▼
  [3]  stopServer inside docker → wait for shutdown
        ▼
  [4]  Copy jar: /home/weblogic/shared → deploy dir (version stripped)
        │             core-cvc-27.1-SNAPSHOT.jar  →  core-cvc.jar
        ▼
  [5]  Remove jar from shared folder (cleanup)
        ▼
  [5b] Ensure Artemis queue is running
        │             checks for Artemis process; calls startArtemis if not found
        ▼
  [6]  startServer inside docker
```

---

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js v16+ | Run: `node --version` to confirm |
| npm package: `xlsx` | Located at `C:/Users/abhuinya/node_modules/xlsx` — path set in `config.xlsx → General → nodeModules` |
| Docker Desktop | Running, with the payor container started (default: `payer-tc-261`) |
| Maven build | Module must already be compiled — run `mvn clean install` or `mvn package` first |
| Shared folder | `C:\Users\abhuinya\shared\payor_env` must be bind-mounted in docker at `/home/weblogic/shared` |
| `setbranch` run | Run `setbranch 26.1` (or relevant branch) in PowerShell so `SRCDIR` is set |

---

## Folder Structure

```
Delta_Jar_Local_Deployment/
├── config.xlsx                  ← Edit this to change defaults (3 tabs)
├── WORKFLOW.md                  ← This file
├── ReadMe.docx                  ← User-friendly formatted documentation
└── scripts/
    ├── config.js                ← Reads config.xlsx (do not edit)
    ├── create_config_xlsx.js    ← One-time: regenerate config.xlsx
    ├── jar_resolver.js          ← Finds and names the source jar
    ├── docker_helpers.js        ← docker exec / docker cp helpers
    ├── deploy_jar.js            ← Deploy a single module
    ├── list_modules.js          ← List all deployable payor modules
    └── gen_readme.js            ← Regenerates ReadMe.docx
```

---

## Commands

### Deploy a module

```bash
cd "C:\Users\abhuinya\OneDrive - HealthEdge Software, Inc\HealthEdge\claude_code_workflows\Delta_Jar_Local_Deployment"

node scripts/deploy_jar.js <module-name>
```

**Example:**
```bash
node scripts/deploy_jar.js core-cvc
```

### List all payor modules

```bash
node scripts/list_modules.js
```

Shows three sections:
- **READY TO DEPLOY** — has a built jar in `target/`; shows source jar and deployed name
- **NEEDS BUILD FIRST** — has `pom.xml` but no jar yet; run `mvn clean install` first
- **NON-MAVEN DIRECTORIES** — shown only with `--all`; never deployable

```bash
node scripts/list_modules.js --all    # also show non-Maven dirs
```

---

## Configuration — config.xlsx

Open `config.xlsx` and fill the **Overridden Value** column for anything that
differs from the default. Leave blank to keep the default. Never edit JS files directly.

### Tab 1 — General

| Key | Default Value | Description |
|---|---|---|
| `nodeModules` | `C:/Users/abhuinya/node_modules` | Path to node_modules with `xlsx` package |
| `payorRepoRoot` | `C:/Users/abhuinya/hebb` | Fallback: parent folder of `hrp.payer.core-*` repos. Not used when `SRCDIR` env var is set. |
| `sharedFolder` | `C:/Users/abhuinya/shared` | Windows path to shared folder mounted in docker (**override to** `C:/Users/abhuinya/shared/payor_env`) |

### Tab 2 — Docker_VM

| Key | Default Value | Description |
|---|---|---|
| `containerName` | `payer-tc-261` | Docker container name |
| `dockerUser` | `weblogic` | User to exec commands as inside docker |
| `dockerPassword` | *(blank)* | Leave blank — no password required |
| `deployDir` | `/home/weblogic/domains/healthedge/jars` | Where jars are deployed inside the container |

### Tab 3 — jar_location (optional overrides per module)

| Column | Purpose |
|---|---|
| `Module` | Module name, e.g. `core-cvc` |
| `From` | Override source jar path (absolute Windows path) — skips `SRCDIR` lookup |
| `To` | Override deployed jar name, e.g. `core-cvc.jar` — leave blank to auto-strip version |
| `Shared Folder` | Override shared folder for this module — leave blank to use `General → sharedFolder` |

---

## How Branch / SRCDIR Resolution Works

`setbranch` is a PowerShell function defined in
`Documents/WindowsPowerShell/Healthedge.Powershell_functions.ps1`.
Running `setbranch 26.1` in PowerShell does:

1. Writes `~/.default-branch` ← `26.1` (bare branch name)
2. Sets `SRCDIR = C:\Users\abhuinya\hebb\hrp.payer.core-26.1` (when `SEPARATE_BRANCH_DIRECTORIES=true`)
3. Persists `SRCDIR` to Windows User environment variables

`jar_resolver.js` resolves the payor repo in this priority order:

| Priority | Source | Notes |
|---|---|---|
| 1 | `SRCDIR` env var | Set by `setbranch` in the current PowerShell session |
| 2 | `~/.default-branch` | Bare branch name written by `setbranch`; combined with `GIT_HOME` + `REPO_PAYOR` |
| 3 | Auto-detect | Most recently modified `hrp.payer.core-*` dir under `payorRepoRoot` |

---

## Jar Naming — Version Stripping

Version info is automatically removed so the deployed name is stable across builds:

| Source jar | Deployed as |
|---|---|
| `core-cvc-27.1-SNAPSHOT.jar` | `core-cvc.jar` |
| `core-main-27.1-SNAPSHOT.jar` | `core-main.jar` |
| `core-foundation-26.1.5-SNAPSHOT.jar` | `core-foundation.jar` |

Override via `config.xlsx → jar_location → To` column.

---

## Step-by-Step Details

### Step 1 — Resolve jar

Reads `SRCDIR` env var (set by `setbranch`) then finds the SNAPSHOT jar inside
`<SRCDIR>/<moduleName>/target/`. Source path and deploy name can be overridden
per module via the `jar_location` sheet.

### Step 2 — Copy to shared folder

Copies the jar to the Windows shared folder (default: `C:\Users\abhuinya\shared\payor_env`)
which is bind-mounted into docker at `/home/weblogic/shared`.

### Step 3 — Stop server

Runs inside docker:
```bash
cd /home/weblogic/domains/healthedge && ./stopServer.sh 2>&1 || stopServer 2>&1
```
Then polls `ps aux` every 5 seconds until no weblogic/Tomcat Java process is found
(5-minute timeout).

### Step 4 — Deploy jar

Copies `/home/weblogic/shared/<deployName>` to `/home/weblogic/domains/healthedge/jars/<deployName>`
inside the container, replacing the previous jar.

### Step 5 — Cleanup shared folder

Deletes the jar from the Windows shared folder after successful deployment so the
folder stays clean. A warning is logged if deletion fails but deployment is not affected.

### Step 5b — Ensure Artemis queue is running

Checks whether an Artemis process is already running inside docker using `ps aux | grep Artemis`.
If no Artemis process is found, runs `startArtemis` inside the container before proceeding to
start the server. This guarantees the message queue is available when the Payor server boots.

### Step 6 — Start server

Runs inside docker (non-blocking):
```bash
cd /home/weblogic/domains/healthedge && nohup ./startServer.sh > /tmp/startServer.log 2>&1 &
```
Monitor `/tmp/startServer.log` inside the container to track startup progress.

---

## Troubleshooting

| Error / Symptom | Fix |
|---|---|
| `Cannot determine payor source directory` | Run `setbranch 26.1` (or relevant branch) in PowerShell first |
| `Module directory not found` | Check module name matches a subdirectory in `SRCDIR`. Use `node scripts/list_modules.js` to see valid names. |
| `No jar found in target/` | Module not compiled. Run `mvn clean install` or `mvn package` first. |
| Container not running | Start Docker Desktop, then `docker start payer-tc-261` |
| `docker: command not found` | Install Docker Desktop and ensure `docker` is on your PATH |
| `/home/weblogic/shared` not found inside docker | The `payor_env` subfolder is the actual mount point — set `sharedFolder` override to `C:/Users/abhuinya/shared/payor_env` in `config.xlsx` |
| Server does not stop in 5 minutes | Run `docker exec payer-tc-261 stopServer` manually, then re-run the script |

---

## Known Configuration (this machine)

| Setting | Value |
|---|---|
| Container name | `payer-tc-261` |
| Windows shared folder | `C:\Users\abhuinya\shared\payor_env` |
| Docker shared mount | `/home/weblogic/shared` |
| Deploy directory (in docker) | `/home/weblogic/domains/healthedge/jars` |
| Current SRCDIR | `C:\Users\abhuinya\hebb\hrp.payer.core-master` |
