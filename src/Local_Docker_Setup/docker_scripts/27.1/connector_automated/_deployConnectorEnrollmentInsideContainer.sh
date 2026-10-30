#!/bin/bash

# Define variables
CONN_DOMAIN=/home/cprime/environments/connector
MEDIA_DIR=~/media
DIST_DIR=$(find /home/cprime/staging/enrollment -maxdepth 1 -type d -name "connector-enrollment-dist-*" | head -1)
if [[ -z "$DIST_DIR" ]]; then
  echo "ERROR: No connector-enrollment-dist-* directory found under /home/cprime/staging/enrollment/"
  exit 1
fi
echo "Using DIST_DIR: $DIST_DIR"
COMMANDS_FILE=${CONN_DOMAIN}/genCommand.sh
KARAF_HOME=/home/cprime/cprime/healthrules-connector-server-4.4.11
HMEM_FILE=${CONN_DOMAIN}/enrollmentHmem.properties

# Function to display a banner message
function banner() {
  echo "****************************************************************"
  echo "$1"
  echo "****************************************************************"
}

# Enrollment installs significantly more features than a plain connector install.
# feature:install itself (Felix's OSGi resolver — ResolverImpl.mergeUses) is heap-heavy
# at resolve time, not just at steady-state runtime: 4096m OOMs mid-resolution before any
# routes even start. Confirmed empirically that 7168m/1536m-metaspace survives the full
# enrollment + HMEM feature set. Bumps the heap if it is currently below that.
# Sets HEAP_BUMPED=1 so callers know a restart is required before installing features.
HEAP_BUMPED=0
ensureMinHeap7G() {
    local setenv="$KARAF_HOME/bin/setenv"
    if [ ! -f "$setenv" ]; then
        echo "Warning: $setenv not found, skipping heap check"
        return
    fi

    local current_raw
    current_raw=$(grep -E '^export JAVA_MAX_MEM=' "$setenv" | head -1 | sed 's/export JAVA_MAX_MEM=//')
    local current_mb=0
    if echo "$current_raw" | grep -qi 'g$'; then
        current_mb=$(echo "$current_raw" | sed 's/[Gg]//')
        current_mb=$((current_mb * 1024))
    elif echo "$current_raw" | grep -qi 'm$'; then
        current_mb=$(echo "$current_raw" | sed 's/[Mm]//')
    fi

    if [ "$current_mb" -lt 7168 ] 2>/dev/null; then
        echo "Heap is ${current_raw} — bumping JAVA_MAX_MEM to 7168m for enrollment"
        sed -i 's|^export JAVA_MAX_MEM=.*|export JAVA_MAX_MEM=7168m|' "$setenv"
        sed -i 's|^export JAVA_MIN_MEM=.*|export JAVA_MIN_MEM=2048m|' "$setenv"
        sed -i 's|^export JAVA_MAX_PERM_MEM=.*|export JAVA_MAX_PERM_MEM=1536m|' "$setenv"
        HEAP_BUMPED=1
    else
        echo "Heap is ${current_raw} — no change needed"
    fi
}

# Function to restart the connector server so a bumped heap takes effect
restartConnectorServer() {
    banner "Restarting connector server to apply heap change"
    sh $KARAF_HOME/bin/stop
    CONNECTOR_SERVER_STATUS=$($KARAF_HOME/bin/status)
    STOP_COUNT=0
    while [ "$CONNECTOR_SERVER_STATUS" = "Running ..." ]; do
        STOP_COUNT=$((STOP_COUNT + 1))
        sleep 5
        if [ $STOP_COUNT -eq 10 ]; then
            break
        fi
        CONNECTOR_SERVER_STATUS=$($KARAF_HOME/bin/status)
    done

    $KARAF_HOME/bin/start
    sleep 45
    CONNECTOR_SERVER_STATUS=$($KARAF_HOME/bin/status)
    START_COUNT=0
    while [ ! "$CONNECTOR_SERVER_STATUS" = "Running ..." ]; do
        echo "Connector Server at $KARAF_HOME has status of $CONNECTOR_SERVER_STATUS"
        START_COUNT=$((START_COUNT + 1))
        if [ $START_COUNT -eq 10 ]; then
            echo "Something is wrong. Connector Server did not start. Has status of $CONNECTOR_SERVER_STATUS"
            exit 204
        else
            sleep 15
        fi
        CONNECTOR_SERVER_STATUS=$($KARAF_HOME/bin/status)
    done
    echo "Connector Server at $KARAF_HOME has status of $CONNECTOR_SERVER_STATUS"
}

# Function to install enrollment modules
installEnrollmentModules() {
  ENROLLMENT_REPOS="connector-medicarehicn-repos connector-membercomplianceprogram-repos connector-enrollmentsparse-repos"
  
  banner "Adding Enrollment Distribution"
  echo "hrc:add-distribution $DIST_DIR" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b
  sleep 30

  banner "Installing Enrollment Features"
  enrollment_install_info=$(echo "feature:install -r $ENROLLMENT_REPOS" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b | tee /dev/stderr)

  # Check for installation errors
  err_feature=$(echo "$enrollment_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
  err_feature_list=""

  # While features with installation failure are encountered, remove the failed feature and retry
  while [[ -n "$err_feature" ]]; do
    err_feature_list+="$err_feature\n"
    ENROLLMENT_REPOS=${ENROLLMENT_REPOS//$err_feature /}
    enrollment_install_info=$(echo "feature:install -r $ENROLLMENT_REPOS" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b)
    err_feature=$(echo "$enrollment_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
  done
  
  if [[ -n "$err_feature_list" ]]; then
    echo "****************************************************************"
    echo -e "Failed to install the following enrollment features: \n"
    echo -e $err_feature_list
  fi

  banner "Enrollment modules installed"
}

# Function to install HMEM modules
installHMEMModules() {
  HMEM_REPOS="connector-hmem-common-repos connector-hmem-publisher-repos connector-hmem-consumer-repos"
  
  banner "Installing HMEM Features"
  hmem_install_info=$(echo "feature:install -r $HMEM_REPOS" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b | tee /dev/stderr)

  # Check for installation errors
  err_feature=$(echo "$hmem_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
  err_feature_list=""

  # While features with installation failure are encountered, remove the failed feature and retry
  while [[ -n "$err_feature" ]]; do
    err_feature_list+="$err_feature\n"
    HMEM_REPOS=${HMEM_REPOS//$err_feature /}
    hmem_install_info=$(echo "feature:install -r $HMEM_REPOS" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b)
    err_feature=$(echo "$hmem_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
  done
  
  if [[ -n "$err_feature_list" ]]; then
    echo "****************************************************************"
    echo -e "Failed to install the following HMEM features: \n"
    echo -e $err_feature_list
  fi

  banner "HMEM modules installed"
}

# Main script execution
banner "Installing features to enrollment server..."
INSTALL_START="$(date +'%s')"

if [[ ! -d "$MEDIA_DIR" ]]; then
  mkdir -m 775 -p $MEDIA_DIR
fi

if [[ ! -d "$CONN_DOMAIN" ]]; then
  mkdir -m 775 -p $CONN_DOMAIN
fi

# feature:install's OSGi resolution is what OOMs, so the heap must be sized
# BEFORE installing anything, not after.
ensureMinHeap7G
if [[ "$HEAP_BUMPED" -eq 1 ]]; then
  restartConnectorServer
fi

installEnrollmentModules
installHMEMModules

banner "Install ran for $(($(date +'%s') - $INSTALL_START)) seconds."