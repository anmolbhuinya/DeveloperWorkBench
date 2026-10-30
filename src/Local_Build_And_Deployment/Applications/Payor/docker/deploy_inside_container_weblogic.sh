#!/bin/bash
# deploy_inside_container_weblogic.sh
# WebLogic equivalent of deploy_inside_container.sh.
# Stops WebLogic, deploys the distribution tarball, runs schema ops, starts WebLogic.

# Default values
SKIP_DB_UPGRADE=false
CREATE_SCHEMA=false
BOOTSTRAP_DW=false
ONLY_START=false

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-db-upgrade    Skip database upgrade steps"
    echo "  --create-schema      Drop and recreate OLTP schema only (no DW bootstrap)"
    echo "  --bootstrap-dw       Bootstrap DW schema (run after datauniv reload)"
    echo "  --only-start         Only start the server (no deployment/upgrade)"
    echo "  -h, --help           Show this help message"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-db-upgrade) SKIP_DB_UPGRADE=true; shift ;;
        --create-schema)   CREATE_SCHEMA=true;   shift ;;
        --bootstrap-dw)    BOOTSTRAP_DW=true;    shift ;;
        --only-start)      ONLY_START=true;      shift ;;
        -h|--help)         usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

if [ "$CREATE_SCHEMA" = true ] && [ "$SKIP_DB_UPGRADE" = true ]; then
    echo "Error: --create-schema and --skip-db-upgrade are mutually exclusive"
    usage
fi

if [ "$(whoami)" != "weblogic" ]; then
    echo "Error: This script must be run as weblogic user"
    exit 1
fi

WEBLOGIC_HOME="/home/weblogic"
ENV_DIR="$WEBLOGIC_HOME/environments/healthedge"
DISTRIBUTION_FILE="core.distribution-*-pkg.tar.gz"
STAGING_DIR="$WEBLOGIC_HOME/staging"
LOG_DIR="$STAGING_DIR/logs"
LOG_FILE="$LOG_DIR/deployPayor.log"

log_message() {
    local message="$1"
    local timestamp
    timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    echo "$timestamp [INFO] $message" | tee -a "$LOG_FILE"
}

mkdir -p "$STAGING_DIR" "$LOG_DIR"

# ── Helpers: stop/start WebLogic ─────────────────────────────────────────────

stop_weblogic() {
    log_message "Stopping Artemis server..."
    if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
        cd "$WEBLOGIC_HOME/artemis/HEBroker/bin" || true
        ./artemis-service stop &>> "$LOG_FILE"
        rm -rf "$WEBLOGIC_HOME/artemis/HEBroker/data/artemis.pid"
    else
        log_message "WARNING: Artemis service not found at $WEBLOGIC_HOME/artemis/HEBroker/bin"
    fi

    log_message "Stopping WebLogic server..."
    # Look for stopServer.sh under two candidate locations
    local STOP_CANDIDATES=(
        "$ENV_DIR/claimserver/install/tools/bin/stopServer.sh"
        "$WEBLOGIC_HOME/payor_distribution/target/core-distribution/claimserver/install/tools/bin/stopServer.sh"
    )
    local STOP_SCRIPT=""
    for c in "${STOP_CANDIDATES[@]}"; do
        if [ -x "$c" ]; then STOP_SCRIPT="$c"; break; fi
    done

    if [ -n "$STOP_SCRIPT" ]; then
        cd "$(dirname "$STOP_SCRIPT")" || true
        ./stopServer.sh &>> "$LOG_FILE"
    else
        log_message "WARNING: stopServer.sh not found — server may already be stopped."
    fi
}

start_weblogic() {
    log_message "Setting up Artemis broker (if not already created)..."
    local SETUP_ARTEMIS="$ENV_DIR/claimserver/install/tools/bin/setup-artemis.sh"
    if [ -f "$SETUP_ARTEMIS" ]; then
        chmod +x "$SETUP_ARTEMIS"
        bash "$SETUP_ARTEMIS" &>> "$LOG_FILE"
    else
        log_message "WARNING: setup-artemis.sh not found at $SETUP_ARTEMIS"
    fi

    log_message "Starting Artemis server..."
    if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
        cd "$WEBLOGIC_HOME/artemis/HEBroker/bin" || exit 2
        ./artemis-service start &>> "$LOG_FILE"
    else
        log_message "WARNING: Artemis service not found."
    fi

    log_message "Starting WebLogic server..."
    local START_CANDIDATES=(
        "$ENV_DIR/claimserver/install/tools/bin/startServer.sh"
        "$WEBLOGIC_HOME/payor_distribution/target/core-distribution/claimserver/install/tools/bin/startServer.sh"
    )
    local START_SCRIPT=""
    for c in "${START_CANDIDATES[@]}"; do
        if [ -x "$c" ]; then START_SCRIPT="$c"; break; fi
    done

    if [ -n "$START_SCRIPT" ]; then
        cd "$(dirname "$START_SCRIPT")" || exit 2
        ./startServer.sh &>> "$LOG_FILE"
    else
        log_message "WARNING: startServer.sh not found — run refresh-payor first to deploy the environment."
    fi
}

