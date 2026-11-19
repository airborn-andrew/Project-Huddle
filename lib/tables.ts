import { db } from "@/lib/db";

/**
 * Reads and writes rows in the job costing tables. On the server it goes to
 * Supabase; without a database (local development) the rows stay in memory,
 * the same way lib/state.ts keeps project state. Filters are equality only;
 * `null` matches a null column.
 */
type Row = Record<string, unknown>;
type Filter = Record<string, string | number | boolean | null>;
type Options = { order?: string; descending?: boolean; limit?: number; after?: [column: string, value: string | number] };

const memory = new Map<string, Row[]>();
const rowsOf = (table: string) => {
  if (!memory.has(table)) memory.set(table, []);
  return memory.get(table)!;
};
const matches = (row: Row, filter: Filter) => Object.entries(filter).every(([k, v]) => (row[k] ?? null) === v);
let nextEventId = 1;

export async function select<T>(table: string, filter: Filter = {}, options: Options = {}): Promise<T[]> {
  const client = db();
  if (!client) {
    let rows = rowsOf(table).filter((r) => matches(r, filter));
    if (options.after) {
      const [column, value] = options.after;
      rows = rows.filter((r) => (r[column] as string | number) > value);
    }
    if (options.order) {
      const key = options.order;
      const sign = options.descending ? -1 : 1;
      rows = [...rows].sort((a, b) => ((a[key] as string) > (b[key] as string) ? sign : (a[key] as string) < (b[key] as string) ? -sign : 0));
    }
    return structuredClone(rows.slice(0, options.limit ?? rows.length)) as T[];
  }
  let query = client.from(table).select("*");
  for (const [k, v] of Object.entries(filter)) query = v === null ? query.is(k, null) : query.eq(k, v);
  if (options.after) query = query.gt(options.after[0], options.after[1]);
  if (options.order) query = query.order(options.order, { ascending: !options.descending });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return data as T[];
}

export async function insert<T extends Row>(table: string, rows: T[]): Promise<T[]> {
  if (!rows.length) return [];
  const client = db();
  if (!client) {
    const stored = rows.map((r) => (table === "events" ? { id: nextEventId++, ...r } : r));
    rowsOf(table).push(...structuredClone(stored));
    return structuredClone(stored);
  }
  const { data, error } = await client.from(table).insert(rows as Row[]).select();
  if (error) throw error;
  return data as T[];
}

/** Updates the rows matching `filter` and returns them; none when another write changed them first. */
export async function update<T>(table: string, filter: Filter, patch: Row): Promise<T[]> {
  const client = db();
  if (!client) {
    const hit = rowsOf(table).filter((r) => matches(r, filter));
    for (const r of hit) Object.assign(r, structuredClone(patch));
    return structuredClone(hit) as T[];
  }
  let query = client.from(table).update(patch);
  for (const [k, v] of Object.entries(filter)) query = v === null ? query.is(k, null) : query.eq(k, v);
  const { data, error } = await query.select();
  if (error) throw error;
  return data as T[];
}

/** Inserts the row, or updates the row with the same `key` columns. */
export async function upsert<T extends Row>(table: string, row: T, key: (keyof T & string)[]): Promise<T> {
  const client = db();
  if (!client) {
    const filter = Object.fromEntries(key.map((k) => [k, row[k] as string]));
    const existing = rowsOf(table).find((r) => matches(r, filter));
    if (existing) Object.assign(existing, structuredClone(row));
    else rowsOf(table).push(structuredClone(row));
    return structuredClone(existing ?? row) as T;
  }
  const { data, error } = await client.from(table).upsert(row as Row, { onConflict: key.join(",") }).select().single();
  if (error) throw error;
  return data as T;
}

export async function remove(table: string, filter: Filter) {
  const client = db();
  if (!client) {
    memory.set(
      table,
      rowsOf(table).filter((r) => !matches(r, filter)),
    );
    return;
  }
  let query = client.from(table).delete();
  for (const [k, v] of Object.entries(filter)) query = v === null ? query.is(k, null) : query.eq(k, v);
  const { error } = await query;
  if (error) throw error;
}
