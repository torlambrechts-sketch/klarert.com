'use client';

import { createContext, useContext } from 'react';
import {
  trendLabel,
  trendOf,
  trendPolarity,
  type TrendChange,
  type TrendTone,
} from '@/engine/values/trend';
import type { Ctx, Field, Item } from '@/engine/types';

// The trend line after a score in the Table (docs/05 §3.1): the value's recent history as a small line with a dot at
// the current value, coloured by whether the change is good (green), bad (red) or neither (grey), with the direction
// in words for screen readers and on hover. The host (the Table) provides the history and whether to show lines.

export interface TrendState {
  /** Comfortable density on wider screens; compact rows and phone cards show no lines. */
  show: boolean;
  /** Changes per item and field (groupChanges); null while loading. */
  history: ReadonlyMap<string, TrendChange[]> | null;
}

export const TrendContext = createContext<TrendState>({ show: false, history: null });

const W = 64;
const H = 20;
const PAD = 3;

const STROKE: Record<TrendTone, string> = {
  good: 'var(--green-700)',
  bad: 'var(--red-700)',
  neutral: 'var(--gray-700)',
};

/** Space for the line, reserved while the history loads and kept when there is none, so cells do not shift. */
export function TrendLine({
  field,
  item,
  value,
  ctx,
}: {
  field: Field;
  item: Item;
  value: unknown;
  ctx: Ctx;
}) {
  const { show, history } = useContext(TrendContext);
  if (!show || trendPolarity(field) === null) return null;
  const trend = history ? trendOf(history, item.id, field, value, ctx) : null;
  if (!trend || trend.points.length < 2)
    return <span aria-hidden className="block shrink-0" style={{ width: W, height: H }} />;
  const { points } = trend;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const xy = points.map((p, i) => [
    PAD + (i / (points.length - 1)) * (W - PAD * 2),
    // a level line sits in the middle
    Math.max(...points) === min ? H / 2 : H - PAD - ((p - min) / span) * (H - PAD * 2),
  ]);
  const [ex, ey] = xy[xy.length - 1]!;
  const label = trendLabel(trend);
  const stroke = STROKE[trend.tone];
  return (
    <svg
      role="img"
      aria-label={label}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="block shrink-0"
      data-trend={trend.direction}
      data-tone={trend.tone}
    >
      <title>{label}</title>
      <polyline
        points={xy.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={ex} cy={ey} r={2.5} fill={stroke} />
    </svg>
  );
}
