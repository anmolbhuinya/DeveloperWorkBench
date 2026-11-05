#!/bin/bash
# deploy_connector_inside_container.sh
# Runs INSIDE the connector container.
# Usage: bash deploy_connector_inside_container.sh <DIST_DIR>
#   DIST_DIR — path to the extracted connector distribution directory
#              e.g. /home/cprime/staging/connector-distribution-27.1-SNAPSHOT

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

FEATURE_TAG='<feature'
CONFIG_TAG='configfile'
CONN_DOMAIN=/home/cprime/environments/connector

if [[ -z "$KARAF_HOME" ]]; then
    echo "ERROR: KARAF_HOME is not set. Pass it via the deployment configuration (build_deploy_config.xlsx karaf_home key)."
    exit 1
fi
if [[ -z "$JAVA_HOME" ]]; then
    echo "ERROR: JAVA_HOME is not set. Pass it via the deployment configuration (build_deploy_config.xlsx java_home key)."
    exit 1
fi
export JAVA_HOME

# Karaf's bin scripts (setenv etc.) may hard-code a JDK path that does not exist in this container
# (e.g. /opt/java/jdk21-current -> "JAVA_HOME is not valid", Karaf never starts). Point them at the configured JAVA_HOME.
fixKarafJavaHome() {
    [[ -d "$KARAF_HOME/bin" && -d "$JAVA_HOME" ]] || return 0
    local f p
    for f in "$KARAF_HOME"/bin/setenv "$KARAF_HOME"/bin/*-service* "$KARAF_HOME"/bin/*.conf "$KARAF_HOME"/bin/karaf-wrapper*; do
        [[ -f "$f" ]] || continue
        for p in $(grep -oE '(/[A-Za-z0-9._-]+)+/(jdk|java|jre)[A-Za-z0-9._-]*' "$f" 2>/dev/null | sort -u); do
            if [[ "$p" != "$JAVA_HOME" && ! -d "$p" && "$p" == /opt/java/* ]]; then
                echo "Fixing stale JAVA_HOME ($p) in $f, using $JAVA_HOME instead"
                sed -i "s|$p|$JAVA_HOME|g" "$f"
            fi
        done
    done
}
ALL_CONFIG_FILE=${CONN_DOMAIN}/allFeatures.properties
OLTP_HOST=payer-db-261
OLTP_DB=DB19C
OLTP_USER=PAYOR_OLTP
OLTP_PASSWORD=hedge
DW_HOST=payer-db-261
DW_DB=DB19C
DW_USER=PAYOR_DW
DW_PASSWORD=hedge
PAYER_CONTAINER=payer-tc-261

echo "================================================================"
echo " Connector deploy: $DIST_DIR"
echo "================================================================"

killServer() {
    CONNECTOR_SERVER_PID=$(ps -ef | grep karaf.main.Main | grep -v grep | awk '{print $2}')
    if [[ -n "$CONNECTOR_SERVER_PID" ]]; then
        echo "Killing Connector Server PID $CONNECTOR_SERVER_PID"
        kill -9 $CONNECTOR_SERVER_PID
    fi
    sleep 10
}

karafRunning() {
    $KARAF_HOME/bin/status 2>/dev/null | grep -q "Running \.\.\."
}

stopConnectorServer() {
    echo "Stopping connector server ..."
    fixKarafJavaHome
    if [[ -d "$KARAF_HOME/bin" ]]; then
        sh $KARAF_HOME/bin/stop 2>/dev/null || true
        START_COUNT=0
        while karafRunning; do
            START_COUNT=$((START_COUNT + 1))
            sleep 5
            [[ $START_COUNT -ge 10 ]] && break
        done
    fi
    killServer
}

startConnectorServer() {
    echo "Starting connector server ..."
    fixKarafJavaHome
    $KARAF_HOME/bin/start
    sleep 90
    START_COUNT=0
    while ! karafRunning; do
        START_COUNT=$((START_COUNT + 1))
        echo "Waiting for Karaf... ($START_COUNT)"
        sleep 20
        if [[ $START_COUNT -ge 30 ]]; then
            echo "ERROR: Connector Server did not start."
            exit 204
        fi
    done
    echo "Connector Server is Running."
}

cleanServer() {
    echo "Cleaning connector server ..."
    stopConnectorServer
    for dir in data install connector-blueprints-deploy custom-blueprints-deploy log datasources xml; do
        [[ -d "$KARAF_HOME/$dir" ]] && rm -rf "$KARAF_HOME/$dir"/* || true
    done
    rm -f "$KARAF_HOME/lock" || true
    rm -rf "$KARAF_HOME/etc/com.healthedge.connector.*.cfg" || true
    startConnectorServer
}

generateAllFeatureFile() {
    FEATURE_DIRECTORY="$DIST_DIR/features"
    mkdir -p "$CONN_DOMAIN"
    rm -f "$ALL_CONFIG_FILE"
    touch "$ALL_CONFIG_FILE"
    if [[ -d "$FEATURE_DIRECTORY" ]]; then
        for file in "$FEATURE_DIRECTORY"/*.kar; do
            [[ -e "$file" ]] || { echo "No .kar files in $FEATURE_DIRECTORY"; break; }
            file_name=$(basename "$file")
            basename=$(echo "$file_name" | sed -E 's/(.*repos).*/\1/')
            echo "$basename" >> "$ALL_CONFIG_FILE"
        done
    else
        echo "ERROR: Connector distribution features directory not found: $FEATURE_DIRECTORY"
        exit 1
    fi
}

