// Two-character rail codes for sheets (docs/05 §2.1). Pure: computed from names, never stored.
// Rule: initials of the first two words, letters and digits only ("Hazards (HIRA)" → "HH"); one word → its first two
// characters. Unique in the workspace: if taken, the first letter plus the next consonant of the name, then any next
// letter or digit, then the first letter plus a digit.

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U', 'Y']);

function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/Æ/g, 'AE')
    .replace(/Ø/g, 'O')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function candidates(name: string): string[] {
  const w = words(name);
  if (w.length === 0) return ['SH'];
  const first = w.length > 1 ? `${w[0]![0]}${w[1]![0]}` : w[0]!.slice(0, 2);
  const out = [first.length === 2 ? first : `${first}${first}`];
  const lead = w[0]![0]!;
  const rest = w.join('').slice(1).split('');
  for (const c of rest) if (!VOWELS.has(c) && /[A-Z]/.test(c)) out.push(lead + c);
  for (const c of rest) out.push(lead + c);
  for (let d = 2; d <= 9; d += 1) out.push(`${lead}${d}`);
  return out;
}

/**
 * Codes for the sheets of one workspace. Sheets are taken in creation order so a code never changes when a newer
 * sheet arrives. Returns a map from sheet id to code.
 */
export function sheetCodes(
  sheets: readonly { id: string; name: string; createdAt: string }[],
): Map<string, string> {
  const ordered = [...sheets].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const used = new Set<string>();
  const codes = new Map<string, string>();
  for (const s of ordered) {
    let code = candidates(s.name).find((c) => !used.has(c));
    // every candidate taken (very large workspaces): any free two-character code
    if (!code) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      outer: for (const a of chars)
        for (const b of chars)
          if (!used.has(a + b)) {
            code = a + b;
            break outer;
          }
    }
    code ??= 'SH';
    used.add(code);
    codes.set(s.id, code);
  }
  return codes;
}
