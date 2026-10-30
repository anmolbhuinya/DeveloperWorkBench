#!/bin/bash

show_help() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -sc      Skip the clone process"
  echo "  -schk    Skip the checkout process"
  echo "  -ncs     No code sync (git pull) during checkout"
  echo "  -nups    No update opm with snapshot versions"
  echo "  -sb      Skip the build process"
  echo "  -st      Skip tests during build"
  echo "  -si      Skip deployment to Karaf in Docker (uninstall/install)"
  echo "  -h       Show this help message and exit"
  echo ""
  echo "Configuration file:"
  echo "  ~/.cotiviti_setup_config    Stores persistent settings for branch version and environment variables."
  echo "                              To change branch version, COTIVITI_SRC_PATH, or COTIVITI_KARAF_CONTAINER,"
  echo "                              simply edit this file and re-run the script."
  echo "                              (Note:  This file won't exist before first time setup)"
  echo ""
  echo "Examples:"
  echo "  $0 -sc -sb"
  echo "  $0 -sc -sb -st"
  echo "  $0 -sc -schk -sb -st -si"
  echo "  $0 -sc -sb -nups"
  echo "  $0 -sc -schk -ncs"
  echo ""
}

# Check for -h before any other logic
for arg in "$@"; do
  case "$arg" in
    -h|help)
      show_help
      exit 0
      ;;
  esac
done

# Default config values
DEFAULT_BRANCH_VERSION="latest"
DEFAULT_SRC_PATH="$HOME/hebb/hecommons"
DEFAULT_KARAF_CONTAINER="connector-261"

COTIVITI_CONFIG_FILE="$HOME/.cotiviti_setup_config"

# Create config file with defaults and prompt for branch version if it doesn't exist
if [ ! -f "$COTIVITI_CONFIG_FILE" ]; then
  echo "First time setup: Please enter the Cotiviti branch version you want to use (e.g. 25.2.1 or latest):"
  read -p "Enter Cotiviti branch version: " USER_BRANCH_VERSION
  if [[ -z "$USER_BRANCH_VERSION" ]]; then
    USER_BRANCH_VERSION="$DEFAULT_BRANCH_VERSION"
  fi
  cat > "$COTIVITI_CONFIG_FILE" <<EOF
export COTIVITI_BRANCH_VERSION="$USER_BRANCH_VERSION"
export COTIVITI_SRC_PATH="$DEFAULT_SRC_PATH"
export COTIVITI_KARAF_CONTAINER="$DEFAULT_KARAF_CONTAINER"
EOF
  echo "Created config at $COTIVITI_CONFIG_FILE"
fi

# Source config file
source "$COTIVITI_CONFIG_FILE"

# Use config values or fallback to defaults if not set in config
COTIVITI_SRC_PATH="${COTIVITI_SRC_PATH:-$DEFAULT_SRC_PATH}"
COTIVITI_BRANCH_VERSION="${COTIVITI_BRANCH_VERSION:-$DEFAULT_BRANCH_VERSION}"
COTIVITI_KARAF_CONTAINER="${COTIVITI_KARAF_CONTAINER:-$DEFAULT_KARAF_CONTAINER}"

echo "COTIVITI_SRC_PATH is set to: $COTIVITI_SRC_PATH"
echo "COTIVITI_BRANCH_VERSION is set to: $COTIVITI_BRANCH_VERSION"
echo "COTIVITI_KARAF_CONTAINER is set to: $COTIVITI_KARAF_CONTAINER"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse options (shortcuts only)
SKIP_CLONE=false
SKIP_CHECKOUT=false
SKIP_BUILD=false
SKIP_TESTS=false
SKIP_INSTALL=false
SKIP_POM_UPDATE_SNAPSHOT=false
SKIP_CODE_SYNC=false

for ((i=1; i<=$#; i++)); do
  arg="${!i}"
  case "$arg" in
    -sc)
      SKIP_CLONE=true
      ;;
    -schk)
      SKIP_CHECKOUT=true
      ;;
    -sb)
      SKIP_BUILD=true
      ;;
    -st)
      SKIP_TESTS=true
      ;;
    -si)
      SKIP_INSTALL=true
      ;;
    -nups)
      SKIP_POM_UPDATE_SNAPSHOT=true
      ;;
    -ncs)
      SKIP_CODE_SYNC=true
      ;;
    -h|help)
      show_help
      echo "Waiting 5 seconds before exit so you can read logs..."
      sleep 5
      exit 0
      ;;
  esac
