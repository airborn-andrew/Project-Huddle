import { notFound } from "next/navigation";
import { Passcode } from "@/components/passcode";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function UnlockPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();
  return <Passcode title={project.name} endpoint={`/api/p/${slug}/unlock`} home={`/p/${slug}`} />;
}
