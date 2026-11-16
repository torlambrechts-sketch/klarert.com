// The workspace's design (Build › Design, docs/05 §4): one node per sheet the person can read, lines for link
// fields, "create item on another sheet" actions, buttons and linked updates, outside destinations as badges. The same
// derivation as a sheet's flow, across sheets. Filters (app, pack, folder, Registers domain, "differs from pack") keep
// the matching sheets and the sheets they connect to, as muted context. Pure.
import { actionTarget, automationHealth, deriveSheetFlow, isLinkField, worseTone } from './derive';
import {
  DESTINATION_LABEL,
  EDGE_KIND_LABEL,
  type Destination,
  type EdgeKind,
  type FlowViewer,
  type FlowWorld,
  type GraphEdge,
  type GraphFilter,
  type GraphNode,
  type LeaveRow,
  type WorkspaceGraph,
} from './types';
import { maskWorld, UNREADABLE_SHEET } from './words';

/** Every sheet and every connection between sheets the person can read. */
export function workspaceGraph(rawWorld: FlowWorld, viewer: FlowViewer): WorkspaceGraph {
  const world = maskWorld(rawWorld);
  const readable = new Set(world.sheets.map((s) => s.id));
  const nodes: GraphNode[] = [];
  for (const sheet of world.sheets) {
    const flow = deriveSheetFlow(world, sheet.id, viewer);
    if (!flow) continue;
    const steps = flow.groups.flatMap((g) => g.steps);
    const outside = new Map<Destination, number>();
    for (const s of steps)
      if (s.leaves) outside.set(s.leaves.destination, (outside.get(s.leaves.destination) ?? 0) + 1);
    const installIds = new Set<string>();
    if (sheet.pack) installIds.add(sheet.pack.installId);
    for (const f of world.fields)
      if (f.sheetId === sheet.id && f.pack) installIds.add(f.pack.installId);
    for (const f of world.forms)
      if (f.sheetId === sheet.id && f.pack) installIds.add(f.pack.installId);
    for (const a of world.automations)
      if (a.sheetId === sheet.id && a.pack) installIds.add(a.pack.installId);
    const packKeys = world.packs.filter((p) => installIds.has(p.installId)).map((p) => p.key);
    nodes.push({
      id: sheet.id,
      name: sheet.name,
      folderId: sheet.folderId,
      folderName: sheet.folderName,
      domain: sheet.domain,
      packKeys,
      packTitle: sheet.pack
        ? (world.packs.find((p) => p.installId === sheet.pack!.installId)?.title ?? null)
        : null,
      inputs: flow.counts.inputs,
      logic: flow.counts.logic,
      outputs: flow.counts.outputs,
      outside: [...outside].map(([destination, count]) => ({
        destination,
        label: DESTINATION_LABEL[destination],
        count,
      })),
      differs: flow.differs,
      tone: steps.reduce<GraphNode['tone']>((t, s) => worseTone(t, s.health?.tone ?? null), null),
      apps: world.apps.filter((a) => a.sheetIds.includes(sheet.id)).map((a) => a.key),
    });
  }

  const edges: GraphEdge[] = [];
  const pairs = new Set<string>();
  for (const f of world.fields) {
    if (!isLinkField(f) || !readable.has(f.sheetId)) continue;
    const to = (f.config as { targetSheetId: string }).targetSheetId;
    if (!readable.has(to)) continue;
    const inverse = (f.config as { inverseFieldId?: string | null }).inverseFieldId ?? null;
    // a two-way link is one line
    const pair = inverse ? [f.id, inverse].sort().join(':') : f.id;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    edges.push({
      id: `link:${pair}`,
      from: f.sheetId,
      to,
      kind: 'link',
      via: f.name,
      ...(inverse ? { twoWay: true } : {}),
      health: null,
    });
  }
  for (const a of world.automations) {
    if (!readable.has(a.sheetId)) continue;
    a.actions.forEach((action, i) => {
      const to = actionTarget(action, a, world);
      if (!to || !readable.has(to)) return;
      const kind: EdgeKind =
        action.type === 'update_linked'
          ? 'update'
          : action.type === 'sync_requirement_checks'
            ? 'sync'
            : a.trigger.type === 'button_clicked'
              ? 'button'
              : 'create';
      edges.push({
        id: `${kind}:${a.id}:${i}`,
        from: a.sheetId,
        to,
        kind,
        via: a.name,
        health: automationHealth(a, world, viewer),
      });
    });
  }
  return { nodes, edges };
}

