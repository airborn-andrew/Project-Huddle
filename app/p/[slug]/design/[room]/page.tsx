import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { DesignRoom } from "@/components/design/design-room";
import { roleOn } from "@/lib/access";
import { openLayout } from "@/lib/design/open";
import { listVersions } from "@/lib/design/store";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function DesignRoomPage({ params }: { params: Promise<{ slug: string; room: string }> }) {
  const { slug, room } = await params;
  const project = await getProject(slug);
  if (!project) notFound();
  const role = await roleOn(slug, await cookies());
  if (!role) notFound();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const opened = await openLayout(project, room, origin);
  if (!opened) notFound();

  return (
    <DesignRoom
      slug={slug}
      project={project.name}
      room={opened.room.id}
      roomName={opened.room.name}
      role={role}
      initial={{ layout: opened.layout, versions: role === "ohi" ? await listVersions(slug, opened.room.id) : [] }}
    />
  );
}
