import type { Phase, Plan } from "@/lib/types";

/**
 * Projects come from the HUDDLE_PROJECTS environment variable, so names and
 * codes never live in the repo:
 *
 *   {"k7m2qx": {"name": "McClure Residence", "home": "123456", "ohi": "654321"}}
 *
 * Geometry and production days live in data/<slug>/ and public/models/<slug>.glb.
 */
export type ProjectConfig = { name: string; home: string; ohi: string };

export function projectConfig(slug: string): ProjectConfig | null {
  try {
    const all = JSON.parse(process.env.HUDDLE_PROJECTS ?? "{}") as Record<string, ProjectConfig>;
    return all[slug] ?? null;
  } catch {
    return null;
  }
}

export async function projectData(slug: string): Promise<{ plan: Plan; phases: Phase[] } | null> {
  if (!/^[a-z0-9]+$/.test(slug)) return null;
  try {
    const plan = (await import(`@/data/${slug}/plan.json`)).default as Plan;
    const { phases } = (await import(`@/data/${slug}/days.json`)).default as { phases: Phase[] };
    return { plan, phases };
  } catch {
    return null;
  }
}
