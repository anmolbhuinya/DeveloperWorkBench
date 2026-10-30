# RedCard Docker Setup

One-click setup for Payor 25.1.4 + Connector + RedCard outbound on Docker (Windows).

## What you get

- Oracle DB, Payor WebLogic, and Connector Karaf containers
- Payor OLTP/DW schemas upgraded
- Connector Classic deployed to WebLogic
- RedCard outbound bundle + batch-transaction features in Karaf
- Host-side `test.properties`, `redcard.properties`, and `DOMAIN_HOME` synced for integration tests

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Windows 10/11** | PowerShell 5.1+ |
| **Docker Desktop** | Running, with enough RAM (connector container requests up to 15 GB) |
| **Java 11** | On `PATH` |
| **Maven 3.6+** | On `PATH` |
| **Nexus access** | VPN (for Docker images and artifact downloads) + `docker login nexus.headquarters.healthedge.com:8124` |
| **Maven Nexus settings** | Copy `templates/settings.xml.template` → `%USERPROFILE%\.m2\settings.xml` and set credentials (needed for IT tests only) |
| **`artifacts/` folder** | Large distributions are **downloaded automatically** from Nexus on first run if missing (~2 GB). `docker-compose.yml` and `wl.properties` ship with this package. |

### Artifacts (auto-downloaded if missing)

On Step 0, missing files listed in `artifacts/artifacts.manifest.json` are downloaded from Nexus public repo (VPN required). To skip downloads and use only local files:

```powershell
.\setup-all.ps1 -SkipDownload
```

| Artifact | Notes |
|----------|--------|
| `core-distribution-*.tar.gz` | Payor base |
| `connector-distribution-*.tar.gz` | Connector Karaf |
| `connector-classic-distribution-*.tar.gz` | Connector Classic WLS |
| `he-redcard-*-repos*.kar` | RedCard outbound (or `he-redcard-api-repos*.kar`) |
| `he-batch-transaction-*-repos*.kar` | Batch transaction KARs (3 files) |
| `wl.properties` | Shipped in repo (not downloaded) |

## Quick start

```powershell
.\setup-all.ps1
```

First run typically takes **45–90 minutes** (DB upgrade, Payor install, Karaf feature installs).

Logs are written to `logs/setup-all_<timestamp>.log`.

## Verify RedCard (optional)

Clone `hrp.he.redcard` and run integration tests from that repo (requires Maven Nexus settings and a running WebLogic instance):

```powershell
cd ..\hrp.he.redcard
$env:DOMAIN_HOME = "$env:USERPROFILE\domains\healthedge_25.1.4"
$env:MAVEN_OPTS = "-Djava.net.preferIPv4Stack=true"
mvn test -P integration-tests -pl he-redcard-outbound-tests `
  "-Dtest=ClaimAdjustmentPaidLessIT#testAdjustedClaimPaidLessScenario" `
  "-DTEST_PROP_FILE_NAME=$env:USERPROFILE\test.properties"
```

## What the script configures

| Host path | Purpose |
|-----------|---------|
| `%USERPROFILE%\shared\connector_env\` | Docker volume for RedCard trigger + output files |
| `%USERPROFILE%\shared\connector_env\redcard.properties` | RedCard IT + Karaf shared config |
| `%USERPROFILE%\test.properties` | Payor integration test properties |
| `%USERPROFILE%\domains\healthedge_25.1.4\` | WebLogic domain synced from container |

Karaf inside the connector container uses `/home/cprime/shared/...` (same volume as host `shared\connector_env`).

## Partial re-run (containers already up)

If Payor and Connector are already installed and you only need to redeploy RedCard:

```powershell
.\setup-redcard.ps1
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Docker pull fails | `docker login nexus.headquarters.healthedge.com:8124` on VPN |
| IT test JNDI timeout | Run `.\scripts\04_ensure_wls_running.ps1` — WLS may have stopped after connector-classic deploy |
| No outbound file in test | Confirm `%USERPROFILE%\shared\connector_env\redcardOutBound\output` exists; check connector logs: `docker exec connector-25-1-4 tail -100 /home/cprime/cprime/healthrules-connector-server-4.4.3/log/healthrules-connector.log` |
| Maven dependency errors | Configure `%USERPROFILE%\.m2\settings.xml` from template |

## Not included

- `connector-enrollmentsparse-repos` — not required for RedCard outbound
- Linux/macOS support
- Automatic download of Payor/Connector distributions from Nexus (see `artifacts/artifacts.manifest.json`)
