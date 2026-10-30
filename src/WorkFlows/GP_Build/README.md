# GP Build Tool

Automates GP regression build scheduling via Jenkins, JIRA, and GitHub.

---

## Dependencies

| Package | Purpose | How installed |
|---|---|---|
| `openpyxl` | Read/write `.xlsx` files | `pip install openpyxl` |
| `requests` | HTTP calls to Jenkins / JIRA / GitHub | `pip install requests` |
| `playwright` | Headless browser — Jenkins UI fallback when API returns 403 | `pip install playwright` |
| Chromium | Browser binary used by Playwright (~170 MB) | `playwright install chromium` — **skipped if Chrome/Edge is already installed** |

All dependencies (including Playwright) are installed automatically when you run `setupgptool` for the first time. You will be prompted before anything is downloaded. If Google Chrome or Microsoft Edge is already installed on the machine, Playwright uses it directly — no Chromium download needed.

To install manually:
```
pip install openpyxl requests playwright
# Only needed if Chrome/Edge is NOT installed:
playwright install chromium
```

---

## First-Time Setup

```
setupgptool
```

This creates the skeleton files and optionally installs Playwright + Chromium.

Then:
1. Open `config.xlsx` → Settings and fill in `gp_base_url`, `scrum_team`, `application`
2. Open `secrets.xlsx` → Jenkins sheet and fill in credentials:

| Key | Description |
|---|---|
| `jenkins_username` | Your Jenkins login username |
| `jenkins_api_token` | API token (Jenkins → your profile → Configure → Add new Token) |
| `jenkins_password` | Your actual login password (used by headless browser fallback) |

3. Run:
```
setupgptool -fetchparams
```

---

## Commands

| Command | Description |
|---|---|
| `gprun -t <TICKET> -db <DEST_BRANCH>` | Schedule a GP build for a ticket |
| `gprun -fb <FEATURE_BRANCH> -db <DEST_BRANCH>` | Schedule using feature branch directly |
| `gpstatus` | Show all projects (newest first, 10 per page) |
| `gpstatus -rf` | Refresh Jenkins + PR status for active projects |
| `gpstatus -s <status>` | Filter by status (e.g. `-s running`, `-s passed`) |
| `gpdelete -pid <project_id>` | Delete a project entry |
| `setupgptool` | Create skeleton files + install dependencies |
| `setupgptool -fetchparams` | Fetch Jenkins build parameters and test groups |

---

## Files

| Path | Purpose |
|---|---|
| `config.xlsx` | Jenkins job settings (URL, team, application) |
| `gp_params.xlsx` | Build parameters and test group categories (fetched from Jenkins) |
| `projects.xlsx` | Run history log |
| `tickets/` | Per-ticket build config files (created by `gprun`) |
| `secrets.xlsx` | Shared credentials — one level up from `GP_Build/` |

---

## Jenkins Build Trigger

`gprun` first attempts the Jenkins REST API. If the API returns **403** (CSRF or permission issue), it automatically retries via a headless Chromium browser (Playwright):

1. Logs in to Jenkins using `jenkins_password`
2. Navigates to the `buildWithParameters` page with all parameters pre-filled
3. Submits the form and captures the build queue URL
4. Polls for the Jenkins job ID

No manual intervention is needed — the fallback is transparent.

---

## Secrets File (`secrets.xlsx`)

Located one level above `GP_Build/` at `claude_code_workflows/secrets.xlsx`.

| Sheet | Keys |
|---|---|
| Jenkins | `jenkins_username`, `jenkins_api_token`, `jenkins_password` |
| Atlassian | (used by other tools) |
| GitHub | (used by other tools) |
