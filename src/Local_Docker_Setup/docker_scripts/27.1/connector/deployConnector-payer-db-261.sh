#!/bin/bash

FEATURE_TAG='<feature'
CONFIG_TAG='configfile'
KARAF_HOME=/home/cprime/cprime/healthrules-connector-server-4.4.3
# Define the directory where the distribution tar.gz file is located
DIST_DIR=/home/cprime/distribution/cprime-distribution/target/dist
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



# Function to apply connector server patch
applyConnectorPatch() {
	stopConnectorServer
    local patchVersion="4.4.3-1.7.5"
    local patchName="connector-installer-patch-${patchVersion}.tar.gz"


    echo "****************************************************************"
    echo "Applying connector server patch version ${patchVersion}"
    echo "****************************************************************"

    
    echo "Unpacking and installing installer patch"
    cd "${INSTALLER_PATCH_DIR}"
    tar xzpf "${INSTALLER_PATCH_DIR}/${patchName}"
    cd "${INSTALLER_PATCH_DIR}/connector-installer-patch-${patchVersion}"

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
    cd "${INSTALLER_PATCH_DIR}"
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
	cd ${KARAF_HOME}/data
	rm -rf *
	cd ${KARAF_HOME}/install
	rm -rf *
	cd ${KARAF_HOME}/connector-blueprints-deploy
	rm -rf *
	cd ${KARAF_HOME}/custom-blueprints-deploy
	rm -rf *
	cd ${KARAF_HOME}/log
	rm -rf *
	cd ${KARAF_HOME}/datasources
	rm -rf *
	cd ${KARAF_HOME}/xml
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

generateAllFeatureFile() {
  FEATURE_DIRECTORY=$DIST_DIR/features
  ENROLLMENT_FEATURE_DIR=$ENROLLMENT_DIST_DIR/features

  EDIR=~/environments/connector
  if [[ ! -d "$EDIR" ]]; then
      mkdir -m 775 -p $EDIR
  fi

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
    if [[ $TAG_NAME = $CONFIG_TAG ]] ; then
        eval local $ATTRIBUTES
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
        sed -i 's/com.healthedge.connector.payor.oltp.cfg;url=.*/com.healthedge.connector.payor.oltp.cfg;url='"jdbc:oracle:thin:@${OLTP_HOST}:1521:${OLTP_DB}"'/g' $generated_config
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
        sed -i 's/com.healthedge.connector.payor.cfg;wls.address=.*/com.healthedge.connector.payor.cfg;wls.address='"payer-1"'/g' $generated_config
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
    ${KARAF_HOME}/bin/client -u connector -p Connector123 "hrc:add-distribution $DIST_DIR"
    sleep 90

    echo "**** Installing Connector Features ****"
    feature_install_info=$(${KARAF_HOME}/bin/client -u connector -p Connector123 "feature:install -r $FEATURE_LIST" | tee /dev/tty)
    err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    err_feature_list=""
    #While features with installation failure are encountered, remove the failed feature from the list and try to install the remaining features
    while [[ -n "$err_feature" ]]; do
        err_feature_list+="$err_feature\n"  # Append err_feature to err_feature_list
        FEATURE_LIST=${FEATURE_LIST//$err_feature /}

        # Update error_line for the next iteration
        feature_install_info=$(${KARAF_HOME}/bin/client -u connector -p Connector123 "feature:install -r $FEATURE_LIST")
        err_feature=$(echo "$feature_install_info" | grep 'Error executing command' | sed -n -e 's/^.*\(connector-.*repos\).*$/\1/p')
    done

    if [[ -n "$err_feature_list" ]]; then
        echo "****************************************************************"
        echo -e "Failed to install the following features: \n"
        echo -e $err_feature_list
    fi

    #echoMessage "Connector server is installed successfully with the features from $PROP_FILE file"

    #restart connector server
    stopConnectorServer
    startConnectorServer

    sleep 90
    #Listing the  bundles failed to start at after server was restarted
    failed_bundle_info=$(${KARAF_HOME}/bin/client list | grep -E "Resolved|Failure")
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
applyConnectorPatch
installFeatures $ALL_CONFIG_FILE
