import { NextResponse, type NextRequest } from "next/server";
import { isOhi, roleOn } from "@/lib/access";

/**
 * Every project page and API call needs a cookie for that project, and the
 * project list and edit view need OHI's. Without one, pages go to the right
 * passcode screen and API calls get a 401.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const locked = (unlockPath: string) => {
    if (isApi) return NextResponse.json({ error: "locked" }, { status: 401 });
    // The passcode screen returns to the page that was asked for, so a link to a sheet still opens it.
    const unlock = new URL(unlockPath, request.url);
    unlock.searchParams.set("next", pathname + search);
    return NextResponse.redirect(unlock);
  };

  if (/^\/(api\/)?ohi(\/|$)/.test(pathname)) {
    if (/^\/(api\/)?ohi\/unlock$/.test(pathname)) return NextResponse.next();
    return (await isOhi(request.cookies)) ? NextResponse.next() : locked("/ohi/unlock");
  }

  const match = pathname.match(/^\/(?:api\/)?p\/([a-z0-9]+)(\/.*)?$/);
  if (!match) return NextResponse.next();
  const [, slug, rest = ""] = match;
  if (rest === "/unlock") return NextResponse.next();

  const role = await roleOn(slug, request.cookies);
  if (!role) return locked(`/p/${slug}/unlock`);
  if (rest.startsWith("/edit") && role !== "ohi") return NextResponse.redirect(new URL(`/p/${slug}`, request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/p/:path*", "/api/p/:path*", "/ohi/:path*", "/ohi", "/api/ohi/:path*"] };
