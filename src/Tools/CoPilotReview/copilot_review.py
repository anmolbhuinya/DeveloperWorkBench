"""
CoPilot Review — fetch GitHub Copilot review comments for a Pull Request.
Credentials read from secrets.xlsx (GitHub sheet, github_token key).
"""
import sys
import re
from pathlib import Path
from urllib.parse import urlparse

SECRETS_PATH = Path(__file__).parent.parent.parent / "secrets.xlsx"

# Copilot bot login patterns
COPILOT_LOGINS = {"copilot-pull-request-reviewer[bot]", "github-copilot[bot]"}


def read_github_token(secrets_path=SECRETS_PATH):
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("openpyxl is required: pip install openpyxl")
    if not secrets_path.exists():
        raise FileNotFoundError(f"secrets.xlsx not found: {secrets_path}")
    wb = openpyxl.load_workbook(str(secrets_path), read_only=True, data_only=True)
    if "GitHub" not in wb.sheetnames:
        raise ValueError("No 'GitHub' sheet in secrets.xlsx")
    for row in wb["GitHub"].iter_rows(min_row=2, values_only=True):
        if row and row[0] and str(row[0]).strip() == "github_token" and row[1]:
            wb.close()
            return str(row[1]).strip()
    wb.close()
    raise ValueError("'github_token' key not found in GitHub sheet of secrets.xlsx")


def parse_pr_url(url):
    """Parse https://github.com/owner/repo/pull/123 → (owner, repo, pr_number)."""
    url = url.strip().rstrip("/")
    m = re.search(r'github\.com/([^/]+)/([^/]+)/pull/(\d+)', url)
    if not m:
        raise ValueError(f"Cannot parse GitHub PR URL: {url}")
    return m.group(1), m.group(2), int(m.group(3))


def _gh_get(session, url, params=None):
    resp = session.get(url, params=params, timeout=30, verify=False)
    if resp.status_code == 404:
        raise ValueError(f"Not found (404): {url}")
    if resp.status_code == 403:
        raise PermissionError("GitHub API rate limit or auth error (403)")
    resp.raise_for_status()
    return resp.json()


def _paginate(session, url, params=None):
    items = []
    p = 1
    while True:
        data = _gh_get(session, url, {**(params or {}), "per_page": 100, "page": p})
        if not data:
            break
        items.extend(data)
        if len(data) < 100:
            break
        p += 1
    return items


def is_copilot(user):
    if not user:
        return False
    login = str(user.get("login", "")).lower()
    return (
        login in {l.lower() for l in COPILOT_LOGINS}
        or "copilot" in login
    )


_THREADS_Q = """query($o:String!,$r:String!,$n:Int!,$after:String){repository(owner:$o,name:$r){pullRequest(number:$n){
reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{isResolved comments(first:100){nodes{databaseId}}}}}}}"""


def fetch_resolved_comment_ids(session, owner, repo, pr_number):
    """IDs of inline review comments whose thread is marked resolved (GraphQL; empty set on failure)."""
    resolved, after = set(), None
    try:
        while True:
            resp = session.post("https://api.github.com/graphql", timeout=30, verify=False, json={
                "query": _THREADS_Q, "variables": {"o": owner, "r": repo, "n": pr_number, "after": after}})
            resp.raise_for_status()
            data = resp.json()
            if data.get("errors"):
                break
            rt = data["data"]["repository"]["pullRequest"]["reviewThreads"]
            for t in rt["nodes"]:
                if t.get("isResolved"):
                    resolved.update(c["databaseId"] for c in t["comments"]["nodes"])
            if not rt["pageInfo"]["hasNextPage"]:
                break
            after = rt["pageInfo"]["endCursor"]
    except Exception:
        pass
    return resolved


def mark_resolved_in_body(body, resolved_ids):
    """The review overview is a frozen snapshot ("3 open findings ... · New"); rewrite it to reflect resolved threads."""
    if not body or not resolved_ids:
        return body
    res = tot = 0
    out = []
    for line in body.split("\n"):
        m = re.search(r"#discussion_r(\d+)\)", line)
        if m:
            tot += 1
            if int(m.group(1)) in resolved_ids:
                res += 1
                line = re.sub(r"\s*·\s*[^·\n]*$", "", line) + " · ✅ **Resolved**"
        out.append(line)
    body = "\n".join(out)
    if tot:
        body = re.sub(r"<strong>\d+ open (finding|issue)s?</strong>",
                      f"<strong>{tot - res} open · {res} resolved</strong>", body, count=1)
        if res == tot:
            # collapse the findings block when everything is resolved
            body = re.sub(r"<details\s+open>(\s*<summary><strong>0 open)", r"<details>\1", body, count=1)
            body = re.sub(r"###\s*[^\n]*Changes recommended", "### ✅ All findings resolved", body, count=1)
    return body


def fetch_copilot_review(owner, repo, pr_number, token):
    import requests, urllib3
    urllib3.disable_warnings()

    session = requests.Session()
    session.verify = False
    session.headers.update({
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })

    base = f"https://api.github.com/repos/{owner}/{repo}"

    # PR metadata
    pr_meta = _gh_get(session, f"{base}/pulls/{pr_number}")

    # All reviews — keep only Copilot's
    all_reviews = _paginate(session, f"{base}/pulls/{pr_number}/reviews")
    copilot_reviews = [r for r in all_reviews if is_copilot(r.get("user"))]

    # All inline review comments — keep only Copilot's
    all_comments = _paginate(session, f"{base}/pulls/{pr_number}/comments")
    copilot_comments = [c for c in all_comments if is_copilot(c.get("user"))]

    resolved_ids = fetch_resolved_comment_ids(session, owner, repo, pr_number)

    # Group inline comments by file
    by_file = {}
    for c in copilot_comments:
        path = c.get("path", "")
        by_file.setdefault(path, []).append({
            "id":        c.get("id"),
            "line":      c.get("line") or c.get("original_line"),
            "side":      c.get("side", "RIGHT"),
            "body":      c.get("body", ""),
            "url":       c.get("html_url", ""),
            "created":   c.get("created_at", ""),
            "diff_hunk": c.get("diff_hunk", ""),
            "resolved":  c.get("id") in resolved_ids,
            "author":    (c.get("user") or {}).get("login", ""),
        })

    # Top-level review bodies
    review_summaries = []
    for r in copilot_reviews:
        if r.get("body", "").strip():
            review_summaries.append({
                "id":      r.get("id"),
                "state":   r.get("state", ""),
                "body":    mark_resolved_in_body(r.get("body", ""), resolved_ids),
                "url":     r.get("html_url", ""),
                "submitted": r.get("submitted_at", ""),
            })

    return {
        "pr": {
            "number": pr_number,
            "title":  pr_meta.get("title", ""),
            "state":  pr_meta.get("state", ""),
            "url":    pr_meta.get("html_url", ""),
            "author": (pr_meta.get("user") or {}).get("login", ""),
        },
        "review_summaries": review_summaries,
        "files": [
            {"path": path, "comments": comments}
            for path, comments in sorted(by_file.items())
        ],
        "total_comments": len(copilot_comments),
        "resolved_comments": sum(1 for c in copilot_comments if c.get("id") in resolved_ids),
        "total_reviews":  len(copilot_reviews),
    }


if __name__ == "__main__":
    import argparse, json
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="GitHub PR URL")
    args = parser.parse_args()

    token = read_github_token()
    owner, repo, pr_num = parse_pr_url(args.url)
    result = fetch_copilot_review(owner, repo, pr_num, token)
    print(json.dumps(result, indent=2))