readFeaturesXML() {
    local IFS=\>
    read -d \< ENTITY CONTENT
    local ret=$?
    TAG_NAME=${ENTITY%% *}
    ATTRIBUTES=${ENTITY#* }
    return $ret
}

parseFeaturesXML() {
    cfg=''
    if [[ $TAG_NAME == "$CONFIG_TAG" ]]; then
        eval local "${ATTRIBUTES}" 2>/dev/null || true
        if [[ $finalname == *".cfg" ]]; then
            texts=$(echo $CONTENT | tr "/" "\n")
            for text in $texts; do
                [[ $text == 'mvn:'* || $text == 'cfg' ]] && continue
                cfg=${cfg:+$cfg-}$text
            done
            configFileName=${finalname:4}
            configPath=$(find "$1" -name "$cfg.cfg" 2>/dev/null | head -1)
            [[ -f "$configPath" ]] || return 0
            while IFS= read -r line || [[ -n "$line" ]]; do
                [[ ${line:0:1} == '#' || -z "$line" ]] && continue
                lineKey=$(echo "$line" | cut -d'=' -f1)
                fileNameWithKey="$configFileName;$lineKey"
                [[ $(echo "${#line}" | xargs) -eq 0 ]] && continue
                grep -qF "$fileNameWithKey" "$generated_config" 2>/dev/null && continue
                echo "$configFileName;$line" >> "$generated_config"
            done < "$configPath"
        fi
    fi
}

readFeatureTagFromFeatureXML() {
    for i in $(find "$DIST_DIR" -name "$1*.kar" -type f 2>/dev/null); do
        [[ " ${connectorFeatures[*]} " =~ " ${1} " ]] && continue
        local karFileNameWithVersion=$(basename "$i")
        unzip -q -o "$i" -d "$(dirname "$i")/${1}" 2>/dev/null || true
        local feature="${karFileNameWithVersion%%.kar*}"
        local featuresXMLPath=$(find "$(dirname "$i")/${1}/repository/com/healthedge" -name "$feature-features.xml" 2>/dev/null | head -1)
        if [[ -f "$featuresXMLPath" ]]; then
            local contents=($(grep "$FEATURE_TAG" "$featuresXMLPath" | cut -f2 -d'>' | cut -f1 -d'<'))
            connectorFeatures=("${1}" "${connectorFeatures[@]}")
            for j in "${contents[@]}"; do
                [[ $j == *"-repos" ]] && readFeatureTagFromFeatureXML "$j"
            done
        fi
    done
}

generateConfig() {
    PROP_FILE=$1
    echo "Generating connector config files from $PROP_FILE"
    connectorFeatures=()
    count=0
    generated_config="${CONN_DOMAIN}/features_configs_generated.properties"
    rm -f "$generated_config"
    touch "$generated_config"

    while IFS= read -r line; do
        readFeatureTagFromFeatureXML "$line"
    done < "$PROP_FILE"

    for l in "${connectorFeatures[@]}"; do
        i=$(find "$DIST_DIR" -name "${l}*.kar" -type f 2>/dev/null | head -1)
        [[ -z "$i" ]] && continue
        karFileNameWithVersion=$(basename "$i")
        karFileWithNoVersion="${karFileNameWithVersion%%repos*}repos"
        unzip -q -o "$i" -d "$(dirname "$i")/${karFileWithNoVersion}" 2>/dev/null || true
        feature="${karFileNameWithVersion%%.kar*}"
        featuresXMLPath=$(find "$(dirname "$i")/${karFileWithNoVersion}/repository/com/healthedge" -name "$feature-features.xml" 2>/dev/null | head -1)
        if [[ -f "$featuresXMLPath" ]]; then
            dirPath=$(dirname "$i")/${karFileWithNoVersion}/repository/com/healthedge
            while readFeaturesXML; do
                parseFeaturesXML "$dirPath" "$count"
            done < "$featuresXMLPath"
        fi
    done

    # Update DB/server connection config values
    sed -i "s|com.healthedge.connector.payor.oltp.cfg;url=.*|com.healthedge.connector.payor.oltp.cfg;url=jdbc:oracle:thin:@${OLTP_HOST}:1521/${OLTP_DB}|g" "$generated_config" 2>/dev/null || true
    sed -i "s|com.healthedge.connector.payor.oltp.cfg;username=.*|com.healthedge.connector.payor.oltp.cfg;username=${OLTP_USER}|g" "$generated_config" 2>/dev/null || true
    sed -i "s|com.healthedge.connector.payor.oltp.cfg;password=.*|com.healthedge.connector.payor.oltp.cfg;password=${OLTP_PASSWORD}|g" "$generated_config" 2>/dev/null || true
    sed -i "s|com.healthedge.connector.dw.cfg;url=.*|com.healthedge.connector.dw.cfg;url=jdbc:oracle:thin:@${DW_HOST}:1521:${DW_DB}|g" "$generated_config" 2>/dev/null || true
    sed -i "s|com.healthedge.connector.dw.cfg;username=.*|com.healthedge.connector.dw.cfg;username=${DW_USER}|g" "$generated_config" 2>/dev/null || true
    sed -i "s|com.healthedge.connector.dw.cfg;password=.*|com.healthedge.connector.dw.cfg;password=${DW_PASSWORD}|g" "$generated_config" 2>/dev/null || true
    sed -i "s|com.healthedge.connector.payor.cfg;wls.address=.*|com.healthedge.connector.payor.cfg;wls.address=${PAYER_CONTAINER}|g" "$generated_config" 2>/dev/null || true
    sed 's/\r//g' "$generated_config" > "${generated_config}_tmp" && mv "${generated_config}_tmp" "$generated_config"

    tmp_cfg="${CONN_DOMAIN}/temp-cfg"
    mkdir -p "$tmp_cfg"
    configFiles=()
    while IFS=';' read -r configFileName keyValue; do
        trimLine=$(echo "$configFileName" | xargs)
        [[ $configFileName == \#* || -z "$configFileName" || ${#trimLine} -eq 0 ]] && continue
        [[ " ${configFiles[*]} " =~ " ${configFileName} " ]] || configFiles+=("$configFileName")
    done < "$generated_config"
    for configFile in "${configFiles[@]}"; do
        touch "${tmp_cfg}/${configFile}"
        chmod 755 "${tmp_cfg}/${configFile}"
        grep "$configFile;" "$generated_config" | cut -d';' -f2 > "${tmp_cfg}/${configFile}"
    done
    cp -f "${tmp_cfg}"/*.cfg "$KARAF_HOME/etc/" 2>/dev/null || true
    rm -rf "$tmp_cfg" "$generated_config"
    echo "Config files applied."
}

installFeatures() {
    PROP_FILE=$1
    FEATURE_LIST=""
    filecontent=($(cat "$PROP_FILE"))
    for j in "${filecontent[@]}"; do
        [[ $j == \#* || -z "$j" ]] && continue
        [[ $j == connector-camel-util-repos ]] && continue
        [[ $j == connector* ]] && FEATURE_LIST="$FEATURE_LIST $j "
    done
    [[ -z "$FEATURE_LIST" ]] && { echo "ERROR: No features found."; exit 1; }

    echo "***** Adding Connector Distribution ******"
    echo "hrc:add-distribution $DIST_DIR" | ${KARAF_HOME}/bin/client -u connector -p Connector123
    sleep 90

    echo "**** Installing Connector Features ****"
    feature_install_info=$(echo "feature:install -r $FEATURE_LIST" | ${KARAF_HOME}/bin/client -u connector -p Connector123 | tee /dev/tty)
    err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n 's/^.*\(connector-.*repos\).*$/\1/p')
    while [[ -n "$err_feature" ]]; do
        FEATURE_LIST="${FEATURE_LIST//$err_feature /}"
        feature_install_info=$(echo "feature:install -r $FEATURE_LIST" | ${KARAF_HOME}/bin/client -u connector -p Connector123)
        err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n 's/^.*\(connector-.*repos\).*$/\1/p')
    done

    stopConnectorServer
    startConnectorServer
    sleep 90

    failed_bundle_info=$(echo "bundle:list" | ${KARAF_HOME}/bin/client -u connector -p Connector123 2>/dev/null | grep -E "Resolved|Failure" || true)
    [[ -n "$failed_bundle_info" ]] && echo -e "Bundles not started:\n$failed_bundle_info"
}

# ── Main ──────────────────────────────────────────────────
cleanServer
generateAllFeatureFile
generateConfig "$ALL_CONFIG_FILE"
installFeatures "$ALL_CONFIG_FILE"
echo "================================================================"
echo " Connector deployment complete."
echo "================================================================"
