#!/bin/bash

# Script to deploy Aetna Connector custom code to Docker container
# Based on CVSH Environment setup documentation

# Start timing
START_TIME=$(date +%s)

# Default configuration
AETNA_CONNECTOR_REPO="${AETNA_CONNECTOR_DIR:-${USERPROFILE}/hebb/hrp.cust.aetna.connector}"
CONTAINER_NAME="connector-261"
CPRIME_HOME="/home/cprime"
SHARED_DIR="$CPRIME_HOME/shared"
DISTRIBUTION_FILE_PATTERN="aetna-custom-distribution-*.tar.gz"
KARAF_HOME="$CPRIME_HOME/cprime/healthrules-connector-server-4.4.3"
KARAF_USER="connector"
KARAF_PASS="Connector123"

SKIP_BUILD=false
SKIP_TESTS=false
SKIP_DEPLOY=false
COPY_LOCAL_KAR=false
LOCAL_KAR_PATH=""
DEBUG=false

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-build         Skip the Maven build step"
    echo "  --skip-tests         Skip tests during Maven build"
    echo "  --skip-deploy        Skip deployment to container"
    echo "  --copy-kar PATH      Copy specific KAR file into container"
    echo "                       Use one of these path forms in Git Bash:"
    echo "                         --copy-kar \"C:\\Users\\spanda\\hebb\\myfile.kar\""
    echo "                         --copy-kar C:/Users/spanda/hebb/myfile.kar"
    echo "                         --copy-kar /c/Users/spanda/hebb/myfile.kar"
    echo "  --container NAME     Use specific container name (default: $CONTAINER_NAME)"
    echo "  --debug              Enable debug logging"
    echo "  --help               Display this help message"
    echo ""
    echo "Environment Variables:"
    echo "  AETNA_CONNECTOR_DIR  Path to aetna-connector repository (default: \${USERPROFILE}/hebb/hrp.cust.aetna.connector)"
    echo "  USERPROFILE          Windows user profile path"
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
        --copy-kar)
            if [[ -n "${2:-}" && "$2" != -* ]]; then
                COPY_LOCAL_KAR=true
                LOCAL_KAR_PATH="$2"
                # When copying KAR, skip build and deploy by default
                SKIP_BUILD=true
                SKIP_DEPLOY=true
                shift 2
            else
                log_message "Error: --copy-kar requires a file path"
                exit 1
            fi
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

# Convert Windows path to Unix path for Git Bash compatibility
convert_path() {
    local path="$1"
    # Try cygpath first (available in Git Bash / MSYS2) for reliable conversion
    if command -v cygpath &>/dev/null; then
        cygpath -u "$path" 2>/dev/null && return
    fi
    # Fallback: manually convert C:\path or C:/path to /c/path
    if [[ "$path" =~ ^[A-Za-z]:[/\\] ]]; then
        echo "$path" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|'
    else
        echo "$path"
    fi
}

# Validate environment and directories
log_message "Validating environment..."

# Convert Windows paths if needed
AETNA_CONNECTOR_REPO=$(convert_path "$AETNA_CONNECTOR_REPO")

# Convert local KAR path if provided
if [[ -n "$LOCAL_KAR_PATH" ]]; then
    LOCAL_KAR_PATH=$(convert_path "$LOCAL_KAR_PATH")
fi

if [[ "$COPY_LOCAL_KAR" == false ]]; then
    if [[ -z "$AETNA_CONNECTOR_REPO" ]]; then
        log_message "Error: AETNA_CONNECTOR_DIR environment variable is not set"
        log_message "Please set it to your aetna-connector repository path"
        log_message "Example: export AETNA_CONNECTOR_DIR=\"/c/Users/username/hebb/hrp.cust.aetna.connector-25.2.5\""
        exit 1
    fi

    if [[ ! -d "$AETNA_CONNECTOR_REPO" ]]; then
        log_message "Error: Aetna Connector repository directory not found: $AETNA_CONNECTOR_REPO"
        exit 1
    fi

    if [[ ! -f "$AETNA_CONNECTOR_REPO/pom.xml" ]]; then
        log_message "Error: pom.xml not found in $AETNA_CONNECTOR_REPO"
        exit 1
    fi
fi

