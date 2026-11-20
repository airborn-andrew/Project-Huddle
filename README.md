# Project Huddle

A temporary web app OHI shares with a homeowner for one rebuild, from production to final occupancy. The house is a floating 3D glass floor plan; each room opens a detail card with its work and days, a day scrubber moves the house through the schedule, and the homeowner answers change orders and sends messages and photos. No money and no line items.

## Project layout

| Path | What it is |
| --- | --- |
| `app/p/[slug]` | The plan screen, the passcode screen (`unlock`) and OHI's edit view (`edit`) |
| `app/ohi` | OHI's project list and its passcode screen |
| `app/api/p/[slug]`, `app/api/ohi` | Project state, photo uploads and unlock |
| `components/plan/scene.tsx` | The 3D plan: model, materials by work state, camera, room labels |
| `lib/templates.ts` | Production day templates: title, what happens, what to expect, default days |
| `lib/sequence.ts` | Holidays, workday dates, and turning production days into the schedule |
| `lib/projects.ts`, `lib/state.ts` | Projects and their state in Supabase: the published project, OHI's draft, undo history and change log. Photos are in Vercel Blob |
| `supabase/migrations` | The database tables |
| `public/models/<slug>.glb` | The 3D model from the sketch, every level stacked; nodes are named `<level>__<room>__<part>` |
| `pipeline/dxf_to_plan.py` | Sketch DXF and scope PDF to `plan.json`, `days.json` and `.glb` |
| `pipeline/scope.py`, `pipeline/day_rules.py` | Reading the scope, and the rules that turn its line items into production days |
| `pipeline/components.py` | Reading the Xactimate Components report into the job's insurance budget |
| `lib/costing.ts`, `lib/cost-codes.ts` | Every job costing calculation, and the CSI MasterFormat sections components land in |
| `lib/ledger.ts`, `lib/tasks.ts`, `lib/agents.ts` | The costing ledger and its approval rules, the task queue, and the bots' tokens |
| `app/api/agent` | The bot API; `GET /api/agent` describes it |
| `app/p/[slug]/design/[room]` | The Design Room screen |
| `components/design` | The Design Room: the room in plan and 3D, and the dock with the catalog and the picked piece |
| `lib/design` | The Design Room: the cabinet and appliance catalog, layouts and their checks, and each room's walls, doors and windows from the sketch |
| `app/api/p/[slug]/design/[room]` | A room's layout: read it, save it, and go back to an earlier version |

## Adding a project

1. In Xactimate, export the carrier-approved version of the estimate as a PDF and each level of the sketch as a DXF. Production days come from this scope, so work the carrier denied never becomes a day. Put them in `pipeline/input/<slug>/`, using a random lowercase slug. This folder is never committed; the files are read during the build and stay on your machine.

   Name each DXF after the level the scope uses, with a number in front for the order from the bottom up: `1 Main Level.dxf`, `2 Upper Level.dxf`. A job with one level can name its DXF anything. When the scope has a Crawlspace section, the model adds a crawlspace under the lowest level.
