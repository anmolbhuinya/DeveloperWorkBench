# Payor IT Failure Remote Regression — Workflow Documentation

## Overview

This workflow automates the full Payor regression analysis cycle for each release:

```
[Phase 0] Populate baseline from previous-release Jenkins builds
        │   → baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx
        ▼
  [Step 1] Fetch failures from Jenkins API
        │   → Jenkins_Payor_IT_Failures_Local_<version>.xlsx
        ▼
  [Step 2] SSH into remote server, run each IT class
        │   → it_results_raw_<version>.txt
        ▼
  [Step 3] Update Excel with Local Failure / Timeout / Baseline results
        │   → Excel updated in-place
        ▼
  [Step 4] Generate regression email draft
              → Regression_Email_<version>.docx
```

---

## Commands

| Command | Alias | Description |
|---|---|---|
| `remotepopulatepayorbaseline` | `rpb` | Fetch baseline Jenkins failures → `baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx` |
| `remotepayorregression` | `rprt` | Full 4-step regression report (Steps 1–4) |
| `rprt -rfits [--timeout <s>]` | | Rerun ITs where Local Failure = Yes → update Excel → email |
| `rprt -rtits [--timeout <s>]` | | Rerun ITs where Timeout = Yes → update Excel → email |
| `rprt -rits  [--timeout <s>]` | | Rerun ITs where Rerun col = Yes/Y/1/True → update Excel → email |
| `rprt --help` | | Show full CLI usage |
| `rpb --help` | | Show baseline population usage |

---

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js | v16 or later |
| npm packages | `xlsx`, `docx` — path in `config.xlsx` → General tab → `nodeModules` |
| SSH access | Password auth (`sshpass`) or key-based — configured in `config.xlsx` → RemoteServer tab |
| Jenkins access | Network access to `engsvc-engjen1.headquarters.healthedge.com:8080` |
| Remote repo | Branch already compiled at the path set in `config.xlsx` → RemoteServer tab → `repo` |
| Baseline file | `baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx` — run `rpb` to populate Local Failure column; set Known Failure = Yes manually for pre-classified failures |

---

## Folder Structure

```
Remote_Regression_Jenkins_IT_Failure/
└── Payor/
    ├── config.xlsx                             ← Edit this each release (5 tabs)
    ├── Regression_Email_Format_V2.docx         ← Email section format reference
    ├── ReadMe.docx                             ← End-user guide
    ├── baseline/
    │   └── Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx
    ├── scripts/
    │   ├── config.js                           ← Reads config.xlsx (do not edit)
    │   ├── utils.js                            ← Shared helpers
    │   ├── create_config_xlsx.js               ← One-time: generate config.xlsx
    │   ├── gen_readme.js                       ← Regenerate ReadMe.docx
    │   ├── populate_baseline.js                ← Phase 0: fetch baseline failures
    │   ├── step1_fetch_jenkins_failures.js     ← Fetch Jenkins failures → Excel
    │   ├── step2_run_remote_its.js             ← Run ITs on remote server
    │   ├── step3_update_excel.js               ← Update Excel with results
    │   ├── step4_generate_email.js             ← Generate email docx
    │   ├── run_all.js                          ← Runs all 4 steps (+ rerun modes)
    │   ├── rerun_its.js                        ← Rerun selected/failed/timedout ITs
    │   └── known_failures.json                 ← (optional) pre-known failures
    └── <output>/                               ← Defaults to cwd; override in config.xlsx
        ├── Jenkins_Payor_IT_Failures_Local_<version>.xlsx
        ├── it_results_raw_<version>.txt
        └── Regression_Email_<version>.docx
```

---

## Setup for a New Release

### 1. Edit `config.xlsx`

Open `Payor/config.xlsx`. Each tab has a **Default Value** column (pre-filled) and an **Overridden Value** column. Fill in **Overridden Value** for what you want to change; leave blank to keep the default.

**General tab**

| Key | Default Value | What to set |
|---|---|---|
| `version` | `26.1.5` | New release version, e.g. `26.1.6` |
| `nodeModules` | `C:/Users/abhuinya/node_modules` | Leave blank unless packages moved |
| `outputFileName` | *(blank)* | Leave blank — uses `Jenkins_Payor_IT_Failures_Local_<version>.xlsx` |
| `testTimeout` | `600` | Per-test Maven timeout in seconds; override if needed |
| `outputDir` | *(blank = cwd)* | Absolute path to redirect output files |
| `baselineVersion` | *(blank)* | Previous release version, e.g. `26.0.9` |
| `baselineFile` | `Baseline_Jenkins_Payor_IT_Status.xlsx` | Leave blank — version is appended automatically |
| `baselineDir` | `.../Payor/baseline` | Leave blank unless baseline file lives elsewhere |
| `emailFormat` | `.../Regression_Email_Format_V2.docx` | Leave blank |

