import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listProjects, type ProjectStatus } from "@/lib/projects";
import { readStates } from "@/lib/state";
import { summarize } from "@/lib/summary";

export const dynamic = "force-dynamic";

const statusLabel: Record<ProjectStatus, string> = { draft: "Draft", live: "Live", done: "Done" };

/** OHI's home screen: every project, newest first, with where each one stands. */
export default async function ProjectsPage() {
  const projects = await listProjects();
  const states = await readStates(projects.map((p) => p.slug));

  return (
    <main className="projects">
      <h1 className="projects-title">Projects</h1>
      {projects.length ? (
        <div className="group group-list">
          {projects.map((project) => {
            const { where, fresh } = summarize(project, states.get(project.slug)!);
            return (
              <Link key={project.slug} className="project-row" href={`/p/${project.slug}/edit`}>
                <span className="project-dot" data-on={fresh} aria-label={fresh ? "New from the homeowner" : undefined} />
                <span className="project-text">
                  <span className="project-name">{project.name}</span>
                  <span className="project-where">{where}</span>
                </span>
                <span className="project-status" data-status={project.status}>
                  {statusLabel[project.status]}
                </span>
                <ChevronRight className="project-chevron" />
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="projects-empty">No projects yet.</p>
      )}
      <div className="group group-list">
        <Link className="link-row" href="/ohi/bots">
          Bots
          <ChevronRight />
        </Link>
      </div>
    </main>
  );
}
