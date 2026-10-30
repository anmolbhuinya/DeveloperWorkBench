 

function mvngetversion() {
	cd $SRCDIR
	local MVN_CURRENT_VERSION=$(mvn -q \
    -Dexec.executable=echo \
    -Dexec.args='${project.version}' \
    --non-recursive \
    exec:exec)

    local clean_version=$(echo "$MVN_CURRENT_VERSION" | cut -d'-' -f1)
	echo $clean_version
}

export release_ver_payor=`mvngetversion`
export TEMP_DOWNLOAD_DIR="/tmp/temp_payor_dist_download"

alias mvncleanbuildobr='mvn clean install  -DskipTests=true -DobrRepository=NONE -Dmaven.clean.fast=true   '

function mvncleanbuildPayorEnrollment() {
    local force_flag=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--force)
                force_flag=true
                shift
                ;;
            *)
                echo "no force flag provided"
                shift
                ;;
        esac
    done
    
    if [ -z "$SRCDIR" ]; then
        echo "Error: SRCDIR environment variable is not set!"
        echo "Please set SRCDIR to your source directory path."
        echo "Example: export SRCDIR=/path/to/your/source"
        return 1
    fi

    # Optional: Also check if the directory exists
    if [ ! -d "$SRCDIR" ]; then
        echo "Error: SRCDIR directory '$SRCDIR' does not exist!"
        return 1
    fi

    # If -f flag is used, skip confirmation
    if [ "$force_flag" = true ]; then
        echo "Force flag detected. Skipping confirmation..."
        echo "Proceeding with maven clean build..."
    else
        local message="${1:- it will do maven clean first on entire payor $release_ver_payor under $SRCDIR, Do you want to continue?}"

        echo "$message (y/N): "
        read -r user_input
        
        if [[ "$user_input" != "y" && "$user_input" != "Y" ]]; then
            echo "Operation cancelled. Exiting..."
            return 1
        fi
    fi

    cd $SRCDIR
	mvn clean
	local start_time=$(date +%s)

	# mvncleanbuildobr -pl core-versions-jar 
	mvncleanbuildobr -pl query -am
	
	if [[ ! $? -eq 0 ]] 
	then
		echo "mvncleanbuildobr -pl query -am failed"
		return 1
	fi 

	mvncleanbuildobr -pl core-queries,core-main,dw,core-cvc,core-enrollment


	if [[ ! $? -eq 0 ]] 
	then
		echo "mvncleanbuildobr -pl dw,core-main,core-cvc,core-enrollment failed"
		return 1
	fi 

	local end_time=$(date +%s)
	local duration=$((end_time - start_time))

	echo "Build Duration: $duration seconds"
}



function mvncleanbuildPayorIom() {
    cd $SRCDIR/metadata/iom
    mvncleanbuildobr
    
	if [[ ! $? -eq 0 ]] 
	then
		echo "mvncleanbuildobr iom failed"
		return 1
	fi 


    cd $SRCDIR/metadata/hicl
    mvncleanbuildobr

	if [[ ! $? -eq 0 ]] 
	then
		echo "mvncleanbuildobr hicl failed"
		return 1
	fi 
    cd $SRCDIR
    mvncleanbuildobr -pl core-util
}


function find_first_file_by_extension() {
    local folder_path="$1"
    local extension="$2"
    
   
    # Find first file with specific extension
    local first_file=$(find "$folder_path" -name "*.$extension" -type f | head -1)
    
    if [ ! -z "$first_file" ]; then
        echo "$(basename "$first_file")"
    else
        echo "No files with .$extension extension found in $folder_path"
    fi
}



