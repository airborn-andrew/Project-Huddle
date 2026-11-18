import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Huddle } from "@/components/huddle";
import { roleOn } from "@/lib/access";
import { getProject } from "@/lib/projects";
import { forRole, readState, updateState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();
  const role = await roleOn(slug, await cookies());
  if (!role) notFound();
  const state =
    role === "ohi"
      ? await updateState(slug, (s) => {
          s.ohiSeen = new Date().toISOString();
        })
      : await readState(slug);

  return (
    <Huddle
      slug={slug}
      name={project.name}
      role={role}
      plan={project.plan}
      phases={project.phases}
      model={project.model}
      initialState={forRole(state, role)}
    />
  );
}
