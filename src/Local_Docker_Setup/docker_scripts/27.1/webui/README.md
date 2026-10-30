# WebUI Docker Compose Setup

This directory contains the necessary files to set up a Docker Compose stack for the WebUI application for a particular version.

## Prerequisites
- Docker and Docker Compose installed on your machine
- Basic knowledge of Docker and Docker Compose
- VPN connectivity and access to Nexus repository
- Required Docker images exist in your registry

## Files Overview

- **docker-compose.yaml**: Defines the services for the WebUI stack
- **env-setter.sh**: Script to automatically generate `.env` file with latest image versions from Nexus
- **.env**: Environment variables file containing version information for Docker images
- **managerConfig.json**: Configuration file for the WebUI manager
- **nginx.conf**: NGINX configuration for the WebUI reverse proxy

## Setup Instructions

### 1. Define Payor Server

The Payor server hostname or IP address (prefer IP address over hostname) should be defined in the following files:

1. Update the `DEFAULT_PAYER_SERVER_URL` variable in the `docker-compose.yml` file under the `environment` section for the `adapter` service
2. Use the same value in the `managerConfig.json` file for the `DEFAULT_PAYER_SERVER_URL` field

### 2. Generate or Create the .env File

The `.env` file contains environment variables that specify the versions of Docker images to use for each service in the stack.

#### .env File Format

The `.env` file uses a simple KEY=VALUE format:

```dotenv
VERSION=26.1
WEBUI_VERSION=26.1.0-20251130224949
ADAPTOR_VERSION=26.1-20251130233119
WEBSOCKET_VERSION=26.1-20251130233515
```

**Variables:**
- `VERSION`: The major version prefix (e.g., 26.1, 25.1)
- `WEBUI_VERSION`: Full version tag for the `payor-ui-react` Docker image
- `ADAPTOR_VERSION`: Full version tag for the `payor-rest-adaptor` Docker image
- `WEBSOCKET_VERSION`: Full version tag for the `payor-adaptor-websocket` Docker image

#### Option 1: Use env-setter.sh Script (Recommended)

The `env-setter.sh` script automatically queries the Nexus repository to find the latest Docker image versions for a given version prefix and generates the `.env` file.

**Basic Usage:**

```bash
# Generate .env file for version 26.1
./env-setter.sh --version 26.1 --write
```

**Query Individual Component Versions:**

```bash
# Query all components (no .env file created)
./env-setter.sh --version 26.1

# Query specific component version
./env-setter.sh --webui --version 26.1
./env-setter.sh --adaptor --version 26.1
./env-setter.sh --websocket --version 26.1
```

**Script Options:**
- `--version <prefix>`: **(Required)** Version prefix to search for (e.g., 25.1, 26.1)
- `--write`: Write all versions to `.env` file (backs up existing `.env` if present)
- `--webui`: Query only the `payor-ui-react` image version
- `--adaptor`: Query only the `payor-rest-adaptor` image version
- `--websocket`: Query only the `payor-adaptor-websocket` image version
- `--help`: Display usage information

**Example Output:**

```bash
$ ./env-setter.sh --version 26.1 --write
Backed up existing .env to .env-20251201171252
Wrote versions to ./.env
VERSION=26.1
WEBUI_VERSION=26.1.0-20251130224949
ADAPTOR_VERSION=26.1-20251130233119
WEBSOCKET_VERSION=26.1-20251130233515
```

#### Option 2: Manually Create .env File

If you cannot use the `env-setter.sh` script (e.g., no network access to Nexus), you can manually create a `.env` file:

1. Create a file named `.env` in this directory
2. Add the version variables in the format shown above
3. Ensure you use valid Docker image tags that exist in your registry

**Example:**

```dotenv
VERSION=26.1
WEBUI_VERSION=26.1.0-20251130224949
ADAPTOR_VERSION=26.1-20251130233119
WEBSOCKET_VERSION=26.1-20251130233515
```

### 3. Start the Docker Compose Stack

Once the `.env` file is configured, start the Docker Compose stack:

```bash
docker compose up -d
```

This command will start all services defined in the `docker-compose.yml` file in detached mode.

### 4. Verify the Stack

Check that all services are running:

```bash
docker compose ps
```

View logs for troubleshooting:

```bash
# View all logs
docker compose logs

# View logs for a specific service
docker compose logs webui
docker compose logs adaptor
docker compose logs websocket
```

## Managing the Stack

**Stop the stack:**
```bash
docker compose down
```

**Restart the stack:**
```bash
docker compose restart
```

**Update to a new version:**
```bash
# Generate new .env file
./env-setter.sh --version 26.2 --write

# Restart with new versions
docker compose down
docker compose up -d
```

## Troubleshooting

1. **Connection Issues**: Ensure VPN is connected and you have access to the Nexus repository
2. **Image Not Found**: Verify the image versions in `.env` exist in the Docker registry
3. **Payor Server Connection**: Check that `DEFAULT_PAYER_SERVER_URL` is correctly set and accessible
4. **Port Conflicts**: Ensure the ports used by the services are not already in use on your machine

## Backup Files

The directory may contain backup `.env` files with timestamps (e.g., `.env-20251201171252`). These are automatically created by `env-setter.sh` when you regenerate the `.env` file. You can safely delete old backups if needed.
