#!/bin/bash

# Simple script to copy _deployConnectorInsideContainer.sh and tar file to staging directory inside docker container connector-261
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIG_DIR=$(pwd)
trap 'cd "$ORIG_DIR"' EXIT INT TERM HUP

cd "$SCRIPT_DIR" || exit 1
# Start timing
START_TIME=$(date +%s)

# Parse command line arguments
SKIP_COPY=false
SKIP_BUILD=false
SKIP_TESTS=false
SKIP_GIT_PULL=false
SKIP_CONNECTOR_PATCH=false
FOR_ENROLLMENT=false
DEFAULT_CONNECTOR_CONTAINER="connector-jdk21-271"  # Default container name
DEFAULT_PAYER_CONTAINER="payer-tc-jdk21-271"
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
        --skip-connector-patch|--no-connector-patch|-p)
            SKIP_CONNECTOR_PATCH=true
            shift
            ;;
        --container|-c)
            if [[ -n "$2" && "$2" != -* ]]; then
                DEFAULT_CONNECTOR_CONTAINER="$2"
                shift 2
            else
                echo "ERROR: --container requires a container name"
                exit 1
            fi
            ;;
        --payer-container)
            if [[ -n "$2" && "$2" != -* ]]; then
                DEFAULT_PAYER_CONTAINER="$2"
                shift 2
            else
                echo "ERROR: --payer-container requires a container name"
                exit 1
            fi
            ;;
        --for-enrollment)
            FOR_ENROLLMENT=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --skip-copy, --no-copy, -s      Skip copying files and use existing files in container"
            echo "  --skip-build, --no-build, -b    Skip Maven build step"
            echo "  --skip-tests, --no-tests, -t    Skip tests during Maven build"
            echo "  --skip-git-pull, --no-git-pull, -g  Skip git pull in source directory"
            echo "  --skip-connector-patch, --no-connector-patch, -p  Skip applying connector server patch"
            echo "  --container, -c <name>          Specify the container name (default: ${DEFAULT_CONNECTOR_CONTAINER})"
            echo "  --payer-container <name>        Specify the payer container name (default: ${DEFAULT_PAYER_CONTAINER})"
            echo "  --for-enrollment                Use enrollment feature file generation"
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

SOURCE_FILE="_deployConnectorInsideContainer.sh"
TAR_SOURCE_DIR="${C4SRCDIR}/connector-distribution/target/"

if [[ "$SKIP_COPY" == true ]]; then
    echo "========================================="
    echo "Skipping copy - using existing files"
    echo "========================================="
else
    echo "========================================="
    echo "Copying files to container staging"
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
if ! docker ps | grep -q "${DEFAULT_CONNECTOR_CONTAINER}"; then
    echo "ERROR: Container ${DEFAULT_CONNECTOR_CONTAINER} is not running"
    exit 2
fi

echo "Container ${DEFAULT_CONNECTOR_CONTAINER} is running"

# Git pull stage - update source code if not skipping
if [[ "$SKIP_GIT_PULL" == false ]]; then
    # Check if C4SRCDIR is set for git pull (will be validated again in build stage if needed)
    if [[ -z "${C4SRCDIR}" ]]; then
        echo "ERROR: C4SRCDIR environment variable is not set (required for git pull)"
        exit 1
    fi

    if [[ ! -d "${C4SRCDIR}" ]]; then
        echo "ERROR: C4SRCDIR directory ${C4SRCDIR} not found"
        exit 1
    fi

    # Check if it's a git repository
    if [[ ! -d "${C4SRCDIR}/.git" ]]; then
        echo "ERROR: ${C4SRCDIR} is not a git repository (no .git directory found)"
        exit 1
    fi

    echo "========================================="
    echo "Updating source code with git pull..."
    echo "========================================="
    echo "Running 'git pull' in ${C4SRCDIR}"

    # Change to the source directory and run git pull
    cd "${C4SRCDIR}" || exit 2
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
    cd "${OLDPWD}" || exit 2
fi

