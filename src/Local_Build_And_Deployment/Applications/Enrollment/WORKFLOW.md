# Enrollment — Local Development Workflow

## Overview
The Health Enrollment application manages member enrollment, eligibility, and group/individual subscriptions.
It runs as a Tomcat container (`enrollment-tc`) exposing port **7003**.

## Prerequisites
- Docker Desktop running with `enrollment-tc` container available
- Git repository cloned locally (set `git_path` in App Config)
- Payor server running (for eligibility integration): http://localhost:7001

## Daily Workflow

### 1. Start the container
```
docker start enrollment-tc
```
Or use the **App Server** tab in Developer WorkBench.

### 2. Check and pull latest code
Use the **Code** tab in Developer WorkBench.

### 3. Build and deploy
```
cd %SRCDIR_ENROLLMENT%
ant deploy-enrollment
```
After deploying, update the **Deployed Info** in the App Server tab.

### 4. Manage runtime properties
Use `lenrollmentserver` CLI or the **App Server** → Runtime Properties section:
```
lenrollmentserver list
lenrollmentserver set <key> <value>
lenrollmentserver del <key>
```

Properties file inside container: `/home/weblogic/domains/healthedge/runtime.properties`

### 5. Access the application
- Enrollment UI: http://localhost:7003/Enrollment
- Eligibility API: http://localhost:7003/web-services/EligibilityService
- Member API: http://localhost:7003/web-services/MemberService

## Container Management
```
docker start enrollment-tc      # Start
docker stop enrollment-tc       # Stop
docker restart enrollment-tc    # Restart
docker logs -f enrollment-tc    # Tail logs
```

## Integration with Payor
The Enrollment server integrates with Payor for eligibility lookups.
Ensure `PAYOR_BASE_URL` in runtime properties points to http://localhost:7001/web-services/
