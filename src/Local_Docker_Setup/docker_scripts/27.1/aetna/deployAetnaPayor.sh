#!/bin/bash

# Script to deploy Aetna Payor custom code to Docker container
# Based on CVSH Environment setup documentation

# Start timing
START_TIME=$(date +%s)

# Default configuration
AETNA_PAYOR_REPO="${CWLSRCDIR:-${USERPROFILE}/hebb/hrp.cust.aetna.payer}"
CONTAINER_NAME="payer-tc-261"
WEBLOGIC_HOME="/home/weblogic"
SHARED_DIR="$WEBLOGIC_HOME/shared/payor-env"
DISTRIBUTION_FILE_PATTERN="aetna-wl-distribution-*.tar.gz"
ACCUMULATOR_FILE="Aetna_Accumulator.properties"

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
    echo "  --container NAME Use specific container name (default: $CONTAINER_NAME)"
    echo "  --debug          Enable debug logging"
    echo "  --help           Display this help message"
    echo ""
    echo "Environment Variables:"
    echo "  CWLSRCDIR       Path to aetna-payor repository (default: \${USERPROFILE}/hebb/hrp.cust.aetna.payer)"
    echo "  USERPROFILE     Windows user profile path"
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

# Convert Windows path to Unix path for Git Bash compatibility
convert_path() {
    local path="$1"
    if [[ "$path" =~ ^[A-Za-z]: ]]; then
        # Convert C:\path to /c/path
        echo "$path" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|'
    else
        echo "$path"
    fi
}

# Validate environment and directories
log_message "Validating environment..."

# Convert Windows paths if needed
AETNA_PAYOR_REPO=$(convert_path "$AETNA_PAYOR_REPO")

if [[ -z "$AETNA_PAYOR_REPO" ]]; then
    log_message "Error: CWLSRCDIR environment variable is not set"
    log_message "Please set it to your aetna-payor repository path"
    log_message "Example: export CWLSRCDIR=\"/c/Users/username/hebb/hrp.cust.aetna.payer-25.2.5\""
    exit 1
fi

if [[ ! -d "$AETNA_PAYOR_REPO" ]]; then
    log_message "Error: Aetna Payor repository directory not found: $AETNA_PAYOR_REPO"
    exit 1
fi

if [[ ! -f "$AETNA_PAYOR_REPO/pom.xml" ]]; then
    log_message "Error: pom.xml not found in $AETNA_PAYOR_REPO"
    exit 1
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
    log_message "Error: Container ${CONTAINER_NAME} is not running"
    exit 2
fi

log_message "Container ${CONTAINER_NAME} is running"
debug_log "Aetna Payor repository: $AETNA_PAYOR_REPO"

