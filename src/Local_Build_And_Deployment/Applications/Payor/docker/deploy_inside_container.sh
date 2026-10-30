#!/bin/bash

# Default values
SKIP_DB_UPGRADE=false
CREATE_SCHEMA=false
BOOTSTRAP_DW=false
ONLY_START=false

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-db-upgrade    Skip database upgrade steps"
    echo "  --create-schema      Drop and recreate OLTP schema only (no DW bootstrap)"
    echo "  --bootstrap-dw       Bootstrap DW schema (run after datauniv reload)"
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
        --create-schema)
            CREATE_SCHEMA=true
            shift
            ;;
        --bootstrap-dw)
            BOOTSTRAP_DW=true
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

# Validate option combinations
if [ "$ONLY_START" = true ] && [ "$SKIP_DB_UPGRADE" = true ]; then
    echo "Error: --only-start cannot be used with other options"
    usage
fi
if [ "$CREATE_SCHEMA" = true ] && [ "$SKIP_DB_UPGRADE" = true ]; then
    echo "Error: --create-schema and --skip-db-upgrade are mutually exclusive"
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
#DOMAIN_HOME="$WEBLOGIC_HOME/domains/your_domain"
STAGING_DIR="$WEBLOGIC_HOME/staging"
LOG_DIR="$STAGING_DIR/logs"
LOG_FILE="$LOG_DIR/deployPayor.log"

# Function to log messages
log_message() {
    local message="$1"
    local timestamp
    timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    local log_message="$timestamp [INFO] $message"
    echo "$log_message" | tee -a "$LOG_FILE"
}

# Ensure staging and log directories exist
if [ ! -d "$STAGING_DIR" ]; then
    mkdir -p "$STAGING_DIR"
fi

if [ ! -d "$LOG_DIR" ]; then
    mkdir -p "$LOG_DIR"
fi

# Handle --only-start: just start the servers and exit
if [ "$ONLY_START" = true ]; then
    log_message "Only starting servers (skipping deployment and upgrade)..."

    log_message "Starting Artemis server..."
    if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
        cd $WEBLOGIC_HOME/artemis/HEBroker/bin || exit
        ./artemis-service start &>> "$LOG_FILE"
    else
        log_message "Artemis service not found."
    fi

    log_message "Starting Tomcat server..."
    if [ -x "$ENV_DIR/claimserver/install/tools/bin/start_tomcat_instances.sh" ]; then
        cd $ENV_DIR/claimserver/install/tools/bin || exit
        chmod +x start_tomcat_instances.sh
        ./start_tomcat_instances.sh -d &>> "$LOG_FILE"
    elif [ -n "$CATALINA_HOME" ] && [ -d "$WEBLOGIC_HOME/domains/$WL_DOMAIN/claimserver" ]; then
        log_message "Falling back to direct Catalina start (domain-based instance)..."
        export CATALINA_BASE="$WEBLOGIC_HOME/domains/$WL_DOMAIN/claimserver"
        "$CATALINA_HOME/bin/catalina.sh" start >> "$LOG_FILE" 2>&1
        log_message "Catalina start command issued."
    else
        log_message "Tomcat start script not found."
    fi

    log_message "Server start completed successfully."
    exit 0
fi

log_message "Starting deployment with configuration:"
log_message "  - Skip DB Upgrade: $SKIP_DB_UPGRADE"
log_message "  - Create Schema:   $CREATE_SCHEMA"
log_message "  - Bootstrap DW:    $BOOTSTRAP_DW"

log_message "Stopping Artemis server..."
if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
    # New path exists
    cd $WEBLOGIC_HOME/artemis/HEBroker/bin || exit 2
    ./artemis-service stop &>> "$LOG_FILE"
    rm -rf $WEBLOGIC_HOME/artemis/HEBroker/data/artemis.pid
