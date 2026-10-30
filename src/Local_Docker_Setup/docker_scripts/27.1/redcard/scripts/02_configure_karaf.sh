#!/bin/bash
set -e

echo "================================================================="
echo "Configuring Karaf with RedCard / Batch-Transaction Features (connector-25-1-4)"
echo "================================================================="

KARAF_DIR="/home/cprime/cprime/healthrules-connector-server-4.4.3"
cd "$KARAF_DIR"

CONNECTOR_USER="connector"
CONNECTOR_PASSWORD="Connector123"

OLTP_URL="jdbc:oracle:thin:@payer-db-25-1-4:1521/DB19C"
OLTP_USERNAME="PAYOR_OLTP"
OLTP_PASSWORD="hedge"

stop_karaf() {
    echo "Stopping Karaf server..."
    ./bin/stop || true
    for i in {1..12}; do
        if ! ./bin/status 2>/dev/null | grep -q "Running"; then
            break
        fi
        sleep 5
    done
    # Force kill if still alive
    if ./bin/status 2>/dev/null | grep -q "Running"; then
        echo "Karaf did not stop gracefully, force killing..."
        pkill -9 -f org.apache.karaf.main.Main || true
        sleep 5
    fi
    # Wait for SSH port to actually close so we don't talk to a dying instance
    for i in {1..12}; do
        if ! (echo > /dev/tcp/localhost/8101) 2>/dev/null; then
            break
        fi
        sleep 5
    done
    echo "Karaf stopped."
}

start_karaf() {
    echo "Starting Karaf server..."
    ./bin/start
    for i in {1..40}; do
        if ./bin/status 2>/dev/null | grep -q "Running"; then
            break
        fi
        sleep 5
    done
    ./bin/status | grep -q "Running" || { echo "ERROR: Karaf failed to start"; exit 1; }

    echo "Waiting for Karaf SSH port 8101..."
    while ! (echo > /dev/tcp/localhost/8101) 2>/dev/null; do
        sleep 2
    done
    echo "Waiting for Karaf client console to be fully responsive..."
    for i in {1..40}; do
        if echo 'list' | ./bin/client -u "$CONNECTOR_USER" -p "$CONNECTOR_PASSWORD" 2>&1 | grep -q 'for a list of available commands'; then
            echo "Karaf console is fully ready!"
            return 0
        fi
        sleep 5
    done
    echo "ERROR: Karaf console did not become responsive"
    exit 1
}

# Runs a karaf command and fails if the command reports an error
run_karaf() {
    local cmd="$1"
    local out
    out=$(echo "$cmd" | ./bin/client -u "$CONNECTOR_USER" -p "$CONNECTOR_PASSWORD" 2>&1)
    echo "$out"
    if echo "$out" | grep -qE "Error executing command|Failed to get the session"; then
        echo "ERROR: Karaf command failed: $cmd"
        return 1
    fi
    return 0
}

resolve_redcard_feature() {
    local repos_out="$1"
    if echo "$repos_out" | grep -q "he-redcard-outbound-repos"; then
        echo "he-redcard-outbound-repos"
    elif echo "$repos_out" | grep -q "he-redcard-api-repos"; then
        echo "he-redcard-api-repos"
    else
        echo ""
    fi
}

redcard_repo_registered() {
    local repos_out="$1"
    [ -n "$(resolve_redcard_feature "$repos_out")" ]
}

echo "Restarting Karaf server cleanly..."
stop_karaf
start_karaf

echo "Pre-creating custom datasource config for Spring Batch History..."
# The KAR ships this configfile with override="false", so a pre-existing file
# with the correct credentials wins over the placeholder template.
BT_CFG="etc/com.healthedge.bt.custom.datasource.db.cfg"
if [ ! -f "$BT_CFG" ] || grep -q "<username>" "$BT_CFG"; then
    cat > "$BT_CFG" <<EOF
