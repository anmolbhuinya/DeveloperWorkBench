# PIK — Local Development Workflow

## Overview
The Payment Innovation Kit (PIK) provides advanced payment processing: auto-adjudication of payment requests,
remittance handling, value-based payment models, and payment analytics.
It runs as a Tomcat container (`pik-tc`) exposing port **7004**.

## Prerequisites
- Docker Desktop running with `pik-tc` container available
- Git repository cloned locally (set `git_path` in App Config)
- Payor server running (for adjudication): http://localhost:7001

## Daily Workflow

### 1. Start the container
```
docker start pik-tc
```
Or use the **App Server** tab in Developer WorkBench.

### 2. Check and pull latest code
Use the **Code** tab in Developer WorkBench.

### 3. Build and deploy
```
cd %SRCDIR_PIK%
ant deploy-pik
```
After deploying, update the **Deployed Info** in the App Server tab.

### 4. Manage runtime properties
Use `lpikserver` CLI or the **App Server** → Runtime Properties section:
```
lpikserver list
lpikserver set <key> <value>
lpikserver del <key>
```

Properties file inside container: `/home/weblogic/domains/healthedge/runtime.properties`

### 5. Access the application
- PIK API: http://localhost:7004/pik/api/
- Payment requests: http://localhost:7004/pik/api/payments
- Remittance: http://localhost:7004/pik/api/remittance

## Container Management
```
docker start pik-tc      # Start
docker stop pik-tc       # Stop
docker restart pik-tc    # Restart
docker logs -f pik-tc    # Tail logs
```

## Integration with Payor
PIK uses the Payor adjudication engine for claim processing.
Ensure `PAYOR_BASE_URL` in runtime properties points to http://localhost:7001/web-services/
