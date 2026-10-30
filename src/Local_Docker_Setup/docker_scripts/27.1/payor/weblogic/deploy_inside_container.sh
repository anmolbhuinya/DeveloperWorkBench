#!/bin/bash

# Default values
SKIP_DB_UPGRADE=false

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-db-upgrade    Skip database upgrade steps"
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
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

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
if [ ! -d "$STAGING_DIR" ]; then
    mkdir -p "$STAGING_DIR"
fi

if [ ! -d "$LOG_DIR" ]; then
    mkdir -p "$LOG_DIR"
fi  

log_message "Starting deployment with configuration:"
log_message "  - Skip DB Upgrade: $SKIP_DB_UPGRADE"

log_message "Stopping WebLogic server..."
stop_server.sh &>> "$LOG_FILE"

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
    cd $STAGING_DIR
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

# Step 8: Load secrets and export WEBLOGIC_PASSWORD for createDomain.py
# loadSecrets.sh flattens .secrets_env JSON fields into KEY=value lines.
# WEBLOGIC_PASSWORD is exported so createDomain.py reads it via os.environ
# instead of receiving a hardcoded or vault: placeholder value.
if [ -f "$STAGING_DIR/.secrets_env" ]; then
    cp "$STAGING_DIR/.secrets_env" "$WEBLOGIC_HOME/.secrets_env"
    log_message "Step 8: .secrets_env copied to $WEBLOGIC_HOME/.secrets_env"
else
    log_message "Warning: $STAGING_DIR/.secrets_env not found — WEBLOGIC_PASSWORD will not be injected."
fi

CREDS=""
if [ -f "$STAGING_DIR/loadSecrets.sh" ]; then
    log_message "Step 8: Loading credentials from .secrets_env..."
    CREDS=$("$STAGING_DIR/loadSecrets.sh" \
        --secrets-env "$WEBLOGIC_HOME/.secrets_env") || true
    [ -n "$CREDS" ] && log_message "Credentials loaded."
else
    log_message "Warning: loadSecrets.sh not in staging — WEBLOGIC_PASSWORD will not be injected."
fi

if [ -n "$CREDS" ]; then
    log_message "Step 8: Exporting WEBLOGIC_PASSWORD for createDomain.py..."
    _lookup_cred() {
        local field="$1"
        local val=""
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            local k="${line%%=*}" v="${line#*=}"
            if [[ "$k" == "$field" ]]; then
                eval "val=$v" 2>/dev/null || val="$v"
                break
            fi
        done <<< "$CREDS"
        printf '%s' "$val"
    }
    export WEBLOGIC_PASSWORD=$(_lookup_cred "weblogic-password")
fi

# Step 9: Run installation script
log_message "Running installation script..."
{
	cd $ENV_DIR/payor-utils
	chmod +x install.sh
    cd $ENV_DIR/claimserver
    ./install.sh --full -n -w ../wl.properties
} &>> "$LOG_FILE"

# Step 10: Upgrade the DB
if [ "$SKIP_DB_UPGRADE" = false ]; then
    log_message "Upgrading the OLTP database..."
    {
        cd $ENV_DIR/ddl/oltp
        chmod +x upgrade-oltp.sh
        ./upgrade-oltp.sh upgrade.xml clearCheckSums
        ./upgrade-oltp.sh upgrade.xml releaseLocks
        ./upgrade-oltp.sh
    } 2>&1 | tee -a "$LOG_FILE"

    log_message "Upgrading the DW database..."
    {
        cd $ENV_DIR/ddl/dw
        chmod +x upgrade-dw.sh
        ./upgrade-dw.sh upgrade.xml clearCheckSums
        ./upgrade-dw.sh upgrade.xml releaseLocks
        ./upgrade-dw.sh
    } 2>&1 | tee -a "$LOG_FILE"
else
    log_message "Skipping database upgrade as requested..."
fi

# Step 11: Set environment variables for debugging
log_message "Setting environment variables for debugging..."
{
    export WLS_DEBUG=true
    export ENABLE_REMOTE_DEBUG=true
} &>> "$LOG_FILE"

# Step 12: Start WebLogic server
log_message "Starting WebLogic server..."
start_server.sh &>> "$LOG_FILE"

#log_message "Deployment completed successfully."