driverClassName=oracle.jdbc.OracleDriver
url=${OLTP_URL}
username=${OLTP_USERNAME}
password=${OLTP_PASSWORD}
initialSize=5
maxIdle=5
maxTotal=20
testOnBorrow=true
testOnCreate=false
testOnReturn=false
testWhileIdle=false
validationQuery=select 1 from dual
maxWaitMillis=-1
timeBetweenEvictionRunsMillis=60000
numTestsPerEvictionRun=5
minEvictableIdleTimeMillis=-1
softMinEvictableIdleTimeMillis=180000
lifo=true
removeAbandonedOnMaintenance=false
removeAbandonedOnBorrow=false
removeAbandonedTimeout=300
logAbandoned=false
abandonedUsageTracking=false
EOF
    echo "Created $BT_CFG"
else
    echo "$BT_CFG already configured, leaving as-is."
fi

echo "Waiting for batch/redcard feature repositories to register after restart..."
REPOS_READY=false
for i in $(seq 1 60); do
    REPOS_OUT=$(echo 'feature:repo-list' | ./bin/client -u "$CONNECTOR_USER" -p "$CONNECTOR_PASSWORD" 2>&1)
    MISSING=""
    for repo in he-batch-transaction-custom-datasource-repos he-batch-transaction-schema-repos he-batch-transaction-repos; do
        if ! echo "$REPOS_OUT" | grep -q "$repo"; then
            MISSING="$MISSING $repo"
        fi
    done
    if ! redcard_repo_registered "$REPOS_OUT"; then
        MISSING="$MISSING he-redcard-(outbound|api)-repos"
    fi
    if [ -z "$MISSING" ]; then
        REPOS_READY=true
        echo "All required feature repositories are registered (after ${i}0s)."
        break
    fi
    echo "  Still waiting for repos:${MISSING} (${i}/60)"
    sleep 10
done

