# Connector Deployment Scripts

Deployment automation scripts for Health Edge connector services.

## Scripts

### deployConnector.sh
Deploys connector cprime services to Docker container.

**Environment Variable**: `C4SRCDIR` - Path to main connector source code

**Usage:**
```bash
./deployConnector.sh [OPTIONS]
```

**Options:**
- `--skip-copy`, `--no-copy`, `-s`              Skip copying files, use existing files in container
- `--skip-build`, `--no-build`, `-b`            Skip Maven build step  
- `--skip-tests`, `--no-tests`, `-t`            Skip tests during Maven build
- `--skip-git-pull`, `--no-git-pull`, `-g`      Skip git pull in source directory
- `--skip-connector-patch`, `--no-connector-patch`, `-p`  Skip applying connector server patch
- `--use-existing-tar`, `-e`                    Use existing tar file from /home/cprime/install/connector-distribution in container
- `--container`, `-c <name>`                    Specify the container name (default: connector-261)
- `--payer-container <name>`                    Specify the payer container name (default: payer-tc-261)
- `--help`, `-h`                                Show help message

### deployConnectorEnrollment.sh
Deploys enrollment connector services including HMEM modules.

**Environment Variable**: `C4ESRCDIR` - Path to enrollment connector source code

**Usage:**
```bash
./deployConnectorEnrollment.sh [OPTIONS]
```

**Options:**
- `--skip-copy`, `--no-copy`, `-s`              Skip copying files, use existing files in container
- `--skip-build`, `--no-build`, `-b`            Skip Maven build step
- `--skip-tests`, `--no-tests`, `-t`            Skip tests during Maven build  
- `--skip-git-pull`, `--no-git-pull`, `-g`      Skip git pull in source directory
- `--use-existing-tar`, `-e`                    Use existing tar file from /home/cprime/enrollment-installer in container
- `--container`, `-c <name>`                    Specify the container name (default: connector-261)
- `--help`, `-h`                                Show help message

## Examples

```bash
# Full deployment with default container
./deployConnector.sh
./deployConnectorEnrollment.sh

# Deploy to a specific container
./deployConnector.sh --container my-connector-123
./deployConnectorEnrollment.sh --container my-connector-123

# Development (skip tests for speed)
./deployConnector.sh --skip-tests
./deployConnectorEnrollment.sh --skip-tests

# Use existing tar file in container (no build/copy needed)
./deployConnector.sh --use-existing-tar
./deployConnectorEnrollment.sh --use-existing-tar

# Deploy to a specific container with existing tar files
./deployConnector.sh --use-existing-tar --container my-connector-123
./deployConnectorEnrollment.sh --use-existing-tar --container my-connector-123

# Specify custom payer container name
./deployConnector.sh --payer-container payer-tc-2

# Deploy to custom connector and payer containers
./deployConnector.sh --container my-connector-123 --payer-container my-payer-123

# Skip connector patch application
./deployConnector.sh --skip-connector-patch

# Use existing tar with custom container and skip patch
./deployConnector.sh --use-existing-tar --container my-container --skip-connector-patch

# Combined options for enrollment with custom container
./deployConnectorEnrollment.sh --use-existing-tar --container my-container

# Use existing build without patch
./deployConnector.sh --skip-build --skip-git-pull --skip-connector-patch
./deployConnectorEnrollment.sh --skip-build --skip-git-pull

# Combined options for custom container
./deployConnector.sh --container my-container --skip-tests --skip-connector-patch
```

## Prerequisites
- Docker container must be running (default: `connector-261` or specify with `--container`)
- Environment variables must be set (`C4SRCDIR` for connector, `C4ESRCDIR` for enrollment) - not needed with `--use-existing-tar`
- Maven must be available in PATH - not needed with `--use-existing-tar`
- Connector server patch files available (if not using `--skip-connector-patch`)
- For `--use-existing-tar`: 
  - Connector: tar file must exist in `/home/cprime/install/connector-distribution` inside container
  - Enrollment: tar file must exist in `/home/cprime/enrollment-installer` inside container

## Best Practices

1. **Use Full Process**: Run complete process (`./deployConnector.sh`) for clean deployments
2. **Skip Tests During Development**: Use `--skip-tests` for faster iteration during development
3. **Custom Containers**: Use `--container` option when working with non-default container names
4. **Patch Management**: Use `--skip-connector-patch` when patch is not needed or already applied
5. **Existing Tar Files**: Use `--use-existing-tar` when you have pre-built tar files in the container
6. **Monitor Output**: Watch script output for errors and deployment status
7. **Set Environment Variables**: Always ensure correct `C4SRCDIR`/`C4ESRCDIR` values (not needed with `--use-existing-tar`)
8. **Container Status**: Verify container is running before deployment with `docker ps`
9. **Sequential Deployment**: Deploy cprime connector before enrollment connector
10. **Development Workflow**: Combine options for efficient development (e.g., `--skip-tests --skip-connector-patch`)
11. **Clean Deployment**: Avoid `--skip-copy` for production deployments to ensure fresh files
12. **Pre-built Artifacts**: Use `--use-existing-tar` for quick deployments with existing builds
