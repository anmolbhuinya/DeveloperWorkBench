#!/bin/bash

# Start time tracking
START_TIME=$(date +%s)

# Default configuration
PAYOR_REPO="${SRCDIR}"
CONTAINER_NAME="payer-1"
WEBLOGIC_HOME="/home/weblogic"
DEPLOY_SCRIPT="deploy_inside_container.sh"
STAGING_DIR="$WEBLOGIC_HOME/staging"
DIST_DIR="$PAYOR_REPO/distribution/target/core-distribution/claimserver/install"
BUILD_MODULE=""
BUILD_ARGS=""
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# secrets_management is three levels up from docker/payor/weblogic/
SECRETS_DIR="$(cd "${SCRIPTS_DIR}/../../../secrets_management" 2>/dev/null && pwd || true)"
if [ -z "${SECRETS_DIR}" ] || [ ! -d "${SECRETS_DIR}" ]; then
    echo "Error: secrets_management/ directory not found at ${SCRIPTS_DIR}/../../../secrets_management"
    echo "Ensure hrp.dev.tools is checked out and secrets_management/ exists alongside docker/payor/weblogic/"
    exit 1
fi

SKIP_BUILD=false
SKIP_TESTS=false
SKIP_DEPLOY=false
SKIP_DB_UPGRADE=false
DEBUG=false
BUILD_MODULE=""
BUILD_ARGS=""

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-build     Skip the Maven build step"
    echo "  --skip-tests     Skip tests during Maven build"
    echo "  --skip-deploy    Skip deployment to container"
    echo "  --skip-db-upgrade Skip database upgrade steps"
    echo "  --container NAME Use specific container name (default: payer-1)"
    echo "  --debug          Enable debug logging"
    echo "  --build-just     Build Individual Module"
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
        --skip-db-upgrade)
            SKIP_DB_UPGRADE=true
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
        --full-build)
            shift
            ;;
        --build-just)
            BUILD_MODULE="$2"
            shift 2
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
## check if payor repo variable is not empty and the directory exists and has a pom.xml file
if [ -z "$PAYOR_REPO" ] || [ ! -d "$PAYOR_REPO" ] || [ ! -f "$PAYOR_REPO/pom.xml" ]; then
    log_message "Error: Payor repository directory is not set or does not contain a valid pom.xml file. Check if the SRCDIR environment variable is set and points to a valid directory."
    exit 1
