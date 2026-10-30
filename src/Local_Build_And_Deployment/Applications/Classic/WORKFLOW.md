# Classic — Local Development Workflow

## Overview
HealthEdge Classic (HealthRules Classic) is the legacy adjudication platform.
It runs as a Tomcat container (`classic-tc`) exposing port **7002**.

## Prerequisites
- Docker Desktop running with `classic-tc` container available
- Git repository cloned locally (set `git_path` in App Config)
- `GIT_HOME` and `REPO_CLASSIC` environment variables set

## Daily Workflow

### 1. Start the container
```
docker start classic-tc
```
Or use the **App Server** tab → Start button in Developer WorkBench.

### 2. Check and pull latest code
Use the **Code** tab in Developer WorkBench to:
- View current branch
- Pull latest from remote
- Switch branches

### 3. Build and deploy
```
cd %SRCDIR_CLASSIC%
ant deploy-classic
```
After deploying, update the **Deployed Info** in the App Server tab.

### 4. Manage runtime properties
Use `lclassicserver` CLI or the **App Server** → Runtime Properties section:
```
lclassicserver list
lclassicserver set <key> <value>
lclassicserver del <key>
```

### 5. Access the application
- Classic UI: http://localhost:7002/HealthEdge
- Web Services: http://localhost:7002/web-services/

## Container Management
```
docker start classic-tc     # Start
docker stop classic-tc      # Stop
docker restart classic-tc   # Restart
docker logs -f classic-tc   # Tail logs
```

## Runtime Properties
Properties are stored inside the container at:
`/home/weblogic/domains/healthedge/runtime.properties`

Use `lclassicserver` to manage them while the container is running.