# Build stage
if [[ "$SKIP_BUILD" == false ]]; then
    log_message "Building Aetna Payor code..."
    debug_log "Changing to Aetna Payor repository directory: $AETNA_PAYOR_REPO"
    
    cd "$AETNA_PAYOR_REPO" || {
        log_message "Error: Failed to change to directory $AETNA_PAYOR_REPO"
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
    DIST_TARGET_DIR="$AETNA_PAYOR_REPO/aetna-wl-distribution/target"
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
    
    # Define source paths
    ACCUMULATOR_SOURCE="$AETNA_PAYOR_REPO/aetna-wl-distribution/$ACCUMULATOR_FILE"
    
    # Check if distribution file exists
    if [[ ! -f "$DIST_SOURCE" ]]; then
        log_message "Error: Distribution file not found: $DIST_SOURCE"
        exit 1
    fi
    
    # Check if accumulator properties file exists
    if [[ ! -f "$ACCUMULATOR_SOURCE" ]]; then
        log_message "Error: Accumulator properties file not found: $ACCUMULATOR_SOURCE"
        exit 1
    fi
    
    debug_log "Found distribution file: $DIST_SOURCE"
    debug_log "Found accumulator file: $ACCUMULATOR_SOURCE"
    
    # Create shared directory in container first
    log_message "Creating shared directory in container: ${SHARED_DIR}"
    
    # Use MSYS_NO_PATHCONV to prevent Git Bash path conversion issues
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" mkdir -p "${SHARED_DIR}"
    
    # Verify directory was created successfully
    if ! MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" test -d "${SHARED_DIR}"; then
        log_message "Error: Failed to create directory ${SHARED_DIR}"
        log_message "Attempting to debug container state..."
        docker exec "${CONTAINER_NAME}" ls -la /home/weblogic/ || true
        exit 1
    fi
    
    # Set proper ownership for the directory
    log_message "Setting directory ownership..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown -R weblogic:weblogic "${SHARED_DIR}"
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
    
    # Copy files to container
    log_message "Copying distribution file to container..."
    docker cp "$DIST_SOURCE" "${CONTAINER_NAME}:${SHARED_DIR}/${DISTRIBUTION_FILE}"
    
    log_message "Copying accumulator properties file to container..."
    docker cp "$ACCUMULATOR_SOURCE" "${CONTAINER_NAME}:${SHARED_DIR}/${ACCUMULATOR_FILE}"
    
    # Set proper ownership for copied files
    log_message "Setting copied files ownership..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown weblogic:weblogic "${SHARED_DIR}/${DISTRIBUTION_FILE}"
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown weblogic:weblogic "${SHARED_DIR}/${ACCUMULATOR_FILE}"
    
    # Extract distribution in container
    log_message "Extracting distribution in container..."
    
    # Determine the top-level extracted directory name from the tarball contents
    EXTRACTED_DIR_NAME=$(tar -tzf "$DIST_SOURCE" 2>/dev/null | head -1 | cut -d/ -f1)
    if [[ -z "$EXTRACTED_DIR_NAME" ]]; then
        log_message "Error: Unable to determine extracted directory name from $DISTRIBUTION_FILE"
        exit 1
    fi
    log_message "Expected extracted directory: $EXTRACTED_DIR_NAME"
    
    MSYS_NO_PATHCONV=1 docker exec --user weblogic "${CONTAINER_NAME}" bash -c "
        cd ${SHARED_DIR}
        tar -xf ${DISTRIBUTION_FILE}
    "
    
    if [[ $? -ne 0 ]]; then
        log_message "Error: Failed to extract distribution in container"
        log_message "Attempting to debug directory contents..."
        MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" ls -la "${SHARED_DIR}/" || true
        exit 1
    fi
    
    # Set permissions as root user to avoid permission issues
    log_message "Setting file permissions..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" bash -c "
        cd ${SHARED_DIR}/$EXTRACTED_DIR_NAME
        chown -R weblogic:weblogic .
        find . -name '*.sh' -exec chmod +x {} \\;
    "
    
    log_message "Distribution extracted successfully"
    
    # Create a modified install.sh with corrected Aetna_Accumulator.properties path
    log_message "Modifying install.sh to fix Aetna_Accumulator.properties path..."
    MSYS_NO_PATHCONV=1 docker exec --user weblogic "${CONTAINER_NAME}" bash -c "
        cd ${SHARED_DIR}/$EXTRACTED_DIR_NAME
        # Create backup of original install.sh
        cp install.sh install.sh.backup
        # Fix the path by removing one '../' from the three locations
        sed -i 's|../Aetna_Accumulator.properties|Aetna_Accumulator.properties|g' install.sh
    "
    
    if [[ $? -ne 0 ]]; then
        log_message "Warning: Failed to modify install.sh, you may need to fix paths manually"
    else
        log_message "Successfully modified install.sh"
    fi
    
    # Run installation
    log_message "Running Aetna Payor installation..."
    MSYS_NO_PATHCONV=1 docker exec --user weblogic "${CONTAINER_NAME}" bash -c "
        cd ${SHARED_DIR}/$EXTRACTED_DIR_NAME
        ./install.sh
    " 2>&1 | while read -r line; do 
        log_message "[INSTALL] ${line}"
    done
    
    # Check installation result
    if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
        log_message "Aetna Payor installation completed successfully"
    else
        log_message "Warning: Installation may have failed or completed with errors"
        log_message "Note: Installation may fail for code entry (as documented) - proceed with aetna-test setup"
    fi
    
    # List contents for verification
    log_message "Verifying installation files..."
    MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" ls -la "${SHARED_DIR}/"
fi

# Display total time
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
HOURS=$((TOTAL_TIME / 3600))
MINUTES=$(( (TOTAL_TIME % 3600) / 60 ))
SECONDS=$((TOTAL_TIME % 60))

log_message "Aetna Payor deployment completed!"
log_message "Total time taken: ${HOURS}h ${MINUTES}m ${SECONDS}s"

if [[ "$SKIP_DEPLOY" == false ]]; then
    log_message ""
    log_message "Next steps:"
    log_message "1. Run aetna-test setup (aetna-utils build and tests)"
    log_message "2. Resume Aetna Payor installation if code entry step failed"
    log_message "3. Verify the deployment by checking WebLogic logs"
    log_message ""
    log_message "Container shared directory: ${SHARED_DIR}"
    log_message "Installation directory: ${SHARED_DIR}/${EXTRACTED_DIR_NAME}"
    log_message "Distribution file used: ${DISTRIBUTION_FILE}"
fi