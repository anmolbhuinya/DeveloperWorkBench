#!/bin/bash

# Configuration
WEBLOGIC_HOME="/home/weblogic"

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

log_message "Setting environment variables for debugging..."
{
    export WLS_DEBUG=true
    export ENABLE_REMOTE_DEBUG=true
} &>> "$LOG_FILE"

log_message "Starting WebLogic server..."
start_server.sh | tee -a "$LOG_FILE"