# Validate local KAR file if provided
if [[ "$COPY_LOCAL_KAR" == true ]]; then
    if [[ -z "$LOCAL_KAR_PATH" ]]; then
        log_message "Error: --copy-kar requires a file path"
        exit 1
    fi
    
    if [[ ! -f "$LOCAL_KAR_PATH" ]]; then
        log_message "Error: KAR file not found: $LOCAL_KAR_PATH"
        log_message "In Git Bash, backslashes in paths are stripped unless the path is quoted."
        log_message "Pass the path using one of these forms:"
        log_message "  Double-quoted Windows path:  --copy-kar \"C:\\Users\\spanda\\hebb\\myfile.kar\""
        log_message "  Forward slashes:             --copy-kar C:/Users/spanda/hebb/myfile.kar"
        log_message "  POSIX path:                  --copy-kar /c/Users/spanda/hebb/myfile.kar"
        exit 1
    fi
    
    if [[ ! "$LOCAL_KAR_PATH" =~ \.kar$ ]]; then
        log_message "Error: File must have .kar extension: $LOCAL_KAR_PATH"
        exit 1
    fi
    
    log_message "Local KAR file validated: $LOCAL_KAR_PATH"
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
    log_message "Error: Container ${CONTAINER_NAME} is not running"
    exit 2
fi

log_message "Container ${CONTAINER_NAME} is running"
debug_log "Aetna Connector repository: $AETNA_CONNECTOR_REPO"


# Build stage
if [[ "$SKIP_BUILD" == false ]]; then
    log_message "Building Aetna Connector code..."
    debug_log "Changing to Aetna Connector repository directory: $AETNA_CONNECTOR_REPO"
    
    cd "$AETNA_CONNECTOR_REPO" || {
        log_message "Error: Failed to change to directory $AETNA_CONNECTOR_REPO"
        exit 1
    }

    BUILD_CMD="mvn clean install"
    [[ "$SKIP_TESTS" == true ]] && BUILD_CMD="$BUILD_CMD -DskipTests"
    
    debug_log "Executing build command: $BUILD_CMD"
    if ! $BUILD_CMD; then
        log_message "Error: Maven build failed"
        exit 1
    fi
    
    log_message "Maven build completed successfully"
fi

