import { NextResponse, type NextRequest } from "next/server";
import { cookieName, readToken } from "@/lib/access";

/**
 * Every project page and API call needs the project's cookie. Without it,
 * pages go to the passcode screen and API calls get a 401. The edit view
 * needs the OHI role.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const match = pathname.match(/^\/(?:api\/)?p\/([a-z0-9]+)(\/.*)?$/);
  if (!match) return NextResponse.next();
  const [, slug, rest = ""] = match;
  if (rest === "/unlock") return NextResponse.next();

  const role = await readToken(slug, request.cookies.get(cookieName(slug))?.value);
  const isApi = pathname.startsWith("/api/");

  if (!role) {
    if (isApi) return NextResponse.json({ error: "locked" }, { status: 401 });
    return NextResponse.redirect(new URL(`/p/${slug}/unlock`, request.url));
  }
  if (rest.startsWith("/edit") && role !== "ohi") {
    return NextResponse.redirect(new URL(`/p/${slug}`, request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/p/:path*", "/api/p/:path*"] };
