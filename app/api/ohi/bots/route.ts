import { NextResponse } from "next/server";
import { createAgent, dispatchPaused, listAgents, publicAgent, removeAgent, setAgent, setDispatchPaused } from "@/lib/agents";
import { bodyOf } from "@/lib/agent-http";
import { text } from "@/lib/ledger";
import { releaseAll, taskTypes } from "@/lib/tasks";

/** The bots, their task types, and the switch that stops every task going out. OHI only (middleware). */
async function view(token?: string) {
  return {
    agents: (await listAgents()).map(publicAgent),
    dispatchPaused: await dispatchPaused(),
    taskTypes: Object.entries(taskTypes).map(([type, t]) => ({ type, does: t.does })),
    ...(token ? { token } : {}),
  };
}

export async function GET() {
  return NextResponse.json(await view());
}

const types = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t in taskTypes) : []);
const webhook = (v: unknown) => {
  const url = text(v, 500);
  return url && /^https:\/\//.test(url) ? url : null;
};

export async function POST(request: Request) {
  const body = await bodyOf(request);
  const id = text(body.id, 80) ?? "";
  switch (body.action) {
    case "create": {
      const name = text(body.name, 60);
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 422 });
      if ((await listAgents()).some((a) => a.name === name)) return NextResponse.json({ error: "a bot by that name exists" }, { status: 422 });
      const { token } = await createAgent(name, types(body.task_types), webhook(body.webhook_url));
      return NextResponse.json(await view(token));
    }
    case "update":
      await setAgent(id, {
        ...(typeof body.paused === "boolean" ? { paused: body.paused } : {}),
        ...("task_types" in body ? { task_types: types(body.task_types) } : {}),
        ...("webhook_url" in body ? { webhook_url: webhook(body.webhook_url) } : {}),
      });
      break;
    case "remove":
      await removeAgent(id);
      break;
    case "dispatch":
      await setDispatchPaused(body.paused === true);
      if (body.paused !== true) await releaseAll();
      break;
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 422 });
  }
  return NextResponse.json(await view());
}
