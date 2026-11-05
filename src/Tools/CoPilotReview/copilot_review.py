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


def _parse_xml_lines(text):
    """Tiny XML tree {tag, text, children, line} - ElementTree cannot report line numbers."""
    import xml.parsers.expat as ex
    root, stack = None, []

    def start(name, attrs):
        nonlocal root
        el = {"tag": name.split("}")[-1], "text": "", "children": [], "line": p.CurrentLineNumber}
        if stack:
            stack[-1]["children"].append(el)
        else:
            root = el
        stack.append(el)

    def end(name):
        stack.pop()

    def chars(data):
        if stack:
            stack[-1]["text"] += data

    p = ex.ParserCreate(namespace_separator="}")
    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, end, chars
    try:
        p.Parse(text.encode("utf-8") if isinstance(text, str) else text, True)
    except Exception:
        return None
    return root


def _kid(el, name):
    return next((c for c in (el or {}).get("children", []) if c["tag"] == name), None)


def _txt(el, name):
    k = _kid(el, name)
    return (k["text"].strip() if k else "")


class _PomContext:
    """Resolves dependency versions / scopes of one pom the way Maven would: own + parent chain properties and
    dependencyManagement. Parent poms are read from the repository at the same commit."""

    def __init__(self, fetch, path, sha, depth=0):
        import posixpath
        self.path, self.root = path, _parse_xml_lines(fetch(path, sha) or "")
        self.props, self.managed = {}, {}
        self.module = self.group = self.version = ""
        if self.root is None:
            return
        par = _kid(self.root, "parent")
        if par is not None and depth < 6:
            rel = _txt(par, "relativePath") or "../pom.xml"
            ppath = posixpath.normpath(posixpath.join(posixpath.dirname(path), rel))
            if not ppath.endswith(".xml"):
                ppath = posixpath.join(ppath, "pom.xml")
            pc = _PomContext(fetch, ppath, sha, depth + 1)
            if pc.root is not None:
                self.props.update(pc.props)
                self.managed.update(pc.managed)
            self.props.setdefault("project.parent.version", _txt(par, "version"))
            self.props["parent.version"] = _txt(par, "version")
            self.props["project.parent.groupId"] = _txt(par, "groupId")
        pr = _kid(self.root, "properties")
        if pr is not None:
            for c in pr["children"]:
                self.props[c["tag"]] = c["text"].strip()
        self.module = _txt(self.root, "artifactId")
        self.group = _txt(self.root, "groupId") or (_txt(par, "groupId") if par else "")
        self.version = _txt(self.root, "version") or (_txt(par, "version") if par else "")
        for k in ("project.version", "pom.version", "version"):
            self.props[k] = self.version
        self.props["project.groupId"] = self.group
        self.props["project.artifactId"] = self.module
        dm = _kid(_kid(self.root, "dependencyManagement"), "dependencies")
        for d in (dm["children"] if dm else []):
            if d["tag"] == "dependency":
                self.managed[(self.res(_txt(d, "groupId")), self.res(_txt(d, "artifactId")))] = {
                    "version": self.res(_txt(d, "version")), "scope": self.res(_txt(d, "scope"))}

    def res(self, v):
        for _ in range(8):
            n = re.sub(r"\$\{([^}]+)\}", lambda m: self.props.get(m.group(1), m.group(0)), v or "")
            if n == v:
                break
            v = n
        return v

    def entries(self):
        """Resolved dependency declarations of this pom: module, group, artifact, version, scope, line, section."""
        out = []
        if self.root is None:
            return out

        def walk(el, anc):
            for c in el["children"]:
                if c["tag"] == "dependency" and anc and anc[-1] == "dependencies" and "plugin" not in anc and "plugins" not in anc:
                    g, a = self.res(_txt(c, "groupId")), self.res(_txt(c, "artifactId"))
                    if not a:
                        continue
                    sec = "dependencyManagement" if "dependencyManagement" in anc else "dependencies"
                    mg = self.managed.get((g, a), {})
                    v = self.res(_txt(c, "version")) or (mg.get("version") if sec == "dependencies" else "") or ""
                    sc = self.res(_txt(c, "scope")) or (mg.get("scope") if sec == "dependencies" else "") or "compile"
                    if not v:
                        v = "(managed by BOM/parent)"
                    elif "${" in v:
                        v = "(unresolved) " + v
                    out.append({"file": self.path, "module": self.module, "group": g, "artifact": a, "version": v,
                                "scope": sc, "line": c["line"], "section": sec, "type": self.res(_txt(c, "type")) or "jar",
                                "classifier": self.res(_txt(c, "classifier"))})
                else:
                    walk(c, anc + [c["tag"]])
        walk(self.root, [])
        par = _kid(self.root, "parent")
        if par is not None:
            v = self.res(_txt(par, "version"))
            out.append({"file": self.path, "module": self.module, "group": _txt(par, "groupId"), "artifact": _txt(par, "artifactId"),
                        "version": v, "scope": "parent", "line": par["line"], "section": "parent", "type": "pom", "classifier": ""})
        return out


def _json_deps(text, path):
    import json
    try:
        d = json.loads(text)
    except Exception:
        return []
    out = []
    for sec in ("dependencies", "devDependencies", "peerDependencies"):
        for k, v in (d.get(sec) or {}).items():
            out.append({"file": path, "module": d.get("name") or path, "group": "", "artifact": k, "version": str(v),
                        "scope": sec, "line": "", "section": sec, "type": "npm", "classifier": ""})
    return out


