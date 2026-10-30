#!/bin/bash

# Default values
SKIP_DB_UPGRADE=false
ONLY_START=false

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-db-upgrade    Skip database upgrade steps"
    echo "  --only-start         Only start the server (no deployment/upgrade)"
    echo "  -h, --help          Show this help message"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-db-upgrade)
            SKIP_DB_UPGRADE=true
            shift
            ;;
        --only-start)
            ONLY_START=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate --only-start option
if [ "$ONLY_START" = true ] && [ "$SKIP_DB_UPGRADE" = true ]; then
    echo "Error: --only-start cannot be used with other options"
    usage
fi

# Check if running as weblogic user
if [ "$(whoami)" != "weblogic" ]; then
    echo "Error: This script must be run as weblogic user"
    exit 1
fi

# Configuration
WEBLOGIC_HOME="/home/weblogic"
ENV_DIR="$WEBLOGIC_HOME/environments/healthedge"
DISTRIBUTION_FILE="core.distribution-*-pkg.tar.gz"
STAGING_DIR="$WEBLOGIC_HOME/staging"
LOG_DIR="$STAGING_DIR/logs"
LOG_FILE="$LOG_DIR/deployPayor.log"
export DOMAIN_HOME="$WEBLOGIC_HOME/domains/healthedge"
export WL_DOMAIN="healthedge"

# Function to log messages
log_message() {
    local message="$1"
    local timestamp
    timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    local log_message="$timestamp [INFO] $message"
    echo "$log_message" | tee -a "$LOG_FILE"
}

# Ensure staging and log directories exist
mkdir -p "$STAGING_DIR" "$LOG_DIR"

# Create artemis-current symlink only if it doesn't already exist; never overwrite it
ARTEMIS_DIR="$WEBLOGIC_HOME/artemis"
if [ -e "$ARTEMIS_DIR/artemis-current" ]; then
    log_message "artemis-current already exists -> $(readlink -f "$ARTEMIS_DIR/artemis-current"), leaving it untouched."
