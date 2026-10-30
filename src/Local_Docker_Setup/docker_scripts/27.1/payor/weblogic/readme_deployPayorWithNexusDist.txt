

# Deploy Payor based on pre-build distribution file on Nexus - Setup Guide

## Initial Setup

To get started, in git bash, navigate to the current folder and source the deployment script:

```
source ./deployPayorWithNexusDist.sh
```

you can also add the step above into your own bashrc_user_ext*.sh in your laptop

## Step 1: Build Enrollment Feature JARs

After switching to a new branch or synchronizing with the latest code, you might need to build the necessary JARs for the enrollment feature. 
This is used for debugging and executing unit tests in IntelliJ, and is also able to merge newly changed jars into the distribution for deployment.
This process may take approximately 16 minutes to complete,  we can add new command for other features later.

Run the following command to build the enrollment-specific components:

```
mvncleanbuildPayorEnrollment
```

This command performs a clean Maven build of the following modules:
 
- core-queries and its dependencies including iom, hicl, core-util
- core-main
- core-cvc
- core-enrollment
- dw

## Step 2: Download Pre-built Distribution from Nexus Repository, it might take 2 min

Download a pre-built distribution from the Nexus Repository. The downloaded file will be placed under `/tmp/temp_payor_dist_download`.

```
downloadPayorDistribution <branch_type> <date>
```

### Parameters:
1. **branch_type**: 
   - `master` - Latest master branch builds
   - `release` - Previous released versions

2. **date**: Date format `YYMMDD` or `YYMMDDHH` (e.g., `250728` or `25072811`). Use a date close to time before you synchronized with GitHub to find the most relevant build.
    notes that you can use the command "git log --pretty=format:'%h%x09%an%x09%ad%x09%s'  | head -n 15" to check the date in your local.

This command will find the distribution version based on the specified date and verify if the OLTP version matches between local and nexus. 
If the OLTP versions don't match, it will display a list of available distribution versions and prompt you to refine your search 
by including both date and hour until a matching OLTP version is found.

### Examples:
```
# Download latest master build
downloadPayorDistribution master 250728

# Download a release version
downloadPayorDistribution release 250415
```

## Step 3: 

    ### Option A: Use Downloaded Distribution Directly
        If you want to use the downloaded distribution to deploy payor directly, call the command below:

        ```
        moveDownloadedDistributionToTarget
        ```

    ### Option B: Merge Local JARs with Downloaded Distribution
        If you want to merge the newly built enrollment JARs with the downloaded pre-built distribution, call the command below:

        ```
        mergeLocalArtifactsToDistribution
        ```

        This function performs the following operations:
        - Locates the downloaded distribution tar.gz file
        - Extracts the distribution archive
        - Updates it with newly built enrollment JARs
        - Creates a new distribution package with the merged components



## Step 4: After the new distribution file is downloaded or generated, you can use the same deployPayor command to deploy the payor to Docker. 
Note that the `--skip-tests` and `--skip-build` flags are required since we've already built the components and generated the distribution file in the previous steps.


```
cd <current folder>
./deployPayor.sh --skip-tests  --skip-build
```



## Incremental Deployment for Single Module
After you make changes and build a few classes, instead of deploying the entire distribution file, 
you can use the command like below to copy only the new JAR file to Docker, and then restart the payor server manually

```
cpPayorJar core-main

cpPayorJar core-enrollment
```



## Available Functions Reference

- `mvncleanbuildPayorEnrollment` - Builds enrollment-specific modules with Maven 
- `downloadPayorDistribution` - Downloads pre-built payor distributions from Nexus repository
- `mergeLocalArtifactsToDistribution` - Generates final distribution package by merging local JARs
- `moveDownloadedDistributionToTarget` - Use Downloaded Distribution Directly to deploy
- `cpPayorJar` - Incremental Deployment for Single Module