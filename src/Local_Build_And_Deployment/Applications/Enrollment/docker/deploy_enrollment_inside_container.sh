#!/bin/bash
# deploy_enrollment_inside_container.sh
# Runs INSIDE the connector container.
# Usage: bash deploy_enrollment_inside_container.sh <DIST_DIR>
#   DIST_DIR — path to the extracted enrollment distribution directory
#              e.g. /home/weblogic/staging/connector-enrollment-dist-27.1-SNAPSHOT

DIST_DIR="${1}"
if [[ -z "$DIST_DIR" ]]; then
    echo "ERROR: DIST_DIR argument is required."
    echo "Usage: $0 <path-to-extracted-distribution>"
    exit 1
fi
if [[ ! -d "$DIST_DIR" ]]; then
    echo "ERROR: DIST_DIR does not exist: $DIST_DIR"
    exit 1
fi

if [[ -z "$KARAF_HOME" ]]; then
    echo "ERROR: KARAF_HOME is not set. Pass it via the deployment configuration (build_deploy_config.xlsx karaf_home key)."
    exit 1
fi
if [[ -z "$JAVA_HOME" ]]; then
    echo "ERROR: JAVA_HOME is not set. Pass it via the deployment configuration (build_deploy_config.xlsx java_home key)."
    exit 1
fi
export JAVA_HOME

echo "================================================================"
echo " Enrollment deploy: $DIST_DIR"
echo "================================================================"

function banner() {
    echo "****************************************************************"
    echo "$1"
    echo "****************************************************************"
}

installEnrollmentModules() {
    ENROLLMENT_REPOS="connector-medicarehicn-repos connector-membercomplianceprogram-repos connector-enrollmentsparse-repos"

    banner "Adding Enrollment Distribution"
    ${KARAF_HOME}/bin/client -u connector -p Connector123 "hrc:add-distribution $DIST_DIR"
    sleep 30

    banner "Installing Enrollment Features"
    enrollment_install_info=$(${KARAF_HOME}/bin/client -u connector -p Connector123 "feature:install -r $ENROLLMENT_REPOS")
    echo "$enrollment_install_info"

    err_feature=$(echo "$enrollment_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    err_feature_list=""

    while [[ -n "$err_feature" ]]; do
        err_feature_list+="$err_feature\n"
        ENROLLMENT_REPOS=${ENROLLMENT_REPOS//$err_feature /}
        enrollment_install_info=$(${KARAF_HOME}/bin/client -u connector -p Connector123 "feature:install -r $ENROLLMENT_REPOS")
        err_feature=$(echo "$enrollment_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    done

    if [[ -n "$err_feature_list" ]]; then
        echo "****************************************************************"
        echo -e "Failed to install the following enrollment features:\n"
        echo -e "$err_feature_list"
    fi

    banner "Enrollment modules installed"
}

installHMEMModules() {
    HMEM_REPOS="connector-hmem-common-repos connector-hmem-publisher-repos connector-hmem-consumer-repos"

    banner "Installing HMEM Features"
    hmem_install_info=$(${KARAF_HOME}/bin/client -u connector -p Connector123 "feature:install -r $HMEM_REPOS")
    echo "$hmem_install_info"

    err_feature=$(echo "$hmem_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    err_feature_list=""

    while [[ -n "$err_feature" ]]; do
        err_feature_list+="$err_feature\n"
        HMEM_REPOS=${HMEM_REPOS//$err_feature /}
        hmem_install_info=$(${KARAF_HOME}/bin/client -u connector -p Connector123 "feature:install -r $HMEM_REPOS")
        err_feature=$(echo "$hmem_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    done

    if [[ -n "$err_feature_list" ]]; then
        echo "****************************************************************"
        echo -e "Failed to install the following HMEM features:\n"
        echo -e "$err_feature_list"
    fi

    banner "HMEM modules installed"
}

INSTALL_START="$(date +'%s')"

installEnrollmentModules
installHMEMModules

banner "Install ran for $(($(date +'%s') - $INSTALL_START)) seconds."
echo "================================================================"
echo " Enrollment deployment complete."
echo "================================================================"
