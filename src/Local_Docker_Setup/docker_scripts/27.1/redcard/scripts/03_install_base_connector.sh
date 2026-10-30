#!/bin/bash
set -eo pipefail

echo "================================================================="
echo "Installing base Connector server (connector-25-1-4)"
echo "================================================================="

# Parse command line arguments
SKIP_CONNECTOR_PATCH=false
PAYER_CONTAINER="payer-25-1-4"  # Default payer container name
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-connector-patch|--no-connector-patch|-p)
            SKIP_CONNECTOR_PATCH=true
            shift
            ;;
        --payer-container)
            if [[ -n "$2" && "$2" != -* ]]; then
                PAYER_CONTAINER="$2"
                shift 2
            else
                echo "ERROR: --payer-container requires a container name"
                exit 1
            fi
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --skip-connector-patch, --no-connector-patch, -p    Skip applying connector server patch"
            echo "  --payer-container <name>                            Specify the payer container name (default: ${PAYER_CONTAINER})"
            echo "  -h, --help                                          Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

FEATURE_TAG='<feature'
CONFIG_TAG='configfile'

mkdir -p /home/cprime/staging/distribution
CONN_TAR=$(ls /home/cprime/staging/cprime/connector-distribution-*.tar.gz | head -n 1)
tar -xf "$CONN_TAR" -C /home/cprime/staging/distribution

KARAF_HOME=/home/cprime/cprime/healthrules-connector-server-4.4.3
DIST_DIR=$(ls -d /home/cprime/staging/distribution/connector-distribution-* | head -n 1)
ENROLLMENT_DIST_DIR=""
CONN_DOMAIN=/home/cprime/environments/connector
INSTALLER_PATCH_DIR=/home/cprime/installer-patch
ALL_CONFIG_FILE=/home/cprime/environments/connector/allFeatures.properties

mkdir -p /home/cprime/environments/connector

OLTP_HOST="${OLTP_HOST:-payer-db-25-1-4}"
OLTP_DB="${OLTP_DB:-DB19C}"
OLTP_USER="${OLTP_USER:-PAYOR_OLTP}"
OLTP_PASSWORD="${OLTP_PASSWORD:-hedge}"
DW_HOST="${DW_HOST:-payer-db-25-1-4}"
DW_DB="${DW_DB:-DB19C}"
DW_USER="${DW_USER:-PAYOR_DW}"
DW_PASSWORD="${DW_PASSWORD:-hedge}"

EXCLUDED_FEATURES=("connector-activemq-repos" "connector-apache-camel-repos" "connector-cellar-repos" "connector-cxf-repos" "connector-spring-repos" "connector-cave-repos")

# Function to apply connector server patch
applyConnectorPatch() {
    local patchVersion="4.4.3-1.7.5"
    local patchName="connector-installer-patch-${patchVersion}.tar.gz"

    if [[ ! -d "${INSTALLER_PATCH_DIR}" ]] || [[ ! -f "${INSTALLER_PATCH_DIR}/${patchName}" ]]; then
        echo "Installer patch directory or patch file not found. Skipping patch."
        return 0
    fi

    stopConnectorServer
    echo "****************************************************************"
    echo "Applying connector server patch version ${patchVersion}"
    echo "****************************************************************"

    echo "Unpacking and installing installer patch"
    cd "${INSTALLER_PATCH_DIR}" || exit 1
    tar xzpf "${INSTALLER_PATCH_DIR}/${patchName}"
    cd "${INSTALLER_PATCH_DIR}/connector-installer-patch-${patchVersion}" || exit 2

    # Define the script name
    local patchScript="connector-server-patch.sh"
    # Check if the script is present in the current directory
    if [[ -f "${patchScript}" ]]; then
        sh connector-server-patch.sh "${KARAF_HOME}"
        echo "The implementation of the connector-server patch has been successfully completed."
        echo "Please review the connector-server-patch.log file to verify the logs pertaining to the patch installation process."
    else
        echo "The script ${patchScript} is not found."
    fi

    # Clean up patch directory
    cd "${INSTALLER_PATCH_DIR}" || exit 2
    rm -rf "${INSTALLER_PATCH_DIR}/connector-installer-patch-${patchVersion}"
    startConnectorServer
}

