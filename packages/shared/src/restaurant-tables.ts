// ── Restaurant table matching + occupancy helpers ─────────────────
// Shared logic for matching a party size to the best-available table
// and for computing a live occupancy summary. Used by every client
// (web desk panel, Station, Expo) so the rules stay consistent.

export type TableStatus =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'cleaning'
  | 'disabled';

export interface RestaurantTable {
  id: string;
  office_id: string;
  code: string;
  label: string;
  zone?: string | null;
  capacity?: number | null;
  min_party_size?: number | null;
  max_party_size?: number | null;
  reservable?: boolean | null;
  status: TableStatus;
  current_ticket_id?: string | null;
  assigned_at?: string | null;
}

export interface TableMatch {
  table: RestaurantTable;
  /** Lower is better. 0 = perfect fit, positive = wasted seats, negative = undersized. */
  score: number;
  /** True when the table strictly fits the party size (capacity >= party, within min/max). */
  fits: boolean;
}

/**
 * Rank available tables for a given party size.
 *   • Perfect fit (capacity === party) wins.
 *   • Next smallest capacity that still fits wins after that.
 *   • Tables with min/max party constraints that exclude the party are filtered out.
 *   • Only `available` tables are considered.
 *   • Zone, reservable and existing assignment never move a table up the list.
 */
export function matchTablesForParty(
  tables: RestaurantTable[],
  partySize: number,
): TableMatch[] {
  if (!Number.isFinite(partySize) || partySize < 1) return [];

  const matches: TableMatch[] = [];
  for (const t of tables) {
    if (t.status !== 'available') continue;
    const cap = t.capacity ?? 0;
    if (cap <= 0) continue;

    const minOk = t.min_party_size == null || partySize >= t.min_party_size;
    const maxOk = t.max_party_size == null || partySize <= t.max_party_size;
    const fits = cap >= partySize && minOk && maxOk;
    if (!fits) continue;

    // Score = wasted seats. 0 = perfect fit. Larger = more waste.
    const score = cap - partySize;
    matches.push({ table: t, score, fits: true });
  }
  matches.sort((a, b) => a.score - b.score || a.table.code.localeCompare(b.table.code));
  return matches;
}

/** Best single suggestion for a party size, or null if nothing available fits. */
export function suggestTable(
  tables: RestaurantTable[],
  partySize: number,
): RestaurantTable | null {
  const matches = matchTablesForParty(tables, partySize);
  return matches[0]?.table ?? null;
}

export interface OccupancySummary {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  cleaning: number;
  disabled: number;
  /** Ratio of seats in use over total seats, between 0 and 1. */
  seatUtilisation: number;
  /** Total occupied seats (sum of capacity over occupied tables). */
  seatsOccupied: number;
  /** Total seats across all non-disabled tables. */
  seatsTotal: number;
}

export function summarizeOccupancy(tables: RestaurantTable[]): OccupancySummary {
  let available = 0, occupied = 0, reserved = 0, cleaning = 0, disabled = 0;
  let seatsTotal = 0, seatsOccupied = 0;
  for (const t of tables) {
    const cap = t.capacity ?? 0;
    if (t.status === 'disabled') { disabled++; continue; }
    seatsTotal += cap;
    if (t.status === 'occupied') { occupied++; seatsOccupied += cap; }
    else if (t.status === 'reserved') reserved++;
    else if (t.status === 'cleaning') cleaning++;
    else available++;
  }
  const total = tables.length;
  const seatUtilisation = seatsTotal === 0 ? 0 : seatsOccupied / seatsTotal;
  return { total, available, occupied, reserved, cleaning, disabled, seatUtilisation, seatsOccupied, seatsTotal };
}

/** Parse a party size value stored in customer_data (string or number). */
export function parsePartySize(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
