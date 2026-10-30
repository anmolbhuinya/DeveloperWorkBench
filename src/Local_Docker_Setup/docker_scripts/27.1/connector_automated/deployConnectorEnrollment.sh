#!/bin/bash

# Comprehensive deployment script for connector enrollment - builds code and deploys to container connector-261

# Start timing
START_TIME=$(date +%s)

# Parse command line arguments
SKIP_COPY=false
SKIP_BUILD=false
SKIP_TESTS=false
SKIP_GIT_PULL=false
USE_EXISTING_TAR=false
CONTAINER_NAME="connector-jdk21-271"  # Default container name
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-copy|--no-copy|-s)
            SKIP_COPY=true
            shift
            ;;
        --skip-build|--no-build|-b)
            SKIP_BUILD=true
            shift
            ;;
        --skip-tests|--no-tests|-t)
            SKIP_TESTS=true
            shift
            ;;
        --skip-git-pull|--no-git-pull|-g)
            SKIP_GIT_PULL=true
            shift
            ;;
        --use-existing-tar|-e)
            USE_EXISTING_TAR=true
            shift
            ;;
        --container|-c)
            if [[ -n "$2" && "$2" != -* ]]; then
                CONTAINER_NAME="$2"
                shift 2
            else
                echo "ERROR: --container requires a container name"
                exit 1
            fi
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --skip-copy, --no-copy, -s      Skip copying files and use existing files in container"
            echo "  --skip-build, --no-build, -b    Skip Maven build step"
            echo "  --skip-tests, --no-tests, -t    Skip tests during Maven build"
            echo "  --skip-git-pull, --no-git-pull, -g  Skip git pull in source directory"
            echo "  --use-existing-tar, -e          Use existing tar file from /home/cprime/enrollment-installer in container"
            echo "  --container, -c <name>          Specify the container name (default: connector-261)"
            echo "  -h, --help                      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# When using existing tar, automatically skip build, git pull, and copy
if [[ "$USE_EXISTING_TAR" == true ]]; then
    SKIP_BUILD=true
    SKIP_GIT_PULL=true
    SKIP_COPY=true
    echo "========================================="
    echo "Using existing enrollment tar file from container"
    echo "Automatically setting: --skip-build --skip-git-pull --skip-copy"
    echo "========================================="
fi

SOURCE_FILE="_deployConnectorEnrollmentInsideContainer.sh"
TAR_SOURCE_DIR="${C4ESRCDIR}/connector-enrollment-dist/target/"

if [[ "$SKIP_COPY" == true ]]; then
    echo "========================================="
    echo "Skipping copy - using existing files"
    echo "========================================="
else
    echo "========================================="
    echo "Copying enrollment files to container staging"
    echo "========================================="
fi

if [[ "$SKIP_BUILD" == true ]]; then
    echo "Skipping Maven build"
else
    if [[ "$SKIP_TESTS" == true ]]; then
        echo "Maven build will be performed (skipping tests)"
    else
        echo "Maven build will be performed (including tests)"
    fi
fi

if [[ "$SKIP_GIT_PULL" == true ]]; then
    echo "Skipping git pull"
else
    echo "Git pull will be performed in source directory"
fi

# Check if container is running
if ! docker ps | grep -q "${CONTAINER_NAME}"; then
    echo "ERROR: Container ${CONTAINER_NAME} is not running"
    exit 2
fi

echo "Container ${CONTAINER_NAME} is running"