# Deployment stage
if [[ "$SKIP_DEPLOY" == false ]]; then
    log_message "Starting deployment to container..."
    
    # Find the distribution file dynamically
    DIST_TARGET_DIR="$AETNA_CONNECTOR_REPO/aetna-custom-distribution/target"
    mapfile -t DISTRIBUTION_FILES < <(find "$DIST_TARGET_DIR" -name "$DISTRIBUTION_FILE_PATTERN" 2>/dev/null)

    if [[ ${#DISTRIBUTION_FILES[@]} -eq 0 ]]; then
        log_message "Error: No distribution file found matching pattern: $DISTRIBUTION_FILE_PATTERN"
        log_message "Searched in: $DIST_TARGET_DIR"
        exit 1
    elif [[ ${#DISTRIBUTION_FILES[@]} -gt 1 ]]; then
        log_message "Warning: Multiple distribution files found, using the first one:"
        for file in "${DISTRIBUTION_FILES[@]}"; do
            log_message "  - $(basename "$file")"
        done
    fi
    
    DIST_SOURCE="${DISTRIBUTION_FILES[0]}"
    DISTRIBUTION_FILE=$(basename "$DIST_SOURCE")
    log_message "Using distribution file: $DISTRIBUTION_FILE"
    
    # Check if distribution file exists
    if [[ ! -f "$DIST_SOURCE" ]]; then
        log_message "Error: Distribution file not found: $DIST_SOURCE"
        exit 1
    fi
    
    debug_log "Found distribution file: $DIST_SOURCE"
    
    # Create shared directory in container
    log_message "Creating shared directory in container..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" mkdir -p "${SHARED_DIR}"
    
    # Verify directory was created successfully
    if ! MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" test -d "${SHARED_DIR}"; then
        log_message "Error: Failed to create directory ${SHARED_DIR}"
        exit 1
    fi
    
    # Set proper ownership for the directory
    log_message "Setting directory ownership..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown -R cprime:cprime "${SHARED_DIR}"
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chmod 755 "${SHARED_DIR}"
    
    debug_log "Directory ${SHARED_DIR} created/verified successfully"
    
    # Clean up existing files in the subdirectory
    log_message "Cleaning existing files from ${SHARED_DIR}..."
    EXISTING_FILES=$(MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" ls -A "${SHARED_DIR}/" 2>/dev/null || true)
    if [[ -n "$EXISTING_FILES" ]]; then
        log_message "Found existing files/directories in ${SHARED_DIR}:"
        echo "$EXISTING_FILES" | while read -r file; do
            [[ -n "$file" ]] && log_message "  - $file"
        done
        log_message "Removing all existing files..."
        MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" rm -rf "${SHARED_DIR}"/*
        log_message "Directory cleaned successfully"
    else
        log_message "Directory is empty, no cleanup needed"
    fi
    
    # Copy distribution file to container
    log_message "Copying distribution file to container..."
    docker cp "$DIST_SOURCE" "${CONTAINER_NAME}:${SHARED_DIR}/${DISTRIBUTION_FILE}"
    
    # Set proper ownership for copied file
    log_message "Setting copied file ownership..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown cprime:cprime "${SHARED_DIR}/${DISTRIBUTION_FILE}"
    
    # Extract distribution in container
    log_message "Extracting distribution in container..."
    
    # Determine the top-level extracted directory name from the tarball contents
    EXTRACTED_DIR_NAME=$(tar -tzf "$DIST_SOURCE" 2>/dev/null | head -1 | cut -d/ -f1)
    if [[ -z "$EXTRACTED_DIR_NAME" ]]; then
        log_message "Error: Unable to determine extracted directory name from $DISTRIBUTION_FILE"
        exit 1
    fi
    log_message "Expected extracted directory: $EXTRACTED_DIR_NAME"
    MSYS_NO_PATHCONV=1 docker exec -u cprime "${CONTAINER_NAME}" bash -c "
        cd ${SHARED_DIR} && tar -xf ${DISTRIBUTION_FILE}
    "
    
    if [[ $? -ne 0 ]]; then
        log_message "Error: Failed to extract distribution in container"
        exit 1
    fi
    
    log_message "Distribution extracted successfully"
    
    # List available KAR files
    log_message "Listing available KAR files..."
    KAR_FILES=$(MSYS_NO_PATHCONV=1 docker exec -u cprime "${CONTAINER_NAME}" bash -c "ls ${SHARED_DIR}/${EXTRACTED_DIR_NAME}/features/ | grep '\.kar$'" || true)
    
    if [[ -n "$KAR_FILES" ]]; then
        log_message "Found KAR files:"
        echo "$KAR_FILES" | while read -r kar_file; do
            log_message "  - $kar_file"
        done
    else
        log_message "Warning: No KAR files found in features directory"
    fi
    
    # Karaf installation stage
    log_message "Installing features in Karaf server..."

    # Check if Karaf is running
    log_message "Checking Karaf server status..."
    KARAF_STATUS=$(MSYS_NO_PATHCONV=1 docker exec -u cprime "${CONTAINER_NAME}" bash -c "
        cd ${KARAF_HOME}/bin && ./status
    " 2>/dev/null || echo 'not_running')

    if [[ "$KARAF_STATUS" == *"not_running"* ]] || [[ "$KARAF_STATUS" == *"Not Running"* ]]; then
        log_message "Warning: Karaf server is not running"
        log_message "You may need to start it manually:"
        log_message "  docker exec -it ${CONTAINER_NAME} bash"
        log_message "  su cprime"
        log_message "  cd ${KARAF_HOME}/bin"
        log_message "  ./start"
    else
        log_message "Karaf server is running"

        # Add distribution to Karaf
        log_message "Adding distribution to Karaf..."
        MSYS_NO_PATHCONV=1 docker exec -u cprime "${CONTAINER_NAME}" bash -c "
            cd ${KARAF_HOME}/bin && echo \"hrc:add-distribution -f ${SHARED_DIR}/${EXTRACTED_DIR_NAME}/features\" | ./client -u ${KARAF_USER} -p ${KARAF_PASS}
        " 2>&1 | while read -r line; do
            log_message "[KARAF] ${line}"
        done

        if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
            log_message "Distribution added to Karaf successfully"

            # Wait a moment for distribution to be processed
            log_message "Waiting for distribution to be processed..."
            sleep 10

            # List available features
            log_message "Listing available features..."
            MSYS_NO_PATHCONV=1 docker exec -u cprime "${CONTAINER_NAME}" bash -c "
                cd ${KARAF_HOME}/bin && echo \"feature:list | grep aetna\" | ./client -u ${KARAF_USER} -p ${KARAF_PASS}
            " 2>&1 | while read -r line; do
                log_message "[FEATURES] ${line}"
            done

            log_message ""
            log_message "To install a specific feature, run:"
            log_message "  docker exec -it ${CONTAINER_NAME} bash"
            log_message "  su cprime"
            log_message "  cd ${KARAF_HOME}/bin"
            log_message "  ./client"
            log_message "  feature:install <repo_name>"

        else
            log_message "Warning: Failed to add distribution to Karaf"
        fi
    fi
    
    # List final contents for verification
    log_message "Verifying deployment files..."
    MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" ls -la "${SHARED_DIR}/"
fi

# Local KAR installation stage
if [[ "$COPY_LOCAL_KAR" == true ]]; then
    log_message "Copying local KAR file: $(basename "$LOCAL_KAR_PATH")"

    # Create temporary directory for KAR file
    KAR_TEMP_DIR="${SHARED_DIR}/kar_temp"
    log_message "Creating temporary directory for KAR file..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" mkdir -p "${KAR_TEMP_DIR}"
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown cprime:cprime "${KAR_TEMP_DIR}"

    # Copy KAR file to container
    KAR_FILENAME=$(basename "$LOCAL_KAR_PATH")
    log_message "Copying KAR file to container: $KAR_FILENAME"
    docker cp "$LOCAL_KAR_PATH" "${CONTAINER_NAME}:${KAR_TEMP_DIR}/${KAR_FILENAME}"

    # Set proper ownership
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown cprime:cprime "${KAR_TEMP_DIR}/${KAR_FILENAME}"

    log_message "KAR file copied to container: ${KAR_TEMP_DIR}/${KAR_FILENAME}"
fi

# Display total time
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
HOURS=$((TOTAL_TIME / 3600))
MINUTES=$(( (TOTAL_TIME % 3600) / 60 ))
SECONDS=$((TOTAL_TIME % 60))

log_message "Aetna Connector deployment completed!"
log_message "Total time taken: ${HOURS}h ${MINUTES}m ${SECONDS}s"

if [[ "$SKIP_DEPLOY" == false || "$COPY_LOCAL_KAR" == true ]]; then
    log_message ""
    log_message "Next steps:"
    if [[ "$SKIP_DEPLOY" == false ]]; then
        log_message "1. Install specific features using Karaf client"
        log_message "2. Configure module-specific settings (e.g., Provider Validation)"
        log_message "3. Verify the deployment by checking connector logs"
    fi
    if [[ "$COPY_LOCAL_KAR" == true ]]; then
        log_message "4. KAR file is staged at: ${SHARED_DIR}/kar_temp/$(basename "$LOCAL_KAR_PATH")"
        log_message "5. To install it in Karaf run: hrc:add-distribution -f ${SHARED_DIR}/kar_temp/$(basename "$LOCAL_KAR_PATH")"
    fi
    log_message ""
    log_message "Container shared directory: ${SHARED_DIR}"
    if [[ "$SKIP_DEPLOY" == false ]]; then
        log_message "Installation directory: ${SHARED_DIR}/${EXTRACTED_DIR_NAME}"
        log_message "Distribution file used: ${DISTRIBUTION_FILE}"
    fi
    if [[ "$COPY_LOCAL_KAR" == true ]]; then
        log_message "Local KAR file copied to container: $(basename "$LOCAL_KAR_PATH")"
    fi
    log_message "Karaf home: ${KARAF_HOME}"
    log_message ""
    log_message "Manual Karaf commands:"
    log_message "  docker exec -it ${CONTAINER_NAME} bash"
    log_message "  su cprime"
    log_message "  cd ${KARAF_HOME}/bin"
    log_message "  ./client -u ${KARAF_USER} -p ${KARAF_PASS}"
    if [[ "$SKIP_DEPLOY" == false ]]; then
        log_message "  hrc:add-distribution -f ${SHARED_DIR}/${EXTRACTED_DIR_NAME}/features"
        log_message "  feature:list | grep aetna"
        log_message "  feature:install <repo_name>"
    fi
    log_message "  hrc:add-distribution -f /path/to/your.kar  # To install a staged KAR file"
fi
