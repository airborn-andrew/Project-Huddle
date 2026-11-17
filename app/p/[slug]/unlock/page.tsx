import { notFound } from "next/navigation";
import { Passcode } from "@/components/passcode";
import { projectConfig } from "@/lib/projects";

export default async function UnlockPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = projectConfig(slug);
  if (!config) notFound();
  return <Passcode slug={slug} name={config.name} />;
}
