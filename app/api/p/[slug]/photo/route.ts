import { NextResponse } from "next/server";
import { savePhoto } from "@/lib/state";

/** Photos arrive already resized in the browser, so they stay well under the request limit. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 4_000_000) {
    return NextResponse.json({ error: "bad photo" }, { status: 400 });
  }
  return NextResponse.json({ url: await savePhoto(slug, file) });
}