2. Run the pipeline:

   ```
   pip install -r pipeline/requirements.txt
   python pipeline/dxf_to_plan.py <slug>
   ```

   It writes `data/<slug>/plan.json`, `data/<slug>/days.json` and `public/models/<slug>.glb`, and prints the homeowner code. The build stops when the sketch and the scope disagree (room names, or a room's floor area off by more than 0.5%) or when a line item matches no rule in `pipeline/day_rules.py`.
3. Add a row to the `projects` table: the project name, the printed homeowner code, `plan.json` as `plan`, the `phases` list from `days.json`, and the model's address as `model`. It starts as a draft.

The homeowner code is the house number from the scope's property address, padded with leading zeros to six digits (10305 becomes 010305). `python pipeline/scope.py <scope.pdf>` prints it, along with every room and line item the scope lists.

### Doors and windows

The sketch sets where each door and window is and how wide. The scope sets whether it is a door or a window and how tall: each opening takes the closest-width door or window the scope lists for the room it is in, and the build stops when a room has a different number of doors and windows in the sketch and the scope. Walls are one piece around every opening. Windows start with the sill 3 ft off the floor and keep at least 8 in of wall above them; a window that would come closer slides down, the sill never goes below 1 ft, and a window that still does not fit is cut to fit.

### Production days

The homeowner sees production days, never line items. A production day is a trade's work on the house: insulation, cabinets, paint, flooring, doors, baseboard and trim, cleaning, and the final walkthrough. Support work never gets a day of its own: detach and reset, moving contents, protection, material only, labor minimums, supply lines and haul-off are part of the trade day they serve, and tearing out a damaged finish is part of the day its trade puts back. Appliances and plumbing fixtures are set back as support work, and vanities and countertops belong to the cabinet day.

Each line item in the scope matches one rule in `pipeline/day_rules.py`, which names the day template its trade belongs to, or none for support work; a project's `phases` keep only the templates and the rooms each one covers. The words the homeowner reads for each template live in `lib/templates.ts`. Every job ends with a final walkthrough day.

When a job has work no template covers, add a template to `lib/templates.ts` and `pipeline/day_rules.py` (same id, same order), then a rule for the line item. Every later job reuses it.

The project link is `/p/<slug>`.

The app opens on a dark gray background with the day's work glowing white, and the room someone taps glows brighter on every wall. The moon button switches that device to a near-black background; each device remembers its choice.

## The Design Room

Every project with a kitchen gets a Design Room, where the homeowner and OHI lay out cabinets, appliances and an island in the real room. The first time a room opens, its walls come from the plan, its doors and windows from the 3D model, and its first layout from the cabinets and appliances the sketch already shows, each run filled with the fewest standard boxes. Walls, doors and windows never move.

The pencil-and-ruler button on the project opens it at `/p/<slug>/design/<room>`. The room shows from above on a one-foot grid, or in 3D with the walls nearest the camera faded. The dock at the bottom holds the catalog: drag a piece up into the room, or tap it to place it in the first open spot along a wall. Cabinets and appliances turn to put their back on the nearest wall and close small gaps against their neighbors; islands stand where they are put. Tapping a piece opens it in the dock with its box size, Turn, Remove and the other sizes it can swap to. A piece that would overlap another or reach past a wall shows a red outline and goes back where it was.

In 3D, cabinets show at real size with a toe kick, drawer and door fronts in the picked style (shaker, slab or raised panel), bar pulls and a countertop; appliances are stainless with black glass. Cabinets come in white, gray or black, or in the homeowner's own finish: a photo of the door sample from the showroom, cropped to a square and saved with the project's photos. Picking a cabinet adds Doors and Finish to the dock, each with Every cabinet to use it on the whole kitchen, and new cabinets take the style and finish most of the kitchen has.

Both sides edit together live. While someone drags a piece, the other screen shows it moving; each save tells the other screen to load the new layout at once; and the title says when the other side has the room open. This runs over Supabase Realtime on a channel whose name is signed with `HUDDLE_SECRET`, with the publishable key, which can reach no table. Without `SUPABASE_PUBLISHABLE_KEY`, the room refreshes every 20 seconds instead.

The sparkle button shares the room with the homeowner's own AI (ChatGPT, Grok or any other). Send to your AI hands over one PDF through the phone's share sheet, or downloads it on a computer, since AI apps take a PDF from the share sheet where they drop other files. Its first page has a 3D picture of the room and a short note in plain words; the pages after it carry the layout file (the room, the catalog, door styles, finishes and the pieces) as text, one piece per line. The file is built in `lib/design/file.ts` and the PDF in `lib/design/pdf.ts`. The file the AI sends back is uploaded in the same sheet; it is checked like any other save, and anything wrong is listed in plain words for the homeowner to hand back to the AI.

When the homeowner is happy, the check button sends the layout to OHI: OHI gets an email with a link to the room, and the layout holds still for the homeowner until they take it back with the pencil button. OHI's lock button locks it for ordering; a locked layout adds the clipboard button, which shows the cabinet schedule (one line per box, door style and finish, each with a tag) and downloads it as a CSV and as a DXF plan view of the room with every piece drawn and tagged, wall lengths, the schedule and a title block. Homeowner finish photos are numbered in the schedule and linked from the sheet. The lock button opens a locked layout again.

On a phone that can show AR, the cube-in-motion button opens the cabinets, island, appliances and a thin outline of the room's walls on the floor at true size in the real kitchen: AR Quick Look on iPhone and iPad (a USDZ made in the browser) and Scene Viewer on Android (a GLB stored in Vercel Blob for it). Scaling is off on both, so a pinch cannot shrink the kitchen. Line up the outline's corner with the room's corner and everything else falls into place. It is meant to be walked through with the homeowner on site; the layout's own sizes stay the measure for clearances.

A layout is a list of pieces from the catalog in `lib/design/catalog.ts`, in inches from the room's southwest corner. Every save is checked (catalog sizes, quarter turns, inside the walls, nothing overlapping) and kept as a version, and OHI can put any earlier version back. Each save starts from the version it was made on, so two people saving at once never overwrite each other.

The tables are in `supabase/migrations/20261120000000_design_room.sql`.

## The OHI view

The OHI code is the same on every project. It opens `/ohi`, the list of every project with where each one stands and a dot when the homeowner has posted something new, and from there each project's edit view at `/p/<slug>/edit`. On a phone, add `/ohi` to the home screen to open it like an app. The OHI code also works on any project's passcode screen. Every change there lands in a draft that only OHI sees; **Push to homeowner** publishes it. Undo steps back one change at a time until the next push, and the change log lists every edit with its time. Messages and the homeowner's change order answers are never drafted: they go live at once.

From the OHI view you can:

- **Schedule:** set the start date and off days; move a production day, change its length (later days move with it), add one from the templates, remove one, change its rooms, mark it done, and rewrite what to expect for this project.
- **Content:** post notes and photos to a day, a room or both; create, edit and withdraw change orders; fill in closeout.
- **Selections:** record what the homeowner picked at the showroom (flooring, tile, countertops, cabinets, fixtures, appliances) with the product, its color or style, a room if it belongs to one, and screenshots. The homeowner sees them under Selections, with no prices.
- **People:** set the project manager and the subs, and the production days each sub is on site.

## Job costing

Each project's edit view has a Job costing section that only OHI sees. It sets the insurance money in each CSI MasterFormat section against what OHI has committed and spent, and shows the margin left by section and for the job. Sections below the job's margin floor show in orange.

- **Insurance budget:** the Components report of the carrier-approved estimate. `python pipeline/components.py <components.pdf>` reads it, checks every page adds up to its printed total, and prints the JSON for `POST /api/agent/jobs/<slug>/budget`. Each component lands in a section by `lib/cost-codes.ts`; one no rule covers stays unassigned until it is moved. Approving a new import replaces the one before it.
- **Supplements, commitments and actual costs** are entries against a section. Accepting a bid means approving its commitment.
- **The scope gate:** a commitment or cost counts only inside the carrier-approved estimate. One in a section with no approved estimate lines (the carrier denied it, or it was never asked for) waits under Not in the approved estimate until OHI decides: discard it, have the homeowner pay with a priced change order (it joins the job when the homeowner says yes), or send it to the carrier as a supplement (it joins the job when OHI marks it approved). Nothing outside the approved scope reaches the homeowner except that change order, which waits in OHI's draft until it is pushed.
- **Cost to complete** follows the commitments not yet paid, or with nothing committed, the insurance money not yet spent. OHI can set it for a section instead.
- **Overhead and profit** from the approved estimate is entered under Job settings and counts toward the job's revenue.

### Bots

Bots work through `/api/agent` with their own token, made on the Bots screen (`/ohi/bots`). A bot's budget imports and entries wait in the approval queue until OHI approves them; its notes, flags and line moves land at once. Nothing a bot writes reaches the homeowner.

Work goes to bots as tasks. Flagging a section for re-bid queues a quote request with that section's scope; Give to a bot queues a bid or components report to read. A bot claims a task with `GET /api/agent/tasks/next` and answers with `POST /api/agent/tasks/<id>`; a result that does not match the task's shape is refused and the task goes back in the queue, up to three tries before it fails and OHI gets a note. A bot with a webhook is pinged when a task it takes is queued. Manual mode on a job holds its tasks until they are released, and the switch on the Bots screen stops every task going out.

Every OHI edit, homeowner update and costing change is also recorded as an event, which bots read with `GET /api/agent/jobs/<slug>/changes`.

The tables are in `supabase/migrations/20261119000000_job_costing.sql`; apply it before using job costing.

## Environment variables

| Name | Value |
| --- | --- |
| `HUDDLE_OHI_CODE` | OHI's six-digit code |
| `HUDDLE_SECRET` | Any long random string; signs the access cookies |
| `SUPABASE_URL` | The Supabase project's address |
| `SUPABASE_SECRET_KEY` | A Supabase secret key. It stays on the server and is never sent to a browser |
| `SUPABASE_PUBLISHABLE_KEY` | The Supabase publishable key, for live editing in the Design Room. Row level security keeps it out of every table |
| `BLOB_READ_WRITE_TOKEN` | Added by connecting a Vercel Blob store to the project |
| `RESEND_API_KEY` | Resend sending key. When a homeowner sends a message or answers a change order, OHI gets an email that links to it. Without it, no email is sent |

Names, codes and customer details stay in Supabase and Blob, never in the repo.

## Development

```
npm install
HUDDLE_OHI_CODE=222222 HUDDLE_SECRET=dev npm run dev
```

Without Supabase variables, projects come from `.dev/projects.json` (keyed by slug, with the `projects` table's columns) and state stays in memory.

After five wrong codes in a row, a device waits 15 minutes before it can try again.

`npm run check` runs lint, typecheck and build, the same as CI.