done

cloneCotivitiRepos() {
  # Ensure the base directory exists
  if [ ! -d "${COTIVITI_SRC_PATH}" ]; then
    echo "Creating directory: ${COTIVITI_SRC_PATH}"
    mkdir -p "${COTIVITI_SRC_PATH}" || { echo "Failed to create directory ${COTIVITI_SRC_PATH}"; return 1; }
  fi

  declare -A REPO_URLS=(
    ["hrp.he.claim.schema"]="git@github.com:HE-Core/hrp.he.claim.schema.git"
    ["hrp.he.custom.datasource"]="git@github.com:HE-Core/hrp.he.custom.datasource.git"
    ["hrp.he.claims.tracking.schema"]="git@github.com:HE-Core/hrp.he.claims.tracking.schema.git"
    ["hrp.he.claims.mapper.validator"]="git@github.com:HE-Core/hrp.he.claims.mapper.validator.git"
    ["hrp.he.claims.external.processor"]="git@github.com:HE-Core/hrp.he.claims.external.processor.git"
    ["hrp.he.claims.external.mapper"]="git@github.com:HE-Core/hrp.he.claims.external.mapper.git"
    ["hrp.he.claims.we.state.events"]="git@github.com:HE-Core/hrp.he.claims.we.state.events.git"
    ["hrp.he.cotiviti.realtime"]="git@github.com:HE-Core/hrp.he.cotiviti.realtime.git"
  )

  cd "${COTIVITI_SRC_PATH}" || { echo "Failed to cd to ${COTIVITI_SRC_PATH}"; return 1; }

  for REPO in "${!REPO_URLS[@]}"; do
    if [ -d "${REPO}" ]; then
      echo "Repository '${REPO}' already exists. Skipping clone."
    else
      echo "Cloning ${REPO_URLS[$REPO]} into ${REPO}..."
      git clone "${REPO_URLS[$REPO]}" "${REPO}" || { echo "Failed to clone '${REPO}'"; return 1; }
    fi
  done
  echo "All repositories cloned (or already present) in ${COTIVITI_SRC_PATH}"
}

# Handle setCotivitiBranch command
if [[ "$1" == "setCotivitiBranch" ]]; then
  setCotivitiBranch
  exit 0
fi

