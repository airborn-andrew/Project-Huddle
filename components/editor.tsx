"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PhotoButton } from "@/components/photo-button";
import { useProject } from "@/lib/client";
import { dayFormat, lastDay, schedule, steps, workdayDate } from "@/lib/sequence";
import type { Photo, Plan, ProjectState, Task } from "@/lib/types";

/** OHI's controls: dates, task days, completion, change orders, photos and closeout. */
export function Editor({
  slug,
  name,
  plan,
  tasks,
  initialState,
}: {
  slug: string;
  name: string;
  plan: Plan;
  tasks: Task[];
  initialState: ProjectState;
}) {
  const { state, act } = useProject(slug, initialState);
  const scheduled = useMemo(() => schedule(tasks, state), [tasks, state]);
  const last = lastDay(scheduled);
  const roomName = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? id;
  const dayOptions = Array.from({ length: last + 6 }, (_, i) => i);

  const [coTitle, setCoTitle] = useState("");
  const [coBody, setCoBody] = useState("");
  const [coPhotos, setCoPhotos] = useState<Photo[]>([]);
  const [photoRoom, setPhotoRoom] = useState(plan.rooms[0]?.id ?? "");
  const [warranty, setWarranty] = useState(state.closeout.warranty);
  const [punch, setPunch] = useState("");
  const [punchRoom, setPunchRoom] = useState("");
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");

  const roomSelect = (value: string, set: (v: string) => void, blank?: string) => (
    <select className="field" value={value} onChange={(e) => set(e.target.value)}>
      {blank && <option value="">{blank}</option>}
      {plan.rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );

  return (
    <main className="edit">
      <div className="edit-head">
        <h1 className="title" style={{ fontSize: 28 }}>
          {name}
        </h1>
        <Link className="edit-back" href={`/p/${slug}`}>
          Done
        </Link>
      </div>

      <p className="label">Start date</p>
      <input
        type="date"
        className="field"
        value={state.startDate}
        onChange={(e) => e.target.value && act("start", { startDate: e.target.value })}
      />

      {steps
        .filter((s) => scheduled.some((t) => t.step === s.id))
        .map((s) => (
          <section key={s.id}>
            <p className="label">{s.name}</p>
            <table>
              <tbody>
                {scheduled
                  .filter((t) => t.step === s.id)
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{roomName(t.room)}</td>
                      <td>{t.title}</td>
                      <td>
                        <select value={t.day} onChange={(e) => act("task", { id: t.id, day: Number(e.target.value) })}>
                          {dayOptions.map((d) => (
                            <option key={d} value={d}>
                              {dayFormat.format(workdayDate(state.startDate, d))}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label="Done"
                          checked={t.done}
                          onChange={(e) => act("task", { id: t.id, done: e.target.checked })}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}

      <p className="label">New change order</p>
      <div className="group">
        <input className="field" placeholder="Title" value={coTitle} onChange={(e) => setCoTitle(e.target.value)} />
        <textarea className="field" placeholder="Details" value={coBody} onChange={(e) => setCoBody(e.target.value)} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <PhotoButton slug={slug} onAdd={(p) => setCoPhotos((c) => [...c, ...p])} />
          <span style={{ color: "var(--secondary)", font: "var(--footnote)" }}>
            {coPhotos.length ? `${coPhotos.length} photo${coPhotos.length > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <button
          type="button"
          className="button"
          disabled={!coTitle.trim()}
          onClick={async () => {
            if (await act("changeOrder", { title: coTitle, body: coBody, photos: coPhotos })) {
              setCoTitle("");
              setCoBody("");
              setCoPhotos([]);
            }
          }}
        >
          Send to homeowner
        </button>
      </div>

      <p className="label">Room photos</p>
      <div className="group" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {roomSelect(photoRoom, setPhotoRoom)}
        <div style={{ marginTop: 10 }}>
          <PhotoButton slug={slug} onAdd={(photos) => act("roomPhoto", { room: photoRoom, photos })} />
        </div>
      </div>

      <p className="label">Closeout</p>
      <div className="group">
        <label style={{ font: "var(--subhead)", color: "var(--secondary)" }}>
          Final walkthrough
          <input
            type="date"
            className="field"
            value={state.closeout.walkthrough ?? ""}
            onChange={(e) => act("closeout", { walkthrough: e.target.value })}
          />
        </label>
        <textarea className="field" placeholder="Warranty" value={warranty} onChange={(e) => setWarranty(e.target.value)} />
        <button type="button" className="button" onClick={() => act("closeout", { warranty })}>
          Save warranty
        </button>
      </div>

      <div className="group">
        {state.closeout.punch.map((p) => (
          <label key={p.id} className="check" data-done={p.done}>
            <input type="checkbox" checked={p.done} onChange={(e) => act("punchDone", { id: p.id, done: e.target.checked })} />
            <span>
              {p.room ? `${roomName(p.room)} · ` : ""}
              {p.text}
            </span>
          </label>
        ))}
        {roomSelect(punchRoom, setPunchRoom, "Whole house")}
        <input className="field" placeholder="Punch item" value={punch} onChange={(e) => setPunch(e.target.value)} />
        <button
          type="button"
          className="button"
          disabled={!punch.trim()}
          onClick={async () => {
            if (await act("punch", { text: punch, room: punchRoom })) setPunch("");
          }}
        >
          Add punch item
        </button>
      </div>

      <div className="group">
        {state.closeout.documents.map((d) => (
          <p key={d.url}>{d.name}</p>
        ))}
        <input className="field" placeholder="Document name" value={docName} onChange={(e) => setDocName(e.target.value)} />
        <input className="field" placeholder="Link" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} />
        <button
          type="button"
          className="button"
          disabled={!docName.trim() || !docUrl.startsWith("http")}
          onClick={async () => {
            if (await act("document", { name: docName, url: docUrl })) {
              setDocName("");
              setDocUrl("");
            }
          }}
        >
          Add document
        </button>
      </div>
    </main>
  );
}