# Git pull stage - update source code if not skipping
if [[ "$SKIP_GIT_PULL" == false ]]; then
    # Check if C4ESRCDIR is set for git pull (will be validated again in build stage if needed)
    if [[ -z "${C4ESRCDIR}" ]]; then
        echo "ERROR: C4ESRCDIR environment variable is not set (required for git pull)"
        exit 1
    fi

    if [[ ! -d "${C4ESRCDIR}" ]]; then
        echo "ERROR: C4ESRCDIR directory ${C4ESRCDIR} not found"
        exit 1
    fi

    # Check if it's a git repository
    if [[ ! -d "${C4ESRCDIR}/.git" ]]; then
        echo "ERROR: ${C4ESRCDIR} is not a git repository (no .git directory found)"
        exit 1
    fi

    echo "========================================="
    echo "Updating source code with git pull..."
    echo "========================================="
    echo "Running 'git pull' in ${C4ESRCDIR}"
    
    # Change to the source directory and run git pull
    cd "${C4ESRCDIR}"
    git pull
    
    if [[ $? -eq 0 ]]; then
        echo "========================================="
        echo "Git pull completed successfully"
        echo "========================================="
    else
        echo "WARNING: Git pull failed or had conflicts"
        echo "Continuing with deployment using current code..."
    fi
    
    # Return to the original directory
    cd "${OLDPWD}"
fi

# Maven build stage - check C4ESRCDIR and run build if not skipping
if [[ "$SKIP_BUILD" == false ]]; then
    # Check if C4ESRCDIR is set for build (may have already been validated in git pull stage)
    if [[ "$SKIP_GIT_PULL" == true ]] && [[ -z "${C4ESRCDIR}" ]]; then
        echo "ERROR: C4ESRCDIR environment variable is not set (required for Maven build)"
        exit 1
    fi

    if [[ "$SKIP_GIT_PULL" == true ]] && [[ ! -d "${C4ESRCDIR}" ]]; then
        echo "ERROR: C4ESRCDIR directory ${C4ESRCDIR} not found"
        exit 1
    fi

    # Check if pom.xml exists in the root directory
    if [[ ! -f "${C4ESRCDIR}/pom.xml" ]]; then
        echo "ERROR: pom.xml not found in ${C4ESRCDIR}"
        exit 1
    fi

    echo "========================================="
    echo "Building enrollment code with Maven..."
    echo "========================================="
    
    # Prepare Maven command with optional test skipping
    MAVEN_CMD="mvn clean install"
    if [[ "$SKIP_TESTS" == true ]]; then
        MAVEN_CMD="$MAVEN_CMD -DskipTests"
        echo "Running '$MAVEN_CMD' in ${C4ESRCDIR} (tests will be skipped)"
    else
        echo "Running '$MAVEN_CMD' in ${C4ESRCDIR}"
    fi
    
    # Change to the source directory and run Maven build
    cd "${C4ESRCDIR}"
    $MAVEN_CMD
    
    if [[ $? -eq 0 ]]; then
        echo "========================================="
        echo "Maven build completed successfully"
        echo "========================================="
    else
        echo "ERROR: Maven build failed"
        exit 3
    fi
    
    # Return to the original directory
    cd "${OLDPWD}"
fi

# Always check if the source file exists (we always copy the script)
if [[ ! -f "${SOURCE_FILE}" ]]; then
    echo "ERROR: Source file ${SOURCE_FILE} not found"
    exit 1
fi