def fetch_dependency_changes(owner, repo, pr_number, token):
    """Dependency report of a PR: added / removed / updated, duplicates inside a module and version mismatches in the repo."""
    import requests, urllib3
    from concurrent.futures import ThreadPoolExecutor
    urllib3.disable_warnings()
    session = requests.Session()
    session.verify = False
    session.headers.update({"Authorization": f"token {token}", "Accept": "application/vnd.github+json",
                            "X-GitHub-Api-Version": "2022-11-28"})
    base = f"https://api.github.com/repos/{owner}/{repo}"
    meta = _gh_get(session, f"{base}/pulls/{pr_number}")
    base_sha, head_sha = meta["base"]["sha"], meta["head"]["sha"]
    files = _paginate(session, f"{base}/pulls/{pr_number}/files")
    cache = {}

    def fetch(path, sha):
        k = (path, sha)
        if k not in cache:
            r = session.get(f"{base}/contents/{path}", params={"ref": sha}, timeout=30, verify=False,
                            headers={"Accept": "application/vnd.github.raw"})
            cache[k] = r.text if r.status_code == 200 else ""
        return cache[k]

    def ents(path, sha):
        if path.endswith("package.json"):
            return _json_deps(fetch(path, sha), path)
        return _PomContext(fetch, path, sha).entries()

    key = lambda e: (e["section"], e["group"], e["artifact"], e.get("type", ""), e.get("classifier", ""))
    added, removed, updated, dup_module, changed_pom_paths = [], [], [], [], []
    for f in files:
        path = f.get("filename", "")
        name = path.rsplit("/", 1)[-1]
        if name not in ("pom.xml", "package.json"):
            continue
        before = [] if f.get("status") == "added" else ents(f.get("previous_filename") or path, base_sha)
        after = [] if f.get("status") == "removed" else ents(path, head_sha)
        if name == "pom.xml" and after:
            changed_pom_paths.append(path)
        bmap, amap = {}, {}
        for e in before:
            bmap.setdefault(key(e), e)
        for e in after:
            amap.setdefault(key(e), e)
        for k, e in amap.items():
            if k not in bmap:
                added.append(e)
            elif (bmap[k]["version"], bmap[k]["scope"]) != (e["version"], e["scope"]):
                o = bmap[k]
                updated.append({**e, "from_version": o["version"], "to_version": e["version"],
                                "from_scope": o["scope"], "to_scope": e["scope"]})
        removed += [e for k, e in bmap.items() if k not in amap]
        # duplicates of the same dependency inside this pom (head version)
        grp = {}
        for e in after:
            if e["section"] in ("dependencies", "dependencyManagement"):
                grp.setdefault((e["section"], e["group"], e["artifact"]), []).append(e)
        for k, v in grp.items():
            if len(v) > 1:
                dup_module += v

    # repository-wide: same dependency declared with different versions (only for artifacts this PR touches)
    dup_repo, note = [], ""
    touched = {(e["group"], e["artifact"]) for e in added + [{**u} for u in updated]}
    for p in changed_pom_paths:
        touched |= {(e["group"], e["artifact"]) for e in ents(p, head_sha) if e["section"] == "dependencies"}
    if touched:
        try:
            tree = _gh_get(session, f"{base}/git/trees/{head_sha}", {"recursive": "1"})
            poms = [x["path"] for x in tree.get("tree", []) if x["path"].endswith("pom.xml") and x["type"] == "blob"]
            if tree.get("truncated"):
                note = "Repository tree was truncated by GitHub - the repository-wide check may be incomplete."
            if len(poms) > 400:
                note, poms = "More than 400 pom.xml files - repository-wide check skipped.", []
            with ThreadPoolExecutor(max_workers=8) as ex:
                allents = [e for lst in ex.map(lambda p: ents(p, head_sha), poms) for e in lst]
            occ = {}
            for e in allents:
                if e["section"] in ("dependencies", "dependencyManagement") and (e["group"], e["artifact"]) in touched \
                        and not e["version"].startswith("("):
                    occ.setdefault((e["group"], e["artifact"]), []).append(e)
            for (g, a), v in sorted(occ.items()):
                vers = sorted({x["version"] for x in v})
                if len(vers) > 1:
                    dup_repo += [{**x, "versions": vers} for x in sorted(v, key=lambda x: (x["version"], x["file"], x["line"]))]
        except Exception as ex_:
            note = "Repository-wide check failed: %s" % ex_
    keep = ("file", "module", "group", "artifact", "version", "scope", "line", "section")
    slim = lambda lst, extra=(): [{k: e.get(k, "") for k in keep + tuple(extra)} for e in lst]
    return {
        "pr": {"number": pr_number, "title": meta.get("title", ""), "url": meta.get("html_url", ""), "repo": f"{owner}/{repo}"},
        "added": slim(added), "removed": slim(removed),
        "updated": slim(updated, ("from_version", "to_version", "from_scope", "to_scope")),
        "dup_module": slim(dup_module), "dup_repo": slim(dup_repo, ("versions",)),
        "note": note,
        "totals": {"added": len(added), "removed": len(removed), "updated": len(updated),
                   "dup_module": len(dup_module), "dup_repo": len(dup_repo)},
    }


if __name__ == "__main__":
    import argparse, json
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="GitHub PR URL")
    parser.add_argument("--deps", action="store_true", help="print dependency changes instead of the review")
    args = parser.parse_args()

    token = read_github_token()
    owner, repo, pr_num = parse_pr_url(args.url)
    if args.deps:
        print(json.dumps(fetch_dependency_changes(owner, repo, pr_num, token), indent=2))
        sys.exit(0)
    result = fetch_copilot_review(owner, repo, pr_num, token)
    print(json.dumps(result, indent=2))
