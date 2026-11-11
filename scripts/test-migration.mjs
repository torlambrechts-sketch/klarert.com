// Smoke test for 0001_core.sql without Docker: runs the migration in PGlite (Postgres in WASM) with a stubbed auth schema,
// then exercises create_item, set_item_values, links, locks, forms, the hash chain and append-only rules.
// Run: pnpm add -D @electric-sql/pglite && node scripts/test-migration.mjs   (RLS is not tested here: PGlite runs as superuser; use pgTAP in supabase/tests)
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
const db = new PGlite({ extensions: { pgcrypto } });
const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
`;
await db.exec(stub);
const sql = fs.readFileSync(new URL('../supabase/migrations/0001_core.sql', import.meta.url),'utf8');
try { await db.exec(sql); console.log('migration OK'); } catch(e) { console.error('MIGRATION FAIL', e.message); process.exit(1); }
const q = async (s, p) => (await db.query(s, p)).rows;
const U1='11111111-1111-1111-1111-111111111111', U2='22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users values ('${U1}'),('${U2}');
insert into profiles(id,display_name,initials) values ('${U1}','Maria Pereira','MP'),('${U2}','Vic Viewer','VV');
insert into orgs(id,name,slug) values ('aaaaaaaa-0000-0000-0000-000000000001','Meridian Components Ltd','meridian');
insert into memberships values ('aaaaaaaa-0000-0000-0000-000000000001','${U1}','owner'),('aaaaaaaa-0000-0000-0000-000000000001','${U2}','viewer');`);
const ORG='aaaaaaaa-0000-0000-0000-000000000001';
await db.exec(`set test.uid='${U1}'`);
const [sh] = await q(`insert into sheets(org_id,name,item_label,id_prefix,position) values ($1,'Corrective actions','Action','CA-','a0') returning id`,[ORG]);
const [g] = await q(`insert into groups(org_id,sheet_id,name,position) values ($1,$2,'Open','a0') returning id`,[ORG,sh.id]);
const [fs1] = await q(`insert into fields(org_id,sheet_id,key,name,type,position,config) values ($1,$2,'status','Status','status','a0','{"options":[{"id":"o1","label":"Open","color":"orange"},{"id":"o2","label":"Done","color":"green","done":true}]}') returning id`,[ORG,sh.id]);
const [fl] = await q(`insert into fields(org_id,sheet_id,key,name,type,position) values ($1,$2,'related','Related','link','a1') returning id`,[ORG,sh.id]);
const [it] = await q(`select * from create_item($1,$2,'Fix guard on press 3','a0', jsonb_build_object($3::text,'"o1"'::jsonb))`,[sh.id,g.id,fs1.id]);
console.log('created', it.display_id, it.values);
const [it2] = await q(`select * from create_item($1,$2,'Second','a1')`,[sh.id,g.id]);
console.log('created', it2.display_id);
const [up] = await q(`select * from set_item_values($1, jsonb_build_object($2::text,'"o2"'::jsonb), 'Fix guard on press 3 (done)')`,[it.id,fs1.id]);
console.log('updated', up.name, up.values);
try { await q(`select * from set_item_values($1, jsonb_build_object($2::text,'["x"]'::jsonb))`,[it.id,fl.id]); console.log('BAD: link via values allowed'); } catch(e){ console.log('ok rejects link in values:', e.message); }
await q(`select * from set_item_links($1,$2,array[$3]::uuid[],'add')`,[fl.id,it.id,it2.id]);
console.log('links', (await q(`select count(*) from item_links`))[0]);
const log = await q(`select id, action, actor_kind, left(prev_hash,8) p, left(hash,8) h from activity_log where item_id=$1 order by id`,[it.id]);
console.log(log);
console.log('verify', (await q(`select verify_activity_chain($1) v`,[it.id]))[0].v);
try { await db.exec(`update activity_log set note='x' where item_id='${it.id}'`); console.log('BAD update allowed'); } catch(e){ console.log('ok append-only:', e.message); }
// viewer cannot write
await db.exec(`set test.uid='${U2}'`);
try { await q(`select * from set_item_values($1, jsonb_build_object($2::text,'"o1"'::jsonb))`,[it.id,fs1.id]); console.log('BAD viewer wrote'); } catch(e){ console.log('ok viewer blocked:', e.message); }
// lock
await db.exec(`set test.uid='${U1}'`);
await q(`select * from set_item_lock($1,true,'Approved')`,[it.id]);
await db.exec(`insert into memberships values ('${ORG}','${U2}','editor') on conflict (org_id,user_id) do update set role='editor'`);
await db.exec(`set test.uid='${U2}'`);
try { await q(`select * from set_item_values($1, jsonb_build_object($2::text,'"o1"'::jsonb))`,[it.id,fs1.id]); console.log('BAD editor edited locked'); } catch(e){ console.log('ok locked:', e.message); }
// move + archive
await db.exec(`set test.uid='${U1}'`);
const [g2] = await q(`insert into groups(org_id,sheet_id,name,position) values ($1,$2,'Closed','a1') returning id`,[ORG,sh.id]);
await q(`select * from move_item($1,$2,'a0')`,[it2.id,g2.id]);
// form
const [fm] = await q(`insert into form_links(org_id,sheet_id) values ($1,$2) returning token`,[ORG,sh.id]);
await db.exec(`set test.uid=''`);
const [fi] = await q(`select * from submit_form($1,'Reported by QR','{}'::jsonb,'a2')`,[fm.token]);
console.log('form item', fi.display_id, (await q(`select actor_kind from activity_log where item_id=$1`,[fi.id]))[0]);
console.log('schema log', (await q(`select action, count(*) from activity_log where item_id is null group by 1 order by 1`)));
console.log('verify sheet chain', (await q(`select chain_key from activity_log where item_id is null limit 1`))[0]);
await db.exec(`set test.uid='${U1}'`);
const ck=(await q(`select chain_key from activity_log where item_id is null limit 1`))[0].chain_key;
console.log('verify sheet', (await q(`select verify_activity_chain($1) v`,[ck]))[0].v);
