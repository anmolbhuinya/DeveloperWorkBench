#!/bin/bash

KARAF_HOME="/home/cprime/cprime/healthrules-connector-server-4.4.3"
KARAF_CLIENT="$KARAF_HOME/bin/client"
KARAF_USER="connector"
KARAF_PASS="Connector123"

FEATURES="he-cotiviti-realtime-repos he-claims-external-mapper-repos he-claims-external-processor-repos he-claims-mapper-validator-repos he-claims-we-state-events-repos he-claim-schema-repos he-custom-datasource-repos he-claims-tracking-schema-repos"

usage() {
  echo "Usage: $0 [uninstall|install]"
  echo "  uninstall : Uninstall Cotiviti bundles and wait for uninstall"
  echo "  install   : Install Cotiviti bundles and wait for all to be Active"
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

MODE="$1"

if [[ "$MODE" == "uninstall" ]]; then
  echo "Uninstalling Cotiviti bundles from Karaf..."
  $KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS "feature:uninstall $FEATURES"
  echo "Uninstall command executed."

  # Wait for uninstall
  poll_attempt=0
  while [[ $poll_attempt -lt 30 ]]; do
    sleep 2
    bundle_output=$($KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS "bundle:list | grep 'he-'" 2>/dev/null)
    non_blueprint_bundles=$(echo "$bundle_output" | grep -v "\.xml")
    echo "Polling for he- product bundles to be uninstalled (attempt $((poll_attempt+1)))..."
    if [[ -z "$non_blueprint_bundles" ]]; then
      echo "All he- product bundles are uninstalled (ignoring blueprints)."
      exit 0
    fi
    poll_attempt=$((poll_attempt + 1))
  done

  echo "Timeout: he- product bundles were not uninstalled within 1 minute."
  echo "Current bundle status:"
  echo "$bundle_output"
  exit 1

elif [[ "$MODE" == "install" ]]; then
  echo "Installing Cotiviti bundles in Karaf..."
  INSTALL_CMD="feature:install he-custom-datasource-repos he-claims-tracking-schema-repos he-claim-schema-repos he-claims-we-state-events-repos he-claims-mapper-validator-repos he-claims-external-processor-repos he-claims-external-mapper-repos he-cotiviti-realtime-repos"
  $KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS "$INSTALL_CMD"
  echo "Install command executed."

  # Wait for all he- bundles to be Active
  poll_attempt=0
  while [[ $poll_attempt -lt 30 ]]; do
    sleep 2
    bundle_output=$($KARAF_CLIENT -u $KARAF_USER -p $KARAF_PASS "list | grep 'he-'" 2>/dev/null)
    active_count=$(echo "$bundle_output" | grep -v "\.xml" | grep "Active" | wc -l)
    not_active_bundles=$(echo "$bundle_output" | grep -v "Active" | grep -v "\.xml")
    echo "Polling for he- product bundles to be Active (attempt $((poll_attempt+1)))..."
    echo "Currently Active he- bundles: $active_count"
    if [[ $active_count -ge 8 && -z "$not_active_bundles" ]]; then
      echo "All he- product bundles are Active (ignoring blueprints)."
      echo "Installed he- bundles:"
      echo "$bundle_output" | grep -v "\.xml"
      exit 0
    fi
    poll_attempt=$((poll_attempt + 1))
  done

  echo "Timeout: Not all he- product bundles are Active within 1 minute."
  echo "Current bundle status:"
  echo "$bundle_output"
  exit 1

else
  usage
fi
