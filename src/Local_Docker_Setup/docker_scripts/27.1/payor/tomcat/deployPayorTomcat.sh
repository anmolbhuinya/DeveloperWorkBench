#!/bin/bash

# Start time tracking
START_TIME=$(date +%s)

# Default configuration
PAYOR_REPO="${SRCDIR}"
CONTAINER_NAME="payer-tc-jdk21-271"
WEBLOGIC_HOME="/home/weblogic"
DEPLOY_SCRIPT="deploy_inside_container.sh"
STAGING_DIR="$WEBLOGIC_HOME/staging"
DIST_DIR="$PAYOR_REPO/distribution/target/core-distribution/claimserver/install"
BUILD_MODULE=""
BUILD_ARGS=""
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# SECRETS_DIR can be overridden via environment variable (e.g. when script is invoked from a different directory structure)
if [ -z "${SECRETS_DIR}" ]; then
    SECRETS_DIR="$(cd "${SCRIPTS_DIR}/../../../secrets_management" 2>/dev/null && pwd || true)"
fi
if [ -z "${SECRETS_DIR}" ] || [ ! -d "${SECRETS_DIR}" ]; then
    echo "Error: secrets_management/ directory not found at ${SCRIPTS_DIR}/../../../secrets_management"
    echo "Ensure hrp.dev.tools is checked out and secrets_management/ exists alongside docker/payor/tomcat/"
    exit 1
fi

SKIP_BUILD=false
SKIP_TESTS=false
SKIP_DEPLOY=false
SKIP_DB_UPGRADE=false
DEBUG=false
ONLY_START=false

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  --skip-build      Skip the Maven build step"
    echo "  --skip-tests      Skip tests during Maven build"
    echo "  --skip-deploy     Skip deployment to container"
    echo "  --skip-db-upgrade Skip database upgrade steps"
    echo "  --container NAME  Use specific container name (default: payer-tc-261)"
    echo "  --debug           Enable debug logging"
    echo "  --build-just      Build individual module"
    echo "  --only-start      Only start the server (no build/deploy)"
    echo "  --help            Display this help message"
    exit 1
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build)      SKIP_BUILD=true;       shift ;;
        --skip-tests)      SKIP_TESTS=true;       shift ;;
        --skip-deploy)     SKIP_DEPLOY=true;      shift ;;
        --skip-db-upgrade) SKIP_DB_UPGRADE=true;  shift ;;
        --container)       CONTAINER_NAME="$2";   shift 2 ;;
        --debug)           DEBUG=true;            shift ;;
        --full-build)                             shift ;;
        --build-just)      BUILD_MODULE="$2";     shift 2 ;;
        --only-start)      ONLY_START=true;       shift ;;
        --help)            usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# ── Logging helpers ───────────────────────────────────────────────────────────
