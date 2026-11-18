# Project Huddle

A temporary web app OHI shares with a homeowner for one rebuild, from production to final occupancy. The house is a floating 3D glass floor plan; each room opens a detail card with its work and days, a day scrubber moves the house through the schedule, and the homeowner answers change orders and sends messages and photos. No money and no line items.

## Project layout

| Path | What it is |
| --- | --- |
| `app/p/[slug]` | The plan screen, the passcode screen (`unlock`) and OHI's edit view (`edit`) |
| `app/api/p/[slug]` | Project state, photo uploads and unlock |
| `components/plan/scene.tsx` | The 3D plan: model, materials by work state, camera, room labels |
| `lib/templates.ts` | Production day templates: title, what happens, what to expect, default days |
| `lib/sequence.ts` | Holidays, workday dates, and turning production days into the schedule |
| `lib/state.ts` | Project state in Vercel Blob (in memory when no Blob token is set) |
| `data/<slug>/plan.json` | Rooms from the sketch |
| `data/<slug>/days.json` | The project's production days: each template and the rooms it covers |
| `public/models/<slug>.glb` | The 3D model from the sketch |
| `pipeline/dxf_to_plan.py` | Sketch DXF and scope PDF to `plan.json`, `days.json` and `.glb` |
| `pipeline/scope.py`, `pipeline/day_rules.py` | Reading the scope, and the rules that turn its line items into production days |

## Adding a project

1. In Xactimate, export the sketch as DXF and the estimate as a PDF. Put both in `pipeline/input/<slug>/`, using a random lowercase slug. This folder is never committed; the files are read during the build and stay on your machine.
2. Run the pipeline:

   ```
   pip install -r pipeline/requirements.txt
   python pipeline/dxf_to_plan.py <slug>
   ```

   It writes `data/<slug>/plan.json`, `data/<slug>/days.json` and `public/models/<slug>.glb`, and prints the homeowner code. The build stops when the sketch and the scope disagree (room names, or a room's floor area off by more than 0.5%) or when a line item matches no rule in `pipeline/day_rules.py`.
3. Add the project to `HUDDLE_PROJECTS` in Vercel, with the printed homeowner code and an OHI code, and redeploy.

The homeowner code is the house number from the scope's property address, padded with leading zeros to six digits (10305 becomes 010305). `python pipeline/scope.py <scope.pdf>` prints it, along with every room and line item the scope lists.

### Doors and windows

The sketch sets where each door and window is and how wide. The scope sets whether it is a door or a window and how tall: each opening takes the closest-width door or window the scope lists for the room it is in, and the build stops when a room has a different number of doors and windows in the sketch and the scope. Walls are one piece around every opening. Windows start with the sill 3 ft off the floor and keep at least 8 in of wall above them; a window that would come closer slides down, the sill never goes below 1 ft, and a window that still does not fit is cut to fit.

### Production days

The homeowner sees production days, never line items. Each line item in the scope matches one rule in `pipeline/day_rules.py`, which names the day templates it belongs to; `days.json` keeps only the templates and the rooms each one covers. The words the homeowner reads for each template live in `lib/templates.ts`. Every job ends with a final walkthrough day.

When a job has work no template covers, add a template to `lib/templates.ts` and `pipeline/day_rules.py` (same id, same order), then a rule for the line item. Every later job reuses it.

The project link is `/p/<slug>`.

## Environment variables

| Name | Value |
| --- | --- |
| `HUDDLE_PROJECTS` | `{"<slug>": {"name": "...", "home": "<house number, six digits>", "ohi": "<6-digit OHI code>"}}` |
| `HUDDLE_SECRET` | Any long random string; signs the access cookie |
| `BLOB_READ_WRITE_TOKEN` | Added by connecting a Vercel Blob store to the project |

Names, codes and customer details stay in these variables and in Blob, never in the repo.

## Development

```
npm install
HUDDLE_PROJECTS='{"k7m2qx": {"name": "McClure Residence", "home": "111111", "ohi": "222222"}}' HUDDLE_SECRET=dev npm run dev
```

After five wrong codes in a row, a device waits 15 minutes before it can try again.

`npm run check` runs lint, typecheck and build, the same as CI.
