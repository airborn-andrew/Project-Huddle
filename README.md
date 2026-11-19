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

## Adding a project

1. In Xactimate, export the estimate as a PDF and each level of the sketch as a DXF. Put them in `pipeline/input/<slug>/`, using a random lowercase slug. This folder is never committed; the files are read during the build and stay on your machine.

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

The homeowner sees production days, never line items. Each line item in the scope matches one rule in `pipeline/day_rules.py`, which names the day templates it belongs to; a project's `phases` keep only the templates and the rooms each one covers. The words the homeowner reads for each template live in `lib/templates.ts`. Every job ends with a final walkthrough day.

When a job has work no template covers, add a template to `lib/templates.ts` and `pipeline/day_rules.py` (same id, same order), then a rule for the line item. Every later job reuses it.

The project link is `/p/<slug>`.

The app opens on a dark gray background with the day's work glowing white, and the room someone taps glows brighter on every wall. The moon button switches that device to a near-black background; each device remembers its choice.

## The OHI view

The OHI code is the same on every project. It opens `/ohi`, the list of every project with where each one stands and a dot when the homeowner has posted something new, and from there each project's edit view at `/p/<slug>/edit`. On a phone, add `/ohi` to the home screen to open it like an app. The OHI code also works on any project's passcode screen. Every change there lands in a draft that only OHI sees; **Push to homeowner** publishes it. Undo steps back one change at a time until the next push, and the change log lists every edit with its time. Messages and the homeowner's change order answers are never drafted: they go live at once.

From the OHI view you can:

- **Schedule:** set the start date and off days; move a production day, change its length (later days move with it), add one from the templates, remove one, change its rooms, mark it done, and rewrite what to expect for this project.
- **Content:** post notes and photos to a day, a room or both; create, edit and withdraw change orders; fill in closeout.
- **Selections:** record what the homeowner picked at the showroom (flooring, tile, countertops, cabinets, fixtures, appliances) with the product, its color or style, a room if it belongs to one, and screenshots. The homeowner sees them under Selections, with no prices.
- **People:** set the project manager and the subs, and the production days each sub is on site.

## Environment variables

| Name | Value |
| --- | --- |
| `HUDDLE_OHI_CODE` | OHI's six-digit code |
| `HUDDLE_SECRET` | Any long random string; signs the access cookies |
| `SUPABASE_URL` | The Supabase project's address |
| `SUPABASE_SECRET_KEY` | A Supabase secret key. It stays on the server and is never sent to a browser |
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
