# Payor Deployment Automation

This directory contains scripts for automating the build and deployment of the Payor application to a Docker container.

## Repository Structure

```
hrp.dev.tools/
├── docker/payor/tomcat/                  ← deployment scripts
│   ├── deployPayorTomcat.sh              ← main orchestrator (run this)
│   ├── deploy_inside_container.sh        ← runs inside Docker container
│   ├── wl.properties                     ← install configuration
│   └── README.md
│
└── secrets_management/                   ← zero-secret tooling
    ├── fetchAWSSecrets.sh                ← fetch secrets from AWS → ~/.secrets_env
    ├── updateConfigurationFiles.sh       ← inject vault: refs with real secrets
    └── payor_configuration_file_path.yaml ← config targets for secrets injection
```

## Prerequisites

- Docker installed and running
- AWS CLI configured with a profile that has access to `hrp-payor-dev/*` secrets
- `SRCDIR` environment variable pointing to `hrp.payer.core` repository root
- `DOMAIN_HOME` environment variable pointing to local domain directory
- `~/.secrets_path` file listing AWS secret names to fetch (one per line)
- `~/.secrets_env` populated by running `fetchAWSSecrets.sh`

## One-Time Setup

```bash
# 1. Create ~/.secrets_path listing the secrets to fetch
cat > ~/.secrets_path << 'SECRETS'
hrp-payor-dev/artemis-creds
hrp-payor-dev/payor-creds
hrp-payor-dev/xten-creds
hrp-payor-dev/blue-card-creds
hrp-payor-dev/gpcs-creds
hrp-payor-dev/source-creds
hrp-payor-dev/encryption-creds
hrp-payor-dev/burgess-creds
hrp-payor-dev/hrco-integration-creds
hrp-payor-dev/provider-directory-creds
SECRETS

# 2. Fetch secrets from AWS Secrets Manager
AWS_PROFILE=he-bedrockinvocation-dev-902338856854 \
    ./secrets_management/fetchAWSSecrets.sh
```

## Usage

### Main Deployment Script

```bash
cd docker/payor/tomcat
./deployPayorTomcat.sh [OPTIONS]
```

#### Options

| Option | Description |
|---|---|
| `--skip-build` | Skip the Maven build step |
| `--skip-tests` | Skip tests during Maven build |
| `--skip-deploy` | Skip deployment to container |
| `--skip-db-upgrade` | Skip Liquibase DB upgrade steps |
| `--container NAME` | Use specific container name (default: payer-tc-261) |
| `--build-just MODULE` | Build only a specific Maven module |
| `--debug` | Enable debug logging |
| `--help` | Display help message |

### Examples

```bash
# Full build and deploy
./deployPayorTomcat.sh

# Skip build, deploy only
./deployPayorTomcat.sh --skip-build

# Skip build and DB upgrade
./deployPayorTomcat.sh --skip-build --skip-db-upgrade

# Build without tests
./deployPayorTomcat.sh --skip-tests
```

## Deployment Workflow

1. **Build** — `mvn clean install` on `hrp.payer.core`
2. **Copy to staging** — `wl.properties`, distribution tar, `deploy_inside_container.sh`, `installCommon-tomcat.bash`, `runtime.properties.template`, `updateConfigurationFiles.sh`, `payor_configuration_file_path.yaml`, `~/.secrets_env`
3. **Inside container**:
   - Stop Artemis + Tomcat
   - Extract distribution, apply patched scripts
   - `install-tomcat.sh` — writes `vault:` placeholders into `runtime.properties`
   - `updateConfigurationFiles.sh --local` — replaces `vault:` with real secrets from `~/.secrets_env`
   - Liquibase DB upgrade
   - Start Artemis + Tomcat
4. **Copy back** — `runtime.properties` (with real secrets) copied to local `$DOMAIN_HOME`

## Secrets Management

Secrets are managed via AWS Secrets Manager. No plaintext credentials are stored in any script or committed file.

| Tool | Location | Purpose |
|---|---|---|
| `fetchAWSSecrets.sh` | `secrets_management/` | Fetches secrets from AWS → `~/.secrets_env` |
| `updateConfigurationFiles.sh` | `secrets_management/` | Replaces `vault:` placeholders with real values |
| `payor_configuration_file_path.yaml` | `secrets_management/` | Defines which files to inject secrets into |

## Troubleshooting

- **Deployment logs**: `/home/weblogic/staging/logs/deployPayor.log` inside the container
- **Debug mode**: `./deployPayorTomcat.sh --debug`
- **Secrets not injected**: Run `fetchAWSSecrets.sh` first to refresh `~/.secrets_env`
- **Liquibase ORA-12514**: Oracle DB service name mismatch — check `OLTP_DB`/`DW_DB` in `wl.properties` matches `lsnrctl status` on the DB container
