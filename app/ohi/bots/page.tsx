import { Bots } from "@/components/bots";
import { dispatchPaused, listAgents, publicAgent } from "@/lib/agents";
import { taskTypes } from "@/lib/tasks";

export const dynamic = "force-dynamic";

/** OHI's bots: their tokens, the tasks each takes, and the switch that stops every task going out. */
export default async function BotsPage() {
  return (
    <Bots
      initial={{
        agents: (await listAgents()).map(publicAgent),
        dispatchPaused: await dispatchPaused(),
        taskTypes: Object.entries(taskTypes).map(([type, t]) => ({ type, does: t.does })),
      }}
    />
  );
}
