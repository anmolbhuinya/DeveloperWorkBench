"""Detached worker for 'Merge Release Branch' - keeps running if the Workbench restarts.

usage: merge_release_job.py <merge|finish> <srcdir> <release_branch> <feature_branch> <state.json>

merge : git pull origin <release>, then git push origin <feature>
finish: (after conflicts were resolved) commit the merge if needed, then push
Progress and the result are written to <state.json> so the UI can show them at any time.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

mode, src, release, cur, state_path = sys.argv[1:6]
state_file = Path(state_path)
state = {"status": "running", "phase": "starting", "mode": mode, "current": cur, "release": release,
         "output": "", "message": "", "conflicts": [], "up_to_date": False, "pid": os.getpid(), "started": time.time()}


def save(**kw):
    state.update(kw)
    state["updated"] = time.time()
    tmp = state_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, state_file)


def git(*args, timeout=600):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_EDITOR="true")
    r = subprocess.run(["git", "-C", src, *args], capture_output=True, text=True, timeout=timeout, env=env,
                       encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()


def conflicts():
    _, out = git("diff", "--name-only", "--diff-filter=U", timeout=60)
    return [f for f in out.splitlines() if f.strip()]


def log(text):
    save(output=(state["output"] + ("\n" if state["output"] else "") + text).strip())


def push():
    save(phase="pushing")
    rc, out = git("push", "origin", cur, timeout=600)
    log("$ git push origin " + cur + "\n" + out)
    if rc != 0:
        save(status="push_failed", phase="done",
             message=f"Merged '{release}' into '{cur}' locally, but pushing to origin failed.")
        return
    up = state["up_to_date"]
    save(status="ok", phase="done",
         message=(f"'{cur}' already contains '{release}' - nothing new to push." if up
                  else f"Merged '{release}' into '{cur}' and pushed to origin."))


try:
    save()
    if mode == "merge":
        save(phase="pulling")
        rc, out = git("pull", "--no-rebase", "--no-edit", "origin", release)
        log("$ git pull origin " + release + "\n" + out)
        c = conflicts()
        if c or (rc != 0 and (Path(src) / ".git" / "MERGE_HEAD").exists()):
            save(status="conflict", phase="done", conflicts=c, message="Merge conflicts need to be resolved.")
        elif rc != 0:
            save(status="error", phase="done", message="git pull failed.")
        else:
            save(up_to_date="already up to date" in out.lower())
            push()
    else:
        c = conflicts()
        if c:
            save(status="conflict", phase="done", conflicts=c, message="Conflicts are still unresolved.")
        else:
            if (Path(src) / ".git" / "MERGE_HEAD").exists():
                git("add", "-u", timeout=120)
                rc, out = git("commit", "--no-edit", timeout=120)
                log("$ git commit --no-edit\n" + out)
                if rc != 0:
                    save(status="error", phase="done", message="Could not complete the merge commit.")
                    sys.exit(0)
            push()
except Exception as e:  # noqa: BLE001 - always leave a final state behind
    save(status="error", phase="done", message=f"Merge worker failed: {e}")
