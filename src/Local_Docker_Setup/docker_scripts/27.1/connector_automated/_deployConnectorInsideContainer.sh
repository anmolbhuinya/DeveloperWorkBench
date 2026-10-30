#!/bin/bash

# Parse command line arguments
SKIP_CONNECTOR_PATCH=false
PAYER_CONTAINER="payer-tc-jdk21-271"  # Default payer container name
FOR_ENROLLMENT=false
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
        --for-enrollment)
            FOR_ENROLLMENT=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --skip-connector-patch, --no-connector-patch, -p    Skip applying connector server patch"
            echo "  --payer-container <name>                            Specify the payer container name (default: ${PAYER_CONTAINER})"
            echo "  --for-enrollment                                    Use enrollment feature file generation"
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
KARAF_HOME=/home/cprime/cprime/healthrules-connector-server-4.4.11
# Define the directory where the distribution tar.gz file is located
DIST_DIR=/home/cprime/staging/distribution/connector-distribution-13.0-SNAPSHOT
CONN_DOMAIN=/home/cprime/environments/connector
INSTALLER_PATCH_DIR=/home/cprime/installer-patch
ALL_CONFIG_FILE=/home/cprime/environments/connector/allFeatures.properties
OLTP_HOST=payer-db-261
OLTP_DB=DB19C
OLTP_USER=PAYOR_OLTP
OLTP_PASSWORD=hedge
DW_HOST=payer-db-261
DW_DB=DB19C
DW_USER=PAYOR_DW
DW_PASSWORD=hedge


# Function to fix a stale hardcoded JDK path in Karaf's bin/setenv (e.g. jdk21-current) that no longer exists on this container
fixKarafJavaHome() {
    local setenvFile="$KARAF_HOME/bin/setenv"
    local staleJavaHome="/opt/java/jdk21-current"
    local validJavaHome="${JAVA_HOME:-/opt/java/jdk-current}"

    if [[ -f "$setenvFile" ]] && ! [[ -d "$staleJavaHome" ]] && [[ -d "$validJavaHome" ]]; then
        echo "Fixing stale JAVA_HOME (${staleJavaHome}) in ${setenvFile}, using ${validJavaHome} instead"
        sed -i "s|${staleJavaHome}|${validJavaHome}|g" "$setenvFile"
    fi
}


# Function to apply connector server patch
applyConnectorPatch() {
	stopConnectorServer
    local patchVersion="4.4.3-1.7.5"
    local patchName="connector-installer-patch-${patchVersion}.tar.gz"


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
	cd ${KARAF_HOME}/data || exit 2
	rm -rf *
	cd ${KARAF_HOME}/install || exit 2
	rm -rf *
	cd ${KARAF_HOME}/connector-blueprints-deploy || exit 2
	rm -rf *
	cd ${KARAF_HOME}/custom-blueprints-deploy || exit 2
	rm -rf *
	cd ${KARAF_HOME}/log || exit 2
	rm -rf *
	cd ${KARAF_HOME}/datasources || exit 2
	rm -rf *
	cd ${KARAF_HOME}/xml || exit 2
	rm -rf *
	rm ${KARAF_HOME}/lock
	rm -rf ${KARAF_HOME}/etc/com.healthedge.connector.*.cfg
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
}


generateAllFeatureFileForEnrollment() {
  FEATURE_DIRECTORY=$DIST_DIR/features
  ENROLLMENT_FEATURE_DIR=$ENROLLMENT_DIST_DIR/features

  mkdir -m 775 -p "$(dirname "$ALL_CONFIG_FILE")"
  > "$ALL_CONFIG_FILE"

  # connector-weblogic-repos excluded
  # connector-classic-repos excluded
  printf '%s\n' \
      "connector-payor-ref-repos" \
      "connector-common-schema-repos" \
      "connector-common-util-repos" \
      "connector-cobpolicy-repos" \
      "connector-subsidy-repos" \
      "connector-accountlookup-repos" \
      "connector-benefitplanlookup-repos" \
      "connector-providerlookup-repos" \
      "connector-memberlookup-repos" \
      "connector-jms-repos" \
      "connector-enrollmentsparse-repos" \
      >> "$ALL_CONFIG_FILE"
}

