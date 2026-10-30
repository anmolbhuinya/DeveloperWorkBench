#!/bin/bash

# Define variables
CONN_DOMAIN=/home/cprime/environments/connector
MEDIA_DIR=~/media
DIST_DIR=/home/cprime/staging/dist/connector-enrollment-dist-13.0-SNAPSHOT
COMMANDS_FILE=${CONN_DOMAIN}/genCommand.sh
KARAF_HOME=/home/cprime/cprime/healthrules-connector-server-4.4.3
HMEM_FILE=${CONN_DOMAIN}/enrollmentHmem.properties
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="$(cd "${SCRIPTS_DIR}/../../secrets_management" 2>/dev/null && pwd || true)"

# Function to display a banner message
function banner() {
  echo "****************************************************************"
  echo "$1"
  echo "****************************************************************"
}

# Function to install enrollment modules
installEnrollmentModules() {
  ENROLLMENT_REPOS="connector-medicarehicn-repos connector-membercomplianceprogram-repos connector-enrollmentsparse-repos"
  echo "shell:echo ***** Adding Enrollment Distribution ******" >$COMMANDS_FILE
  echo "hrc:add-distribution $DIST_DIR" >>$COMMANDS_FILE
  echo "shell:echo ***** Installing Enrollment ******" >>$COMMANDS_FILE
  echo "feature:install -r $ENROLLMENT_REPOS" >>$COMMANDS_FILE
  ${KARAF_HOME}/bin/client -f $COMMANDS_FILE

  banner "Enrollment modules installed"
  rm -rf $COMMANDS_FILE
}

# Function to install HMEM modules
installHMEMModules() {
  HMEM_REPOS="connector-hmem-common-repos connector-hmem-publisher-repos connector-hmem-consumer-repos"
  echo "shell:echo ***** Installing HMEM modules ******" >$COMMANDS_FILE
  echo "feature:install -r $HMEM_REPOS" >>$COMMANDS_FILE
  ${KARAF_HOME}/bin/client -f $COMMANDS_FILE

  banner "HMEM modules installed"
  rm -rf $COMMANDS_FILE
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

installEnrollmentModules
installHMEMModules

injectEnrollmentSecrets() {
  local secrets_env="${HOME}/.secrets_env"
  local update_cfg="${SECRETS_DIR}/updateConfigurationFiles.sh"
  local enrollment_cfg_yaml="${SECRETS_DIR}/enrollment_configuration_file_path.yaml"

  if [[ ! -f "${secrets_env}" ]]; then
    banner "Skipping secrets injection: ~/.secrets_env not found."
    return 0
  fi
  if [[ ! -x "${update_cfg}" ]]; then
    banner "Skipping secrets injection: updateConfigurationFiles.sh not found or not executable at ${update_cfg}."
    return 0
  fi
  if [[ ! -f "${enrollment_cfg_yaml}" ]]; then
    banner "Skipping secrets injection: enrollment_configuration_file_path.yaml not found at ${enrollment_cfg_yaml}."
    return 0
  fi

  # Export KARAF_HOME so updateConfigurationFiles.sh can expand it in the yaml path
  export KARAF_HOME

  banner "Injecting secrets into Karaf etc/ enrollment config files..."
  bash "${update_cfg}" --local --config "${enrollment_cfg_yaml}" --env "${secrets_env}"
  local rc=$?

  if [[ $rc -eq 0 ]]; then
    banner "Enrollment secrets injection completed."
  else
    echo "WARNING: Enrollment secrets injection exited with code ${rc}."
  fi
}

injectEnrollmentSecrets

banner "Install ran for $(($(date +'%s') - $INSTALL_START)) seconds."