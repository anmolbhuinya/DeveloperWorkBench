"""
api_errors.py — Consistent error messages for expired / invalid credentials,
and a shared requests session that bypasses corporate SSL proxy issues.
Imported by all GP Build scripts that make external API calls.
"""

import urllib3
import requests as _requests
from pathlib import Path

# secrets.xlsx lives two levels above this script (claude_code_workflows/secrets.xlsx)
_SECRETS_PATH = Path(__file__).resolve().parent.parent.parent.parent / "secrets.xlsx"


def _hl(url, text):
    """OSC 8 terminal hyperlink."""
    return f"\x1b]8;;{url}\x1b\\{text}\x1b]8;;\x1b\\"


def _secrets_link(label="secrets.xlsx"):
    """Return a clickable hyperlink to the shared secrets.xlsx file."""
    return _hl(_SECRETS_PATH.as_uri(), label)

# Corporate SSL proxies often present CA certs that fail Python 3.14's stricter
# validation (Basic Constraints not marked critical).  Disable verification
# globally for all tools and suppress the per-request InsecureRequestWarning.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def session():
    """
    Return a requests.Session with SSL verification forcibly disabled.

    Setting s.verify = False alone is insufficient: requests passes verify=None
    (not False) to merge_environment_settings, and send()'s setdefault() does
    not override an already-present None value, so urllib3 ends up with its
    default verify=True.  We fix this by wrapping session.request to always
    inject verify=False explicitly before the call reaches that code path.
    """
    s = _requests.Session()
    s.verify = False
    _orig = s.request
    def _req(method, url, **kwargs):
        kwargs.setdefault("verify", False)
        return _orig(method, url, **kwargs)
    s.request = _req
    return s

# Module-level session used by callers that call requests.get/post directly.
# Import this and use  http.get(...)  instead of  requests.get(...)
http = session()

ATLASSIAN_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens"
GITHUB_TOKEN_URL    = "https://github.com/settings/tokens"


def atlassian_error(code, context=""):
    tag = f"[{context}] " if context else ""
    if code == 401:
        return (
            f"  {tag}Atlassian API token expired or invalid (HTTP 401).\n"
            f"  → Generate a new token : {ATLASSIAN_TOKEN_URL}\n"
            f"  → Update 'jira_api_token' in {_secrets_link()}  (Atlassian sheet)"
        )
    if code == 403:
        return (
            f"  {tag}Atlassian access denied (HTTP 403).\n"
            f"  → Your account may lack permission for this project or resource."
        )
    return f"  {tag}Atlassian returned HTTP {code}."


def github_error(code, context=""):
    tag = f"[{context}] " if context else ""
    if code == 401:
        return (
            f"  {tag}GitHub token expired or invalid (HTTP 401).\n"
            f"  → Generate a new Personal Access Token : {GITHUB_TOKEN_URL}\n"
            f"  → Update 'github_token' in {_secrets_link()}  (GitHub sheet)\n"
            f"  → Required scope: repo  (for private repositories)"
        )
    if code == 403:
        return (
            f"  {tag}GitHub request denied (HTTP 403).\n"
            f"  → Possible causes:\n"
            f"      Token scope insufficient — enable the 'repo' scope\n"
            f"      API rate limit exceeded — wait and retry\n"
            f"  → Token settings : {GITHUB_TOKEN_URL}"
        )
    return f"  {tag}GitHub returned HTTP {code}."


def jenkins_error(code, base_url="", username="", context=""):
    tag = f"[{context}] " if context else ""
    configure_url = (
        f"{base_url.rstrip('/')}/user/{username}/configure"
        if base_url and username
        else "<jenkins_url>/user/<username>/configure"
    )
    if code == 401:
        return (
            f"  {tag}Jenkins API token expired or invalid (HTTP 401).\n"
            f"  → Regenerate token : {configure_url}\n"
            f"      Navigate to → API Token → Add new Token → copy value\n"
            f"  → Update 'jenkins_api_token' in {_secrets_link()}  (Jenkins sheet)"
        )
    if code == 403:
        return (
            f"  {tag}Jenkins access denied (HTTP 403).\n"
            f"  → Possible causes:\n"
            f"      CSRF crumb fetch failed (check VPN / network to Jenkins)\n"
            f"      Account lacks 'Build' permission on this pipeline\n"
            f"  → Token settings : {configure_url}"
        )
    if code == 404:
        return (
            f"  {tag}Jenkins pipeline not found (HTTP 404).\n"
            f"  → Verify gp_base_url / scrum_team / application in gp_job_config.xlsx"
        )
    return f"  {tag}Jenkins returned HTTP {code}."


def connection_error(service, context=""):
    tag = f"[{context}] " if context else ""
    return (
        f"  {tag}Could not connect to {service}.\n"
        f"  → Check VPN / network access and retry."
    )
