#!/bin/bash
set -euo pipefail

echo "================================================================="
echo "Deploying Connector Classic in WebLogic (payer-25-1-4)"
echo "================================================================="

export JAVA_HOME=/opt/java/jdk11-current
export PATH="$JAVA_HOME/bin:$PATH"

CLASSIC_ROOT="/home/weblogic/connector-classic"
STAGING_DIR="/home/cprime/staging/cprime"

echo "Cleaning previous deployments in ${CLASSIC_ROOT}..."
rm -rf "$CLASSIC_ROOT"
mkdir -p "$CLASSIC_ROOT"

echo "Extracting Connector Classic TAR..."
CLASSIC_TAR=$(ls "${STAGING_DIR}"/connector-classic-distribution-*.tar.gz | head -n 1)
tar -xf "$CLASSIC_TAR" -C "$CLASSIC_ROOT"

CLASSIC_DIR=$(ls -d "${CLASSIC_ROOT}"/connector-classic-distribution-* | head -n 1)
cd "$CLASSIC_DIR"

echo "Patching install.sh to avoid syntax errors..."
sed -i 's/\r$//' install.sh
if ls shlib/*.sh 1> /dev/null 2>&1; then
    sed -i 's/\r$//' shlib/*.sh
fi
if ls shlib/*.py 1> /dev/null 2>&1; then
    sed -i 's/\r$//' shlib/*.py
fi

export BEA_HOME=/opt/oracle/weblogic
export WL_DOMAIN=healthedge

echo "Running install.sh..."
./install.sh

echo "Connector Classic deployed successfully into WebLogic!"
