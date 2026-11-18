import { unlock } from "@/lib/unlock";

export async function POST(request: Request) {
  return unlock(request, "ohi");
}
