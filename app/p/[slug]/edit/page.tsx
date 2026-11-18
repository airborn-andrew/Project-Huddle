import { notFound } from "next/navigation";
import { Editor } from "@/components/editor";
import { getProject } from "@/lib/projects";
import { updateState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();
  const state = await updateState(slug, (s) => {
    s.ohiSeen = new Date().toISOString();
  });
  return <Editor slug={slug} name={project.name} plan={project.plan} phases={project.phases} initialState={state} />;
}