# Maven build stage - check C4SRCDIR and run build if not skipping
if [[ "$SKIP_BUILD" == false ]]; then
    # Check if C4SRCDIR is set for build (may have already been validated in git pull stage)
    if [[ "$SKIP_GIT_PULL" == true ]] && [[ -z "${C4SRCDIR}" ]]; then
        echo "ERROR: C4SRCDIR environment variable is not set (required for Maven build)"
        exit 1
    fi

    if [[ "$SKIP_GIT_PULL" == true ]] && [[ ! -d "${C4SRCDIR}" ]]; then
        echo "ERROR: C4SRCDIR directory ${C4SRCDIR} not found"
        exit 1
    fi

    # Check if pom.xml exists in the root directory
    if [[ ! -f "${C4SRCDIR}/pom.xml" ]]; then
        echo "ERROR: pom.xml not found in ${C4SRCDIR}"
        exit 1
    fi

    echo "========================================="
    echo "Building code with Maven..."
    echo "========================================="

    # Prepare Maven command with optional test skipping
    MAVEN_CMD="mvn clean install"
    if [[ "$SKIP_TESTS" == true ]]; then
        MAVEN_CMD="$MAVEN_CMD -DskipTests"
        echo "Running '$MAVEN_CMD' in ${C4SRCDIR} (tests will be skipped)"
    else
        echo "Running '$MAVEN_CMD' in ${C4SRCDIR}"
    fi

    # Change to the source directory and run Maven build
    cd "${C4SRCDIR}" || exit 2
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
    cd "${OLDPWD}" || exit 2
fi

# Always check if the source file exists (we always copy the script)
if [[ ! -f "${SCRIPT_DIR}/${SOURCE_FILE}" ]]; then
    echo "ERROR: Source file ${SOURCE_FILE} not found"
    exit 1
fi

