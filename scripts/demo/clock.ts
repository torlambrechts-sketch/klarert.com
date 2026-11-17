// The demo's injected clock: every date in the demo workspace is written relative to "today", so the example always
// looks current (an overdue item is overdue by the same few days, a calibration is due next month) whenever the seed
// runs. Pure: today comes in as an ISO date.

export interface DemoClock {
  /** Today, YYYY-MM-DD. */
  today: string;
  /** The date n days from today (negative: in the past). */
  day(n: number): string;
  /** The date n months from today, on the given day of that month (clamped to its length). */
  month(n: number, dayOfMonth?: number): string;
  /** A date-time n days from today at hh:mm UTC, as an ISO instant. */
  at(n: number, time: string): string;
  /** "Q3 2026" for the quarter n quarters from today's. */
  quarter(n: number): string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function demoClock(today: string): DemoClock {
  if (!ISO.test(today)) throw new Error(`Not a date: ${today}`);
  const base = new Date(`${today}T00:00:00Z`);
  return {
    today,
    day(n) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + n);
      return iso(d);
    },
    month(n, dayOfMonth) {
      const y = base.getUTCFullYear();
      const m = base.getUTCMonth() + n;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const day = Math.min(dayOfMonth ?? base.getUTCDate(), last);
      return iso(new Date(Date.UTC(y, m, day)));
    },
    at(n, time) {
      if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`Not a time: ${time}`);
      return `${this.day(n)}T${time}:00.000Z`;
    },
    quarter(n) {
      const q0 = base.getUTCFullYear() * 4 + Math.floor(base.getUTCMonth() / 3) + n;
      return `Q${(q0 % 4) + 1} ${Math.floor(q0 / 4)}`;
    },
  };
}

/** Today in a time zone, YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}
