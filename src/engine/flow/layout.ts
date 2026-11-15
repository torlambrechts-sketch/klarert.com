// Auto layout for the two maps (docs/05 §3.8 Map toggle, §4 Platform › Design): no dragging, no stored positions.
// The workspace map is grouped columns (one per Registers domain or folder, in side-menu order, then "No folder");
// a sheet's map is a hub and spoke (the board's option 1e): the sheet in the centre, inputs left, outputs right,
// relations above and logic below. Both return boxes and SVG paths in pixels. Pure.
import type { FlowFolder, FlowStep, GraphEdge, GraphNode, SheetFlow } from './types';

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapColumn {
  id: string;
  title: string;
  x: number;
  w: number;
}

export interface MapPath {
  id: string;
  d: string;
  /** The edge or step it draws. */
  ref: string;
}

export interface WorkspaceLayout {
  width: number;
  height: number;
  columns: MapColumn[];
  boxes: Box[];
  paths: MapPath[];
}

export const NODE_W = 232;
export const NODE_H = 84;
const COL_GAP = 88;
const ROW_GAP = 16;
const HEAD = 36;
const PAD = 16;

const NO_FOLDER = 'none';

/** One column per folder (domain folders first, as the side menu), nodes by name, context sheets last. */
export function layoutWorkspace(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  folders: readonly FlowFolder[],
): WorkspaceLayout {
  const order = [...folders.filter((f) => f.domain), ...folders.filter((f) => !f.domain)].map(
    (f) => f.id,
  );
  const keyOf = (n: GraphNode) => n.folderId ?? NO_FOLDER;
  const keys = [...new Set(nodes.map(keyOf))].sort((a, b) => {
    const ia = a === NO_FOLDER ? Number.MAX_SAFE_INTEGER : order.indexOf(a);
    const ib = b === NO_FOLDER ? Number.MAX_SAFE_INTEGER : order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });
  const columns: MapColumn[] = [];
  const boxes: Box[] = [];
  let height = 0;
  keys.forEach((key, i) => {
    const x = PAD + i * (NODE_W + COL_GAP);
    const inCol = nodes
      .filter((n) => keyOf(n) === key)
      .sort((a, b) => Number(!!a.context) - Number(!!b.context) || a.name.localeCompare(b.name));
    const title =
      key === NO_FOLDER
        ? 'No folder'
        : (folders.find((f) => f.id === key)?.name ?? inCol[0]?.folderName ?? 'Folder');
    columns.push({ id: key, title, x, w: NODE_W });
    inCol.forEach((n, j) => {
      const y = PAD + HEAD + j * (NODE_H + ROW_GAP);
      boxes.push({ id: n.id, x, y, w: NODE_W, h: NODE_H });
      height = Math.max(height, y + NODE_H + PAD);
    });
  });
  const at = new Map(boxes.map((b) => [b.id, b]));
  const paths: MapPath[] = [];
  for (const e of edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) continue;
    paths.push({ id: e.id, ref: e.id, d: connect(a, b) });
  }
  return {
    width: PAD * 2 + Math.max(1, keys.length) * NODE_W + Math.max(0, keys.length - 1) * COL_GAP,
    height: Math.max(height, PAD * 2 + HEAD + NODE_H),
    columns,
    boxes,
    paths,
  };
}

