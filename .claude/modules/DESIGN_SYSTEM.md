# Design System

Load this when working on UI components, layouts, theming, or any visible surface.

The look-and-feel takes its cues from Anthropic's product surfaces — claude.ai, docs.claude.com, the Claude Code CLI, anthropic.com. Warm, paper-feeling, low-ornament, high-information-density when needed but never cluttered. Audit-friendly. The interface should read as serious compliance software, never as cold enterprise IT.

## 1. Color system

Palette derived from Anthropic's brand language. Three layers: **raw colors**, **semantic tokens**, **Tailwind class aliases**. Component code references semantic tokens or Tailwind aliases — never raw hex.

### Raw colors

```
ink           #141413   Text-primary, dark surfaces
paper         #faf9f5   App background (the "Claude cream")
paper-deep    #f0ece0   Elevated cream / composer
bone          #e8e6dc   Light borders, dividers, subtle fills
stone         #b0aea5   Muted text, placeholder, disabled
graphite      #3d3d3a   Text-secondary
slate         #6b6a64   Tertiary text, captions

copper        #d97757   Primary action, links, focus rings
copper-deep   #b85d40   Hover/active
copper-soft   #f5e2d6   Tinted backgrounds, badges, selected rows
sky           #6a9bcc   Informational
moss          #788c5d   Success
amber         #c9923a   Warning
clay          #b1483a   Destructive (warmer than typical red)
```

### Semantic tokens

| Token | Light | Dark |
|---|---|---|
| `background`        | `#faf9f5` | `#1a1a18` |
| `surface`           | `#ffffff` | `#23231f` |
| `surface-elevated`  | `#ffffff` | `#2b2a27` |
| `surface-sunken`    | `#f0ece0` | `#1f1e1b` |
| `border`            | `#e8e6dc` | `#33332e` |
| `border-strong`     | `#d4d1c2` | `#454039` |
| `text-primary`      | `#141413` | `#faf9f5` |
| `text-secondary`    | `#3d3d3a` | `#c9c6b8` |
| `text-muted`        | `#6b6a64` | `#8a8780` |
| `text-disabled`     | `#b0aea5` | `#5a574f` |
| `accent`            | `#d97757` | `#e08c6e` |
| `accent-foreground` | `#ffffff` | `#141413` |
| `ring`              | `#d97757` | `#e08c6e` |
| `success`           | `#788c5d` | `#9aae7c` |
| `warning`           | `#c9923a` | `#dcab59` |
| `destructive`       | `#b1483a` | `#cd6354` |

Dark mode is warm off-charcoal (`#1a1a18`), never pure black. Borders stay low-contrast (~6 % luminance step). Do **not** use Tailwind's default `gray-*` scale — every neutral maps to the tokens above.

## 2. Typography

Anthropic uses Styrene + Tiempos (commercial). claude.ai falls back to system stacks; we mirror that with free equivalents.

- **Sans / UI**: `"Inter", ui-sans-serif, system-ui` — all UI chrome, headings, body
- **Serif / long-form**: `"Source Serif Pro", Georgia, serif` — document viewer, AML legal text, audit exports only
- **Mono**: `"JetBrains Mono", ui-monospace` — tracking codes, certificate numbers, IDs, audit hashes

### Type scale (16 px base, modular 1.2)

| Token | Size | Line | Tracking | Use |
|---|---|---|---|---|
| `display` | 3.052rem (49 px) | 1.10 | -0.02em  | Marketing hero only |
| `h1`      | 2.441rem (39 px) | 1.15 | -0.015em | Page title |
| `h2`      | 1.953rem (31 px) | 1.20 | -0.01em  | Section heading |
| `h3`      | 1.563rem (25 px) | 1.25 | -0.005em | Subsection |
| `h4`      | 1.25rem  (20 px) | 1.30 | 0        | Card title |
| `body-lg` | 1.125rem (18 px) | 1.60 | 0        | Lead paragraph |
| `body`    | 1rem     (16 px) | 1.55 | 0        | Default |
| `body-sm` | 0.875rem (14 px) | 1.50 | 0        | Dense UI, tables |
| `caption` | 0.75rem  (12 px) | 1.40 | 0.01em   | Metadata, timestamps |
| `mono`    | 0.875rem (14 px) | 1.50 | 0        | Codes, IDs |