if [[ "$SKIP_COPY" == false ]]; then
    # Check if C4ESRCDIR is set and tar directory exists only when copying tar files
    # (C4ESRCDIR validation may have already been done in git pull or build stages)
    if [[ "$SKIP_GIT_PULL" == true ]] && [[ "$SKIP_BUILD" == true ]] && [[ -z "${C4ESRCDIR}" ]]; then
        echo "ERROR: C4ESRCDIR environment variable is not set"
        exit 1
    fi

    if [[ ! -d "${TAR_SOURCE_DIR}" ]]; then
        echo "ERROR: Enrollment tar source directory ${TAR_SOURCE_DIR} not found"
        exit 1
    fi

    # Find tar files in the target directory
    TAR_FILES=($(find "${TAR_SOURCE_DIR}" -name "*.tar.gz" -o -name "*.tar"))
    if [[ ${#TAR_FILES[@]} -eq 0 ]]; then
        echo "ERROR: No enrollment tar files found in ${TAR_SOURCE_DIR}"
        exit 1
    fi

    echo "Found ${#TAR_FILES[@]} enrollment tar file(s) to copy"
fi

# Create staging directory and always copy the script
echo "Creating staging directory and copying ${SOURCE_FILE}..."
MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" mkdir -p /home/cprime/staging/enrollment
# Ensure enrollment staging directory has correct ownership
MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown -R cprime:cprime /home/cprime/staging/enrollment

if [[ "$SKIP_COPY" == false ]]; then
    # Check if files exist in staging directory and clean if needed
    echo "Checking enrollment staging directory for existing files..."
    if MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" ls -A "/home/cprime/staging/enrollment/" 2>/dev/null | grep -q .; then
        echo "Found existing files in enrollment staging directory, cleaning..."
        MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" rm -rf /home/cprime/staging/enrollment/*
        echo "Enrollment staging directory cleaned"
    else
        echo "Enrollment staging directory is empty or doesn't exist"
    fi
elif [[ "$USE_EXISTING_TAR" == true ]]; then
    # Clean staging directory when using existing tar
    echo "Cleaning enrollment staging directory for existing tar usage..."
    if MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" ls -A "/home/cprime/staging/enrollment/" 2>/dev/null | grep -q .; then
        MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" rm -rf /home/cprime/staging/enrollment/*
        echo "Enrollment staging directory cleaned"
    fi
fi

# Always copy the shell script (keep it in the docker/connector directory for execution)
echo "Copying ${SOURCE_FILE}..."
docker cp "${SOURCE_FILE}" "${CONTAINER_NAME}:/home/cprime/${SOURCE_FILE}"
MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown cprime:cprime "/home/cprime/${SOURCE_FILE}"
MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chmod +x "/home/cprime/${SOURCE_FILE}"

if [[ "$SKIP_COPY" == false ]]; then
    # Copy tar files to staging directory
    for tar_file in "${TAR_FILES[@]}"; do
        tar_filename=$(basename "${tar_file}")
        echo "Copying enrollment ${tar_filename}..."
        docker cp "${tar_file}" "${CONTAINER_NAME}:/home/cprime/staging/enrollment/"
        MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown cprime:cprime "/home/cprime/staging/enrollment/${tar_filename}"
    done
    
    # Ensure all enrollment staging directory contents have correct ownership
    echo "Setting ownership for enrollment staging directory contents..."
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown -R cprime:cprime /home/cprime/staging/enrollment/

    # Untar the copied tar files
    echo "Extracting enrollment tar files..."
    EXTRACTED_DIR=""
    for tar_file in "${TAR_FILES[@]}"; do
        tar_filename=$(basename "${tar_file}")
        echo "Extracting enrollment ${tar_filename}..."
        MSYS_NO_PATHCONV=1 docker exec --user cprime "${CONTAINER_NAME}" tar -xzf "/home/cprime/staging/enrollment/${tar_filename}" -C "/home/cprime/staging/enrollment/"
        if [[ $? -eq 0 ]]; then
            echo "Successfully extracted enrollment ${tar_filename}"
            # Determine the extracted directory name
            if [[ -z "${EXTRACTED_DIR}" ]]; then
                # Get the first directory created after extraction
                EXTRACTED_DIR=$(MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" find "/home/cprime/staging/enrollment/" -maxdepth 1 -type d ! -path "/home/cprime/staging/enrollment/" | head -1)
                if [[ -n "${EXTRACTED_DIR}" ]]; then
                    echo "Found extracted enrollment directory: ${EXTRACTED_DIR}"
                fi
            fi
            # Set ownership for extracted directory and contents
            echo "Setting ownership for extracted enrollment directory..."
            MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown -R cprime:cprime /home/cprime/staging/enrollment/
        else
            echo "WARNING: Failed to extract enrollment ${tar_filename}"
        fi
    done

    # Update DIST_DIR in the script to point to the extracted directory
    if [[ -n "${EXTRACTED_DIR}" ]]; then
        echo "Updating DIST_DIR in ${SOURCE_FILE} to point to extracted enrollment directory..."
        MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" sed -i "s|^DIST_DIR=.*|DIST_DIR=${EXTRACTED_DIR}|" "/home/cprime/${SOURCE_FILE}"
        echo "Updated DIST_DIR to: ${EXTRACTED_DIR}"
    else
        echo "WARNING: Could not determine extracted enrollment directory, keeping default DIST_DIR"
    fi
elif [[ "$USE_EXISTING_TAR" == true ]]; then
    # Use existing tar file from /home/cprime/enrollment-installer
    echo "Using existing enrollment tar file from /home/cprime/enrollment-installer..."
    
    # Check if the directory exists
    if ! MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" test -d "/home/cprime/enrollment-installer"; then
        echo "ERROR: Directory /home/cprime/enrollment-installer does not exist in container"
        exit 1
    fi
    
    # Find tar files in the enrollment installer directory
    EXISTING_TAR_FILES=($(MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" find "/home/cprime/enrollment-installer" -name "*.tar.gz" -o -name "*.tar"))
    if [[ ${#EXISTING_TAR_FILES[@]} -eq 0 ]]; then
        echo "ERROR: No enrollment tar files found in /home/cprime/enrollment-installer"
        exit 1
    fi
    
    echo "Found ${#EXISTING_TAR_FILES[@]} existing enrollment tar file(s) in container"
    
    # Copy tar files from enrollment installer directory to staging
    EXTRACTED_DIR=""
    for tar_file in "${EXISTING_TAR_FILES[@]}"; do
        tar_filename=$(basename "${tar_file}")
        echo "Copying existing enrollment ${tar_filename} to staging..."
        MSYS_NO_PATHCONV=1 docker exec --user cprime "${CONTAINER_NAME}" cp "${tar_file}" "/home/cprime/staging/enrollment/"
        
        echo "Extracting existing enrollment ${tar_filename}..."
        MSYS_NO_PATHCONV=1 docker exec --user cprime "${CONTAINER_NAME}" tar -xzf "/home/cprime/staging/enrollment/${tar_filename}" -C "/home/cprime/staging/enrollment/"
        if [[ $? -eq 0 ]]; then
            echo "Successfully extracted existing enrollment ${tar_filename}"
            # Determine the extracted directory name
            if [[ -z "${EXTRACTED_DIR}" ]]; then
                # Get the first directory created after extraction
                EXTRACTED_DIR=$(MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" find "/home/cprime/staging/enrollment/" -maxdepth 1 -type d ! -path "/home/cprime/staging/enrollment/" | head -1)
                if [[ -n "${EXTRACTED_DIR}" ]]; then
                    echo "Found extracted enrollment directory from existing tar: ${EXTRACTED_DIR}"
                fi
            fi
            # Set ownership for extracted directory and contents
            echo "Setting ownership for extracted enrollment directory from existing tar..."
            MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown -R cprime:cprime /home/cprime/staging/enrollment/
        else
            echo "WARNING: Failed to extract existing enrollment ${tar_filename}"
        fi
    done

    # Update DIST_DIR in the script to point to the extracted directory
    if [[ -n "${EXTRACTED_DIR}" ]]; then
        echo "Updating DIST_DIR in ${SOURCE_FILE} to point to extracted enrollment directory from existing tar..."
        MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" sed -i "s|^DIST_DIR=.*|DIST_DIR=${EXTRACTED_DIR}|" "/home/cprime/${SOURCE_FILE}"
        echo "Updated DIST_DIR to: ${EXTRACTED_DIR}"
    else
        echo "WARNING: Could not determine extracted enrollment directory from existing tar, keeping default DIST_DIR"
    fi
else
    # When skipping copy, find the existing extracted directory and update DIST_DIR
    echo "Using existing enrollment tar files, finding extracted directory..."
    EXTRACTED_DIR=$(MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" find "/home/cprime/staging/enrollment/" -maxdepth 1 -type d ! -path "/home/cprime/staging/enrollment/" | head -1)
    if [[ -n "${EXTRACTED_DIR}" ]]; then
        echo "Found existing extracted enrollment directory: ${EXTRACTED_DIR}"
        echo "Updating DIST_DIR in ${SOURCE_FILE} to point to existing extracted enrollment directory..."
        MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" sed -i "s|^DIST_DIR=.*|DIST_DIR=${EXTRACTED_DIR}|" "/home/cprime/${SOURCE_FILE}"
        echo "Updated DIST_DIR to: ${EXTRACTED_DIR}"
    else
        echo "WARNING: Could not find existing extracted enrollment directory"
    fi
fi

# Verify
echo "Verifying enrollment files in container..."
MSYS_NO_PATHCONV=1 docker exec "${CONTAINER_NAME}" ls -la "/home/cprime/staging/enrollment/"

# Run the _deployConnectorEnrollmentInsideContainer.sh script
echo "========================================="
echo "Running ${SOURCE_FILE} inside container..."
echo "========================================="

# Execute the script directly with proper environment and working directory.
# Use -i only (no -t) so it works both interactively and in background/CI.
MSYS_NO_PATHCONV=1 docker exec -i --user cprime -w /home/cprime "${CONTAINER_NAME}" bash -c "
export HOME=/home/cprime
export USER=cprime
export SHELL=/bin/bash
export TERM=xterm
exec bash ./${SOURCE_FILE}
"

if [[ $? -eq 0 ]]; then
    echo "========================================="
    echo "${SOURCE_FILE} completed successfully"
    echo "========================================="
else
    echo "========================================="
    echo "WARNING: ${SOURCE_FILE} execution failed or completed with errors"
    echo "========================================="
fi

# Copy the vault-ref version of hmem.jms.cfg into the container's etc/ directory.
# Karaf's feature install only writes default values; the vault-ref version lives in the
# source repo and must be placed in etc/ before updateConfigurationFiles.sh can substitute it.
KARAF_ETC="/home/cprime/cprime/healthrules-connector-server-4.4.11/etc"
HMEM_JMS_DEST="${KARAF_ETC}/com.healthedge.connector.hmem.jms.cfg"
HMEM_JMS_SRC="${C4ESRCDIR}/connector-hmem-common/connector-hmem-common-bundle/src/main/resources/config/hmem.jms.cfg"

echo "========================================="
echo "Staging vault-ref hmem.jms.cfg into container etc/..."
echo "========================================="
if [[ -f "${HMEM_JMS_SRC}" ]]; then
    docker cp "${HMEM_JMS_SRC}" "${CONTAINER_NAME}:${HMEM_JMS_DEST}"
    MSYS_NO_PATHCONV=1 docker exec --user root "${CONTAINER_NAME}" chown cprime:cprime "${HMEM_JMS_DEST}"
    echo "Copied hmem.jms.cfg → [${CONTAINER_NAME}]:${HMEM_JMS_DEST}"
else
    echo "WARNING: Source file not found at ${HMEM_JMS_SRC} — skipping hmem.jms.cfg staging"
    echo "         Set C4ESRCDIR to the connector-enrollment source root and re-run."
fi

# Run updateConfigurationFiles.sh to inject secrets into com.healthedge.connector.hmem.jms.cfg
UPDATE_CONFIG_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../secrets_management/updateConfigurationFiles.sh"
ENROLLMENT_CONFIG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../secrets_management/enrollment_configuration_file_path.yaml"

if [[ -f "$UPDATE_CONFIG_SCRIPT" ]]; then
    echo "========================================="
    echo "Applying secrets to connector HMEM JMS config..."
    echo "========================================="
    bash "$UPDATE_CONFIG_SCRIPT" \
        --config "$ENROLLMENT_CONFIG" \
        --container "${CONTAINER_NAME}"
    if [[ $? -eq 0 ]]; then
        echo "========================================="
        echo "Secrets applied to com.healthedge.connector.hmem.jms.cfg"
        echo "========================================="
    else
        echo "WARNING: updateConfigurationFiles.sh failed — check secrets env and container state"
    fi
else
    echo "WARNING: updateConfigurationFiles.sh not found at $UPDATE_CONFIG_SCRIPT — skipping secrets injection"
fi

# Calculate and display total execution time
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
MINUTES=$((TOTAL_TIME / 60))
SECONDS=$((TOTAL_TIME % 60))

echo "========================================="
echo "Enrollment deployment script execution completed"
echo "Total time taken: ${MINUTES} minutes and ${SECONDS} seconds"
echo "========================================"
