/**
 * Replay what a perimeter consumed under two price lists. DISPLAY ONLY.
 *
 * Every unit runs-service counted (status actual or refunded, both key sources) is priced
 * `quantity x price` under list 1 and under list 2 (each list = one price per cost name, the
 * list as it stood on its date). Beside it: the REAL cost of what was consumed, at the real cost
 * of its own consumption day, and what was actually billed for it (runs-service, gross and net
 * of the per-org discount). A unit through a customer's own key costs us nothing unless the
 * subscription declares those units as ours (Serper, Apify).
 *
 * Money in US cents, ratios in percent. A price list with no price for a cost name prices its
 * units at nothing and says so (`unpricedQuantity1/2` per item, `unpricedCostNames1/2` overall);
 * a cost name with no real cost on a day contributes to `realCostUnknownQuantity`, never 0.
 */
import { SUBSCRIPTIONS } from "./subscriptions.js";

export type ConsumptionRow = {
  day: string;
  orgId: string | null;
  brandId?: string | null;
  costName: string;
  costSource: "platform" | "org";
  quantity: number;
  billed: number;
  netBilled: number;
};

export type Interval = "day" | "week" | "month";

export type Figures = {
  amount1UsdCents: number;
  amount2UsdCents: number;
  differenceUsdCents: number;
  differencePct: number | null;
  realCostUsdCents: number;
  margin1UsdCents: number;
  margin1Pct: number | null;
  margin2UsdCents: number;
  margin2Pct: number | null;
  billedUsdCents: number;
  netBilledUsdCents: number;
  billedPlatformKeyUsdCents: number;
  netBilledPlatformKeyUsdCents: number;
};

type Acc = { a1: number; a2: number; real: number; billed: number; netBilled: number; billedP: number; netBilledP: number };

const zero = (): Acc => ({ a1: 0, a2: 0, real: 0, billed: 0, netBilled: 0, billedP: 0, netBilledP: 0 });
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const pct = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1e6) / 1e4);

function figures(a: Acc): Figures {
  return {
    amount1UsdCents: r6(a.a1),
    amount2UsdCents: r6(a.a2),
    differenceUsdCents: r6(a.a2 - a.a1),
    differencePct: pct(a.a2 - a.a1, a.a1),
    realCostUsdCents: r6(a.real),
    margin1UsdCents: r6(a.a1 - a.real),
    margin1Pct: pct(a.a1 - a.real, a.a1),
    margin2UsdCents: r6(a.a2 - a.real),
    margin2Pct: pct(a.a2 - a.real, a.a2),
    billedUsdCents: r6(a.billed),
    netBilledUsdCents: r6(a.netBilled),
    billedPlatformKeyUsdCents: r6(a.billedP),
    netBilledPlatformKeyUsdCents: r6(a.netBilledP),
  };
}

function add(t: Acc, d: Acc) {
  t.a1 += d.a1;
  t.a2 += d.a2;
  t.real += d.real;
  t.billed += d.billed;
  t.netBilled += d.netBilled;
  t.billedP += d.billedP;
  t.netBilledP += d.netBilledP;
}

export function periodOf(day: string, interval: Interval): string {
  if (interval === "day") return day;
  if (interval === "month") return `${day.slice(0, 7)}-01`;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d.toISOString().slice(0, 10);
}

/** Org-key units of these cost names went through OUR account (declared per subscription). */
const ORG_KEY_UNITS_ARE_OURS = new Set(SUBSCRIPTIONS.filter((s) => s.orgKeyRows.count).flatMap((s) => s.creditCostNames));

export type ComparisonInputs = {
  rows: ConsumptionRow[];
  price1: Map<string, number | null>;
  price2: Map<string, number | null>;
  /** `${day}|${costName}` -> real cost per unit that day (US cents); absent/null = unknown. */
  realCost: Map<string, number | null>;
  interval: Interval;
};

