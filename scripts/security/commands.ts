// Inventory of the server commands (M10 security review, docs/09). Reads src/server/commands/*.ts as text and lists
// every exported async function that takes `unknown` input (a command a Server Action calls), with the Zod schema it
// parses that input with and the role check it runs. Used by commands.test.ts (fails when a command lacks either)
// and printed as the table in docs/09-security-review.md:  pnpm exec tsx scripts/security/commands.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface CommandInfo {
  file: string;
  name: string;
  /** The schema whose safeParse validates the input, or null. */
  schema: string | null;
  /** member | editor | admin (withOrg), signed in (getSession), public (allow-listed), or null. */
  role: string | null;
  /** Further checks in the body (admin-only branches, locks, ownership). */
  extra: string[];
  /** safeParse runs before the first await. */
  parsesFirst: boolean;
}

/** Commands reachable without a session, and why that is right. */
export const PUBLIC_COMMANDS: Record<string, string> = {
  submitPublicForm:
    'public form: 64-hex token checked by submit_public_form, rate limit 10/min per hashed IP (pgTAP 0007)',
};

/** The function body: from the `{` that ends the signature line to its matching `}`. */
function bodyOf(text: string, from: number): string {
  const sig = /\)(?::[^\n]*)? \{\n/g;
  sig.lastIndex = from;
  const m = sig.exec(text);
  const open = m ? m.index + m[0].length - 2 : text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

export function inventory(root = process.cwd()): CommandInfo[] {
  const dir = join(root, 'src/server/commands');
  const out: CommandInfo[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    const re = /export async function (\w+)\(\s*(\w+): unknown/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const name = m[1]!;
      const body = bodyOf(text, m.index);
      const parse = body.match(/(\w+)\.safeParse\(/);
      const firstAwait = body.indexOf('await ');
      const withOrg = body.match(/withOrg\(\s*[\w.]+,\s*'(member|editor|admin)'/);
      const role = withOrg
        ? withOrg[1]!
        : /getSession\(\)/.test(body)
          ? 'signed in'
          : name in PUBLIC_COMMANDS
            ? 'public (token)'
            : null;
      const extra: string[] = [];
      if (/isAdminRole\(/.test(body)) extra.push('admin-only branch');
      if (/lockedFor\(|locked/.test(body)) extra.push('locks');
      if (/author_id|ownerId|owner_id/.test(body)) extra.push('own rows');
      out.push({
        file: relative(root, join(dir, f)),
        name,
        schema: parse ? parse[1]! : null,
        role,
        extra,
        parsesFirst: !!parse && (firstAwait < 0 || body.indexOf(parse[0]) < firstAwait),
      });
    }
  }
  return out;
}

/** The markdown table for docs/09. */
export function table(rows: CommandInfo[]): string {
  const lines = [
    '| Command | File | Zod schema | Role check | Also |',
    '|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| \`${r.name}\` | \`${r.file.replace('src/server/commands/', '')}\` | \`${r.schema ?? '—'}\` | ${r.role ?? '**none**'} | ${r.extra.join(', ') || ''} |`,
    ),
  ];
  return lines.join('\n');
}

if (process.argv[1] && /commands\.ts$/.test(process.argv[1])) {
  const rows = inventory();
  console.log(table(rows));
  console.log(`\n${rows.length} commands.`);
}