# ── --only-start shortcut ─────────────────────────────────────────────────────

if [ "$ONLY_START" = true ]; then
    log_message "Only starting servers (skipping deployment and upgrade)..."
    start_weblogic
    log_message "Server start completed."
    exit 0
fi

log_message "Starting WebLogic deployment:"
log_message "  - Skip DB Upgrade: $SKIP_DB_UPGRADE"
log_message "  - Create Schema:   $CREATE_SCHEMA"
log_message "  - Bootstrap DW:    $BOOTSTRAP_DW"

# ── Stop ─────────────────────────────────────────────────────────────────────

stop_weblogic

# Verify /user_projects/domains symlink (created as root by refresh_payor.js).
# upgrade-dw.sh / upgrade-oltp.sh hardcode /user_projects/domains/healthedge/...
if [ ! -e /user_projects/domains ]; then
    log_message "WARNING: /user_projects/domains symlink is missing. DB upgrade scripts will fail."
    log_message "         This is normally created by refresh_payor.js before deployment."
fi

# ── Extract distribution ──────────────────────────────────────────────────────

log_message "Removing existing core distribution..."
rm -rf "$WEBLOGIC_HOME/payor-distribution/$DISTRIBUTION_FILE"
rm -rf "$ENV_DIR"

log_message "Extracting distribution..."
cd "$STAGING_DIR" || exit 2
tar -xf $DISTRIBUTION_FILE
cp -r healthedge/ "$ENV_DIR"

# ── wl.properties ─────────────────────────────────────────────────────────────

log_message "Copying wl.properties from staging to env_dir..."
cp "$STAGING_DIR/wl.properties" "$ENV_DIR"

log_message "Converting files to Unix format..."
cd "$ENV_DIR" || exit 2
find . -type f -exec dos2unix {} \;

# ── install.sh ────────────────────────────────────────────────────────────────

# BEA_HOME must be set so install.sh can locate/create the domain.
# With the /user_projects/domains -> /home/weblogic/domains symlink in place,
# BEA_HOME=/ means: $BEA_HOME/user_projects/domains/healthedge = /home/weblogic/domains/healthedge
export BEA_HOME=/
export SRCDIR="$ENV_DIR"
log_message "Running installation script (BEA_HOME=$BEA_HOME  SRCDIR=$SRCDIR)..."
cd "$ENV_DIR/payor-utils" || exit 2
chmod +x install.sh
cd "$ENV_DIR/claimserver" || exit 2
./install.sh --full -n -w ../wl.properties &>> "$LOG_FILE"

# ── DB schema ─────────────────────────────────────────────────────────────────

if [ "$SKIP_DB_UPGRADE" = true ]; then
    log_message "Skipping database upgrade as requested."
elif [ "$BOOTSTRAP_DW" = true ]; then
    log_message "Bootstrapping DW schema..."
    cd "$ENV_DIR/ddl/dw" || exit 2
    chmod +x *.sh 2>/dev/null || true
    ./upgrade-dw.sh upgrade.xml releaseLocks
    ./bootstrap-dw.sh
elif [ "$CREATE_SCHEMA" = true ]; then
    log_message "Creating OLTP schema from scratch (dropAll + install)..."
    cd "$ENV_DIR/ddl/oltp" || exit 2
    chmod +x *.sh 2>/dev/null || true
    ./upgrade-oltp.sh upgrade.xml releaseLocks
    ./install-oltp.sh dropAll
    log_message "OLTP schema created. Datauniv reload must run before DW bootstrap."
else
    log_message "Upgrading the OLTP database..."
    cd "$ENV_DIR/ddl/oltp" || exit 2
    chmod +x *.sh 2>/dev/null || true
    ./upgrade-oltp.sh upgrade.xml releaseLocks
    ./upgrade-oltp.sh upgrade.xml clearCheckSums
    ./upgrade-oltp.sh

    log_message "Upgrading the DW database..."
    cd "$ENV_DIR/ddl/dw" || exit 2
    chmod +x *.sh 2>/dev/null || true
    ./upgrade-dw.sh upgrade.xml releaseLocks
    ./upgrade-dw.sh upgrade.xml clearCheckSums
    ./upgrade-dw.sh
fi

# Skip server start for --create-schema (datauniv + DW bootstrap must happen first)
if [ "$CREATE_SCHEMA" = true ]; then
    log_message "Skipping server start — will start after datauniv reload and DW bootstrap."
    exit 0
fi

# ── Start ─────────────────────────────────────────────────────────────────────

start_weblogic

log_message "WebLogic deployment completed successfully."