else
    # Fallback to old path for stopping Artemis
    OLD_ARTEMIS_BIN="$WEBLOGIC_HOME/artemis/apache-artemis-${artemis_version}/bin/HEBroker"
    if [ -x "$OLD_ARTEMIS_BIN/bin/artemis-service" ]; then
        cd $OLD_ARTEMIS_BIN/bin || exit 2
        ./artemis-service stop &>> "$LOG_FILE"
        rm -rf $OLD_ARTEMIS_BIN/data/artemis.pid
    else
        log_message "Artemis service not found in either new or old path."
    fi
fi

#stop_server.sh &>> "$LOG_FILE"

# Step 1: Remove existing core distribution
log_message "Removing existing core distribution..."
{
    rm -rf $WEBLOGIC_HOME/payor-distribution/$DISTRIBUTION_FILE
    rm -rf $ENV_DIR
} &>> "$LOG_FILE"

# Step 2: Copy the distribution to the staging folder
# log_message "Copying the distribution to the staging folder..."
# {
    # cp $DISTRIBUTION_FILE $STAGING_DIR
# } &>> "$LOG_FILE"

# Step 3: Extract the distribution from the staging folder
log_message "Extracting the distribution..."
{
    cd $STAGING_DIR || exit 2
    tar -xf $DISTRIBUTION_FILE
    cp -r healthedge/ $ENV_DIR
} &>> "$LOG_FILE"

# Step 4: Check and copy wl.properties if not present
log_message "Checking for wl.properties..."
# {
    # cd $ENV_DIR
    # if ! ls | grep -q wl.properties; then
        # cp /path/to/init-windows/resources/wl.properties $ENV_DIR
    # fi
# } &>> "$LOG_FILE"

# Step 5: Copy wl.properties to the staging folder
# log_message "Copying wl.properties to the staging folder..."
# {
    # cp $WEBLOGIC_HOME/shared/wl.properties $STAGING_DIR
# } &>> "$LOG_FILE"

# Step 6: Copy wl.properties from staging to env_dir
log_message "Copying wl.properties from staging to env_dir..."
{
    cp $STAGING_DIR/wl.properties $ENV_DIR
} &>> "$LOG_FILE"

# Step 7: Convert files to Unix format
log_message "Converting files to Unix format..."
{
    cd $ENV_DIR || exit 2
    find . -type f -exec dos2unix {} \;
} &>> "$LOG_FILE"

# Step 8: Update wl.properties
# log_message "Updating wl.properties..."
# {
    # sed -i 's/OLTP_HOST=.*/OLTP_HOST=payer-db-1/' wl.properties
    # sed -i 's/DW_HOST=.*/DW_HOST=payer-db-1/' wl.properties
    # sed -i 's/OLTP_PORT=.*/OLTP_PORT=1521/' wl.properties
    # sed -i 's/DW_PORT=.*/DW_PORT=1521/' wl.properties
    # grep -q 'SDPF_HCC_UNIQUE_IDENTIFIER' wl.properties || echo 'SDPF_HCC_UNIQUE_IDENTIFIER=PHIC' >> wl.properties
    # grep -q 'DEFAULT_PASSWORD' wl.properties || echo 'DEFAULT_PASSWORD=denovis10x' >> wl.properties
# } &>> "$LOG_FILE"


log_message "Stopping Tomcat server..."
cd $ENV_DIR/claimserver/install/tools/bin || exit 2
chmod +x stop_tomcat_instances.sh
./stop_tomcat_instances.sh &>> "$LOG_FILE"

# Step 9: Verify /user_projects/domains symlink.
# upgrade-dw.sh / upgrade-oltp.sh hardcode /user_projects/domains/healthedge/...
# refresh_payor.js creates this symlink as root before calling this script.
if [ ! -e /user_projects/domains ]; then
    log_message "WARNING: /user_projects/domains symlink is missing. DB upgrade scripts will fail."
    log_message "         This is normally created by refresh_payor.js before deployment."
fi