export type ItemFigures = Figures & {
  costName: string;
  quantity: number;
  quantityPlatformKey: number;
  price1PerUnitUsdCents: number | null;
  price2PerUnitUsdCents: number | null;
  unpricedQuantity1: number;
  unpricedQuantity2: number;
  realCostUnknownQuantity: number;
};

export function compare(inputs: ComparisonInputs) {
  const { rows, price1, price2, realCost, interval } = inputs;
  const total = zero();
  const byPeriod = new Map<string, Acc>();
  const byItem = new Map<string, { acc: Acc; q: number; qP: number; u1: number; u2: number; uReal: number }>();

  for (const r of rows) {
    const p1 = price1.get(r.costName) ?? null;
    const p2 = price2.get(r.costName) ?? null;
    const ours = r.costSource === "platform" || ORG_KEY_UNITS_ARE_OURS.has(r.costName);
    const unitReal = ours ? (realCost.get(`${r.day}|${r.costName}`) ?? null) : 0;
    const d: Acc = {
      a1: p1 === null ? 0 : r.quantity * p1,
      a2: p2 === null ? 0 : r.quantity * p2,
      real: unitReal === null ? 0 : r.quantity * unitReal,
      billed: r.billed,
      netBilled: r.netBilled,
      billedP: r.costSource === "platform" ? r.billed : 0,
      netBilledP: r.costSource === "platform" ? r.netBilled : 0,
    };
    add(total, d);
    const period = periodOf(r.day, interval);
    const pAcc = byPeriod.get(period) ?? zero();
    add(pAcc, d);
    byPeriod.set(period, pAcc);
    const item = byItem.get(r.costName) ?? { acc: zero(), q: 0, qP: 0, u1: 0, u2: 0, uReal: 0 };
    add(item.acc, d);
    item.q += r.quantity;
    if (r.costSource === "platform") item.qP += r.quantity;
    if (p1 === null) item.u1 += r.quantity;
    if (p2 === null) item.u2 += r.quantity;
    if (unitReal === null) item.uReal += r.quantity;
    byItem.set(r.costName, item);
  }

  const cumulative = zero();
  const buckets = [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, acc]) => {
      add(cumulative, acc);
      return { period, ...figures(acc), cumulative: figures({ ...cumulative }) };
    });

  const costItems: ItemFigures[] = [...byItem.entries()]
    .map(([costName, i]) => ({
      costName,
      quantity: r6(i.q),
      quantityPlatformKey: r6(i.qP),
      price1PerUnitUsdCents: price1.get(costName) ?? null,
      price2PerUnitUsdCents: price2.get(costName) ?? null,
      unpricedQuantity1: r6(i.u1),
      unpricedQuantity2: r6(i.u2),
      realCostUnknownQuantity: r6(i.uReal),
      ...figures(i.acc),
    }))
    .sort((a, b) => b.differenceUsdCents - a.differenceUsdCents || a.costName.localeCompare(b.costName));

  return {
    totals: figures(total),
    unpricedCostNames1: costItems.filter((i) => i.unpricedQuantity1 > 0).map((i) => i.costName),
    unpricedCostNames2: costItems.filter((i) => i.unpricedQuantity2 > 0).map((i) => i.costName),
    realCostUnknownCostNames: costItems.filter((i) => i.realCostUnknownQuantity > 0).map((i) => i.costName),
    buckets,
    costItems,
  };
}

/** Per group key (org, or org x brand): totals only, ranked by difference, largest increase first. */
export function compareByGroup(inputs: Omit<ComparisonInputs, "interval">, key: (r: ConsumptionRow) => string) {
  const groups = new Map<string, ConsumptionRow[]>();
  for (const r of inputs.rows) {
    const k = key(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  return [...groups.entries()]
    .map(([k, rows]) => ({ key: k, ...compare({ ...inputs, rows, interval: "month" }).totals }))
    .sort((a, b) => b.differenceUsdCents - a.differenceUsdCents || a.key.localeCompare(b.key));
}
