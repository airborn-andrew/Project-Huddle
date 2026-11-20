import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { DesignRoom } from "@/components/design/design-room";
import { designChannel, roleOn } from "@/lib/access";
import { openLayout } from "@/lib/design/open";
import { listVersions } from "@/lib/design/store";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function DesignRoomPage({ params }: { params: Promise<{ slug: string; room: string }> }) {
  const { slug, room } = await params;
  const project = await getProject(slug);
  if (!project) notFound();
  const role = await roleOn(slug, await cookies());
  // A prototype: OHI only for now.
  if (role !== "ohi") notFound();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const opened = await openLayout(project, room, origin);
  if (!opened) notFound();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const live = url && key ? { url, key, channel: await designChannel(slug, opened.room.id) } : null;

  return (
    <DesignRoom
      slug={slug}
      project={project.name}
      room={opened.room.id}
      roomName={opened.room.name}
      role={role}
      live={live}
      initial={{ layout: opened.layout, versions: role === "ohi" ? await listVersions(slug, opened.room.id) : [] }}
    />
  );
}