# Function to kill the server process
killServer() {
    CONNECTOR_SERVER_PID=$(ps -ef | grep karaf.main.Main | grep -v grep | awk '{print $2}')
    if [ "X${CONNECTOR_SERVER_PID}" != "X" ]; then
        echo "Killing Connector Server PID $CONNECTOR_SERVER_PID"
        kill -9 $CONNECTOR_SERVER_PID
    fi
    sleep 10
}

# Function to stop the connector server
stopConnectorServer() {
    echo "Stopping connector server ..."
    if [[ -d "$KARAF_HOME/bin" ]]; then
        sh $KARAF_HOME/bin/stop
        CONNECTOR_SERVER_STATUS=$($KARAF_HOME/bin/status)
        START_COUNT=0

        while [ "$CONNECTOR_SERVER_STATUS" = "Running ..." ]; do
            START_COUNT=$((START_COUNT + 1))
            sleep 5
            if [ $START_COUNT -eq 10 ]; then
                break
            fi
            CONNECTOR_SERVER_STATUS=$($KARAF_HOME/bin/status)
        done
    fi

    killServer
}

# Function to clean the server
cleanServer() {
    echo "Cleaning connector server ..."

    stopConnectorServer
    cd "${KARAF_HOME}/data" || exit 2
    rm -rf *
    cd "${KARAF_HOME}/install" || exit 2
    rm -rf *
    cd "${KARAF_HOME}/connector-blueprints-deploy" || exit 2
    rm -rf *
    cd "${KARAF_HOME}/custom-blueprints-deploy" || exit 2
    rm -rf *
    cd "${KARAF_HOME}/log" || exit 2
    rm -rf *
    cd "${KARAF_HOME}/datasources" || exit 2
    rm -rf *
    cd "${KARAF_HOME}/xml" || exit 2
    rm -rf *
    rm "${KARAF_HOME}/lock"
    rm -rf "${KARAF_HOME}/etc/com.healthedge.connector."*.cfg
    startConnectorServer
}

# Function to start the connector server
startConnectorServer() {
    echo "Starting connector server ..."
    $KARAF_HOME/bin/start
    sleep 45
    CONNECTOR_SERVER_STATUS=$($KARAF_HOME/bin/status)
    echo "Connector Server at $KARAF_HOME has status of $CONNECTOR_SERVER_STATUS"
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

    echo "Waiting for Karaf SSH port 8101 to open..."
    while ! (echo > /dev/tcp/localhost/8101) 2>/dev/null; do
      sleep 5
    done
    
    echo "Waiting for Karaf client console to be fully responsive..."
    for i in {1..40}; do
        if echo 'list' | ${KARAF_HOME}/bin/client -u connector -p Connector123 2>&1 | grep -q 'for a list of available commands'; then
            echo "Karaf console is fully ready!"
            break
        fi
        sleep 5
    done
}

generateAllFeatureFile() {
    # Check if the file exists and create it if it doesn't
    if [[ ! -f "$ALL_CONFIG_FILE" ]]; then
      touch "$ALL_CONFIG_FILE"
    else
      rm -f $ALL_CONFIG_FILE
      touch "$ALL_CONFIG_FILE"
    fi

    for DIR in "$DIST_DIR" "$ENROLLMENT_DIST_DIR"; do
      if [ -n "$DIR" ]; then
        if [ -d "$DIR/repos" ]; then
          for file in "$DIR/repos"/*.jar; do
            if [ -e "$file" ]; then
              file_name=$(basename "$file")
              basename=$(echo "$file_name" | sed -E 's/(.*repos).*/\1/')
              echo "$basename" >> $ALL_CONFIG_FILE
            fi
          done
        fi
        if [ -d "$DIR/features" ]; then
          for file in "$DIR/features"/*.kar; do
            if [ -e "$file" ]; then
              file_name=$(basename "$file")
              basename=$(echo "$file_name" | sed -E 's/(.*repos).*/\1/')
              echo "$basename" >> $ALL_CONFIG_FILE
            fi
          done
        fi
      fi
    done
  }