else
    mapfile -t ARTEMIS_VERSION_DIRS < <(find "$ARTEMIS_DIR" -maxdepth 1 -type d -name "apache-artemis-*" 2>/dev/null | sort -V)
    if [ "${#ARTEMIS_VERSION_DIRS[@]}" -gt 1 ]; then
        log_message "Multiple Artemis versions found under $ARTEMIS_DIR: $(printf '%s ' "${ARTEMIS_VERSION_DIRS[@]##*/}")"
    fi
    ARTEMIS_VERSION_DIR="${ARTEMIS_VERSION_DIRS[-1]}"
    if [ -n "$ARTEMIS_VERSION_DIR" ]; then
        log_message "Creating artemis-current -> $(basename "$ARTEMIS_VERSION_DIR")"
        ln -sfn "$(basename "$ARTEMIS_VERSION_DIR")" "$ARTEMIS_DIR/artemis-current"
    else
        log_message "No apache-artemis-* directory found under $ARTEMIS_DIR, skipping symlink creation."
    fi
fi


# ── Handle --only-start ───────────────────────────────────────────────────────
if [ "$ONLY_START" = true ]; then
    log_message "Only starting servers (skipping deployment and upgrade)..."

    log_message "Starting Artemis server..."
    if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
        cd "$WEBLOGIC_HOME/artemis/HEBroker/bin" || exit
        ./artemis-service start &>> "$LOG_FILE"
    else
        log_message "Artemis service not found."
    fi

    log_message "Starting Tomcat server..."
    if [ -x "$ENV_DIR/claimserver/install/tools/bin/start_tomcat_instances.sh" ]; then
        cd "$ENV_DIR/claimserver/install/tools/bin" || exit
        chmod +x start_tomcat_instances.sh
        ./start_tomcat_instances.sh -d &>> "$LOG_FILE"
    else
        log_message "Tomcat start script not found."
    fi

    log_message "Server start completed successfully."
    exit 0
fi

log_message "Starting deployment with configuration:"
log_message "  - Skip DB Upgrade: $SKIP_DB_UPGRADE"

# ── Step 1: Stop Artemis ──────────────────────────────────────────────────────
log_message "Stopping Artemis server..."
if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
    cd "$WEBLOGIC_HOME/artemis/HEBroker/bin" || exit 2
    ./artemis-service stop &>> "$LOG_FILE"
    rm -rf "$WEBLOGIC_HOME/artemis/HEBroker/data/artemis.pid"
else
    OLD_ARTEMIS_BIN="$WEBLOGIC_HOME/artemis/apache-artemis-${artemis_version}/bin/HEBroker"
    if [ -x "$OLD_ARTEMIS_BIN/bin/artemis-service" ]; then
        cd "$OLD_ARTEMIS_BIN/bin" || exit 2
        ./artemis-service stop &>> "$LOG_FILE"
        rm -rf "$OLD_ARTEMIS_BIN/data/artemis.pid"
    else
        log_message "Artemis service not found in either new or old path."
    fi
fi

# ── Step 2: Remove existing core distribution ─────────────────────────────────
log_message "Removing existing core distribution..."
{
    rm -rf "$WEBLOGIC_HOME/payor-distribution/$DISTRIBUTION_FILE"
    rm -rf "$ENV_DIR"
} &>> "$LOG_FILE"

# ── Step 3: Extract the distribution ─────────────────────────────────────────
log_message "Extracting the distribution..."
{
    cd "$STAGING_DIR" || exit 2
    tar -xf $DISTRIBUTION_FILE
    cp -r healthedge/ "$ENV_DIR"
} &>> "$LOG_FILE"

# ── Step 4: Copy wl.properties from staging to env_dir ───────────────────────
log_message "Checking for wl.properties..."
log_message "Copying wl.properties from staging to env_dir..."
{
    cp "$STAGING_DIR/wl.properties" "$ENV_DIR"
} &>> "$LOG_FILE"

# ── Step 5: Convert files to Unix format ─────────────────────────────────────
log_message "Converting files to Unix format..."
{
    cd "$ENV_DIR" || exit 2
    find . -type f -exec dos2unix {} \;
} &>> "$LOG_FILE"

# ── Step 6: Stop Tomcat ───────────────────────────────────────────────────────
log_message "Stopping Tomcat server..."
cd "$ENV_DIR/claimserver/install/tools/bin" || exit 2
chmod +x stop_tomcat_instances.sh
./stop_tomcat_instances.sh &>> "$LOG_FILE"

# ── Step 7: Apply patched scripts from staging ───────────────────────────────
# installCommon-tomcat.bash — uses awk (not sed) in replace_pattern() so vault:
# values containing ':' and '/' do not break the sed delimiter; also has vault:
# guard for Group A keys so they are written as-is (not encrypted).
log_message "Applying patched installCommon-tomcat.bash..."
if [ -f "$STAGING_DIR/installCommon-tomcat.bash" ]; then
    cp "$STAGING_DIR/installCommon-tomcat.bash"        "$ENV_DIR/claimserver/install/installCommon-tomcat.bash"
fi

# install-tomcat.sh — updated version adds --inject-secrets and --secrets-map.
# The version shipped inside the container image is the old one without these
# flags. We overwrite it from staging so Step 13 can pass --inject-secrets.
log_message "Applying updated installsh..."
if [ -f "$STAGING_DIR/install.sh" ]; then
    cp "$STAGING_DIR/install.sh"        "$ENV_DIR/claimserver/install.sh"
    chmod +x "$ENV_DIR/claimserver/install.sh"
else
    log_message "Warning: install-tomcat.sh not in staging — container version will be used."
fi

# ── Step 8: Apply dev runtime.properties.template override ───────────────────
# The dev template sets all credentials to vault:<path>:<field> references so
log_message "Applying dev runtime.properties.template override..."
if [ -f "$STAGING_DIR/runtime.properties.template" ]; then
    cp "$STAGING_DIR/runtime.properties.template" \
       "$ENV_DIR/claimserver/install/runtime.properties.template"
    log_message "Dev template applied: $STAGING_DIR/runtime.properties.template → $ENV_DIR/claimserver/install/runtime.properties.template"
fi

# ── Step 9: Copy .secrets_env from staging into home directory ───────────────
# CREDS is used two ways:
#   a) Step 11 maps JSON field names to env vars (OLTP_PASSWORD etc.) so
#      installCommon-tomcat.bash can fall back to them when wl.properties
#      is missing a property.
#   b) --credentials "$CREDS" is passed to updateConfigurationFiles.sh
#      for runtime.properties injection.
#      so it does not re-read .secrets_env
if [ -f "$STAGING_DIR/.secrets_env" ]; then
    cp "$STAGING_DIR/.secrets_env" "$WEBLOGIC_HOME/.secrets_env"
    log_message ".secrets_env copied to $WEBLOGIC_HOME/.secrets_env"
else
    log_message "Error: $STAGING_DIR/.secrets_env not found — cannot inject secrets."
    exit 2
fi

# ── Step 10: Load all secrets from .secrets_env into CREDS ──────────────────
# loadSecrets.sh flattens .secrets_env JSON fields (e.g. oltp-password=hedge)
# to KEY=value stdout. Keys are hyphenated JSON field names.
CREDS=""
if [ -f "$STAGING_DIR/loadSecrets.sh" ]; then
    log_message "Step 10: Loading credentials from .secrets_env..."
    CREDS=$("$STAGING_DIR/loadSecrets.sh" \
        --secrets-env "$WEBLOGIC_HOME/.secrets_env")
    [ -n "$CREDS" ] && log_message "Credentials loaded."
else
    log_message "Warning: loadSecrets.sh not in staging — secrets injection will read .secrets_env directly."
fi

# ── Step 11: Export credentials as env vars for installCommon-tomcat.bash ────
# installCommon-tomcat.bash reads wl.properties for credential values.
# If a property is absent from wl.properties it falls back to the env var.
# CREDS has hyphenated JSON field names (e.g. oltp-password) but
# installCommon-tomcat.bash expects UPPER_SNAKE_CASE env vars (e.g. OLTP_PASSWORD).
# Map them explicitly here.
if [ -n "$CREDS" ]; then
    log_message "Step 11: Exporting DB credentials as env vars for install fallback..."
    # Only OLTP_PASSWORD and DW_PASSWORD are exported as env var fallbacks.
    # These are written into the jocl files by installCommon-tomcat.bash and
    # are never overwritten later — so they must be correct at install time.
    # All other credentials (DEFAULT_PASSWORD, BURGESS_* etc.) are written to
    # runtime.properties by installCommon-tomcat.bash but then overwritten by
    # updateConfigurationFiles.sh in Step 13 — so no fallback needed here.
    _lookup_cred() {
        local field="$1"
        local val=""
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            local k="${line%%=*}" v="${line#*=}"
            if [[ "$k" == "$field" ]]; then
                val="$v"
                break
            fi
        done <<< "$CREDS"
        printf '%s' "$val"
    }
    export OLTP_PASSWORD=$(_lookup_cred "oltp-password")
    export DW_PASSWORD=$(_lookup_cred "dw-password")
fi

# ── Step 12: Run install-tomcat.sh (product script — unchanged) ──────────────
# install-tomcat.sh runs the full install. installCommon-tomcat.bash reads
# wl.properties line by line and encrypts values directly.
# If a property is absent from wl.properties, the env var exported above is used.
log_message "Running installation script..."
{
    cd "$ENV_DIR/payor-utils" || exit 2
    chmod +x install.sh
    cd "$ENV_DIR/claimserver" || exit 2
    ./install.sh \
        --full \
        -n \
        -w ../wl.properties
} 2>&1 | tee -a "$LOG_FILE"
log_message "Installation complete."

# ── Step 13: Inject secrets into runtime.properties ──────────────────────────
# updateConfigurationFiles.sh receives CREDS in memory via --credentials.
# No re-read of .secrets_env. CREDS flows: loadSecrets -> this script -> updateConfig.
if [ -f "$STAGING_DIR/updateConfigurationFiles.sh" ]; then
    log_message "Injecting secrets into runtime.properties..."
    UPDATE_ARGS=(
        --local
        --config "$STAGING_DIR/payor_configuration_file_path.yaml"
        --env    "$WEBLOGIC_HOME/.secrets_env"
    )
    # Pass pre-resolved credentials in memory if available (avoids re-reading .secrets_env)
    [ -n "$CREDS" ] && UPDATE_ARGS+=(--credentials "$CREDS")
    bash "$STAGING_DIR/updateConfigurationFiles.sh" "${UPDATE_ARGS[@]}" \
        2>&1 | tee -a "$LOG_FILE"
    log_message "Secrets injection complete."
else
    log_message "Warning: updateConfigurationFiles.sh not found — runtime.properties will have vault: placeholders."
fi

# ── Step 14: Upgrade the DB ───────────────────────────────────────────────────
if [ "$SKIP_DB_UPGRADE" = false ]; then
    log_message "Upgrading the OLTP database..."
    {
        cd "$ENV_DIR/ddl/oltp" || exit 2
        chmod +x upgrade-oltp.sh
        ./upgrade-oltp.sh upgrade.xml releaseLocks
        ./upgrade-oltp.sh upgrade.xml clearCheckSums
        ./upgrade-oltp.sh
    } 2>&1 | tee -a "$LOG_FILE"

    log_message "Upgrading the DW database..."
    {
        cd "$ENV_DIR/ddl/dw" || exit 2
        chmod +x upgrade-dw.sh
        ./upgrade-dw.sh upgrade.xml releaseLocks
        ./upgrade-dw.sh upgrade.xml clearCheckSums
        ./upgrade-dw.sh
    } 2>&1 | tee -a "$LOG_FILE"
else
    log_message "Skipping database upgrade as requested..."
fi

# ── Step 15: Write exit code BEFORE starting servers ─────────────────────────
# start_tomcat_instances.sh -d keeps the docker exec session alive for several
# minutes while it waits for Tomcat to fully start.  By the time it returns the
# Docker daemon has expired the exec instance ID, causing deployPayorTomcat.sh
# to see "No such exec instance" when it tries to read the result.
# Writing the exit code here (before server start) lets deployPayorTomcat.sh
# read it immediately via a short-lived docker exec — no race condition.
echo "0" > "$STAGING_DIR/.deploy_exit_code"
log_message "Deployment complete."

# ── Step 16: Start Artemis ────────────────────────────────────────────────────
log_message "Starting Artemis server..."
if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
    cd "$WEBLOGIC_HOME/artemis/HEBroker/bin" || exit 2
    ./artemis-service start &>> "$LOG_FILE"
else
    log_message "Artemis service not found — skipping start."
fi

# ── Step 17: Start Tomcat ─────────────────────────────────────────────────────
log_message "Starting Tomcat server..."
cd "$ENV_DIR/claimserver/install/tools/bin" || exit 2
chmod +x start_tomcat_instances.sh
./start_tomcat_instances.sh -d &>> "$LOG_FILE"
