import { notFound } from "next/navigation";
import { Editor } from "@/components/editor";
import { projectConfig, projectData } from "@/lib/projects";
import { readState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = projectConfig(slug);
  const data = await projectData(slug);
  if (!config || !data) notFound();
  return <Editor slug={slug} name={config.name} plan={data.plan} phases={data.phases} initialState={await readState(slug)} />;
}