parseFeaturesXML () {
    cfg=''
    if [[ $TAG_NAME = "${CONFIG_TAG}" ]] ; then
        eval local "${ATTRIBUTES}"
        if [[ $finalname = *".cfg" ]]; then
           texts=$(echo $CONTENT | tr "/" "\n")
           for text in $texts
               do
                   if [[ $text == 'mvn:'* ]] || [[ $text == 'cfg' ]]; then
                       continue
                   else
                       if [[ $cfg == '' ]]; then
                           cfg=$text
                       else
                           cfg=$cfg-$text
                       fi
                    fi
           done
           configFileName=${finalname:4}
           configPath=$(find $1 -name $cfg.cfg)
           while IFS= read -r line || [[ -n "$line" ]]; do
              if [[ ${line:0:1} == '#' ]] || [[ -z "$line" ]]; then # skip if the line starts with # or its empty
                continue
              else
                lineKey=$(echo $line | cut -d '=' -f 1)
                fileNameWithKey="$configFileName;$lineKey"
                fileNameWithKeyValue="$configFileName;$line"
                trimLine=$(echo $line | xargs)
                length=${#trimLine}
                if [[ $length = 0 ]] || grep -qF "$fileNameWithKey" $generated_config; then
                    continue
                fi
                if [[ $count = 0 ]]; then
                    echo "#########################################################################################################">> $generated_config
                    echo "############################## New connector configuration properties ###################################">> $generated_config
                    echo "#########################################################################################################">> $generated_config
                    count=1
                fi
                echo "$fileNameWithKeyValue" >> $generated_config
              fi
           done < $configPath
        fi
    fi
}

readFeatureTagFromFeatureXML () {
    for i in `find ${DIST_DIR} ${ENROLLMENT_DIST_DIR} -name "$1*.jar" -o -name "$1*.kar" -type f 2>/dev/null`; do
        if [[ " ${connectorFeatures[@]} " =~ " ${1} " ]]; then
            continue;
        fi
        local karFileNameWithVersion=$(basename $i)
        unzip -q -o $i -d $(dirname $i)/${1}
        local feature=${karFileNameWithVersion%%.kar*}
        feature=${feature%%.jar*}
        local featuresXMLPath=$(find $(dirname $i)/${1}/repository/ -name "*-features.xml" 2>/dev/null | head -n 1)
        if [ -f $featuresXMLPath ]; then
            local contents=($(grep $FEATURE_TAG $featuresXMLPath | cut -f2 -d">"|cut -f1 -d"<"))
            connectorFeatures=("${1}" "${connectorFeatures[@]}")
            for j in "${contents[@]}" ; do
               if [[ $j == *"-repos" ]]; then
                 readFeatureTagFromFeatureXML $j
              fi
            done
        fi
    done
}

readFeaturesXML () {
    local IFS=\>
    read -d \< ENTITY CONTENT
    local ret=$?
    TAG_NAME=${ENTITY%% *}
    ATTRIBUTES=${ENTITY#* }
    return $ret
}

# Function to generate configuration files based on a properties file
generateConfig() {
    PROP_FILE=$1
    echo "Auto generating connector config files based on $PROP_FILE"
    connectorFeatures=()
    count=0
    retval=$?
    generated_config=${CONN_DOMAIN}/features_configs_generated.properties

    # Delete if generated config file exists
    if [ -f $generated_config ]; then
        rm -f $generated_config
    fi
    if [ $retval -ne 0 ]; then
        echo "CRITICAL: Failed to delete ${generated_config} file"
        exit $retval
    fi

    # Create an empty generated config file
    touch $generated_config
    if [ $retval -ne 0 ]; then
        echo "CRITICAL: Failed to create an empty ${generated_config} file."
        exit $retval
    fi

    while IFS= read -r line; do
        readFeatureTagFromFeatureXML $line
    done < "$PROP_FILE"

    for l in "${connectorFeatures[@]}"; do
        i=$(find ${DIST_DIR} ${ENROLLMENT_DIST_DIR} -name "${l}*.jar" -o -name "${l}*.kar" -type f 2>/dev/null | head -1)
        karFileNameWithVersion=$(basename $i)
        karFileWithNoVersion=${karFileNameWithVersion%%repos*}repos
        unzip -q -o $i -d $(dirname $i)/${karFileWithNoVersion}
        feature=${karFileNameWithVersion%%.kar*}
        feature=${feature%%.jar*}
        featuresXMLPath=$(find $(dirname $i)/${karFileWithNoVersion}/repository/ -name "*-features.xml" 2>/dev/null | head -n 1)
        if [ -n "$featuresXMLPath" ] && [ -f "$featuresXMLPath" ]; then
            dirPath=$(dirname $i)/${karFileWithNoVersion}/repository/
            while readFeaturesXML; do
                parseFeaturesXML $dirPath $count
            done < $featuresXMLPath
        fi
    done

    if grep -qF "com.healthedge.connector.payor.oltp.cfg;url=" $generated_config; then
        sed -i 's/com.healthedge.connector.payor.oltp.cfg;url=.*/com.healthedge.connector.payor.oltp.cfg;url='"jdbc:oracle:thin:@${OLTP_HOST}:1521\/${OLTP_DB}"'/g' $generated_config
    fi
    if grep -qF "com.healthedge.connector.payor.oltp.cfg;username=" $generated_config; then
        sed -i 's/com.healthedge.connector.payor.oltp.cfg;username=.*/com.healthedge.connector.payor.oltp.cfg;username='"${OLTP_USER}"'/g' $generated_config
    fi
    if grep -qF "com.healthedge.connector.payor.oltp.cfg;password=" $generated_config; then
        sed -i 's/com.healthedge.connector.payor.oltp.cfg;password=.*/com.healthedge.connector.payor.oltp.cfg;password='"${OLTP_PASSWORD}"'/g' $generated_config
    fi
    if grep -qF "com.healthedge.connector.dw.cfg;url=" $generated_config; then
        sed -i 's/com.healthedge.connector.dw.cfg;url=.*/com.healthedge.connector.dw.cfg;url='"jdbc:oracle:thin:@${DW_HOST}:1521\/${DW_DB}"'/g' $generated_config
    fi
    if grep -qF "com.healthedge.connector.dw.cfg;username=" $generated_config; then
        sed -i 's/com.healthedge.connector.dw.cfg;username=.*/com.healthedge.connector.dw.cfg;username='"${DW_USER}"'/g' $generated_config
    fi
    if grep -qF "com.healthedge.connector.dw.cfg;password=" $generated_config; then
        sed -i 's/com.healthedge.connector.dw.cfg;password=.*/com.healthedge.connector.dw.cfg;password='"${DW_PASSWORD}"'/g' $generated_config
    fi
    if grep -qF "com.healthedge.connector.payor.cfg;wls.address=" $generated_config; then
        sed -i 's/com.healthedge.connector.payor.cfg;wls.address=.*/com.healthedge.connector.payor.cfg;wls.address='"${PAYER_CONTAINER}"'/g' $generated_config
    fi

    sed 's/\r//g' ${generated_config} > ${generated_config}_tmp
    mv ${generated_config}_tmp ${generated_config}
    echo "Generated config file created ..."

    configFiles=()
    tmp_cfg=${CONN_DOMAIN}/temp-cfg
    mkdir -p $tmp_cfg
    while IFS=';' read -r configFileName keyValue; do
        trimLine=$(echo $configFileName | xargs)
        length=${#trimLine}
        if [[ $configFileName == \#* ]] || [[ -z "$configFileName" ]] || [[ $length = 0 ]]; then
            continue
        fi
        inArray=$(echo ${configFiles[@]} | grep -o "$configFileName" | wc -w)
        if [[ $inArray = 0 ]]; then
            configFiles+=("$configFileName")
        fi
    done < $generated_config

    for configFile in "${configFiles[@]}"; do
        touch ${tmp_cfg}/${configFile}
        chmod 755 ${tmp_cfg}/${configFile}
        grep "$configFile;" $generated_config | cut -d ";" -f2 > ${tmp_cfg}/${configFile}
    done
    echo "Individual Config files created ..."
    if [[ ! -d "/home/cprime/environments/connector/temp-cfg" ]]; then
        echo "Directory /home/cprime/environments/connector/temp-cfg does not exist."
    fi
    cp -f ${tmp_cfg}/*.cfg $KARAF_HOME/etc/

    rm -rf $tmp_cfg
    rm -rf $generated_config
}

function installFeatures(){
    PROP_FILE=$1
    FEATURE_LIST=""
    COMMON_LIST="healthrules-payor-support healthrules-caremanager-support"
    filecontent=( `cat "$PROP_FILE" `)
    foundCamelUtil=false
    for j in "${filecontent[@]}"
    do
          if [[ $j == \#* ]] || [[ -z "$j" ]]; then # skip if the line starts with # or its empty
                continue
          fi
          if [[ ($j = connector-camel-util-repos) ]]; then
              foundCamelUtil=true
              continue
          fi
          if [[ ($j = connector*) ]]
          then
              is_excluded=false
              for feature in "${EXCLUDED_FEATURES[@]}"; do
                  if [[ "$j" == "$feature" ]]; then
                      is_excluded=true
                      break
                  fi
              done

              if [[ "$is_excluded" == false ]]; then
                  FEATURE_LIST="$FEATURE_LIST $j "
              fi
          elif [[ ($j = $CUST_NAME*) ]]
          then
              continue
          elif [[ ! -z "$j" ]]
          then
              COMMON_LIST="$COMMON_LIST $j "
          fi
    done

    echo "***** Adding Connector Distribution ******"
    echo "hrc:add-distribution $DIST_DIR" | ${KARAF_HOME}/bin/client -u connector -p Connector123
    if [ -n "$ENROLLMENT_DIST_DIR" ]; then
        echo "hrc:add-distribution $ENROLLMENT_DIST_DIR" | ${KARAF_HOME}/bin/client -u connector -p Connector123
    fi
    sleep 90

    if [[ -z $FEATURE_LIST ]]; then
        FEATURE_LIST=$COMMON_LIST
    else
        FEATURE_LIST="$FEATURE_LIST $COMMON_LIST"
    fi

    if [[ -z $(echo "$FEATURE_LIST" | xargs) ]]; then
        echo "No features to explicitly install from distribution. Skipping feature:install."
    else
        echo "**** Installing Connector Features ****"
        feature_install_info=$(echo "feature:install -r $FEATURE_LIST" | ${KARAF_HOME}/bin/client -u connector -p Connector123)
        err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
        err_feature_list=""
        while [[ -n "$err_feature" ]]; do
            err_feature_list+="$err_feature\n"
            FEATURE_LIST=${FEATURE_LIST//$err_feature /}
            feature_install_info=$(echo "feature:install -r $FEATURE_LIST" | ${KARAF_HOME}/bin/client -u connector -p Connector123)
            err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
        done

        if [[ -n "$err_feature_list" ]]; then
            echo "****************************************************************"
            echo -e "Failed to install the following features: \n"
            echo -e $err_feature_list
        fi
    fi

    stopConnectorServer
    startConnectorServer

    sleep 90
    failed_bundle_info=$(echo 'list' | ${KARAF_HOME}/bin/client -u connector -p Connector123 | grep -E "Resolved|Failure")
    if [[ -n "$failed_bundle_info" ]]; then
        echo -e "Failed to start the following bundles in the server: \n"
        echo "$failed_bundle_info"
        echo "===================================================================================================="
    fi
}

# Main script execution
cleanServer
generateAllFeatureFile
generateConfig $ALL_CONFIG_FILE
if [[ "$SKIP_CONNECTOR_PATCH" == false ]]; then
    applyConnectorPatch
else
    echo "========================================="
    echo "Skipping connector patch application"
    echo "========================================="
fi
installFeatures $ALL_CONFIG_FILE

echo "Deploying custom KAR files (RedCard, Batch Txn)..."
if ls /home/cprime/staging/cprime/*.kar 1> /dev/null 2>&1; then
    cp /home/cprime/staging/cprime/*.kar "${KARAF_HOME}/deploy/"
    sleep 30
fi

echo "================================================================="
echo "Base Connector server installation completed successfully!"
echo "================================================================="