log_message() { echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $1"; }
debug_log()   { [ "$DEBUG" = true ] && echo "$(date '+%Y-%m-%d %H:%M:%S') [DEBUG] $1"; }

# ── --only-start shortcut ─────────────────────────────────────────────────────
if [ "$ONLY_START" = true ]; then
    if [ "$SKIP_BUILD" = true ] || [ "$SKIP_TESTS" = true ] || \
       [ "$SKIP_DEPLOY" = true ] || [ "$SKIP_DB_UPGRADE" = true ] || \
       [ -n "$BUILD_MODULE" ]; then
        echo "Error: --only-start cannot be used with other options (except --container and --debug)"
        usage
    fi
    log_message "Only starting the server (skipping build and deploy)..."
    docker exec --user weblogic "${CONTAINER_NAME}" bash -c \
        "cd /home/weblogic/artemis/HEBroker/bin && ./artemis-service start" \
        2>&1 | while read -r line; do log_message "${line}"; done
    docker exec --user weblogic "${CONTAINER_NAME}" bash -c \
        "cd /home/weblogic/environments/healthedge/claimserver/install/tools/bin && \
         chmod +x start_tomcat_instances.sh && ./start_tomcat_instances.sh -d" \
        2>&1 | while read -r line; do log_message "${line}"; done
    END_TIME=$(date +%s); TOTAL=$((END_TIME-START_TIME))
    log_message "Total time: $((TOTAL/3600))h $(((TOTAL%3600)/60))m $((TOTAL%60))s"
    exit 0
fi

# ── Validate repo ─────────────────────────────────────────────────────────────
if [ -z "$PAYOR_REPO" ] || [ ! -d "$PAYOR_REPO" ] || [ ! -f "$PAYOR_REPO/pom.xml" ]; then
    log_message "Error: SRCDIR is not set or does not point to a valid repository."
    exit 1
fi

# ── Build ─────────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
    cd "$PAYOR_REPO" || exit 1
    if [ -n "$BUILD_MODULE" ]; then
        log_message "Building module: $BUILD_MODULE"
        BUILD_CMD="mvn -pl ${BUILD_MODULE},install,distribution"
    else
        log_message "Building the Payor code..."
        BUILD_CMD="mvn clean install"
    fi
    [ "$SKIP_TESTS" = true ] && BUILD_CMD="$BUILD_CMD -DskipTests"
    if ! $BUILD_CMD; then
        log_message "Error: Maven build failed"
        exit 1
    fi
    cd - || exit 1
fi

log_message "Distribution directory path: $DIST_DIR"
[ -d "$DIST_DIR" ] && log_message "Distribution directory found: $DIST_DIR" && \
    log_message "Domain home directory: $DOMAIN_HOME"

# ── Deploy ────────────────────────────────────────────────────────────────────
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

    # ── Prepare staging ───────────────────────────────────────────────────────
    log_message "Preparing staging directory..."
    docker exec --user weblogic "${CONTAINER_NAME}" bash -c \
        "rm -rf ${WEBLOGIC_HOME}/staging && mkdir -p ${WEBLOGIC_HOME}/staging"

    # ── Copy deployment files ─────────────────────────────────────────────────
    log_message "Copying deployment files..."
    docker cp "${SCRIPTS_DIR}/wl.properties"        "${CONTAINER_NAME}:${STAGING_DIR}"
    docker cp "${SCRIPTS_DIR}/${DEPLOY_SCRIPT}"     "${CONTAINER_NAME}:${STAGING_DIR}"
    docker cp "${DISTRIBUTION_FILE}"                "${CONTAINER_NAME}:${STAGING_DIR}"
    # Validate required secrets_management scripts exist before staging
    for _required_script in updateConfigurationFiles.sh loadSecrets.sh payor_configuration_file_path.yaml; do
        if [ ! -f "${SECRETS_DIR}/${_required_script}" ]; then
            log_message "Error: ${_required_script} not found in ${SECRETS_DIR}/"
            log_message "       Ensure secrets_management/ is up to date in hrp.dev.tools."
            exit 1
        fi
    done
    docker cp "${SECRETS_DIR}/updateConfigurationFiles.sh"        "${CONTAINER_NAME}:${STAGING_DIR}"
    docker cp "${SECRETS_DIR}/payor_configuration_file_path.yaml" "${CONTAINER_NAME}:${STAGING_DIR}"
    docker cp "${SECRETS_DIR}/loadSecrets.sh"                     "${CONTAINER_NAME}:${STAGING_DIR}"

    # Patched installCommon.bash (awk replace_pattern + vault: guard)
    if [ -f "${PAYOR_REPO}/distribution/src/main/scripts/installCommon.bash" ]; then
        log_message "Copying patched installCommon.bash..."
        docker cp "${PAYOR_REPO}/distribution/src/main/scripts/installCommon.bash" \
            "${CONTAINER_NAME}:${STAGING_DIR}"
    else
        log_message "Warning: installCommon.bash not found in distribution/src/main/scripts/"
    fi

    # Updated install.sh — adds --inject-secrets / --not-check-config flags.
    # deploy_inside_container.sh calls it with --inject-secrets so vault: placeholders
    # in runtime.properties are resolved before the DB upgrade runs.
    # The container ships the old version without these flags, so we must stage ours.
    if [ -f "${PAYOR_REPO}/distribution/src/main/scripts/install.sh" ]; then
        log_message "Copying updated install.sh..."
        docker cp "${PAYOR_REPO}/distribution/src/main/scripts/install.sh" \
            "${CONTAINER_NAME}:${STAGING_DIR}"
    else
        log_message "Warning: install.sh not found in distribution/src/main/scripts/ — container version will be used (--inject-secrets may fail)."
    fi

    # ~/.secrets_env — fail fast if missing
    if [ -f "${HOME}/.secrets_env" ]; then
        log_message "Copying .secrets_env to staging..."
        docker cp "${HOME}/.secrets_env" "${CONTAINER_NAME}:${STAGING_DIR}/.secrets_env"
    else
        log_message "Error: ~/.secrets_env not found. Run fetchAWSSecrets.sh from ${SECRETS_DIR}/ first."
        exit 1
    fi

    # Dev runtime.properties.template (all credentials as vault: refs)
    if [ -f "${PAYOR_REPO}/config/runtime.properties.template" ]; then
        log_message "Copying dev runtime.properties.template..."
        docker cp "${PAYOR_REPO}/config/runtime.properties.template" \
            "${CONTAINER_NAME}:${STAGING_DIR}"
    else
        log_message "No dev runtime.properties.template found — production template will be used."
    fi

    # Fix ownership
    if [ "$(uname -o)" == "Msys" ]; then
        docker exec --user root "${CONTAINER_NAME}" chown -R weblogic:weblogic "/${STAGING_DIR}"
    else
        docker exec --user root "${CONTAINER_NAME}" chown -R weblogic:weblogic "${STAGING_DIR}"
    fi

    # dos2unix the deploy script
    log_message "Converting deploy script to Unix format..."
    docker exec --user weblogic "${CONTAINER_NAME}" bash -c "dos2unix $STAGING_DIR/$DEPLOY_SCRIPT"

    # ── Run deployment ────────────────────────────────────────────────────────
    log_message "Running deployment script..."
    DEPLOY_ARGS=""
    [ "$SKIP_DB_UPGRADE" = true ] && DEPLOY_ARGS="--skip-db-upgrade"

    # Clear any stale exit-code file from a previous run
    docker exec --user weblogic "${CONTAINER_NAME}" \
        bash -c "rm -f ${STAGING_DIR}/.deploy_exit_code"

    # Stream output — we do NOT rely on PIPESTATUS or $? here because
    # start_tomcat_instances.sh -d keeps the exec session alive for minutes
    # while Tomcat starts, causing the Docker exec instance ID to expire.
    # deploy_inside_container.sh writes "0" to .deploy_exit_code BEFORE
    # starting servers; we read it back with a short-lived docker exec.
    docker exec --user weblogic "${CONTAINER_NAME}" \
        bash -c "cd ${STAGING_DIR} && bash ${DEPLOY_SCRIPT} ${DEPLOY_ARGS}" \
        2>&1 | while read -r line; do log_message "${line}"; done

    # Read exit code written by deploy_inside_container.sh before server start.
    # Use docker cp (not docker exec) — docker exec on a long-running session
    # can fail with "No such exec instance" once the container's exec quota
    # expires.  docker cp opens no exec session and always works.
    EXIT_CODE_TMP=$(mktemp)
    if docker cp "${CONTAINER_NAME}:${STAGING_DIR}/.deploy_exit_code" "${EXIT_CODE_TMP}" 2>/dev/null; then
        DEPLOY_EXIT=$(tr -d '[:space:]' < "${EXIT_CODE_TMP}")
    else
        log_message "Warning: could not read .deploy_exit_code — assuming success (Deployment complete. was logged)."
        DEPLOY_EXIT="0"
    fi
    rm -f "${EXIT_CODE_TMP}"

    if [ "${DEPLOY_EXIT}" != "0" ]; then
        log_message "Error: Deployment script failed with exit code ${DEPLOY_EXIT}."
        exit 1
    fi

    # ── Copy artefacts back to host ───────────────────────────────────────────
    log_message "Copying domain folders to local machine..."
    # On Windows (Git Bash / Msys) Docker Desktop can produce RWLayer errors on
    # docker cp even when the copy succeeds. Gate best-effort behaviour on Msys
    # only — on Linux/macOS retain the original fail-fast semantics so genuine
    # failures surface immediately rather than causing confusing downstream errors.
    if [ "$(uname -o 2>/dev/null)" = "Msys" ]; then
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/jars  "$DOMAIN_HOME/" \
            || log_message "Warning: Failed to copy jars — continuing (Windows RWLayer known issue)."
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/tools "$DOMAIN_HOME/" \
            || log_message "Warning: Failed to copy tools — continuing."
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/data  "$DOMAIN_HOME/" \
            || log_message "Warning: Failed to copy data — continuing."
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/lib   "$DOMAIN_HOME/" \
            || log_message "Warning: Failed to copy lib — continuing."
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/encrypt-keystore.jks "$DOMAIN_HOME/" \
            || log_message "Warning: Failed to copy encrypt-keystore.jks — continuing."
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/xml   "$DOMAIN_HOME/" \
            || log_message "Warning: Failed to copy xml — continuing."
    else
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/jars  "$DOMAIN_HOME/" \
            || { log_message "Error: Failed to copy jars."; exit 1; }
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/tools "$DOMAIN_HOME/" \
            || { log_message "Error: Failed to copy tools."; exit 1; }
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/data  "$DOMAIN_HOME/" \
            || { log_message "Error: Failed to copy data."; exit 1; }
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/lib   "$DOMAIN_HOME/" \
            || { log_message "Error: Failed to copy lib."; exit 1; }
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/encrypt-keystore.jks "$DOMAIN_HOME/" \
            || { log_message "Error: Failed to copy encrypt-keystore.jks."; exit 1; }
        docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/xml   "$DOMAIN_HOME/" \
            || { log_message "Error: Failed to copy xml."; exit 1; }
    fi

    # Copy runtime.properties back to host — original logic restored.
    # The developer machine already holds the same secrets in ~/.secrets_env
    # so this is no additional exposure, and local tooling needs the file.
    log_message "Copying runtime.properties to local machine..."
    docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/runtime.properties \
        "$DOMAIN_HOME/" \
        || { log_message "Error: Failed to copy runtime.properties."; exit 1; }
    docker cp "${CONTAINER_NAME}":/home/weblogic/domains/healthedge/tools/runtime.properties \
        "$DOMAIN_HOME/tools/" \
        || { log_message "Error: Failed to copy tools/runtime.properties."; exit 1; }

    log_message "Deployment script executed successfully."
fi

# ── Total time ────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
TOTAL=$((END_TIME - START_TIME))
log_message "Total time taken: $((TOTAL/3600))h $(((TOTAL%3600)/60))m $((TOTAL%60))s"