**JenkinsJobs tab** — update Overridden URL for each new build number

| ValueStream | Default URL (abbreviated) | Overridden URL |
|---|---|---|
| billing | `.../MR-payer-billing-ora-container/1222/` | `.../1400/` ← new build |
| claims | `.../MR-payer-claims-ora-container/1347/` | |
| enrollment | `.../MR-payer-enrollment-ora-container/1056/` | |
| integrations | `.../MR-payer-he-integrations-ora-container/1076/` | |
| platform | `.../MR-payer-platform-ora-container/1078/` | |
| provider | `.../MR-payer-provider-ora-container/1084/` | |

**Baseline tab** — set once per release cycle (before running `rpb`)

| ValueStream | Overridden URL |
|---|---|
| billing | URL of a stable previous-release billing Jenkins build |
| claims | |
| enrollment | |
| integrations | |
| platform | |
| provider | |

**RemoteServer tab**

| Key | Default Value | What to set |
|---|---|---|
| `host` | `10.22.125.9` | Update if server IP changes |
| `user` | `weblogic` | |
| `password` | `weblogic` | |
| `auth` | `password` | `key` if using SSH private key |
| `sshKey` | *(blank)* | Absolute path to `.pem` / `id_rsa` when `auth = key` |
| `repo` | `/home/weblogic/hebb/hrp.payer.core-26.1` | Update branch path each release |

> **First time only:** If `config.xlsx` does not exist yet, run:
> ```bash
> node scripts/create_config_xlsx.js
> ```

### 2. Update `known_failures.json` (optional)

```json
[
  "com.healthedge.SomeClass.someMethod",
  "com.healthedge.AnotherClass.anotherMethod"
]
```

If the file does not exist, no tests are pre-marked as known failures.

---

## Running the Workflow

### Phase 0 — Populate Baseline (once per release cycle)

Fill in the **Baseline tab** in `config.xlsx` with previous-release Jenkins URLs, then run:

```bash
rpb
```

Output: `baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx`

The baseline Excel has 4 columns: **IT Class | Test Method | Known Failure | Local Failure**.

`rpb` sets **Local Failure = Yes** for every test that failed in the baseline builds. **Known Failure** is left blank — you can set it to `Yes` manually for tests you want to pre-classify as known issues.

Step 3 reads both columns:
- **Known Failure = Yes** → test is promoted to Known Failure in the output Excel (skipped in reporting)
- **Local Failure = Yes** → test is marked Baseline Failure (was already failing last release, not a new regression)

### Option A — Full automated run

```bash
rprt
```

Runs all 4 steps sequentially. Step 2 (remote IT run) typically takes 2–4 hours.

### Option B — Individual steps

```bash
node scripts/step1_fetch_jenkins_failures.js   # ~1 minute
node scripts/step2_run_remote_its.js           # 2–4 hours
node scripts/step3_update_excel.js             # ~10 seconds
node scripts/step4_generate_email.js           # ~10 seconds
```

### Option C — Rerun specific test cases

After a full run, use rerun modes to re-execute a subset and refresh the Excel + email without re-fetching from Jenkins.

```bash
rprt -rfits                     # rerun ITs where Local Failure = Yes
rprt -rtits                     # rerun ITs where Timeout = Yes
rprt -rits                      # rerun ITs where Rerun col = Yes / Y / 1 / True
rprt -rfits --timeout 300       # rerun failed ITs with 5-minute timeout override
rprt -rtits --timeout 900       # rerun timed-out ITs with 15-minute timeout
```

**How to flag specific rows for `-rits`:**
1. Open `Jenkins_Payor_IT_Failures_Local_<version>.xlsx`
2. In col G (Rerun), type `Yes`, `Y`, `1`, or `True` (case-insensitive) for the rows you want
3. Save the file, then run `rprt -rits`

After any rerun: col D (Local Failure) and col E (Timeout) are updated, col G (Rerun) is cleared for executed rows, Summary sheet is refreshed, and a new email draft is generated.

You can also run `rerun_its.js` directly for finer control:

```bash
node scripts/rerun_its.js                          # Rerun col (Rerun=Yes/Y/1/True)
node scripts/rerun_its.js --failed                 # Local Failure = Yes
node scripts/rerun_its.js --timedout               # Timeout = Yes
node scripts/rerun_its.js --all                    # all (excluding Known Failures)
node scripts/rerun_its.js --failed --timeout 300   # with timeout override
```

---

## Step-by-Step Details

### Step 1 — Fetch Jenkins Failures

**Script:** `step1_fetch_jenkins_failures.js`

- Calls the Jenkins JSON API (`/testReport/api/json`) for each of the 6 job URLs.
- Collects all `FAILED`, `REGRESSION`, and `ERROR` test cases.
- Groups them by value stream into Excel tabs in this order:

