# Run supabase/tests (pgTAP) on the hosted project inside rolled-back transactions (run from the repo root).
import glob, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _api import q

fails = 0
for f in sorted(glob.glob("supabase/tests/*.sql")):
    sql = open(f).read()
    assert sql.rstrip().endswith("select * from finish();\nrollback;")
    sql = sql.rstrip()[:-len("select * from finish();\nrollback;")] + "select extensions._get($$curr_test$$) as ran, extensions.num_failed() as failed;"
    rows = q(sql)
    r = rows[0]; fails += r["failed"]
    print(f, f"{r['ran']-r['failed']}/{r['ran']} passed")
left = q("select (select count(*) from pg_extension where extname='pgtap') as pgtap, (select count(*) from public.orgs) as orgs, (select count(*) from auth.users) as users")
print("leftovers:", left)
sys.exit(1 if fails else 0)
