import { NextResponse } from "next/server";
import { costCodes } from "@/lib/cost-codes";
import { noteFlags } from "@/lib/costing";
import { taskTypes } from "@/lib/tasks";

/**
 * The bot API, described as OpenAPI 3.1 so a bot can read what it may do.
 * Every other /api/agent route needs `Authorization: Bearer <token>`; OHI makes
 * tokens on the Bots screen.
 */
export function GET(request: Request) {
  const job = { name: "slug", in: "path", required: true, schema: { type: "string" } };
  const ok = (description: string) => ({ description });
  const json = (schema: object) => ({ required: true, content: { "application/json": { schema } } });
  const money = { type: "number", description: "Dollars with cents" };
  const costCode = { type: ["string", "null"], enum: [...costCodes.map((c) => c.code), null] };

  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Huddle bot API",
      version: "1",
      description: [
        "OHI's job costing, run by bots. The code does every calculation; bots write facts and read results.",
        "Money a bot writes (budget imports and entries) waits for OHI's approval before it counts. Notes, flags and line assignments land at once.",
        "The scope gate: a commitment or cost counts only inside the carrier-approved estimate. One in a section with no approved estimate lines lands with scope 'review' and waits for OHI to discard it, send it to the homeowner as a priced change order, or send it to the carrier as a supplement. Name the approved budget line ids an entry covers in `covers` when you can match them; naming a line that is not approved is refused.",
        "Work arrives as tasks: claim one with GET /tasks/next, do only what it asks, and answer with POST /tasks/{id}. A result that does not match the task's shape is refused and the task is retried.",
        "A bot with a webhook gets a POST when a task it takes is queued: { event: 'task', task_id, type }, signed in X-Huddle-Signature as sha256=HMAC-SHA256(body) keyed with the hex SHA-256 of its token.",
        `Task types: ${Object.entries(taskTypes)
          .map(([type, t]) => `${type}: ${t.does} Input ${t.input}. Result ${t.result}.`)
          .join(" ")}`,
      ].join("\n\n"),
    },
    servers: [{ url: `${new URL(request.url).origin}/api/agent` }],
    components: { securitySchemes: { bot: { type: "http", scheme: "bearer" } } },
    security: [{ bot: [] }],
    paths: {
      "/jobs/{slug}": {
        get: { summary: "The job: schedule, costing by section, approval queue, open notes and tasks", parameters: [job], responses: { 200: ok("Job context") } },
      },
      "/jobs/{slug}/changes": {
        get: {
          summary: "Events after `since`, oldest first, 200 at a time; pass the returned `next` as the next `since`",
          parameters: [job, { name: "since", in: "query", schema: { type: "string", format: "date-time" } }],
          responses: { 200: ok("{ events, next }") },
        },
      },
      "/jobs/{slug}/budget": {
        post: {
          summary: "Propose the approved estimate's components (pipeline/components.py output) or bid items as the insurance budget",
          parameters: [job],
          requestBody: json({
            type: "object",
            required: ["source", "lines", "totals"],
            properties: {
              source: { enum: ["components", "bid_item"] },
              estimate: { type: "string" },
              price_list: { type: "string" },
              lines: {
                type: "array",
                items: {
                  type: "object",
                  required: ["kind", "description", "total"],
                  properties: {
                    kind: { enum: ["material", "labor", "equipment", "other"] },
                    code: { type: ["string", "null"] },
                    description: { type: "string" },
                    quantity: { type: ["number", "null"] },
                    unit: { type: ["string", "null"] },
                    unit_price: { type: ["number", "null"] },
                    total: money,
                    flagged: { type: "boolean" },
                    cost_code: costCode,
                  },
                },
              },
              totals: { type: "object", description: "The printed total for each kind present; the lines must add up to it" },
            },
          }),
          responses: { 201: ok("{ batch, lines, total }, waiting for approval"), 422: ok("Lines do not add up, or a line is missing a field") },
        },
      },
      "/jobs/{slug}/budget-lines/{id}": {
        post: {
          summary: "Move a budget line to another cost code",
          parameters: [job, { name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object", required: ["cost_code"], properties: { cost_code: costCode } }),
          responses: { 200: ok("Moved") },
        },
      },
      "/jobs/{slug}/entries": {
        post: {
          summary: "Propose a supplement or change (budget_change), a commitment, or an actual cost",
          parameters: [job],
          requestBody: json({
            type: "object",
            required: ["type", "amount", "description"],
            properties: {
              type: { enum: ["budget_change", "commitment", "actual"] },
              amount: money,
              description: { type: "string" },
              cost_code: costCode,
              vendor: { type: "string" },
              source: { type: "string", description: "Where the figure came from" },
              reason: { type: "string" },
              covers: { type: "array", items: { type: "string" }, description: "Approved budget line ids this entry covers" },
            },
          }),
          responses: { 201: ok("The entry, waiting for approval; scope 'review' when it is outside the approved estimate"), 422: ok("A field is missing, or covers names a line that is not approved") },
        },
      },
      "/jobs/{slug}/notes": {
        post: {
          summary: "Leave a note or flag on the job, or on a record (record_type 'trade' with a cost code as record_id). Flagging a trade rebid or check_supplier queues a request-quote task.",
          parameters: [job],
          requestBody: json({
            type: "object",
            required: ["body"],
            properties: {
              body: { type: "string" },
              flag: { enum: [...noteFlags, null] },
              record_type: { type: "string" },
              record_id: { type: "string" },
              notify: { type: "boolean", description: "Email OHI" },
            },
          }),
          responses: { 201: ok("The note") },
        },
      },
      "/jobs/{slug}/tasks": {
        post: {
          summary: "Queue a task on the job",
          parameters: [job],
          requestBody: json({ type: "object", required: ["type", "input"], properties: { type: { enum: Object.keys(taskTypes) }, input: { type: "object" } } }),
          responses: { 201: ok("The task") },
        },
      },
      "/tasks/next": {
        get: { summary: "Claim the oldest queued task this bot takes", responses: { 200: ok("{ task, does, result }"), 204: ok("Nothing to do") } },
      },
      "/tasks/{id}": {
        post: {
          summary: "Finish a claimed task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object", properties: { result: { type: "object" }, error: { type: "string" } } }),
          responses: { 200: ok("Done, or the error was recorded"), 422: ok("Result refused; the task goes back in the queue") },
        },
      },
    },
  });
}