if [ "$REPOS_READY" != "true" ]; then
    echo "ERROR: Feature repositories did not register within 10 minutes."
    echo "       Check that KAR files are in ${KARAF_DIR}/deploy/"
    ls -la "${KARAF_DIR}/deploy/"/*.kar 2>/dev/null || echo "       (no .kar files found in deploy/)"
    echo "$REPOS_OUT"
    exit 1
fi

echo "Installing batch-transaction features..."
run_karaf "feature:install he-batch-transaction-custom-datasource-repos"
sleep 20
run_karaf "feature:install he-batch-transaction-schema-repos"
sleep 20
run_karaf "feature:install he-batch-transaction-repos"
sleep 20
sleep 60

echo "Installing RedCard feature..."
REDCARD_FEATURE=$(resolve_redcard_feature "$REPOS_OUT")
if [ -z "$REDCARD_FEATURE" ]; then
    echo "ERROR: No RedCard feature repository found (he-redcard-outbound-repos or he-redcard-api-repos)."
    exit 1
fi
echo "Using RedCard feature: $REDCARD_FEATURE"
run_karaf "feature:install $REDCARD_FEATURE"
sleep 30

echo "Installing enrollment sparse feature (optional — not required for RedCard)..."
run_karaf "feature:install connector-enrollmentsparse-repos" || {
    echo "WARN: connector-enrollmentsparse-repos could not be installed (optional)."
}

echo "Removing conflicting hibernate3 wrap bundle (from connector-1099-repos)..."
# connector-1099-repos wraps an old hibernate3 jar that exports org.hibernate.* at
# version 0.0.0. The OSGi resolver wires the he-batch-transaction bundles to it
# (lowest bundle id wins) instead of the hibernate-core 3.6.10 jar shipped in the
# batch-transaction KAR. That old jar lacks org.hibernate.cfg.AnnotationConfiguration,
# so the RedCard extract fails with NoClassDefFoundError at runtime. Uninstalling it
# lets everything rewire to hibernate-core 3.6.10 on the restart below.
HIB3_ID=$(echo 'list -s -t 0 --no-format' | ./bin/client -u "$CONNECTOR_USER" -p "$CONNECTOR_PASSWORD" 2>&1 | grep -E '\bhibernate3$' | awk '{print $1}' | head -1)
if [ -n "$HIB3_ID" ]; then
    run_karaf "bundle:uninstall $HIB3_ID"
    echo "Uninstalled hibernate3 bundle (id $HIB3_ID)."
else
    echo "hibernate3 wrap bundle not present, nothing to do."
fi

echo "Updating RedCard outbound config to use shared docker volume paths..."
# /home/cprime/shared is the docker volume mapped to %USERPROFILE%/shared/connector_env
# on the host, where the integration tests write trigger files and read extracts.
RC_CFG="etc/com.healthedge.hecommon.integration.redcard.cfg"
for i in {1..12}; do [ -f "$RC_CFG" ] && break; sleep 5; done
if [ -f "$RC_CFG" ]; then
    sed -i -e 's|^outputDirectory=.*|outputDirectory=/home/cprime/shared/redcardOutBound/output|' \
           -e 's|^tempOutputDirectory=.*|tempOutputDirectory=/home/cprime/shared/redcardOutBoundTemp/output|' \
           -e 's|^onDemandTriggerDir=.*|onDemandTriggerDir=/home/cprime/shared/onDemandTriggerDir|' \
           -e 's|^crosswalkFileLocations=.*|crosswalkFileLocations='"$KARAF_DIR"'/xml/hrp_zapp_crosswalk.xml|' "$RC_CFG"
    mkdir -p /home/cprime/shared/redcardOutBound/output \
             /home/cprime/shared/redcardOutBoundTemp/output \
             /home/cprime/shared/onDemandTriggerDir
    echo "RedCard config updated:"
    grep -E '^(outputDirectory|tempOutputDirectory|onDemandTriggerDir|crosswalkFileLocations)' "$RC_CFG"
else
    echo "WARN: $RC_CFG not found; the he-redcard-outbound-repos feature may not have materialized it."
fi

echo "Restarting Karaf for final validation..."
stop_karaf
start_karaf

echo "Waiting for start-level 100 bundles (RedCard, batch-transaction) to become Active..."
REDCARD_ACTIVE=false
for i in $(seq 1 60); do
    BUNDLE_STATE=$(echo 'list -s -t 0 --no-format' | ./bin/client -u "$CONNECTOR_USER" -p "$CONNECTOR_PASSWORD" 2>&1 | grep 'he-redcard-outbound-bundle' | awk '{print $2}' | head -1)
    if [ "$BUNDLE_STATE" = "Active" ]; then
        REDCARD_ACTIVE=true
        echo "RedCard bundle is Active (after ${i}0s)."
        break
    fi
    echo "  RedCard bundle state: ${BUNDLE_STATE:-unknown} - waiting... (${i}/60)"
    sleep 10
done

if [ "$REDCARD_ACTIVE" != "true" ]; then
    echo "WARN: RedCard bundle did not reach Active within 10 minutes; continuing validation anyway."
fi

echo "================== VALIDATION: features =================="
echo 'feature:list' | ./bin/client -u "$CONNECTOR_USER" -p "$CONNECTOR_PASSWORD" 2>&1 | grep -iE "redcard|batch-transaction|enrollmentsparse" || echo "No redcard/batch features found!"

echo "================== VALIDATION: bundles =================="
# Use -s --no-format so bundle names are not truncated by the console width
BUNDLES=$(echo 'list -s -t 0 --no-format' | ./bin/client -u "$CONNECTOR_USER" -p "$CONNECTOR_PASSWORD" 2>&1 | grep -iE "redcard|batch-transaction")
echo "$BUNDLES"

if ! echo "$BUNDLES" | grep -i "redcard" | grep -q "Active"; then
    echo "ERROR: RedCard bundle is NOT Active!"
    echo "Run 'bundle:diag <id>' in the Karaf console for details."
    exit 1
fi

NOT_ACTIVE=$(echo "$BUNDLES" | grep -vE "Active" || true)
if [ -n "$NOT_ACTIVE" ]; then
    echo "WARN: Some redcard/batch bundles are not Active:"
    echo "$NOT_ACTIVE"
fi

echo "================================================================="
echo "RedCard Karaf configuration completed successfully!"
echo "================================================================="
