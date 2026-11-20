import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * Stores the room's AR model (a .glb made in the browser) so Android's Scene
 * Viewer can fetch it from a public address. iPhones open their own copy and
 * never need this.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; room: string }> }) {
  const { slug, room } = await params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 4_000_000) return NextResponse.json({ error: "bad model" }, { status: 400 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "no storage" }, { status: 501 });
  const blob = await put(`projects/${slug}/ar/${room}.glb`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: "model/gltf-binary",
  });
  return NextResponse.json({ url: blob.url });
}
