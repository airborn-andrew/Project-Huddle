import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Huddle } from "@/components/huddle";
import { cookieName, readToken } from "@/lib/access";
import { projectConfig, projectData } from "@/lib/projects";
import { forRole, readState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = projectConfig(slug);
  const data = await projectData(slug);
  if (!config || !data) notFound();
  const role = await readToken(slug, (await cookies()).get(cookieName(slug))?.value);
  if (!role) notFound();

  return (
    <Huddle
      slug={slug}
      name={config.name}
      role={role}
      plan={data.plan}
      phases={data.phases}
      initialState={forRole(await readState(slug), role)}
    />
  );
}
