# Apply supabase/migrations not yet recorded on the hosted project (run from the repo root).
import glob, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _api import q

def lit(s): return "$mig$" + s + "$mig$"
q("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);")
done = {r["version"] for r in q("select version from supabase_migrations.schema_migrations")}
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    base = os.path.basename(f)[:-4]; ver, name = base.split("_", 1)
    if ver in done: print("skip", base); continue
    sql = open(f).read()
    q("begin;\n" + sql + "\n;insert into supabase_migrations.schema_migrations(version, name, statements) values ('%s','%s', array[%s]);\ncommit;" % (ver, name, lit(sql)))
    print("applied", base)