checkoutCotivitiReposBranch() {
  if [[ -z "$COTIVITI_BRANCH_VERSION" ]]; then
    echo "COTIVITI_BRANCH_VERSION is not set."
    echo "Please rerun the script and provide a branch version."
    return 1
  fi

  BRANCH_VERSION="$COTIVITI_BRANCH_VERSION"

  declare -a REPOS=(
    "hrp.he.claim.schema"
    "hrp.he.custom.datasource"
    "hrp.he.claims.tracking.schema"
    "hrp.he.claims.mapper.validator"
    "hrp.he.claims.external.processor"
    "hrp.he.claims.external.mapper"
    "hrp.he.claims.we.state.events"
    "hrp.he.cotiviti.realtime"
  )

  SUCCESS_REPOS=()
  FAILED_REPOS=()

  if [[ "$SKIP_CODE_SYNC" == true ]]; then
    echo "=================================================="
    echo "Skipping git pull for all repositories due to -ncs (no code sync) option."
    echo "=================================================="
  fi

  for REPO in "${REPOS[@]}"; do
    TARGET_DIR="${COTIVITI_SRC_PATH}/${REPO}"
    if [ -d "$TARGET_DIR" ]; then
      cd "$TARGET_DIR" || { echo "Failed to navigate to $TARGET_DIR"; FAILED_REPOS+=("$REPO"); continue; }

      # Rollback uncommitted changes in pom.xml
      if git status --porcelain | grep -q "pom.xml"; then
        echo "Uncommitted changes found in pom.xml for $REPO. Rolling back..."
        git checkout -- pom.xml
      fi

      # Determine branch to checkout
      if [[ "$REPO" == "hrp.he.custom.datasource" ]]; then
        BRANCH="master"
      elif [[ "$BRANCH_VERSION" == "latest" && ( "$REPO" == "hrp.he.claim.schema" || "$REPO" == "hrp.he.claims.tracking.schema" ) ]]; then
        BRANCH="master"
      elif [[ -n "$BRANCH_VERSION" ]]; then
        BRANCH="release-$BRANCH_VERSION"
      else
        BRANCH="release-latest"
      fi

      # Attempt to checkout the branch
      if git checkout "$BRANCH"; then
        echo "$REPO checkout was successful"
        SUCCESS_REPOS+=("$REPO")
      else
        echo "$REPO checkout failed"
        FAILED_REPOS+=("$REPO")
      fi

      # Only run git pull if not skipping code sync
      if [[ "$SKIP_CODE_SYNC" == false ]]; then
        if git pull; then
          echo "Git pull successful for $REPO"
        else
          echo "Git pull failed for $REPO"
          FAILED_REPOS+=("$REPO")
        fi
      fi
    else
      echo "$REPO does not exist, skipping checkout."
      FAILED_REPOS+=("$REPO")
    fi
  done

  # Display checkout summary
  echo "Checkout Summary:"
  if [ ${#SUCCESS_REPOS[@]} -gt 0 ]; then
    echo "Successfully checked out repositories:"
    for REPO in "${SUCCESS_REPOS[@]}"; do
      echo "- $REPO"
    done
  fi

  if [ ${#FAILED_REPOS[@]} -gt 0 ]; then
    echo "Repositories with checkout or pull failures:"
    for REPO in "${FAILED_REPOS[@]}"; do
      echo "- ${REPO}"
    done
    return 1
  else
    echo "All repositories checked out and updated successfully."
    return 0
  fi
}

updateCotivitiReposPomWithSnapshot() {
  # Use COTIVITI_BRANCH_VERSION for both RELEASE_VER and COTIVITI_VERSION
  if [[ -z "$COTIVITI_BRANCH_VERSION" ]]; then
    echo "COTIVITI_BRANCH_VERSION is not set. Cannot update pom.xml."
    return 1
  fi

  # If user entered 'latest', treat as 26.1 for versioning
  if [[ "$COTIVITI_BRANCH_VERSION" == "latest" ]]; then
    RELEASE_VER="26.1"
    COTIVITI_VERSION="26.1"
  else
    RELEASE_VER="$COTIVITI_BRANCH_VERSION"
    COTIVITI_VERSION="$COTIVITI_BRANCH_VERSION"
  fi

  BASE_PATH="${COTIVITI_SRC_PATH}"

  REPOS=("hrp.he.claims.external.processor" "hrp.he.claims.mapper.validator" "hrp.he.claims.we.state.events" "hrp.he.claims.external.mapper" "hrp.he.cotiviti.realtime")

  SUCCESS_REPOS=()
  FAILED_REPOS=()

  for REPO in "${REPOS[@]}"; do
    TARGET_DIR="${BASE_PATH}/${REPO}"

    if [ -d "${TARGET_DIR}" ]; then
      cd "${TARGET_DIR}" || { FAILED_REPOS+=("${REPO}"); continue; }

      if [ -f "pom.xml" ]; then
        sed -i "s|<core.version>[^<]*</core.version>|<core.version>${RELEASE_VER}-SNAPSHOT</core.version>|g" pom.xml
        sed -i "s|<connector-classic.version>[^<]*</connector-classic.version>|<connector-classic.version>${RELEASE_VER}-SNAPSHOT</connector-classic.version>|g" pom.xml
        sed -i "s|<connector.version>[^<]*</connector.version>|<connector.version>${RELEASE_VER}-SNAPSHOT</connector.version>|g" pom.xml
        sed -i "s|<data-universe.version>[^<]*</data-universe.version>|<data-universe.version>${RELEASE_VER}-SNAPSHOT</data-universe.version>|g" pom.xml

        if grep -q "<he-claim-schema.version>" pom.xml; then
          sed -i 's|<he-claim-schema.version>[^<]*</he-claim-schema.version>|<he-claim-schema.version>4.1-SNAPSHOT</he-claim-schema.version>|g' pom.xml
        fi

        if grep -q "<he-claims-mapper-validator.version>" pom.xml; then
          sed -i -E "s|(<he-claims-mapper-validator\.version>)[^<]*(</he-claims-mapper-validator\.version>)|\1${COTIVITI_VERSION}-SNAPSHOT\2|g" pom.xml
        fi

        SUCCESS_REPOS+=("${REPO}")
      else
        FAILED_REPOS+=("${REPO}")
      fi
    else
      FAILED_REPOS+=("${REPO}")
    fi
  done

  echo "Successfully updated pom.xml with $RELEASE_VER-SNAPSHOT versions for all product dependencies"
  for REPO in "${SUCCESS_REPOS[@]}"; do
    echo "- ${REPO}"
  done

  if [ ${#FAILED_REPOS[@]} -gt 0 ]; then
    echo "Repositories with failed updates in pom.xml:"
    for REPO in "${FAILED_REPOS[@]}"; do
      echo "- ${REPO}"
    done
  fi
}

buildCotivitiRepos() {
  declare -a REPOS=(
    "hrp.he.custom.datasource"
    "hrp.he.claims.tracking.schema"
    "hrp.he.claim.schema"
    "hrp.he.claims.we.state.events"
    "hrp.he.claims.mapper.validator"
    "hrp.he.claims.external.processor"
    "hrp.he.claims.external.mapper"
    "hrp.he.cotiviti.realtime"
  )

  if [[ "$SKIP_TESTS" == true ]]; then
    SKIP_TESTS_FLAG="-DskipTests"
  else
    SKIP_TESTS_FLAG=""
  fi

  SUCCESS_REPOS=()
  FAILED_REPOS=()

  for REPO in "${REPOS[@]}"; do
    TARGET_DIR="${COTIVITI_SRC_PATH}/${REPO}"
    if [ -d "${TARGET_DIR}" ]; then
      cd "${TARGET_DIR}" || { echo "Failed to navigate to ${TARGET_DIR}"; FAILED_REPOS+=("${REPO}"); continue; }
      if mvn clean install ${SKIP_TESTS_FLAG}; then
        SUCCESS_REPOS+=("${REPO}")
      else
        FAILED_REPOS+=("${REPO}")
      fi
    else
      echo "Directory ${TARGET_DIR} does not exist"
      FAILED_REPOS+=("${REPO}")
    fi
  done

  echo "Build Summary:"
  if [ ${#SUCCESS_REPOS[@]} -gt 0 ]; then
    echo "Successfully built repositories:"
    for REPO in "${SUCCESS_REPOS[@]}"; do
      echo "- ${REPO}"
    done
  fi

  if [ ${#FAILED_REPOS[@]} -gt 0 ]; then
    echo "Repositories with build failures:"
    for REPO in "${FAILED_REPOS[@]}"; do
      echo "- ${REPO}"
    done
    return 1
  else
    echo "All repositories built successfully."
    return 0
  fi
}

# Uninstall Cotiviti bundles from Karaf running in Docker
uninstallCotivitiBundlesInDocker() {
  # Container and Karaf details (adjust as needed)
  local CONTAINER_NAME="${COTIVITI_KARAF_CONTAINER:-connector-261}"
  local KARAF_HOME="/home/cprime/cprime/healthrules-connector-server-4.4.3"
  local KARAF_CLIENT="$KARAF_HOME/bin/client"
  local KARAF_USER="connector"
  local KARAF_PASS="Connector123"

  echo "Uninstalling Cotiviti bundles from Karaf in Docker container: $CONTAINER_NAME"

  # Uninstall features in reverse order (to handle dependencies)
  local FEATURES="he-cotiviti-realtime-repos he-claims-external-mapper-repos he-claims-external-processor-repos he-claims-mapper-validator-repos he-claims-we-state-events-repos he-claim-schema-repos he-custom-datasource-repos he-claims-tracking-schema-repos"

  MSYS_NO_PATHCONV=1 docker exec -u cprime "$CONTAINER_NAME" bash -c "
    $KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS \"feature:uninstall $FEATURES\"
  "

  echo "Uninstall command executed in container $CONTAINER_NAME."
}

# Wait for all he- bundles to be uninstalled in Karaf on Docker
waitForCotivitiBundlesUninstallInDocker() {
  local CONTAINER_NAME="${COTIVITI_KARAF_CONTAINER:-connector-261}"
  local KARAF_HOME="/home/cprime/cprime/healthrules-connector-server-4.4.3"
  local KARAF_CLIENT="$KARAF_HOME/bin/client"
  local KARAF_USER="connector"
  local KARAF_PASS="Connector123"
  local poll_attempt=0
  local bundle_output=""
  local non_blueprint_bundles=""

  echo "Waiting for Cotiviti (he-) bundles to be uninstalled in Docker container: $CONTAINER_NAME"
  while [[ $poll_attempt -lt 30 ]]; do
    sleep 2
    bundle_output=$(MSYS_NO_PATHCONV=1 docker exec -u cprime "$CONTAINER_NAME" bash -c "$KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS \"bundle:list | grep 'he-'\"")
    non_blueprint_bundles=$(echo "$bundle_output" | grep -v "\.xml")
    echo "Polling for he- product bundles to be uninstalled (attempt $((poll_attempt+1)))..."
    if [[ -z "$non_blueprint_bundles" ]]; then
      echo "All he- product bundles are uninstalled (ignoring blueprints)."
      return 0
    fi
    poll_attempt=$((poll_attempt + 1))
  done
  echo "Timeout: he- product bundles were not uninstalled within 1 minute."
  echo "Current bundle status:"
  echo "$bundle_output"
  return 1
}

# Copy all Cotiviti kar files to Karaf install directory in Docker
copyCotivitiSnapArtifactsToKarafInDocker() {
  local CONTAINER_NAME="${COTIVITI_KARAF_CONTAINER:-connector-261}"
  local KARAF_INSTALL_DIR="/home/cprime/cprime/healthrules-connector-server-4.4.3/install"
  local VERSION="$COTIVITI_BRANCH_VERSION"
  if [[ "$VERSION" == "latest" ]]; then
    VERSION="26.1"
  fi

  declare -a KAR_PATHS=(
    "hrp.he.custom.datasource/he-custom-datasource-repos/target/he-custom-datasource-repos-1.0.0.2.kar"
    "hrp.he.claims.tracking.schema/he-claims-tracking-schema-repos/target/he-claims-tracking-schema-repos-5.0-SNAPSHOT.kar"
    "hrp.he.claim.schema/he-claim-schema-repos/target/he-claim-schema-repos-4.1-SNAPSHOT.kar"
    "hrp.he.claims.we.state.events/he-claims-we-state-events-repos/target/he-claims-we-state-events-repos-${VERSION}-SNAPSHOT.kar"
    "hrp.he.claims.mapper.validator/he-claims-mapper-validator-repos/target/he-claims-mapper-validator-repos-${VERSION}-SNAPSHOT.kar"
    "hrp.he.claims.external.processor/he-claims-external-processor-repos/target/he-claims-external-processor-repos-${VERSION}-SNAPSHOT.kar"
    "hrp.he.claims.external.mapper/he-claims-external-mapper-repos/target/he-claims-external-mapper-repos-${VERSION}-SNAPSHOT.kar"
    "hrp.he.cotiviti.realtime/he-cotiviti-realtime-repos/target/he-cotiviti-realtime-repos-${VERSION}-SNAPSHOT.kar"
  )

  local copied_count=0
  for KAR_PATH in "${KAR_PATHS[@]}"; do
    local SRC_FILE="${COTIVITI_SRC_PATH}/${KAR_PATH}"
    local KAR_NAME=$(basename "$SRC_FILE")
    if [[ -f "$SRC_FILE" ]]; then
      echo "Copying $SRC_FILE to $CONTAINER_NAME:$KARAF_INSTALL_DIR"
      docker cp "$SRC_FILE" "$CONTAINER_NAME:$KARAF_INSTALL_DIR/"
      if [[ $? -eq 0 ]]; then
        echo "Copied: $KAR_NAME"
        copied_count=$((copied_count+1))
      else
        echo "ERROR: Failed to copy $KAR_NAME"
      fi
    else
      echo "WARNING: KAR file not found: $SRC_FILE"
    fi
  done
  echo "Total KAR files copied: $copied_count"
  echo "All Cotiviti kar files copy attempt finished."
}

# Install Cotiviti bundles in Karaf on Docker
installCotivitiBundlesInDocker() {
  local CONTAINER_NAME="${COTIVITI_KARAF_CONTAINER:-connector-261}"
  local KARAF_HOME="/home/cprime/cprime/healthrules-connector-server-4.4.3"
  local KARAF_CLIENT="$KARAF_HOME/bin/client"
  local KARAF_USER="connector"
  local KARAF_PASS="Connector123"
  local INSTALL_CMD="feature:install he-custom-datasource-repos he-claims-tracking-schema-repos he-claim-schema-repos he-claims-we-state-events-repos he-claims-mapper-validator-repos he-claims-external-processor-repos he-claims-external-mapper-repos he-cotiviti-realtime-repos"

  echo "Attempting to login to Karaf in Docker container: $CONTAINER_NAME"
  echo "Login command: docker exec -u cprime $CONTAINER_NAME $KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS \"list | head -5\""
  # Test login by running the client inside the Docker container
  local login_output
  login_output=$(docker exec -u cprime "$CONTAINER_NAME" "$KARAF_CLIENT" -u $KARAF_USER -p $KARAF_PASS "list | head -5")
  if [[ $? -eq 0 && -n "$login_output" && ! "$login_output" =~ "Closed" ]]; then
    echo "Login to Karaf successful. Output:"
    echo "$login_output"
    echo "Running install command inside Docker:"
    echo "docker exec -u cprime $CONTAINER_NAME $KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS \"$INSTALL_CMD\""
    docker exec -u cprime "$CONTAINER_NAME" "$KARAF_CLIENT" -u $KARAF_USER -p $KARAF_PASS "$INSTALL_CMD"
    echo "Install command executed in container $CONTAINER_NAME."
  else
    echo "ERROR: Failed to login to Karaf. Output:"
    echo "$login_output"
    echo "Aborting install step and stopping script."
    exit 1
  fi
}

# Wait for all he- bundles to be Active in Karaf on Docker and verify count
waitForCotivitiBundlesActiveInDocker() {
  local CONTAINER_NAME="${COTIVITI_KARAF_CONTAINER:-connector-261}"
  local KARAF_HOME="/home/cprime/cprime/healthrules-connector-server-4.4.3"
  local KARAF_CLIENT="$KARAF_HOME/bin/client"
  local KARAF_USER="connector"
  local KARAF_PASS="Connector123"
  local poll_attempt=0
  local bundle_output=""
  local not_active_bundles=""
  local active_count=0

  echo "Waiting for Cotiviti (he-) bundles to become Active in Docker container: $CONTAINER_NAME"
  while [[ $poll_attempt -lt 30 ]]; do
    sleep 2
    bundle_output=$(MSYS_NO_PATHCONV=1 docker exec -u cprime "$CONTAINER_NAME" bash -c "$KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS \"list | grep 'he-'\"")
    # Only count non-blueprint, Active bundles
    active_count=$(echo "$bundle_output" | grep -v "\.xml" | grep "Active" | wc -l)
    not_active_bundles=$(echo "$bundle_output" | grep -v "Active" | grep -v "\.xml")
    echo "Polling for he- product bundles to be Active (attempt $((poll_attempt+1)))..."
    echo "Currently Active he- bundles: $active_count"
    if [[ $active_count -ge 8 && -z "$not_active_bundles" ]]; then
      echo "All he- product bundles are Active (ignoring blueprints)."
      echo "Installed he- bundles:"
      echo "$bundle_output" | grep -v "\.xml"
      return 0
    fi
    poll_attempt=$((poll_attempt + 1))
  done
  echo "Timeout: Not all he- product bundles are Active within 1 minute."
  echo "Current bundle status:"
  echo "$bundle_output"
  return 1
}

CLONE_STATUS=0
if [[ "$SKIP_CLONE" == true ]]; then
  echo "=================================================="
  echo "Skipping clone process as requested (--skip-clone/-sc)."
  echo "=================================================="
else
  cloneCotivitiRepos
  CLONE_STATUS=$?
  if [[ $CLONE_STATUS -eq 0 ]]; then
    echo "=================================================="
    echo "SUCCESS: All Cotiviti repositories cloned successfully."
    echo "=================================================="
  else
    echo "=================================================="
    echo "ERROR: One or more Cotiviti repositories failed to clone."
    echo "=================================================="
  fi
fi

# Always attempt checkout/build/update, print what is skipped
if [[ "$SKIP_CLONE" == true || $CLONE_STATUS -eq 0 ]]; then
  if [[ "$SKIP_CLONE" == true ]]; then
    echo "=================================================="
    echo "Clone step skipped, proceeding with checkout, update, and build steps."
    echo "=================================================="
  fi

  if [[ "$SKIP_CHECKOUT" == true ]]; then
    echo "=================================================="
    echo "Skipping checkout process as requested (--skip-checkout/-schk)."
    echo "=================================================="
  else
    echo "Proceeding to checkout branches for all repositories..."
    checkoutCotivitiReposBranch
    CHECKOUT_STATUS=$?
    if [[ $CHECKOUT_STATUS -eq 0 ]]; then
      echo "=================================================="
      echo "SUCCESS: All Cotiviti repositories checked out successfully."
      echo "=================================================="
    else
      echo "=================================================="
      echo "ERROR: One or more Cotiviti repositories failed to checkout."
      echo "=================================================="
    fi
  fi

  echo "Updating pom.xml snapshot versions..."
  if [[ "$SKIP_POM_UPDATE_SNAPSHOT" == true ]]; then
    echo "=================================================="
    echo "Skipping updateCotivitiReposPomWithSnapshot as requested -spu)."
    echo "=================================================="
  else
    updateCotivitiReposPomWithSnapshot
  fi

  if [[ "$SKIP_BUILD" == false ]]; then
    echo "Building Cotiviti repositories..."
    buildCotivitiRepos
    BUILD_STATUS=$?
    if [[ $BUILD_STATUS -eq 0 ]]; then
      echo "=================================================="
      echo "SUCCESS: All Cotiviti repositories built successfully."
      echo "=================================================="
    else
      echo "=================================================="
      echo "ERROR: One or more Cotiviti repositories failed to build."
      echo "=================================================="
    fi
  else
    echo "=================================================="
    echo "Skipping build process as requested (--skip-build/-sb)."
    echo "=================================================="
  fi

else
  echo "=================================================="
  echo "Skipping checkout, update, and build steps because clone failed."
  echo "=================================================="
fi

# After build and before deployment, copy _deployCotivitiInsideContainer.sh to the container and run it

if [[ "$SKIP_INSTALL" == true ]]; then
  echo "=================================================="
  echo "Skipping deployment to Karaf in Docker (--skip-install/-si)."
  echo "=================================================="
  exit 0
fi

INNER_SCRIPT="_deployCotivitiInsideContainer.sh"
CONTAINER_NAME="${COTIVITI_KARAF_CONTAINER:-connector-261}"
CONTAINER_STAGING="/home/cprime/staging/cotiviti"

# Always resolve the script path relative to the original script directory
INNER_SCRIPT_PATH="${SCRIPT_DIR}/${INNER_SCRIPT}"

# Fix: Check if the inner script exists before attempting to copy
if [[ -z "$INNER_SCRIPT_PATH" || ! -f "$INNER_SCRIPT_PATH" ]]; then
  echo "ERROR: Cannot find $INNER_SCRIPT at $INNER_SCRIPT_PATH"
  echo "Please ensure _deployCotivitiInsideContainer.sh is present in $SCRIPT_DIR"
  exit 1
fi

# Remove any previous version of the script in the container
echo "Cleaning up previous deployment script in container..."
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER_NAME" rm -f "$CONTAINER_STAGING/$INNER_SCRIPT"

# Ensure staging directory exists
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER_NAME" mkdir -p "$CONTAINER_STAGING"

# Copy the new inner script (use resolved path)
echo "Copying $INNER_SCRIPT to container $CONTAINER_NAME:$CONTAINER_STAGING"
docker cp "$INNER_SCRIPT_PATH" "$CONTAINER_NAME:$CONTAINER_STAGING/$INNER_SCRIPT"
MSYS_NO_PATHCONV=1 docker exec --user root "$CONTAINER_NAME" chown cprime:cprime "$CONTAINER_STAGING/$INNER_SCRIPT"
MSYS_NO_PATHCONV=1 docker exec --user root "$CONTAINER_NAME" chmod +x "$CONTAINER_STAGING/$INNER_SCRIPT"

# Operation 1: Uninstall bundles before copying KAR files
echo "Running $INNER_SCRIPT uninstall inside container $CONTAINER_NAME..."
MSYS_NO_PATHCONV=1 docker exec -it --user cprime -w "$CONTAINER_STAGING" "$CONTAINER_NAME" bash -c "
export HOME=/home/cprime
export USER=cprime
export SHELL=/bin/bash
export TERM=xterm
exec bash ./$INNER_SCRIPT uninstall
"
UNINSTALL_STATUS=$?
if [[ $UNINSTALL_STATUS -ne 0 ]]; then
  echo "ERROR: Uninstall step failed inside container. Aborting."
  exit 1
fi

# Function to copy config files to Karaf etc directory in Docker
copyConfigFilesToKarafInDocker() {
  local CONTAINER_NAME="${COTIVITI_KARAF_CONTAINER:-connector-261}"
  local KARAF_ETC_DIR="/home/cprime/cprime/healthrules-connector-server-4.4.3/etc"
  local CONFIGS_DIR="${SCRIPT_DIR}/configs"
  local CONFIG_FILES=(
    "com.healthedge.custom.datasource.db.cfg"
    "com.healthedge.he.common.claim.external.mapper.cfg"
    "com.healthedge.he.common.claim.mapping.cfg"
    "com.healthedge.he.common.claim.state.events.cfg"
    "com.healthedge.he.common.cotiviti.realtime.cfg"
    "com.healthedge.he.common.claim.external.process.cfg"
  )

  echo "Copying configuration files to Karaf etc directory in Docker container: $CONTAINER_NAME"
  for CFG in "${CONFIG_FILES[@]}"; do
    local SRC_FILE="${CONFIGS_DIR}/${CFG}"
    if [[ -f "$SRC_FILE" ]]; then
      # Check if file already exists in the container
      MSYS_NO_PATHCONV=1 docker exec "$CONTAINER_NAME" bash -c "[ -f '$KARAF_ETC_DIR/$CFG' ]"
      if [[ $? -eq 0 ]]; then
        echo "File already exists in container: $KARAF_ETC_DIR/$CFG (skipping copy)"
      else
        echo "Copying $SRC_FILE to $CONTAINER_NAME:$KARAF_ETC_DIR/"
        docker cp "$SRC_FILE" "$CONTAINER_NAME:$KARAF_ETC_DIR/"
        if [[ $? -eq 0 ]]; then
          echo "Copied: $CFG"
        else
          echo "ERROR: Failed to copy $CFG"
        fi
      fi
    else
      echo "WARNING: Config file not found: $SRC_FILE"
    fi
  done
  echo "All config files copy attempt finished."
}

# Copy config files to Karaf etc directory in Docker
copyConfigFilesToKarafInDocker

# Operation 2: Copy kar files to container
echo "Copying Cotiviti kar files to Karaf install directory in Docker..."
copyCotivitiSnapArtifactsToKarafInDocker

# Operation 3: Install bundles after copying KAR files
echo "Running $INNER_SCRIPT install inside container $CONTAINER_NAME..."
MSYS_NO_PATHCONV=1 docker exec -it --user cprime -w "$CONTAINER_STAGING" "$CONTAINER_NAME" bash -c "
export HOME=/home/cprime
export USER=cprime
export SHELL=/bin/bash
export TERM=xterm
exec bash ./$INNER_SCRIPT install
"
INSTALL_STATUS=$?
if [[ $INSTALL_STATUS -ne 0 ]]; then
  echo "ERROR: Install step failed inside container. Aborting."
  exit 1
fi