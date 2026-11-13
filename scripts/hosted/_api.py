# Shared helper: run SQL on the hosted Supabase project through the Management API. The session's network proxy
# adds the real access token; "dummy" is a placeholder. Override the project with SUPABASE_PROJECT_REF.
import json, os, subprocess, sys

REF = os.environ.get("SUPABASE_PROJECT_REF", "xtksniuybzlnowkyklkx")


def q(sql):
    out = subprocess.run(
        ["curl", "-sS", "-w", "\n%{http_code}", "-X", "POST",
         f"https://api.supabase.com/v1/projects/{REF}/database/query",
         "-H", "Authorization: Bearer dummy", "-H", "Content-Type: application/json", "--data-binary", "@-"],
        input=json.dumps({"query": sql}), capture_output=True, text=True).stdout
    body, code = out.rsplit("\n", 1)
    if code not in ("200", "201"):
        sys.exit(f"HTTP {code}: {body[:800]}")
    return json.loads(body) if body else None
