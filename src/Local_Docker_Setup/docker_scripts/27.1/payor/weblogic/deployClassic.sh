#!/bin/bash

# Start time tracking
START_TIME=$(date +%s)

# Default configuration
CONTAINER_NAME="payer-1"
WEBLOGIC_HOME="/home/weblogic"

DEPLOY_SCRIPT="deploy_classic_inside_container.sh"
CLASSIC_REPO="${C3SRCDIR}"

STAGING_DIR="$WEBLOGIC_HOME/staging_classic"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SKIP_BUILD=false
SKIP_TESTS=false
SKIP_DEPLOY=false
DEBUG=false

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-build     Skip the Maven build step"
    echo "  --skip-tests     Skip tests during Maven build"
    echo "  --skip-deploy    Skip deployment to container"
    echo "  --container NAME Use specific container name (default: payer-1)"
    echo "  --debug          Enable debug logging"
    #echo "  --full-build     Force full build instead of incremental"
    echo "  --help           Display this help message"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-deploy)
            SKIP_DEPLOY=true
            shift
            ;;
        --container)
            CONTAINER_NAME="$2"
            shift 2
            ;;
        --debug)
            DEBUG=true
            shift
            ;;
        --help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Function to log messages
log_message() {
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "$timestamp [INFO] $1"
}

# Debug logging function
debug_log() {
    if [ "$DEBUG" = true ]; then
        timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        echo "$timestamp [DEBUG] $1"
    fi
}

# Check if C3SRCDIR is set
if [ -z "$C3SRCDIR" ]; then
    echo "C3SRCDIR is not set. Please provide the absolute path to the classic source directory:"
    read USER_INPUT_PATH
    if [ ! -d "$USER_INPUT_PATH" ]; then
        echo "Error: Provided path does not exist. Exiting."
        exit 1
    fi
    CLASSIC_REPO="$USER_INPUT_PATH"
else
    CLASSIC_REPO="$C3SRCDIR"
fi

# Build step
if [ "$SKIP_BUILD" = false ]; then
    log_message "Building the Classic code..."
    debug_log "Changing to Classic repository directory: $CLASSIC_REPO"
    cd "$CLASSIC_REPO" || {
        log_message "Error: Failed to change to directory $CLASSIC_REPO"
        exit 1
    }

    BUILD_CMD="mvn clean install"
    [ "$SKIP_TESTS" = true ] && BUILD_CMD="$BUILD_CMD -DskipTests"
    debug_log "Executing build command: $BUILD_CMD"
    $BUILD_CMD

    cd - || {
        log_message "Error: Failed to return to original directory"
        exit 1
    }
fi

# Deployment steps
if [ "$SKIP_DEPLOY" = false ]; then
    DISTRIBUTION_FILE=$(find "$CLASSIC_REPO/distribution/target" -name "connector-classic-distribution-*.tar.gz" -type f -print -quit)

    if [ -z "$DISTRIBUTION_FILE" ]; then
        log_message "Error: No tar.gz file found in $CLASSIC_REPO/distribution/target"
        exit 1
    fi

    debug_log "Found distribution file: $DISTRIBUTION_FILE"

    log_message "Preparing classic staging directory..."
    docker exec $CONTAINER_NAME bash -c "su weblogic && rm -rf ${STAGING_DIR} && mkdir ${STAGING_DIR}"

    log_message "Copying classic deployment files..."
    docker cp "${SCRIPTS_DIR}/${DEPLOY_SCRIPT}" "${CONTAINER_NAME}:${STAGING_DIR}"
    docker cp "${DISTRIBUTION_FILE}" "${CONTAINER_NAME}:${STAGING_DIR}"

    if [ $(uname -o) == "Msys" ]; then
        ## Git bash was converting variable like /home/weblogic/staging to C:/Program Files/Git/home/weblogic/staging.
        ## So doubled the first slash to avoid this Posix-to-Window path conversion 
        ## Note: Another option is to set the environment variable MSYS_NO_PATHCONV to 1 temporarily
        docker exec ${CONTAINER_NAME} chown -R weblogic:weblogic "/${STAGING_DIR}"
    else
        docker exec ${CONTAINER_NAME} chown -R weblogic:weblogic "${STAGING_DIR}"
    fi


    log_message "Converting classic deploy script to Unix format..."
    docker exec $CONTAINER_NAME bash -c "su weblogic && dos2unix $STAGING_DIR/$DEPLOY_SCRIPT"

    log_message "Running classic deployment script..."
    docker exec $CONTAINER_NAME bash -c "su weblogic && cd ${STAGING_DIR} && bash $DEPLOY_SCRIPT" 2>&1 | while read -r line; do log_message "${line}"; done

    log_message "Classic deployment completed successfully."
fi

# Display total time
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
HOURS=$((TOTAL_TIME / 3600))
MINUTES=$(( (TOTAL_TIME % 3600) / 60 ))
SECONDS=$((TOTAL_TIME % 60))

log_message "Total time taken: ${HOURS}h ${MINUTES}m ${SECONDS}s"