generateAllFeatureFile() {
  FEATURE_DIRECTORY=$DIST_DIR/features
  ENROLLMENT_FEATURE_DIR=$ENROLLMENT_DIST_DIR/features

#  EDIR=~/environments/connector
#  if [[ ! -d "$EDIR" ]]; then
#      mkdir -m 775 -p $EDIR
#  fi

  if [[ ! -d "/home/cprime/environments/connector" ]]; then
      mkdir -m 775 -p /home/cprime/environments/connector
  fi

  # Check if the file exists and create it if it doesn't
  if [[ ! -f "$ALL_CONFIG_FILE" ]]; then
      touch "$ALL_CONFIG_FILE"
  else
    rm -f $ALL_CONFIG_FILE
    touch "$ALL_CONFIG_FILE"
  fi

  if [ -d "$FEATURE_DIRECTORY" ]; then
    # Loop through each .kar file in the directory
    for file in "$FEATURE_DIRECTORY"/*.kar;
    do
      # Check if there are any .kar files
      if [ -e "$file" ]; then
        # Extract the file name and echo it
        file_name=$(basename "$file")
        basename=$(echo "$file_name" | sed -E 's/(.*repos).*/\1/')
        echo "$basename" >> $ALL_CONFIG_FILE
      else
        echo "No .kar files found in $FEATURE_DIRECTORY"
        break
      fi
    done
  else
    echo "Connector Target Directory does not exist."
  fi
}

