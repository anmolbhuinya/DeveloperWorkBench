#!/bin/bash
set -euo pipefail

echo "================================================================="
echo "Installing Payor Base and Upgrading Database (payer-25-1-4)"
echo "================================================================="

ENV_PATH="/home/weblogic/environments"
TAR_PATH=$(ls /home/cprime/staging/cprime/core-distribution-*.tar.gz 2>/dev/null | head -n 1)
if [ -z "$TAR_PATH" ]; then
    echo "ERROR: No core-distribution-*.tar.gz found in /home/cprime/staging/cprime/"
    exit 1
fi
TAR_NAME=$(basename "$TAR_PATH")

echo "Extracting Payor TAR inside staging ($TAR_NAME)..."
rm -rf /home/weblogic/staging
mkdir -p /home/weblogic/staging
cp "$TAR_PATH" /home/weblogic/staging/
cp /home/cprime/staging/cprime/wl.properties /home/weblogic/staging/

cd /home/weblogic/staging
tar -xf "$TAR_NAME"

echo "Copying to environments folder..."
rm -rf "${ENV_PATH}/healthedge"
cp -r healthedge/ "${ENV_PATH}/healthedge"
cp wl.properties "${ENV_PATH}/healthedge/"

echo "Converting files to UNIX format..."
cd /home/weblogic/staging && find . -type f -exec dos2unix {} +
cd "${ENV_PATH}/healthedge" && find . -type f -exec dos2unix {} +

echo "Installing Payor 25.1.4..."
cd "${ENV_PATH}/healthedge/payor-utils" && chmod +x install.sh
cd "${ENV_PATH}/healthedge/claimserver"
chmod +x install.sh
./install.sh --full -n -w ../wl.properties

echo "Upgrading OLTP Database..."
cd "${ENV_PATH}/healthedge/ddl/oltp"
chmod +x upgrade-oltp.sh
./upgrade-oltp.sh upgrade.xml clearCheckSums
./upgrade-oltp.sh upgrade.xml releaseLocks
./upgrade-oltp.sh

echo "Upgrading DW Database..."
cd "${ENV_PATH}/healthedge/ddl/dw"
chmod +x upgrade-dw.sh
./upgrade-dw.sh upgrade.xml clearCheckSums
./upgrade-dw.sh upgrade.xml releaseLocks
./upgrade-dw.sh

echo "Starting WebLogic Server in the background..."
export WLS_DEBUG=true
export ENABLE_REMOTE_DEBUG=true
cd /opt/oracle/weblogic/user_projects/domains/healthedge
nohup ./start_server.sh > start_wls.log 2>&1 &

echo "Payor Base Setup Completed Successfully!"
