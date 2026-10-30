#!/bin/bash
# deploy_pik_inside_container.sh
# Runs inside the PIK container (copied to staging dir by refresh_app.js).
# Moves the tarball to pik-installer and invokes deployPikTomcat.sh.

set -uo pipefail

STAGING_DIR="$(cd "$(dirname "$0")" && pwd)"
PIK_INSTALLER_DIR="/home/weblogic/install/pik-installer"

# Locate the tarball dropped next to this script
TARBALL="$(ls "$STAGING_DIR"/portal-integration-kit-*.tar.gz 2>/dev/null | head -n1)"
if [ -z "$TARBALL" ]; then
  echo "[error] No portal-integration-kit-*.tar.gz found in $STAGING_DIR"
  exit 1
fi

echo "[pik-deploy] tarball : $TARBALL"
echo "[pik-deploy] target  : $PIK_INSTALLER_DIR"

# Clear previous build artefacts, copy new tarball
rm -f "$PIK_INSTALLER_DIR"/portal-integration-kit-*.tar.gz
rm -f "$PIK_INSTALLER_DIR"/portal-integration-kit-*.zip
cp "$TARBALL" "$PIK_INSTALLER_DIR/"
echo "[pik-deploy] copied tarball to $PIK_INSTALLER_DIR"

# Default env vars — override in build_deploy_config.xlsx (deploy sheet) if needed
export WL_PROPERTIES="${WL_PROPERTIES:-/home/weblogic/dev-tools/docker/payor/tomcat/wl.properties}"
export PAYER_HOST="${PAYER_HOST:-payer-tc-261}"
export DB_HOST="${DB_HOST:-pik-db}"
export ARTEMIS_URL="${ARTEMIS_URL:-tcp://payer-tc-261:61619}"

echo "[pik-deploy] WL_PROPERTIES : $WL_PROPERTIES"
echo "[pik-deploy] PAYER_HOST    : $PAYER_HOST"
echo "[pik-deploy] DB_HOST       : $DB_HOST"
echo "[pik-deploy] ARTEMIS_URL   : $ARTEMIS_URL"

DEPLOY_SCRIPT="/home/weblogic/deployPikTomcat.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
  echo "[error] $DEPLOY_SCRIPT not found in container"
  exit 1
fi

echo "[pik-deploy] running deployPikTomcat.sh ..."
exec bash "$DEPLOY_SCRIPT"
