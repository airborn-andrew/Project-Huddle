import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The server's Supabase client. It uses the secret key, so it only ever runs
 * on the server; row level security keeps the public keys out of every table.
 * Without SUPABASE_URL and SUPABASE_SECRET_KEY (local development) there is no
 * database, and lib/projects.ts and lib/state.ts keep everything in memory.
 */
let client: SupabaseClient | null | undefined;

export function db() {
  if (client === undefined) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!(url && key) && process.env.VERCEL) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set on Vercel");
    client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }
  return client;
}

/** Local development reads its projects from .dev/projects.json, keyed by slug, in the database's column names. */
export function devProjects(): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(readFileSync(".dev/projects.json", "utf8"));
  } catch {
    return {};
  }
}