if [[ "$SKIP_COPY" == false ]]; then
    # Check if C4SRCDIR is set and tar directory exists only when copying tar files
    # (C4SRCDIR validation may have already been done in git pull or build stages)
    if [[ "$SKIP_GIT_PULL" == true ]] && [[ "$SKIP_BUILD" == true ]] && [[ -z "${C4SRCDIR}" ]]; then
        echo "ERROR: C4SRCDIR environment variable is not set"
        exit 1
    fi

    if [[ ! -d "${TAR_SOURCE_DIR}" ]]; then
        echo "ERROR: Tar source directory ${TAR_SOURCE_DIR} not found"
        exit 1
    fi

    # Find tar files in the target directory
    TAR_FILES=($(find "${TAR_SOURCE_DIR}" -name "*.tar.gz" -o -name "*.tar"))
    if [[ ${#TAR_FILES[@]} -eq 0 ]]; then
        echo "ERROR: No tar files found in ${TAR_SOURCE_DIR}"
        exit 1
    fi

    echo "Found ${#TAR_FILES[@]} tar file(s) to copy"
fi

# Create staging directory and always copy the script
echo "Creating staging directory and copying ${SOURCE_FILE}..."
MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" mkdir -p /home/cprime/staging/cprime

if [[ "$SKIP_COPY" == false ]]; then
    # Check if files exist in staging directory and clean if needed
    echo "Checking staging directory for existing files..."
    if MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" ls -A "/home/cprime/staging/cprime/" 2>/dev/null | grep -q .; then
        echo "Found existing files in staging directory, cleaning..."
        MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" rm -rf /home/cprime/staging/cprime/*
        echo "Staging directory cleaned"
    else
        echo "Staging directory is empty or doesn't exist"
    fi
fi

# Always copy and update the shell script
echo "Copying and updating ${SOURCE_FILE}..."

# First, create a temporary modified version of the script
TEMP_SCRIPT="temp_${SOURCE_FILE}"
cp "${SOURCE_FILE}" "${TEMP_SCRIPT}"

# Update the DIST_DIR variable to point to the staging location (will be updated after extraction)
sed -i 's|^DIST_DIR=.*|DIST_DIR=/home/cprime/staging/cprime|' "${TEMP_SCRIPT}"

# Copy the modified script to container
docker cp "${TEMP_SCRIPT}" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/${SOURCE_FILE}"
MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chown cprime:cprime "/home/cprime/staging/cprime/${SOURCE_FILE}"
MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chmod +x "/home/cprime/staging/cprime/${SOURCE_FILE}"

# Clean up temporary file
rm "${TEMP_SCRIPT}"
echo "Updated DIST_DIR in ${SOURCE_FILE} to point to staging location"

if [[ "$SKIP_COPY" == false ]]; then
    # Copy tar files
    for tar_file in "${TAR_FILES[@]}"; do
        tar_filename=$(basename "${tar_file}")
        echo "Copying ${tar_filename}..."
        docker cp "${tar_file}" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/"
        MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chown cprime:cprime "/home/cprime/staging/cprime/${tar_filename}"
    done

    # Untar the copied tar files
    echo "Extracting tar files..."
    EXTRACTED_DIR=""
    for tar_file in "${TAR_FILES[@]}"; do
        tar_filename=$(basename "${tar_file}")
        echo "Extracting ${tar_filename}..."
        MSYS_NO_PATHCONV=1 docker exec --user cprime "${DEFAULT_CONNECTOR_CONTAINER}" tar -xzf "/home/cprime/staging/cprime/${tar_filename}" -C "/home/cprime/staging/cprime/"
        if [[ $? -eq 0 ]]; then
            echo "Successfully extracted ${tar_filename}"
            # Determine the extracted directory name (usually the tar filename without extension)
            if [[ -z "${EXTRACTED_DIR}" ]]; then
                # Get the first directory created after extraction
                EXTRACTED_DIR=$(MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" find "/home/cprime/staging/cprime/" -maxdepth 1 -type d ! -path "/home/cprime/staging/cprime/" | head -1)
                if [[ -n "${EXTRACTED_DIR}" ]]; then
                    echo "Found extracted directory: ${EXTRACTED_DIR}"
                fi
            fi
            # Optionally remove the tar file after extraction
            # docker exec "${DEFAULT_CONNECTOR_CONTAINER}" rm "/home/cprime/staging/cprime/${tar_filename}"
        else
            echo "WARNING: Failed to extract ${tar_filename}"
        fi
    done

    # Update DIST_DIR in the script to point to the extracted directory
    if [[ -n "${EXTRACTED_DIR}" ]]; then
        echo "Updating DIST_DIR in ${SOURCE_FILE} to point to extracted directory..."
        MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" sed -i "s|^DIST_DIR=.*|DIST_DIR=${EXTRACTED_DIR}|" "/home/cprime/staging/cprime/${SOURCE_FILE}"
        echo "Updated DIST_DIR to: ${EXTRACTED_DIR}"
    else
        echo "WARNING: Could not determine extracted directory, keeping default DIST_DIR"
    fi
else
    # When skipping copy, find the existing extracted directory and update DIST_DIR
    echo "Using existing tar files, finding extracted directory..."
    EXTRACTED_DIR=$(MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" find "/home/cprime/staging/cprime/" -maxdepth 1 -type d ! -path "/home/cprime/staging/cprime/" | head -1)
    if [[ -n "${EXTRACTED_DIR}" ]]; then
        echo "Found existing extracted directory: ${EXTRACTED_DIR}"
        echo "Updating DIST_DIR in ${SOURCE_FILE} to point to existing extracted directory..."
        MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" sed -i "s|^DIST_DIR=.*|DIST_DIR=${EXTRACTED_DIR}|" "/home/cprime/staging/cprime/${SOURCE_FILE}"
        echo "Updated DIST_DIR to: ${EXTRACTED_DIR}"
    else
        echo "WARNING: Could not find existing extracted directory"
    fi
fi

# ── Stage secrets files for deploy-time injection ────────────────────────────
SECRETS_MGMT_DIR="$(cd "${SCRIPT_DIR}/../../secrets_management" 2>/dev/null && pwd || true)"
if [[ -z "${SECRETS_MGMT_DIR}" || ! -d "${SECRETS_MGMT_DIR}" ]]; then
    echo "ERROR: secrets_management/ directory not found at ${SCRIPT_DIR}/../../secrets_management"
    exit 1
fi

if [[ -f "${HOME}/.secrets_env" ]]; then
    echo "Staging .secrets_env into container..."
    docker cp "${HOME}/.secrets_env" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/.secrets_env"
    MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chown cprime:cprime "/home/cprime/staging/cprime/.secrets_env"
else
    echo "WARNING: ~/.secrets_env not found — template secrets will not be injected at deploy time."
fi

echo "Staging updateConfigurationFiles.sh and connector yaml into container..."
docker cp "${SECRETS_MGMT_DIR}/updateConfigurationFiles.sh" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/updateConfigurationFiles.sh"
docker cp "${SECRETS_MGMT_DIR}/connector_configuration_file_path.yaml" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/connector_configuration_file_path.yaml"
MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chown cprime:cprime \
    "/home/cprime/staging/cprime/updateConfigurationFiles.sh" \
    "/home/cprime/staging/cprime/connector_configuration_file_path.yaml"
MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chmod +x "/home/cprime/staging/cprime/updateConfigurationFiles.sh"

# Stage development-config-templates that contain vault: refs for deploy-time injection
C4SRCDIR_TEMPLATES="${C4SRCDIR}/development-config-templates"
if [[ -d "${C4SRCDIR_TEMPLATES}" ]]; then
    echo "Staging development-config-templates into container..."
    docker cp "${C4SRCDIR_TEMPLATES}/wl.properties.bc.installer.template" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/wl.properties.bc.installer.template"
    docker cp "${C4SRCDIR_TEMPLATES}/com.healthedge.connector.payor.cfg" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/com.healthedge.connector.payor.cfg"
    MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chown cprime:cprime \
        "/home/cprime/staging/cprime/wl.properties.bc.installer.template" \
        "/home/cprime/staging/cprime/com.healthedge.connector.payor.cfg"
else
    echo "WARNING: ${C4SRCDIR_TEMPLATES} not found — Karaf etc/ templates will not be overwritten before secret injection."
fi

# Stage src/main/resources cfg files (always have vault: refs — git-tracked source)
# Note: cvc-event-listener-route.xml is intentionally excluded — it is deployed to
# connector-blueprints-deploy/ by the KAR's own configfile entry during feature:install.
# Staging it here would cause fileinstall to pick it up before the Java bundle is active,
# breaking OSGi resolution of com.healthedge.cprime.cvc.event.model.
declare -A STAGE_FILES=(
    ["${C4SRCDIR}/connector-jms/connector-jms-bundle/src/main/resources/connector-jms.cfg"]="connector-jms.cfg"
    ["${C4SRCDIR}/connector-bluecard-claimpricing/connector-bluecard-claimpricing-bundle/src/main/resources/connector.ibm.mq.client.cfg"]="connector.ibm.mq.client.cfg"
)
for src_path in "${!STAGE_FILES[@]}"; do
    dest_name="${STAGE_FILES[$src_path]}"
    if [[ -f "${src_path}" ]]; then
        echo "Staging ${dest_name} into container..."
        docker cp "${src_path}" "${DEFAULT_CONNECTOR_CONTAINER}:/home/cprime/staging/cprime/${dest_name}"
        MSYS_NO_PATHCONV=1 docker exec --user root "${DEFAULT_CONNECTOR_CONTAINER}" chown cprime:cprime "/home/cprime/staging/cprime/${dest_name}"
    else
        echo "WARNING: ${src_path} not found — ${dest_name} will not be available for deploy-time injection."
    fi
done

# Verify
echo "Verifying files in container..."
MSYS_NO_PATHCONV=1 docker exec "${DEFAULT_CONNECTOR_CONTAINER}" ls -la "/home/cprime/staging/cprime/"

# Run the _deployConnectorInsideContainer.sh script
echo "========================================="
echo "Running ${SOURCE_FILE} inside container..."
echo "========================================="

# Build the command arguments for the inner script
INNER_SCRIPT_ARGS=""
if [[ "$SKIP_CONNECTOR_PATCH" == true ]]; then
    INNER_SCRIPT_ARGS="$INNER_SCRIPT_ARGS --skip-connector-patch"
fi
if [[ -n "$DEFAULT_PAYER_CONTAINER" ]]; then
    INNER_SCRIPT_ARGS="$INNER_SCRIPT_ARGS --payer-container \"$DEFAULT_PAYER_CONTAINER\""
fi
if [[ "$FOR_ENROLLMENT" == true ]]; then
    INNER_SCRIPT_ARGS="$INNER_SCRIPT_ARGS --for-enrollment"
fi

# Execute the script directly with proper environment and working directory.
# Use -i only (no -t) so it works both interactively and in background/CI.
MSYS_NO_PATHCONV=1 docker exec -i --user cprime -w /home/cprime/staging/cprime "${DEFAULT_CONNECTOR_CONTAINER}" bash -c "
export HOME=/home/cprime
export USER=cprime
export SHELL=/bin/bash
export TERM=xterm
exec bash ./${SOURCE_FILE} ${INNER_SCRIPT_ARGS}
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

# Calculate and display total execution time
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
MINUTES=$((TOTAL_TIME / 60))
SECONDS=$((TOTAL_TIME % 60))

echo "========================================="
echo "Script execution completed"
echo "Total time taken: ${MINUTES} minutes and ${SECONDS} seconds"
echo "========================================="