/** Whether a sheet matches every filter given. */
function matches(n: GraphNode, f: GraphFilter, world: FlowWorld): boolean {
  if (f.app && !world.apps.find((a) => a.key === f.app)?.sheetIds.includes(n.id)) return false;
  if (f.pack && !n.packKeys.includes(f.pack)) return false;
  if (f.group && (f.group === 'none' ? n.folderId !== null : n.folderId !== f.group)) return false;
  if (f.domain && n.domain !== f.domain) return false;
  if (f.differs && !n.differs) return false;
  return true;
}

export const hasFilter = (f: GraphFilter) =>
  !!(f.app || f.pack || f.group || f.domain || f.differs);

/**
 * The matching sheets, every connection that touches one of them, and the sheets at their other ends as context.
 * Without a filter: everything.
 */
export function filterGraph(
  graph: WorkspaceGraph,
  filter: GraphFilter,
  world: FlowWorld,
): WorkspaceGraph {
  if (!hasFilter(filter)) return graph;
  const kept = new Set(graph.nodes.filter((n) => matches(n, filter, world)).map((n) => n.id));
  const edges = graph.edges.filter((e) => kept.has(e.from) || kept.has(e.to));
  const context = new Set(edges.flatMap((e) => [e.from, e.to]).filter((id) => !kept.has(id)));
  return {
    nodes: graph.nodes
      .filter((n) => kept.has(n.id) || context.has(n.id))
      .map((n) => (context.has(n.id) ? { ...n, context: true } : n)),
    edges,
  };
}

/** One row of the Connections table: the same content as the map's lines, in words. */
export interface ConnectionRow {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  kind: EdgeKind;
  kindWords: string;
  via: string;
  health: GraphEdge['health'];
}

export function connectionRows(graph: WorkspaceGraph): ConnectionRow[] {
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? UNREADABLE_SHEET;
  return graph.edges
    .map((e) => ({
      id: e.id,
      from: { id: e.from, name: name(e.from) },
      to: { id: e.to, name: name(e.to) },
      kind: e.kind,
      kindWords: `${EDGE_KIND_LABEL[e.kind]}${e.twoWay ? ', both ways' : ''}`,
      via: e.via,
      health: e.health,
    }))
    .sort((a, b) => a.from.name.localeCompare(b.from.name) || a.to.name.localeCompare(b.to.name));
}

/** Every outside destination of the sheets in the graph (the "Leaves the system" lane), worst health first. */
export function leavesRows(
  rawWorld: FlowWorld,
  viewer: FlowViewer,
  sheetIds?: readonly string[],
): LeaveRow[] {
  const world = maskWorld(rawWorld);
  const only = sheetIds ? new Set(sheetIds) : null;
  return world.sheets
    .filter((s) => !only || only.has(s.id))
    .flatMap((s) => {
      const flow = deriveSheetFlow(world, s.id, viewer);
      return flow
        ? flow.groups.flatMap((g) => g.steps).flatMap((st) => (st.leaves ? [st.leaves] : []))
        : [];
    })
    .sort(
      (a, b) =>
        a.sheetName.localeCompare(b.sheetName) || a.automationName.localeCompare(b.automationName),
    );
}

/** The filter choices that exist in this workspace, for the filter bar. */
export function filterChoices(world: FlowWorld, graph: WorkspaceGraph) {
  const folders = new Map<string, string>();
  const domains = new Set<string>();
  let unfiled = false;
  for (const n of graph.nodes) {
    if (n.folderId && n.folderName) folders.set(n.folderId, n.folderName);
    else unfiled = true;
    if (n.domain) domains.add(n.domain);
  }
  return {
    apps: world.apps.map((a) => ({ key: a.key, title: a.title })),
    packs: [...new Map(world.packs.map((p) => [p.key, p.title])).entries()].map(([key, title]) => ({
      key,
      title,
    })),
    groups: [
      ...[...folders]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      ...(unfiled ? [{ id: 'none', name: 'No folder' }] : []),
    ],
    domains: [...domains].sort(),
  };
}