parseFeaturesXML () {
    cfg=''
    if [[ $TAG_NAME = "${CONFIG_TAG}" ]] ; then
        eval local "${ATTRIBUTES}"
        if [[ $finalname = *".cfg" ]]; then
           #cfg=$(echo $CONTENT | rev | cut -d'/' -f1 | rev)
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
           #echo " Config path :: "$configPath
           while IFS= read -r line || [[ -n "$line" ]]; do
              if [[ ${line:0:1} == '#' ]] || [[ -z "$line" ]]; then # skip if the line starts with # or its empty
                continue
              else
                lineKey=$(echo $line | cut -d '=' -f 1)
                fileNameWithKey="$configFileName;$lineKey"
                fileNameWithKeyValue="$configFileName;$line"
                trimLine=$(echo $line | xargs)
                #trimLine=$(echo $line | sed -e 's/^[ \t]*//')
                length=${#trimLine}
                if [[ $length = 0 ]] || grep -qF "$fileNameWithKey" $generated_config; then
                    #echo " Match found for :: $fileNameWithKeyValue or line is empty"
                    continue
                fi
                #echo " No Match found for :: $fileNameWithKeyValue"
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
    for i in `find ${DIST_DIR} -name "$1*.kar" -type f`; do
        #check kar file exists in array
        #echo "list content :: ${connectorFeatures[*]} "
        if [[ " ${connectorFeatures[@]} " =~ " ${1} " ]]; then
            continue;
        fi
        #KAR file with version
        local karFileNameWithVersion=$(basename $i)
        #Extract KAR file
        unzip -q -o $i -d $(dirname $i)/${1}
        local feature=${karFileNameWithVersion%%.kar*}
        local featuresXMLPath=$(find $(dirname $i)/${1}/repository/com/healthedge/** -name $feature-features.xml)
        #echo " Features XML path :: "$featuresXMLPath
        if [ -f $featuresXMLPath ]; then
			
            local contents=($(grep $FEATURE_TAG $featuresXMLPath | cut -f2 -d">"|cut -f1 -d"<"))
            #Add Kar in array
            connectorFeatures=("${1}" "${connectorFeatures[@]}")
            for j in "${contents[@]}" ; do
               if [[ $j == *"-repos" ]]; then
                 readFeatureTagFromFeatureXML $j
              fi
            done
        fi
       # rm -rf $(dirname $i)/${karFileWithNoVersion}
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
        i=$(find ${DIST_DIR} -name "${l}*.kar" -type f)
        karFileNameWithVersion=$(basename $i)
        karFileWithNoVersion=${karFileNameWithVersion%%repos*}repos
        unzip -q -o $i -d $(dirname $i)/${karFileWithNoVersion}
        feature=${karFileNameWithVersion%%.kar*}
        featuresXMLPath=$(find $(dirname $i)/${karFileWithNoVersion}/repository/com/healthedge/** -name $feature-features.xml)
        if [ -f $featuresXMLPath ]; then
            dirPath=$(dirname $i)/${karFileWithNoVersion}/repository/com/healthedge/**
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
        sed -i 's/com.healthedge.connector.dw.cfg;url=.*/com.healthedge.connector.dw.cfg;url='"jdbc:oracle:thin:@${DW_HOST}:1521:${DW_DB}"'/g' $generated_config
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

    # Replacing ^M to new line
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

    #updateBlueCardConfig
    updateTrackingDbConfig
}

# Patch the trackingdb datasource cfg in $KARAF_HOME/etc if present.
# Silently ignore if the file does not exist (feature not installed).
updateTrackingDbConfig() {
    TRACKINGDB_ETC=${KARAF_HOME}/etc/com.healthedge.connector.trackingdb.datasource.db.cfg
    if [[ ! -f "${TRACKINGDB_ETC}" ]]; then
        echo "Skipping trackingdb cfg update: ${TRACKINGDB_ETC} not present."
        return 0
    fi

    echo "Updating ${TRACKINGDB_ETC}"

    # Docker deploy uses Oracle. DW_DB (e.g. DB19C) is a service name on 19c,
    # so use service-name form (/) to avoid ORA-12505 from the listener.
    sed -i 's|^url=.*|url=jdbc:oracle:thin:@'"${DW_HOST}"':1521/'"${DW_DB}"'|g' "${TRACKINGDB_ETC}"
    sed -i 's|^username=.*|username='"${DW_USER}"'|g' "${TRACKINGDB_ETC}"
    sed -i 's|^password=.*|password='"${DW_PASSWORD}"'|g' "${TRACKINGDB_ETC}"

    sed -i 's|^table.tablespace=.*|table.tablespace=data1|g' "${TRACKINGDB_ETC}"
    sed -i 's|^index.tablespace=.*|index.tablespace=indx1|g' "${TRACKINGDB_ETC}"
}

function installFeatures(){
    PROP_FILE=$1
    FEATURE_LIST=""
    COMMON_LIST="healthrules-payor-support healthrules-caremanager-support"
    # Create or update the file with the commands to run
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

    if [[ -z $FEATURE_LIST ]];
    then
        echo "ERROR No Features found to install."
        exit 1
    fi

    
    echo "***** Adding Connector Distribution ******"
    echo "hrc:add-distribution $DIST_DIR" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b
    sleep 90

    echo "**** Installing Connector Features ****"
    feature_install_info=$(echo "feature:install -r $FEATURE_LIST" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b | tee /dev/stderr)
    err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    err_feature_list=""
    #While features with installation failure are encountered, remove the failed feature from the list and try to install the remaining features
    while [[ -n "$err_feature" ]]; do
        err_feature_list+="$err_feature\n"  # Append err_feature to err_feature_list
        FEATURE_LIST=${FEATURE_LIST//$err_feature /}

        # Update error_line for the next iteration
        feature_install_info=$(echo "feature:install -r $FEATURE_LIST" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b)
        err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    done

    if [[ -n "$err_feature_list" ]]; then
        echo "****************************************************************"
        echo -e "Failed to install the following features: \n"
        echo -e $err_feature_list
    fi

    # Inject secrets before restart so Karaf starts with real values already in place
    injectTemplateSecrets

    #restart connector server
    stopConnectorServer
    startConnectorServer

    sleep 90
    #Listing the  bundles failed to start at after server was restarted
    failed_bundle_info=$(echo "bundle:list" | ${KARAF_HOME}/bin/client -u connector -p Connector123 -b | grep -E "Resolved|Failure")
        if [[ -n "$failed_bundle_info" ]]; then
            echo -e "Failed to start the following bundles in the server: \n"
            echo "$failed_bundle_info"
            echo "===================================================================================================="
        fi

}

# Injects secrets into all 5 config/blueprint files after features are installed
# but BEFORE Karaf restarts — so Karaf starts with real secrets already in place.
# Source files keep vault: placeholders; only the live Karaf copies are rewritten.
injectTemplateSecrets() {
    local staging_dir="/home/cprime/staging/cprime"
    local update_cfg="${staging_dir}/updateConfigurationFiles.sh"
    local secrets_env="${staging_dir}/.secrets_env"

    if [[ ! -f "${secrets_env}" ]]; then
        echo "Skipping template secrets injection: .secrets_env not found in ${staging_dir}."
        return 0
    fi
    if [[ ! -x "${update_cfg}" ]]; then
        echo "Skipping template secrets injection: updateConfigurationFiles.sh not found or not executable in ${staging_dir}."
        return 0
    fi

    # Copy .secrets_env to HOME so updateConfigurationFiles.sh can find it
    cp "${secrets_env}" "${HOME}/.secrets_env"

    # Overwrite KAR-installed files (may have hardcoded values) with staged vault-ref sources.
    # Mappings: staged file → Karaf destination (with ConfigAdmin PID-based names)
    # Note: cvc-event-listener-route.xml is intentionally excluded — it is deployed to
    # connector-blueprints-deploy/ by the KAR and must not be touched here. Overwriting
    # it after feature:install would trigger a fileinstall rescan before the Java bundle
    # is stable, breaking OSGi resolution of com.healthedge.cprime.cvc.event.model.
    declare -A overwrite_map=(
        ["${staging_dir}/wl.properties.bc.installer.template"]="${KARAF_HOME}/etc/wl.properties.bc.installer.template"
        ["${staging_dir}/com.healthedge.connector.payor.cfg"]="${KARAF_HOME}/etc/com.healthedge.connector.payor.cfg"
        ["${staging_dir}/connector-jms.cfg"]="${KARAF_HOME}/etc/com.healthedge.connector.jms.cfg"
        ["${staging_dir}/connector.ibm.mq.client.cfg"]="${KARAF_HOME}/etc/com.healthedge.connector.ibm.mq.cfg"
    )
    for src in "${!overwrite_map[@]}"; do
        dest="${overwrite_map[$src]}"
        if [[ -f "${src}" ]]; then
            echo "Overwriting ${dest} with vault-ref source..."
            cp "${src}" "${dest}"
        else
            echo "WARNING: ${src} not found — skipping $(basename ${dest}) overwrite"
        fi
    done

    # Build a temp yaml pointing at all live Karaf files to inject
    local tmp_yaml
    tmp_yaml=$(mktemp /tmp/connector-template-secrets-XXXXXX.yaml)
    cat > "${tmp_yaml}" <<EOF
source: ${HOME}/.secrets_env
targets:
  - type: local
    path: ${KARAF_HOME}/etc/wl.properties.bc.installer.template
  - type: local
    path: ${KARAF_HOME}/etc/com.healthedge.connector.payor.cfg
  - type: local
    path: ${KARAF_HOME}/etc/com.healthedge.connector.jms.cfg
  - type: local
    path: ${KARAF_HOME}/etc/com.healthedge.connector.ibm.mq.cfg
EOF

    echo "Injecting secrets into Karaf files..."
    bash "${update_cfg}" --local --config "${tmp_yaml}" --env "${HOME}/.secrets_env"
    local rc=$?
    rm -f "${tmp_yaml}"

    if [[ $rc -eq 0 ]]; then
        echo "Template secrets injection completed."
    else
        echo "WARNING: Template secrets injection exited with code ${rc}."
    fi
}

# Main script execution
fixKarafJavaHome
cleanServer
if [[ "$FOR_ENROLLMENT" == true ]]; then
    generateAllFeatureFileForEnrollment
else
    generateAllFeatureFile
fi
generateConfig $ALL_CONFIG_FILE
if [[ "$SKIP_CONNECTOR_PATCH" == false ]]; then
    applyConnectorPatch
else
    echo "========================================="
    echo "Skipping connector patch application"
    echo "========================================="
fi
installFeatures $ALL_CONFIG_FILE