# Step 10: Run installation script
# BEA_HOME must be set so install.sh can locate/create the domain.
# With the /user_projects/domains -> /home/weblogic/domains symlink in place,
# BEA_HOME=/ means: $BEA_HOME/user_projects/domains/healthedge = /home/weblogic/domains/healthedge
# install.sh needs BEA_HOME to locate the domain and SRCDIR to find metadata/release.txt.
# BEA_HOME=/ + the /user_projects/domains symlink resolves to /home/weblogic/domains/healthedge.
# SRCDIR=ENV_DIR makes $SRCDIR/metadata/release.txt resolve to the just-extracted release.txt.
export BEA_HOME=/
export SRCDIR="$ENV_DIR"
log_message "Running installation script (BEA_HOME=$BEA_HOME  SRCDIR=$SRCDIR)..."
{
	cd $ENV_DIR/payor-utils || exit 2
	chmod +x install.sh
    cd $ENV_DIR/claimserver || exit 2
    ./install.sh --full -n -w ../wl.properties

} &>> "$LOG_FILE"

# Step 11: DB schema
if [ "$SKIP_DB_UPGRADE" = true ]; then
    log_message "Skipping database upgrade as requested..."
elif [ "$BOOTSTRAP_DW" = true ]; then
    # Second pass after datauniv reload: bootstrap DW only
    log_message "Bootstrapping DW schema..."
    {
        cd $ENV_DIR/ddl/dw || exit 2
        chmod +x *.sh 2>/dev/null || true
        ./upgrade-dw.sh upgrade.xml releaseLocks
        ./bootstrap-dw.sh
    } 2>&1 | tee -a "$LOG_FILE"
elif [ "$CREATE_SCHEMA" = true ]; then
    # First pass: recreate OLTP only — DW bootstrap happens after datauniv reload
    log_message "Creating OLTP schema from scratch (dropAll + install)..."
    {
        cd $ENV_DIR/ddl/oltp || exit 2
        chmod +x *.sh 2>/dev/null || true
        ./upgrade-oltp.sh upgrade.xml releaseLocks
        ./install-oltp.sh dropAll
    } 2>&1 | tee -a "$LOG_FILE"
    log_message "OLTP schema created. Datauniv reload must run before DW bootstrap."
else
    log_message "Upgrading the OLTP database..."
    {
        cd $ENV_DIR/ddl/oltp || exit 2
        chmod +x *.sh 2>/dev/null || true
        ./upgrade-oltp.sh upgrade.xml releaseLocks
        ./upgrade-oltp.sh upgrade.xml clearCheckSums
        ./upgrade-oltp.sh
    } 2>&1 | tee -a "$LOG_FILE"

    log_message "Upgrading the DW database..."
    {
        cd $ENV_DIR/ddl/dw || exit 2
        chmod +x *.sh 2>/dev/null || true
        ./upgrade-dw.sh upgrade.xml releaseLocks
        ./upgrade-dw.sh upgrade.xml clearCheckSums
        ./upgrade-dw.sh
    } 2>&1 | tee -a "$LOG_FILE"
fi

# Skip server start when --create-schema: datauniv reload and DW bootstrap
# must complete first; refresh_payor.js will trigger --bootstrap-dw then
# --only-start once the full sequence is done.
if [ "$CREATE_SCHEMA" = true ]; then
    log_message "Skipping server start — will start after datauniv reload and DW bootstrap."
    exit 0
fi

log_message "Setting up Artemis broker (if not already created)..."
SETUP_ARTEMIS="$ENV_DIR/claimserver/install/tools/bin/setup-artemis.sh"
if [ -f "$SETUP_ARTEMIS" ]; then
    chmod +x "$SETUP_ARTEMIS"
    bash "$SETUP_ARTEMIS" &>> "$LOG_FILE"
else
    log_message "WARNING: setup-artemis.sh not found at $SETUP_ARTEMIS"
fi

log_message "Starting Artemis server..."
cd $WEBLOGIC_HOME/artemis/HEBroker/bin || exit 2
./artemis-service start &>> "$LOG_FILE"

log_message "Starting Tomcat server..."
cd $ENV_DIR/claimserver/install/tools/bin || exit 2
chmod +x start_tomcat_instances.sh
./start_tomcat_instances.sh -d &>> "$LOG_FILE"

# Step 12: Start WebLogic server
#log_message "Starting WebLogic server..."
#start_server.sh &>> "$LOG_FILE"

#log_message "Deployment completed successfully."