| Tab | Jenkins Job |
|---|---|
| Billing | MR-payer-billing-ora-container |
| Claims | MR-payer-claims-ora-container |
| Enrollment | MR-payer-enrollment-ora-container |
| Integrations | MR-payer-he-integrations-ora-container |
| Platform | MR-payer-platform-ora-container |
| Provider | MR-payer-provider-ora-container |

- Marks tests in `known_failures.json` with `Known Failure = Yes`.
- Prepends a **Summary** sheet with counts per value stream.

**Output:** `Jenkins_Payor_IT_Failures_Local_<version>.xlsx`

---

### Step 2 — Run IT Tests on Remote Server

**Script:** `step2_run_remote_its.js`

- Reads all test classes from Excel, excluding `Known Failure = Yes` rows.
- Scans the remote repo to map each class to its Maven module.
- Uploads and runs a bash script via SSH:
  ```bash
  timeout <testTimeout> mvn -pl <module> test -Dtest="<SimpleClass>" -DfailIfNoTests=false
  ```
  `<testTimeout>` defaults to `600` seconds; override via `config.xlsx → General → testTimeout`.
- Exit code classification:

  | Exit code | Result |
  |---|---|
  | 0 | PASS |
  | 124 | TIMEOUT |
  | non-zero + test output | FAIL |
  | non-zero + no test output | BUILD_ERROR |

- Polls every N minutes (Monitoring tab → `intervalMinutes`), printing a live monitor panel.
- Downloads `it_results_raw_<version>.txt` when `=== DONE ===` appears.

---

### Step 3 — Update Excel with Local + Baseline Results

**Script:** `step3_update_excel.js`

- Parses `it_results_raw_<version>.txt`.
- Updates the Excel column layout (A–G):

  | Col | Header | Set by |
  |---|---|---|
  | A | IT Class | Step 1 |
  | B | Test Method | Step 1 |
  | C | Known Failure | Step 1 / Step 3 (promoted) |
  | D | Local Failure | Step 3 |
  | E | Timeout | Step 3 |
  | F | Baseline Failure | Step 3 |
  | G | Rerun | User-filled |

- Baseline cross-check logic:
  - Locally failing + in baseline as Known Failure → promote col C = Yes, clear Local Failure
  - Locally failing + present in baseline file → col F = Yes (Baseline Failure)
  - Locally failing + not in baseline → col F blank (New Local Failure)

---

### Step 4 — Generate Regression Email

**Script:** `step4_generate_email.js`

Groups each test method into an email section based on its column values:

| Col C Known | Col D Local Fail | Col F Baseline | Email Section |
|---|---|---|---|
| Yes | — | — | Known Failures |
| blank | blank | — | Locally Passing |
| blank | Yes | Yes | Baseline Failure |
| blank | Yes | blank | New Local Failure |

Output: `Regression_Email_<version>.docx`

---

## Output Files

| File | Description |
|---|---|
| `Jenkins_Payor_IT_Failures_Local_<version>.xlsx` | All IT failures with Known / Local / Timeout / Baseline columns and Summary sheet |
| `it_results_raw_<version>.txt` | Raw per-class PASS/FAIL/TIMEOUT output from remote server |
| `rerun_results_raw_<version>.txt` | Raw output from the most recent rerun (if any) |
| `Regression_Email_<version>.docx` | Regression email draft |
| `baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx` | Baseline failures from previous release |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Step 1: `Could not parse test report` | Jenkins job URL or build number is wrong. Check `config.xlsx → JenkinsJobs tab`. |
| Step 2: SSH failure | Verify credentials in `config.xlsx → RemoteServer tab`. For `auth: password`, ensure `sshpass` is installed in Git Bash / WSL. |
| Step 2: Many `NOMODULE` results | The `repo` path in RemoteServer tab is wrong, or the branch is not compiled. |
| Step 3: 0 cells updated | Check that `it_results_raw_<version>.txt` is not empty and contains valid `PASS\|...\|FAIL\|...` lines. |
| Step 4: File locked (EBUSY) | Close the output `.docx` in Word before regenerating. |
| `rpb` generates wrong filename | Ensure `baselineFile` Overridden Value in config.xlsx does not contain a version — leave it blank; set `baselineVersion` instead. |
| Rerun finds no classes | For `-rfits`: check col D has `Yes` values. For `-rits`: check col G has `Yes`/`Y`/`1`/`True`. |

---

## Re-running After Config Changes

Any individual step can be re-run independently as long as its input files exist in `output/`.

```bash
# Re-fetch with updated Jenkins URLs, keep existing run results:
node scripts/step1_fetch_jenkins_failures.js

# Regenerate email only (e.g. after editing known_failures.json and re-running step 3):
node scripts/step3_update_excel.js
node scripts/step4_generate_email.js

# Regenerate ReadMe.docx after editing gen_readme.js:
node scripts/gen_readme.js
```
