# Project Huddle

A temporary web app OHI shares with a homeowner for one rebuild, from production to final occupancy. The house is a floating 3D glass floor plan; each room opens a detail card with its work and days, a day scrubber moves the house through the schedule, and the homeowner answers change orders and sends messages and photos. No money and no line items.

## Project layout

| Path | What it is |
| --- | --- |
| `app/p/[slug]` | The plan screen, the passcode screen (`unlock`) and OHI's edit view (`edit`) |
| `app/api/p/[slug]` | Project state, photo uploads and unlock |
| `components/plan/scene.tsx` | The 3D plan: model, materials by work state, camera, room labels |
| `lib/sequence.ts` | Trade order, default days, holidays and the homeowner copy for each kind of work |
| `lib/state.ts` | Project state in Vercel Blob (in memory when no Blob token is set) |
| `data/<slug>/plan.json` | Rooms from the sketch |
| `data/<slug>/tasks.json` | The project's task map: room, kind of work, step and title |
| `public/models/<slug>.glb` | The 3D model from the sketch |
| `pipeline/dxf_to_plan.py` | Sketch DXF to `plan.json` and `.glb` |

## Adding a project

1. Export the Xactimate sketch as DXF and save it as `pipeline/input/<slug>.dxf`, using a random lowercase slug.
2. Optionally save the estimate's room floor areas as `pipeline/input/<slug>.areas.json` (`{"Kitchen": 120.08, ...}`). They are printed next to the sketch areas and guide how open-plan rooms are divided.
3. Run the pipeline:

   ```
   pip install -r pipeline/requirements.txt
   python pipeline/dxf_to_plan.py <slug> --check pipeline/input/<slug>.areas.json
   ```

4. Write `data/<slug>/tasks.json` from the estimate scope. Each task is one room and one kind of work (`Insulation`, `Cabinets`, `Appliances`, `Fixtures`, `Paint`, `Flooring`, `Doors`, `Baseboard`, `Clean`) placed in a step from `lib/sequence.ts`.
5. Add the project to `HUDDLE_PROJECTS` in Vercel and redeploy.

The project link is `/p/<slug>`.

## Environment variables

| Name | Value |
| --- | --- |
| `HUDDLE_PROJECTS` | `{"<slug>": {"name": "...", "home": "<6-digit homeowner code>", "ohi": "<6-digit OHI code>"}}` |
| `HUDDLE_SECRET` | Any long random string; signs the access cookie |
| `BLOB_READ_WRITE_TOKEN` | Added by connecting a Vercel Blob store to the project |

Names, codes and customer details stay in these variables and in Blob, never in the repo.

## Development

```
npm install
HUDDLE_PROJECTS='{"k7m2qx": {"name": "McClure Residence", "home": "111111", "ohi": "222222"}}' HUDDLE_SECRET=dev npm run dev
```

`npm run check` runs lint, typecheck and build, the same as CI.