Weights: `400` body, `500` UI labels, `600` headings, `700` only for `display`. Never 800/900.

## 3. Spatial system

4 px base, 8 px rhythm. Constrain Tailwind defaults to this scale.

- **Spacing**: `0, 1 (4), 2 (8), 3 (12), 4 (16), 5 (20), 6 (24), 8 (32), 10 (40), 12 (48), 16 (64), 24 (96)`. Forbid arbitrary values via `theme.spacing` override.
- **Containers**: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1440`, `prose 65ch`.
- **Page gutter**: `px-6` mobile, `px-10` tablet, `px-12` desktop.
- **Section rhythm**: `py-10` between sections on dashboards, `py-16` on marketing pages.

### Radii (Claude UI is soft)

- `sm` 6 px (inputs, badges)
- `DEFAULT` 10 px (buttons, cards)
- `lg` 14 px (modals, popovers)
- `xl` 20 px (composer, hero cards)
- `full` 9999 px (avatars, pill filters)

### Borders & elevation

Claude almost never uses shadows. Default: 1 px `border` token, no shadow. Shadows reserved for floating elements:

- `shadow-sm`  `0 1px 2px rgba(20,20,19,0.04)` — hover lift on interactive cards
- `shadow-md`  `0 4px 12px rgba(20,20,19,0.06)` — dropdowns, popovers
- `shadow-lg`  `0 12px 32px rgba(20,20,19,0.08)` — modals only

## 4. Component patterns

### Buttons

Three variants, three sizes. No gradients, no glow.

- `primary`: `bg-accent text-accent-foreground` → hover `bg-copper-deep`. Focus ring 2 px copper @ 40 % alpha + 2 px offset.
- `secondary`: `bg-surface border border-border text-primary` → hover `bg-surface-sunken`.
- `ghost`: transparent → hover `bg-surface-sunken`. Toolbar / nav use.
- `destructive`: `bg-destructive text-white`.

Sizes: `sm` (h-8 px-3 text-sm), `md` (h-10 px-4 text-sm), `lg` (h-11 px-5 text-base). Icon-only buttons square at the same height. Loading spinner inline left — never replace the label.

### Cards

Flat by default. `bg-surface border border-border rounded-lg p-6`. Elevated variant adds `shadow-sm` on hover for clickable cards. Don't combine `shadow` and `border-strong`.

### Inputs / selects / checkboxes

shadcn primitives retoned to copper. Inputs always wrapped in `<FormField>`. Focus ring uses `accent`, never Tailwind blue.

### Empty / loading / error states

First-class components. Centered, generous whitespace, single secondary line, single primary action. Icon 32 px, copper @ 60 % alpha or stone.

### Navigation

Sidebar left, content right. Sidebar 264 px → 64 px icon-rail when collapsed. Top bar reserved for org switcher, search, user menu. Breadcrumbs on detail pages, never on dashboards.

### Data density (three modes per list)

- **Cards** — ≤ 20 items with rich preview (alerts, surveys).
- **Table (`DataGrid`)** — ≥ 20 items or sortable data (tasks, audit log).
- **Compact list** — nav-like collections (templates, registries).

A list view exposes a density toggle but defaults based on row count.

## 5. Motion

Subtle, springy, never bouncy. Respect `prefers-reduced-motion` — fall back to opacity-only.

- `duration-fast` 120 ms — hover, focus, simple state changes
- `duration` 200 ms — modals fade-in, drawer slide
- `duration-slow` 320 ms — page transitions, large surfaces
- Easing: `cubic-bezier(0.2, 0, 0, 1)` default; spring only on draggables.

## 6. Iconography

`lucide-react` only. Stroke width `1.75` (lighter than default 2). Sizes: `14 / 16 / 20 / 24`.

- 16 px next to body text
- 20 px in buttons
- 24 px in empty states
- 14 px in dense table cells

Icon color inherits `currentColor`. Never hardcoded. No two icons in one button. No decorative icons next to headings.

## 7. Voice and copy

Anthropic copy is careful, plain, low on superlatives. Apply this:

- Verbs over adjectives. "Send avvik" not "Send inn ditt avvik nå!".
- No exclamation points except real warnings.
- No emojis in product UI. Allowed only in user-authored comment fields.
- Empty states explain *why* it's empty, then offer the next step.
- Confirmations are concrete: "Lagret", "Sendt til AMU" — not "Success!".
- Errors name what failed and what to do; never the stack trace.
- Norwegian translations preserve tone — formal `du`, no marketing fluff. Built-in templates use Arbeidstilsynet-grade legal phrasing.

## 8. Layout patterns by page type

| Page type | Layout |
|---|---|
| **Dashboard** (org home) | Sidebar + grid of section cards via registry. 12-col grid; sections declare colspan. |
| **List view** (avvik, tasks) | Sidebar + filter rail (left, 240 px) + DataGrid or card grid. |
| **Detail view** (single alert, document) | Sidebar + 2-col content (main 8/12 + right rail 4/12 for metadata, audit log, related). Mirrors claude.ai's chat+detail split. |
| **Builder** (template, workflow, checklist) | Sidebar + 3-col: palette / canvas / inspector. |
| **Runner** (anonym form, e-learning lesson) | No sidebar. Centered `max-w-prose`. Paper background. Mirrors docs.claude.com reading layout. |
| **Public form** (anonym varsling) | No chrome at all. Centered card on `bg-surface-sunken`. Tracking code shown in mono. |
| **Audit export** | Print stylesheet, serif body, no color except destructive flags. |

## 9. `lib/design/tokens.ts`

```ts
export const colors = {
  ink: '#141413', paper: '#faf9f5', paperDeep: '#f0ece0',
  bone: '#e8e6dc', stone: '#b0aea5', graphite: '#3d3d3a', slate: '#6b6a64',
  copper: '#d97757', copperDeep: '#b85d40', copperSoft: '#f5e2d6',
  sky: '#6a9bcc', moss: '#788c5d', amber: '#c9923a', clay: '#b1483a',
} as const;

