# Connector — Local Development Workflow

## Overview
The Integration Platform Connector handles bidirectional data exchange (EDI, FHIR, HL7).
It runs as a Docker container (`connector`) exposing port **8080**.

## Prerequisites
- Docker Desktop running with `connector` container available
- Git repository cloned locally (set `git_path` in App Config)

## Daily Workflow

### 1. Start the container
```
docker start connector
```
Or use the **App Server** tab in Developer WorkBench.

### 2. Check and pull latest code
Use the **Code** tab in Developer WorkBench.

### 3. Build and deploy
```
cd %SRCDIR_CONNECTOR%
mvn clean package -DskipTests
docker cp target/connector.war connector:/home/connector/webapps/
docker exec connector sh -c "catalina.sh restart"
```

### 4. Manage runtime properties
Use `lconnectorserver` CLI or the **App Server** → Runtime Properties section:
```
lconnectorserver list
lconnectorserver set <key> <value>
```

Properties file inside container: `/home/connector/config/connector.properties`

### 5. Access the application
- Connector API: http://localhost:8080/connector/api/
- Health check: http://localhost:8080/connector/health

## Container Management
```
docker start connector      # Start
docker stop connector       # Stop
docker logs -f connector    # Tail logs
```

## EDI File Directories (inside container)
- Inbox: `/home/connector/edi/inbox`
- Outbox: `/home/connector/edi/outbox`
- Processed: `/home/connector/edi/processed`
- Errors: `/home/connector/edi/errors`
