#!/bin/bash

# Configuration
WEBLOGIC_HOME="/home/weblogic"
ENV_DIR="$WEBLOGIC_HOME/environments/healthedge"
DISTRIBUTION_FILE="connector-classic-distribution-*.tar.gz"
STAGING_DIR="$WEBLOGIC_HOME/staging_classic"
LOG_DIR="$STAGING_DIR/logs"
LOG_FILE="$LOG_DIR/deployClassic.log"

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

log_message "Stopping Artemis server..."
if [ -x "$WEBLOGIC_HOME/artemis/HEBroker/bin/artemis-service" ]; then
    # New path exists
    cd $WEBLOGIC_HOME/artemis/HEBroker/bin
    ./artemis-service stop &>> "$LOG_FILE"
    rm -rf $WEBLOGIC_HOME/artemis/HEBroker/data/artemis.pid
else
    # Fallback to old path for stopping Artemis
    OLD_ARTEMIS_BIN="$WEBLOGIC_HOME/artemis/apache-artemis-${artemis_version}/bin/HEBroker"
    if [ -x "$OLD_ARTEMIS_BIN/bin/artemis-service" ]; then
        cd $OLD_ARTEMIS_BIN/bin
        ./artemis-service stop &>> "$LOG_FILE"
        rm -rf $OLD_ARTEMIS_BIN/data/artemis.pid
    else
        log_message "Artemis service not found in either new or old path."
    fi
fi

log_message "Stopping Tomcat server..."
cd $ENV_DIR/claimserver/install/tools/bin
chmod +x stop_tomcat_instances.sh
./stop_tomcat_instances.sh &>> "$LOG_FILE"

log_message "Extracting the classic distribution..."
{
    cd "$STAGING_DIR" || exit
    DIST_FILE=$(ls $DISTRIBUTION_FILE | head -n 1)
    tar -xf "$DIST_FILE"
    DIST_DIR=$(basename "$DIST_FILE" .tar.gz)
    cd "$DIST_DIR" || exit
} &>> "$LOG_FILE"

log_message "Converting Classic files to Unix format..."
{
    find . -type f -exec dos2unix {} \;
} &>> "$LOG_FILE"

log_message "Running Classic installation script..."
{
    chmod +x install.sh
    ./install.sh
} | tee -a "$LOG_FILE"

log_message "Starting Artemis server..."
cd $WEBLOGIC_HOME/artemis/HEBroker/bin
./artemis-service start &>> "$LOG_FILE"

log_message "Starting Tomcat server..."
cd $ENV_DIR/claimserver/install/tools/bin
chmod +x start_tomcat_instances.sh
./start_tomcat_instances.sh -d &>> "$LOG_FILE"