fi
# Build step
if [ "$SKIP_BUILD" = false ]; then
    if [ -n "$BUILD_MODULE" ]; then
        log_message "Building the Payor code for module: $BUILD_MODULE"
        debug_log "Changing to Payor repository directory: $PAYOR_REPO"
        cd "$PAYOR_REPO" || {
            log_message "Error: Failed to change to directory $PAYOR_REPO"
            exit 1
        }

        BUILD_ARGS="$BUILD_MODULE,install,distribution"
        BUILD_CMD="mvn -pl $BUILD_ARGS"
        [ "$SKIP_TESTS" = true ] && BUILD_CMD="$BUILD_CMD -DskipTests"
        BUILD_CMD="$BUILD_CMD clean install"

        echo "Executing: $BUILD_CMD"
        $BUILD_CMD

        cd - || {
            log_message "Error: Failed to return to original directory"
            exit 1
        }
    else
        log_message "Building the Payor code..."
        debug_log "Changing to Payor repository directory: $PAYOR_REPO"
        cd "$PAYOR_REPO" || {
            log_message "Error: Failed to change to directory $PAYOR_REPO"
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
fi
log_message "Distribution directory path: $DIST_DIR"
if [ -d "$DIST_DIR" ]; then
    log_message "Distribution directory found: $DIST_DIR"
    log_message "Domain home directory: $DOMAIN_HOME"
    if [ -d "$DIST_DIR/lib" ]; then
      log_message "Copying lib folder..."
      cp -r "$DIST_DIR/lib" "$DOMAIN_HOME/" || {
          log_message "Error: Failed to copy lib folder from $DIST_DIR/lib to $DOMAIN_HOME/"
          exit 1
      }
    fi
    if [ -d "$DIST_DIR/tools" ]; then
      log_message "Copying tools folder..."
      cp -r "$DIST_DIR/tools" "$DOMAIN_HOME/" || {
          log_message "Error: Failed to copy tools folder from $DIST_DIR/tools to $DOMAIN_HOME/"
          exit 1
      }
    fi
fi

# Deployment steps
if [ "$SKIP_DEPLOY" = false ]; then
    DISTRIBUTION_FILE=""
    # bash glob instead of find: on Windows a PATH-shadowing find.exe returns nothing
    for _f in "$PAYOR_REPO"/distribution/target/core.distribution-*-pkg.tar.gz; do
        [ -f "$_f" ] && DISTRIBUTION_FILE="$_f" && break
    done

    if [ -z "$DISTRIBUTION_FILE" ]; then
        log_message "Error: No tar.gz file found in $PAYOR_REPO/distribution/target"
        exit 1
    fi

    debug_log "Found distribution file: $DISTRIBUTION_FILE"

    log_message "Preparing staging directory..."
    docker exec --user weblogic "${CONTAINER_NAME}" bash -c "rm -rf ${WEBLOGIC_HOME}/staging && mkdir -p ${WEBLOGIC_HOME}/staging"

    log_message "Copying deployment files..."
    docker cp "${SCRIPTS_DIR}/wl.properties" "${CONTAINER_NAME}:${STAGING_DIR}"
    docker cp "${SCRIPTS_DIR}/${DEPLOY_SCRIPT}" "${CONTAINER_NAME}:${STAGING_DIR}"
    docker cp "${DISTRIBUTION_FILE}" "${CONTAINER_NAME}:${STAGING_DIR}"

    # Copy secrets_management scripts required for WEBLOGIC_PASSWORD injection
    for _required_script in loadSecrets.sh; do
        if [ ! -f "${SECRETS_DIR}/${_required_script}" ]; then
            log_message "Error: ${_required_script} not found in ${SECRETS_DIR}/"
            log_message "       Ensure secrets_management/ is up to date in hrp.dev.tools."
            exit 1
        fi
    done
    docker cp "${SECRETS_DIR}/loadSecrets.sh" "${CONTAINER_NAME}:${STAGING_DIR}"

    # ~/.secrets_env — fail fast if missing
    if [ -f "${HOME}/.secrets_env" ]; then
        log_message "Copying .secrets_env to staging..."
        docker cp "${HOME}/.secrets_env" "${CONTAINER_NAME}:${STAGING_DIR}/.secrets_env"
    else
        log_message "Error: ~/.secrets_env not found. Run fetchAWSSecrets.sh from ${SECRETS_DIR}/ first."
        exit 1
    fi

    # Ensure proper ownership after copying files
    if [ "$(uname -o)" == "Msys" ]; then
        ## Git bash was converting variable like /home/weblogic/staging to C:/Program Files/Git/home/weblogic/staging.
        ## So doubled the first slash to avoid this Posix-to-Window path conversion 
        ## Note: Another option is to set the environment variable MSYS_NO_PATHCONV to 1 temporarily
        docker exec "${CONTAINER_NAME}" chown -R weblogic:weblogic "/${STAGING_DIR}"
    else
        docker exec "${CONTAINER_NAME}" chown -R weblogic:weblogic "${STAGING_DIR}"
    fi

    log_message "Converting deploy script to Unix format..."
    docker exec --user weblogic "${CONTAINER_NAME}" bash -c "dos2unix $STAGING_DIR/$DEPLOY_SCRIPT"

    log_message "Running deployment script..."
    DEPLOY_ARGS=""
    [ "$SKIP_DB_UPGRADE" = true ] && DEPLOY_ARGS="--skip-db-upgrade"
    docker exec --user weblogic "${CONTAINER_NAME}" bash -c "cd ${STAGING_DIR} && bash ${DEPLOY_SCRIPT} ${DEPLOY_ARGS}" 2>&1 | while read -r line; do log_message "${line}"; done
    # shellcheck disable=SC2181
    if [ $? -ne 0 ]; then
        log_message "Error: Deployment script failed."
        exit 1
    else
        log_message "Deployment script executed successfully."
    fi
fi

# Display total time
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
HOURS=$((TOTAL_TIME / 3600))
MINUTES=$(( (TOTAL_TIME % 3600) / 60 ))
SECONDS=$((TOTAL_TIME % 60))

log_message "Total time taken: ${HOURS}h ${MINUTES}m ${SECONDS}s"
