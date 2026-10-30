# Payor Deployment Automation

This repository contains scripts for automating the build and deployment of the Payor application to a Docker container.

## Overview

The automation scripts handle the following tasks:
- Building the Payor application using Maven
- Deploying the built application to a Docker container
- Installing and configuring the application inside the container
- Upgrading the required databases

## Prerequisites

- Docker installed and running
- Access to the Payor code repository
- WebLogic server running in a container
- Proper directory structure as referenced in the scripts


## Usage

### Main Deployment Script

```bash
./deployPayor.sh [OPTIONS]
```

#### Options:

- `--skip-build`: Skip the Maven build step
- `--skip-tests`: Skip tests during Maven build
- `--skip-deploy`: Skip deployment to container
- `--container NAME`: Use specific container name (default: payer-1)
- `--debug`: Enable debug logging
- `--full-build`: Force full build instead of incremental
- `--help`: Display help message

### Examples

Build and deploy with tests:
```bash
./deployPayor.sh
```

Build without tests and deploy:
```bash
./deployPayor.sh --skip-tests
```

Skip build and just deploy:
```bash
./deployPayor.sh --skip-build
```

Deploy to a specific container:
```bash
./deployPayor.sh --container payer-2
```

## Deployment Workflow

1. **Build Phase** (if not skipped):
   - Changes to the Payor repository directory
   - Executes Maven build script (incremental or full)

2. **Deployment Phase** (if not skipped):
   - Finds the distribution package
   - Stops the WebLogic server in the container
   - Prepares the staging directory in the container
   - Copies deployment files to the container
   - Executes the deployment script inside the container

3. **Inside Container Deployment** (handled by deploy_inside_container.sh):
   - Stops WebLogic server if running
   - Removes existing distribution
   - Extracts the new distribution
   - Copies configuration files
   - Runs installation scripts
   - Upgrades OLTP and DW databases
   - Starts WebLogic server

## Troubleshooting

- Check logs in the container at `/home/weblogic/staging/logs/deployPayor.log`
- Enable debug logging with the `--debug` option
- If deployment fails, you can manually run specific steps in the container

## Environment Variables

The scripts use the following environment variables inside the container:
- `WLS_DEBUG`: Set to true for WebLogic debugging
- `ENABLE_REMOTE_DEBUG`: Enables remote debugging for the application
