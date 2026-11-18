import { db, devProjects } from "@/lib/db";
import type { Phase, Plan } from "@/lib/types";

/** draft: OHI is setting it up. live: pushed to the homeowner. done: closed out. */
export type ProjectStatus = "draft" | "live" | "done";

export type Project = {
  slug: string;
  name: string;
  homeCode: string;
  status: ProjectStatus;
  plan: Plan;
  phases: Phase[];
  /** Address of the project's 3D model. */
  model: string;
  createdAt: string;
};

type Row = {
  slug: string;
  name: string;
  home_code: string;
  status: ProjectStatus;
  plan: Plan;
  phases: Phase[];
  model: string;
  created_at: string;
};

const fromRow = (r: Row): Project => ({
  slug: r.slug,
  name: r.name,
  homeCode: r.home_code,
  status: r.status,
  plan: r.plan,
  phases: r.phases,
  model: r.model,
  createdAt: r.created_at,
});

const isSlug = (slug: string) => /^[a-z0-9]+$/.test(slug);

export async function getProject(slug: string): Promise<Project | null> {
  if (!isSlug(slug)) return null;
  const client = db();
  if (!client) {
    const row = devProjects()[slug] as Row | undefined;
    return row ? fromRow({ ...row, slug }) : null;
  }
  const { data, error } = await client.from("projects").select("*").eq("slug", slug).maybeSingle<Row>();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

/** Every project, newest first. */
export async function listProjects(): Promise<Project[]> {
  const client = db();
  if (!client) {
    return Object.entries(devProjects())
      .map(([slug, row]) => fromRow({ ...(row as Row), slug }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await client.from("projects").select("*").order("created_at", { ascending: false }).returns<Row[]>();
  if (error) throw error;
  return data.map(fromRow);
}