function moveDownloadedDistributionToTarget(){
    local src_folder="$TEMP_DOWNLOAD_DIR"
    local dest_folder="$SRCDIR/distribution/target"
    
    if [ ! -d "$src_folder" ]; then
        echo "Error: Directory '$src_folder' does not exist!"
        return 1
    fi

    local file_count=$(ls -1 "$src_folder" | grep ".tar.gz" | wc -l)
    
    if [ "$file_count" -eq 1 ]; then
        echo "Folder contains exactly one file"
    else
        echo "Folder contains $file_count files, expected exactly one file, please check $src_folder"
        return 1
    fi

    local message="Moving file will remove all files under $SRCDIR/distribution/target first, do you want to continue?"

    echo "$message (y/N): "
    read -r user_input
    
    if [[ "$user_input" != "y" && "$user_input" != "Y" ]]; then
        echo "Operation cancelled. Exiting..."
        return 1
    fi

    rm -rf "$dest_folder"
    mkdir -p "$dest_folder"
    # Copy the downloaded files to the target distribution folder
    cp "$src_folder"/*.tar.gz "$dest_folder"/

    local payor_source_dist_file=$(find_first_file_by_extension "$dest_folder" "tar.gz")
    # echo "Found payor source distribution file: $payor_source_dist_file"
    if [ -f "$dest_folder/$payor_source_dist_file" ]; then
        new_name=$(echo "$payor_source_dist_file" | sed 's/core-distributio/core\.distributio/')
        mv "$dest_folder/$payor_source_dist_file" "$dest_folder/$new_name"
        echo "Renamed: $payor_source_dist_file -> $new_name"
    fi

    echo "Copied downloaded distribution files from $src_folder to $dest_folder"
}

function mergeLocalArtifactsToDistribution(){

    local src_folder="$TEMP_DOWNLOAD_DIR"
    if [ ! -d "$src_folder" ]; then
        echo "Error: Directory '$src_folder' does not exist!"
        return 1
    fi

    local file_count=$(ls -1 "$src_folder" | grep ".tar.gz" | wc -l)
    
    if [ "$file_count" -eq 1 ]; then
        echo "Folder contains exactly one file"
    else
        echo "Folder contains $file_count files, expected exactly one file, please check $src_folder"
        return 1
    fi

	# Find the first .tar.gz file in the specified directory
	local payor_source_dist_file=$(find_first_file_by_extension "$src_folder" "tar.gz")

	if [[ "$payor_source_dist_file" == *"No files with"* ]]; then
        echo "No tar.gz files found in $src_folder"
        return 1
    fi

	local release_ver_payor_new=${release_ver_payor}

	local unziped_folder=$SRCDIR/distribution/target/core-distribution-${release_ver_payor_new}

    rm -rf $SRCDIR/distribution/target
    mkdir -p $SRCDIR/distribution/target

	unzip_dist_gz_file $src_folder/$payor_source_dist_file $unziped_folder

 	local folder_path="$unziped_folder/healthedge/claimserver/install/jars"
    local extension="jar"
	# Find all files with specific extension and print name without extension
    find "$folder_path" -name "*.${extension}" -type f | while read file; do
        filename=$(basename "$file")
        name_without_ext="${filename%.*}"
        # echo "$name_without_ext"
		local fullfilename="$SRCDIR/${name_without_ext}/target/${name_without_ext}-${release_ver_payor_new}-SNAPSHOT.jar"

		if [ -f "$fullfilename" ]; then
			# echo "File exists: $fullfilename"
			copyPayorJarToDist "$name_without_ext" "$folder_path"
		fi
    done

 	# local lib_folder_path="$unziped_folder/healthedge/claimserver/install/lib"
    # copyPayorVersionLibToDist "$lib_folder_path"

	local dist_file=$SRCDIR/distribution/target/core.distribution-${release_ver_payor_new}-SNAPSHOT-pkg.tar.gz
	create_targz_file "$unziped_folder/healthedge" "$dist_file"

}


function downloadPayorDistribution() {

    local base_url_root="https://nexus.headquarters.healthedge.com:8082/service/rest/repository/browse"
	
    local download_url_root="https://nexus.headquarters.healthedge.com:8082/repository"
	if [ "$1" = "master" ]; then
		local base_url="$base_url_root/staging/com/healthedge/core/core-distribution/"
		local download_url="$download_url_root/staging/com/healthedge/core/core-distribution/"
        local download_ver_jar_url="$download_url_root/staging/com/healthedge/core/core-versions-jar/"
# 
	else
		local base_url="$base_url_root/release/com/healthedge/core/core-distribution/"
		local download_url="$download_url_root/release/com/healthedge/core/core-distribution/"
        local download_ver_jar_url="$download_url_root/release/com/healthedge/core/core-versions-jar/"
	fi

	local search_version="$release_ver_payor-20$2"
	# "https://nexus.headquarters.healthedge.com:8082/service/rest/repository/browse"

    echo "Searching for version: $search_version on $base_url"
    
    # Fetch the page content and search for the version

	local first_link=$(curl -s "$base_url" | grep -o "href=\"[^\"]*$search_version[^\"]*\"" | sed 's/href="//g' | sed 's/"//g' | head -1)
    
    if [ ! -z "$first_link" ]; then
		first_link="${first_link%/}"      
        # https://nexus.headquarters.healthedge.com:8082/repository/staging/com/healthedge/core/core-versions-jar/26.1-202507142348-a1bb22f/core-versions-jar-26.1-202507142348-a1bb22f.jar

		local download_versions_jar_url="$download_ver_jar_url$first_link/core-versions-jar-$first_link.jar"    
        
		rm -rf $TEMP_DOWNLOAD_DIR
		mkdir -p $TEMP_DOWNLOAD_DIR
        echo "Downloading core-versions-jar from: $download_versions_jar_url"

        cd "$TEMP_DOWNLOAD_DIR"
        curl -o "$TEMP_DOWNLOAD_DIR/core-versions.jar" "$download_versions_jar_url"
        if [ $? -ne 0 ]; then
            echo "Error: Failed to download core-versions-jar from $download_versions_jar_url"
            return 1
        else 
            local ver_nexus=`unzip -p "$TEMP_DOWNLOAD_DIR/core-versions.jar" build.properties | grep "oltp="`
            echo "-------"
            local ver_local=`cat "$SRCDIR/metadata/release.txt" | grep "oltp="`
            if [[ "$ver_nexus" != "$ver_local" ]]; then
                echo "Error: OLTP version in the nexus jar file ($ver_nexus) for version $first_link does not match the local OLTP version ($ver_local)"

                echo "Please update the search date to include hour by picking next one from the list below, and try it again."
                curl -s "$base_url" | grep -o "href=\"[^\"]*$search_version[^\"]*\"" | sed 's/href="//g' | sed 's/"//g'
                return 1
            else
                echo "OLTP Version check passed for version $first_link: $ver_nexus"
            fi
        fi

        rm -f "$TEMP_DOWNLOAD_DIR/core-versions.jar"
        # Extract filename from the link
        local filename=$(basename "$first_link")
        local message="First match found: $filename, Do you want to download it?"

        echo "$message (y/N): "
        read -r user_input
        
        if [[ "$user_input" != "y" && "$user_input" != "Y" ]]; then
            echo "Operation cancelled. Exiting..."
            return 1
        fi

        
		local dest_file="core-distribution-$first_link-pkg.tar.gz"

		local download_file_url="$download_url$first_link/$dest_file"


		# https://nexus.headquarters.healthedge.com:8082/repository/staging/com/healthedge/core/core-distribution/26.1-202507280513-ab717d7/core-distribution-26.1-202507280513-ab717d7-pkg.tar.gz
        
        # You can use this filename to update your dist_file_name
        echo "Start downloading $download_file_url"
		
		local dest_filepath="$TEMP_DOWNLOAD_DIR/$dest_file"

		if [[ "$dest_filepath" =~ ^[A-Za-z]: ]]; then
			# Convert C:\path to /c/path format  
			dest_filepath=$(echo "$dest_filepath" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|')
			# echo "Converted gz file path to: $dest_filepath"
		fi

        # Use wget
        cd "$TEMP_DOWNLOAD_DIR"
        curl -o "$dest_file" "$download_file_url"

		if [ $? -eq 0 ]; then
			echo "Download completed successfully!"
			echo "File saved as: $dest_file"
			ls -lh "$dest_filepath"
		else
			echo "Download failed!"
			return 1
		fi
    else
        echo "No matches found for version: $search_version"
    fi
}




function copyPayorJarToDist() {
	echo "--"
 	
	local release_ver_payor_new=${release_ver_payor}
	
	if [  ! -f "${2}/${1}.jar.oldBACKUP" ]
	then
		mv ${2}/${1}.jar ${2}/${1}.jar.oldBACKUP
		echo "${1}.jar is backed up to ${1}.jar.oldBACKUP"
	fi

	cp  $SRCDIR/${1}/target/${1}-${release_ver_payor_new}-SNAPSHOT.jar   ${2}/${1}.jar

	echo "${1}.jar is copied to dist folder ${2}"
}


function copyPayorVersionLibToDist() {
	echo "$SRCDIR"
 	
	local release_ver_payor_new=${release_ver_payor}
	
	if [  ! -f "${1}/core-versions.jar.oldBACKUP" ]
	then
		mv ${1}/core-versions.jar ${1}/core-versions.jar.oldBACKUP
		echo "core-versions.jar is backed up to core-versions.jar.oldBACKUP"
	fi

	cp  $SRCDIR/core-versions-jar/target/core-versions-jar-${release_ver_payor_new}-SNAPSHOT.jar   ${1}/core-versions.jar

	echo "core-versions.jar is copied to dist folder ${1}"
}


function create_targz_file() {
    local source_folder="$1"
    local output_file="$2"
    
    if [ -z "$source_folder" ] || [ -z "$output_file" ]; then
        echo "Usage: create_targz_file <source_folder> <output_file.tar.gz>"
        echo "Example: create_targz_file /path/to/folder archive.tar.gz"
        return 1
    fi
    
    # Check if source folder exists
    if [ ! -d "$source_folder" ]; then
        echo "Error: Source folder '$source_folder' not found!"
        return 1
    fi

	
	if [[ "$source_folder" =~ ^[A-Za-z]: ]]; then
        # Convert C:\path to /c/path format  
        source_folder=$(echo "$source_folder" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|')
        # echo "Converted source folder path to: $source_folder"
    fi

	if [[ "$output_file" =~ ^[A-Za-z]: ]]; then
        # Convert C:\path to /c/path format  
        output_file=$(echo "$output_file" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|')
        # echo "Converted destination path to: $output_file"
    fi

    # Check if output file already exists and delete it
    if [ -f "$output_file" ]; then
        echo "Output file '$output_file' already exists. Deleting..."
        rm -f "$output_file"
        if [ $? -eq 0 ]; then
            echo "Successfully deleted existing file: $output_file"
        else
            echo "Error: Failed to delete existing file: $output_file"
            return 1
        fi
    fi
    
    # Create tar.gz file
    echo "Creating tar.gz archive..."
    tar -czf "$output_file" -C "$(dirname "$source_folder")" "$(basename "$source_folder")"
    
    if [ $? -eq 0 ]; then
        echo "Successfully created: $output_file"
        ls -lh "$output_file"
    else
        echo "Error creating tar.gz file"
        return 1
    fi
}


function unzip_dist_gz_file(){
	#!/bin/bash
	# filepath: unzip_gz.sh

	# Check if correct number of arguments provided
	if [ $# -ne 2 ]; then
		echo "Usage: $0 <gz_file> <destination_folder>"
		echo "Example: $0 file.tar.gz /path/to/destination"
		return 1
	fi

	local GZ_FILE="$1"
	local DEST_FOLDER="$2"

	# Check if gz file exists
	if [ ! -f "$GZ_FILE" ]; then
		echo "Error: File '$GZ_FILE' not found!"
		return 1
	fi
	if [[ "$GZ_FILE" =~ ^[A-Za-z]: ]]; then
        # Convert C:\path to /c/path format  
        GZ_FILE=$(echo "$GZ_FILE" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|')
        # echo "Converted gz file path to: $GZ_FILE"
    fi

	if [[ "$DEST_FOLDER" =~ ^[A-Za-z]: ]]; then
        # Convert C:\path to /c/path format  
        DEST_FOLDER=$(echo "$DEST_FOLDER" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|')
        # echo "Converted destination path to: $DEST_FOLDER"
    fi


	# Create destination folder if it doesn't exist
	rm -rf "$DEST_FOLDER"
	mkdir -p "$DEST_FOLDER"

	# Check file extension and extract accordingly
	if [[ "$GZ_FILE" == *.tar.gz ]]; then
		echo "Extracting tar.gz file..."
		tar -xzf "$GZ_FILE" -C "$DEST_FOLDER"
	else
		echo "Error: File must have .gz or .tar.gz extension"
		return 1
	fi

	echo "Extraction completed successfully!"
	echo "Files extracted to: $DEST_FOLDER"
}



function cpPayorJar() {
	echo "$SRCDIR"
    local WL_DOMAIN_HOME=/opt/oracle/weblogic/user_projects/domains/healthedge
 	
	local releases_ver_new=${release_ver_payor}
	local is_backup_existed=$(docker exec payer-1 bash -c "ls $WL_DOMAIN_HOME/jars/${1}.jar.oldBACKUP")
	
	if [  "$is_backup_existed" == "" ]
	then
		docker exec payer-1 bash -c  "mv $WL_DOMAIN_HOME/jars/${1}.jar $WL_DOMAIN_HOME/jars/${1}.jar.oldBACKUP"
		echo "${1}.jar is backed up to ${1}.jar.oldBACKUP"
	fi
    
	docker cp  $SRCDIR/${1}/target/${1}-${releases_ver_new}-SNAPSHOT.jar   payer-1:$WL_DOMAIN_HOME/jars/${1}.jar

	echo "${1}.jar is copied to docker container payer-1"
    docker exec payer-1 bash -c "ls -alrt $WL_DOMAIN_HOME/jars/ | tail -n 5"
}
