# Run SQL on the hosted project: `q.py "select 1"` or `q.py -f file.sql`. A file made by scripts/frameworks-sql.ts
# or scripts/packs-sql.ts is sent one insert at a time (large single requests time out); each insert is idempotent.
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from _api import q

if len(sys.argv) == 3 and sys.argv[1] == "-f":
    sql = open(sys.argv[2]).read()
    body = sql.split("begin;", 1)[1].rsplit("commit;", 1)[0] if "begin;" in sql else sql
    stmts = [s.strip() for s in re.split(r";\s*\n(?=(?:\s*--[^\n]*\n)*\s*insert )", body) if s.strip()]
    for s in stmts:
        q(s.rstrip(";") + ";")
    print(f"ran {len(stmts)} statements")
else:
    print(json.dumps(q(sys.argv[1]))[:3000])