export const radii = {
  sm: '0.375rem', DEFAULT: '0.625rem', lg: '0.875rem', xl: '1.25rem', full: '9999px',
} as const;

export const space = {
  0: '0', 1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem', 5: '1.25rem',
  6: '1.5rem', 8: '2rem', 10: '2.5rem', 12: '3rem', 16: '4rem', 24: '6rem',
} as const;

export const fonts = {
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  serif: '"Source Serif Pro", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const motion = {
  durationFast: '120ms', duration: '200ms', durationSlow: '320ms',
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;
```

CSS variables live in `app/globals.css` under `:root` and `.dark`, expressed as HSL triplets so Tailwind opacity modifiers (`bg-accent/30`) work.

## 10. Wrapper components to build

Under `components/shell/`, `components/primitives/`, `components/states/`, `components/data/`:

| Component | Purpose |
|---|---|
| `<PageShell header sidebar main rightRail?>` | Top-level frame. Sidebar collapse, sticky header (h-14), optional 320 px right rail. |
| `<Section title description actions>` | Wraps every registered section component. Enforces `py-8`, heading hierarchy, action slot top-right. |
| `<Card variant?>` | Flat surface with `border` + `rounded-lg` + `p-6`. Variants: `interactive`, `elevated`, `sunken`. |
| `<Surface as elevation>` | Primitive for any tonal background block. `elevation: flat | raised | sunken`. |
| `<Stack gap align>` | Vertical flex with token-only `gap`. |
| `<Cluster gap wrap>` | Horizontal flex with wrap. Tag rows, action bars. |
| `<Grid cols gap>` | 12-col aware grid wrapper. |
| `<EmptyState icon title description action>` | Centered empty state. |
| `<ErrorState title description retry>` | Destructive tint, retry button. |
| `<LoadingState variant>` | `skeleton` or `spinner`; never both. |
| `<DataGrid columns data>` | Wraps TanStack Table. Sort, filter, pagination, density toggle, CSV export hook. |
| `<FormField name label description>` | Wraps shadcn `Label`, control, `FormMessage`. Integrates with React Hook Form + Zod. |
| `<Toolbar>` | Sticky 56 px bar with `Cluster`-based action groups. |
| `<MetaList>` | Definition-list primitive for detail-view right rails (label / value pairs). |
| `<Badge tone>` | Pill with semantic tone (`neutral / accent / success / warning / destructive`). |
| `<Tag closable>` | Removable tag for filter chips. |
| `<KBD>` | Keyboard shortcut rendering. |
| `<AuditTrail entries>` | Standardized audit log timeline used across detail views. |

Every wrapper accepts `className` (merged via `cn()`) but forbids `style`. No wrapper accepts a `color` prop — colors come from variants only.

## 11. The registry contract

`COMPONENT_REGISTRY` is a typed map. Each section component declares:

```ts
{
  id: 'AvvikKanban',
  component: AvvikKanban,                    // lazy-loaded
  module: 'alert',                           // gated by organization_modules
  permissions: ['avvik.read'],               // gated by has_permission
  layout: { colspan: 8, rowspan: 'auto' },   // grid hint
  i18nKey: 'sections.avvikKanban',           // for picker UI
  preview: 'kanban-preview.png',             // shown in the layout editor
}
```

The layout engine reads `pages` + `page_sections` rows and renders only sections whose `module` is enabled and whose `permissions` the user holds. **Never import a section component directly.**

## 12. Anti-patterns

- Don't `style={{ color: '...' }}`. Use a variant.
- Don't add a new color outside the palette. Add a semantic token first.
- Don't use shadow without a clear reason — Anthropic's surfaces are flat.
- Don't write CSS modules or `.css` files outside `globals.css` and `theme.css`. Tailwind + tokens.
- Don't use Tailwind arbitrary values (`p-[17px]`). If the scale doesn't have it, extend the scale.
- Don't ship a component that doesn't have an empty / loading / error state defined.
- Don't render lists without virtualization beyond ~200 rows. Use `DataGrid` virtual mode.
- Don't mix serif and sans in the same surface except where the serif is *content* (document viewer).
- Don't introduce a new font without explicit approval.

## 13. Accessibility

- Color contrast ≥ AA on all text (4.5:1 body, 3:1 large). Verify with the palette above (already passes).
- Focus ring is always visible. Never `outline: none` without a replacement.
- Every interactive element has an accessible name. Icon-only buttons require `aria-label`.
- Form errors announced via `aria-live="polite"`.
- Tables use proper `<th scope>` and caption.
- Skip-to-content link on every authenticated route.
- Keyboard reachable: every action surfaced in `<Toolbar>` has a shortcut documented in `<KBD>`.

## 14. Norwegian text considerations

- Norwegian words are longer than English. Buttons and table headers must accommodate ~30% width growth — don't fix widths.
- Date format: `dd.MM.yyyy` (e.g. `23.05.2026`). Use `date-fns` with `nb` locale; never hardcode.
- Number format: thousands separator `space` (`1 234 567`), decimal `,`.
- Currency: `1 234,50 kr` (suffix, lowercase). Use `Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK' })`.
- Postal codes: `0123` (4 digits). Validate but don't reformat.
- Organisasjonsnummer: 9 digits, validate with mod-11. Display as `123 456 789`.