/** A curve from one box to another: side to side across columns, a loop on the right within a column. */
export function connect(a: Box, b: Box): string {
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  if (a.id === b.id) {
    const x = a.x + a.w;
    return `M ${x} ${ay - 12} C ${x + 40} ${ay - 40}, ${x + 40} ${ay + 40}, ${x} ${ay + 12}`;
  }
  if (Math.abs(a.x - b.x) < 1) {
    const x = a.x + a.w;
    const bend = 28 + Math.min(40, Math.abs(by - ay) / 6);
    return `M ${x} ${ay} C ${x + bend} ${ay}, ${x + bend} ${by}, ${x} ${by}`;
  }
  const forward = b.x > a.x;
  const x1 = forward ? a.x + a.w : a.x;
  const x2 = forward ? b.x : b.x + b.w;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${x2} ${by}`;
}

// ───────────────────────── a sheet's map ─────────────────────────

export type MapSide = 'left' | 'right' | 'top' | 'bottom';

export interface SheetMapNode extends Box {
  side: MapSide;
  step: FlowStep;
}

export interface SheetLayout {
  width: number;
  height: number;
  hub: Box;
  nodes: SheetMapNode[];
  paths: MapPath[];
  /** Where each side's heading goes. */
  labels: { side: MapSide; title: string; x: number; y: number }[];
}

const SW = 184;
const SH = 56;
const GAP = 12;
const HUB_W = 240;
const HUB_H = 88;
const SIDE_GAP = 72;
const PER_ROW = 3;

/** Relations (links both ways) above, logic below, other inputs left, other outputs right. */
export function sideOf(step: FlowStep): MapSide | null {
  if (step.kind === 'sheet' || step.comingLater) return null;
  if (step.kind === 'link_in' || step.kind === 'link_out') return 'top';
  if (step.group === 'logic') return 'bottom';
  return step.group === 'inputs' ? 'left' : 'right';
}

export function layoutSheetMap(flow: SheetFlow): SheetLayout {
  const steps = flow.groups.flatMap((g) => g.steps);
  const by = (side: MapSide) => steps.filter((s) => sideOf(s) === side);
  const left = by('left');
  const right = by('right');
  const top = by('top');
  const bottom = by('bottom');
  const colH = (n: number) => (n ? n * SH + (n - 1) * GAP : 0);
  const rowW = (n: number) => (n ? n * SW + (n - 1) * GAP : 0);
  const LABEL = 24;
  // relations and logic wrap after PER_ROW boxes, so a busy sheet grows down, not sideways
  const lines = (n: number) => Math.ceil(n / PER_ROW);
  const topH = top.length ? LABEL + colH(lines(top.length)) + SIDE_GAP / 2 : 0;
  const bottomH = bottom.length ? SIDE_GAP / 2 + LABEL + colH(lines(bottom.length)) : 0;
  const middleH = Math.max(HUB_H, colH(left.length) + LABEL, colH(right.length) + LABEL);
  const centreW = Math.max(
    HUB_W,
    rowW(Math.min(PER_ROW, top.length)),
    rowW(Math.min(PER_ROW, bottom.length)),
  );
  const width =
    PAD * 2 + (left.length ? SW + SIDE_GAP : 0) + centreW + (right.length ? SIDE_GAP + SW : 0);
  const height = PAD * 2 + topH + middleH + bottomH;
  const cx = PAD + (left.length ? SW + SIDE_GAP : 0) + centreW / 2;
  const midTop = PAD + topH;
  const hub: Box = {
    id: 'hub',
    x: cx - HUB_W / 2,
    y: midTop + (middleH - HUB_H) / 2 + (left.length || right.length ? LABEL / 2 : 0),
    w: HUB_W,
    h: HUB_H,
  };
  const nodes: SheetMapNode[] = [];
  const labels: SheetLayout['labels'] = [];
  const column = (list: FlowStep[], side: 'left' | 'right', x: number) => {
    if (!list.length) return;
    const y0 = midTop + (middleH - colH(list.length) - LABEL) / 2;
    labels.push({ side, title: side === 'left' ? 'Inputs' : 'Outputs', x, y: y0 + 14 });
    list.forEach((step, i) =>
      nodes.push({ id: step.id, side, step, x, y: y0 + LABEL + i * (SH + GAP), w: SW, h: SH }),
    );
  };
  const row = (list: FlowStep[], side: 'top' | 'bottom', y: number, labelY: number) => {
    if (!list.length) return;
    const first = Math.min(PER_ROW, list.length);
    labels.push({
      side,
      title: side === 'top' ? 'Relations' : 'Logic',
      x: cx - rowW(first) / 2,
      y: labelY,
    });
    list.forEach((step, i) => {
      const line = Math.floor(i / PER_ROW);
      const inLine = Math.min(PER_ROW, list.length - line * PER_ROW);
      const x0 = cx - rowW(inLine) / 2;
      nodes.push({
        id: step.id,
        side,
        step,
        x: x0 + (i % PER_ROW) * (SW + GAP),
        y: y + line * (SH + GAP),
        w: SW,
        h: SH,
      });
    });
  };
  column(left, 'left', PAD);
  column(right, 'right', cx + centreW / 2 + SIDE_GAP);
  row(top, 'top', PAD + LABEL, PAD + 14);
  row(
    bottom,
    'bottom',
    midTop + middleH + SIDE_GAP / 2 + LABEL,
    midTop + middleH + SIDE_GAP / 2 + 14,
  );
  const paths: MapPath[] = nodes.map((n) => {
    const hx = hub.x + hub.w / 2;
    const hy = hub.y + hub.h / 2;
    let d: string;
    if (n.side === 'left') {
      const x1 = n.x + n.w;
      const y1 = n.y + n.h / 2;
      const x2 = hub.x;
      const m = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${m} ${y1}, ${m} ${hy}, ${x2} ${hy}`;
    } else if (n.side === 'right') {
      const x1 = hub.x + hub.w;
      const x2 = n.x;
      const y2 = n.y + n.h / 2;
      const m = (x1 + x2) / 2;
      d = `M ${x1} ${hy} C ${m} ${hy}, ${m} ${y2}, ${x2} ${y2}`;
    } else if (n.side === 'top') {
      const x1 = n.x + n.w / 2;
      const y1 = n.y + n.h;
      const m = (y1 + hub.y) / 2;
      d = `M ${x1} ${y1} C ${x1} ${m}, ${hx} ${m}, ${hx} ${hub.y}`;
    } else {
      const x2 = n.x + n.w / 2;
      const y1 = hub.y + hub.h;
      const m = (y1 + n.y) / 2;
      d = `M ${hx} ${y1} C ${hx} ${m}, ${x2} ${m}, ${x2} ${n.y}`;
    }
    return { id: `path:${n.id}`, ref: n.id, d };
  });
  return { width, height, hub, nodes, paths, labels };
}
