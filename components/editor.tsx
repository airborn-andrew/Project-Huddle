"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Minus, Plus, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Costing } from "@/components/costing";
import { PhotoButton } from "@/components/photo-button";
import { useProject } from "@/lib/client";
import {
  calendarOf,
  dayFormat,
  isoDate,
  lastDay,
  parseDate,
  phaseTitle,
  scheduleOf,
  workdayDate,
  type Calendar,
} from "@/lib/sequence";
import { templateById, templates } from "@/lib/templates";
import {
  selectionCategories,
  type Editable,
  type Phase,
  type PhaseEdit,
  type Photo,
  type Plan,
  type ProjectState,
  type Room,
  type Selection,
  type SelectionCategory,
} from "@/lib/types";

type Act = (action: string, body?: Record<string, unknown>) => Promise<boolean>;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const logTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** OHI's draft, or the published project when there are no unpushed changes. */
function working(s: ProjectState): Editable {
  return s.draft ?? s;
}

/** The workday index on or after a calendar date. */
function indexFor(cal: Calendar, iso: string) {
  const target = parseDate(iso).getTime();
  for (let i = 0; i < 400; i++) if (workdayDate(cal, i).getTime() >= target) return i;
  return 0;
}

const span = (cal: Calendar, p: PhaseEdit) => {
  const first = dayFormat.format(workdayDate(cal, p.start));
  if (p.days === 1) return first;
  return `${first} – ${dayFormat.format(workdayDate(cal, p.start + p.days - 1)).split(", ")[1]}`;
};

/**
 * OHI's controls. Every change lands in a draft; Push to homeowner publishes
 * it. Undo steps back one change, and the change log lists every edit.
 */
export function Editor({
  slug,
  name,
  plan,
  phases,
  initialState,
}: {
  slug: string;
  name: string;
  plan: Plan;
  phases: Phase[];
  initialState: ProjectState;
}) {
  const { state, act } = useProject(slug, initialState);
  const d = working(state);
  const cal = calendarOf(d);
  const schedule = useMemo(() => [...scheduleOf(d, phases)].sort((a, b) => a.start - b.start), [d, phases]);
  const rooms = plan.rooms;
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run: Act = async (action, body) => {
    setBusy(true);
    try {
      return await act(action, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="edit">
      <Link className="edit-up" href="/ohi">
        <ChevronLeft />
        Projects
      </Link>
      <div className="edit-head">
        <h1 className="title" style={{ fontSize: 28 }}>
          {name}
        </h1>
        <Link className="edit-back" href={`/p/${slug}`}>
          Done
        </Link>
      </div>

      <NoteComposer slug={slug} rooms={rooms} cal={cal} last={lastDay(schedule.map((p) => ({ day: p.start, days: p.days })))} act={run} />

      <p className="label">Schedule</p>
      <div className="group group-list">
        {schedule.map((p) => (
          <PhaseRow
            key={p.id}
            phase={p}
            rooms={rooms}
            cal={cal}
            expect={d.expect[p.template]}
            open={open === p.id}
            onToggle={() => setOpen(open === p.id ? null : p.id)}
            act={run}
          />
        ))}
        <AddPhase rooms={rooms} act={run} />
      </div>

      <p className="label">Calendar</p>
      <div className="group">
        <label className="row-field">
          <span>Start date</span>
          <input
            type="date"
            value={d.startDate}
            onChange={(e) => e.target.value && run("start", { startDate: e.target.value })}
          />
        </label>
        <OffDays offDays={d.offDays} act={run} />
      </div>

      {d.notes.length > 0 && (
        <>
          <p className="label">Notes</p>
          <div className="group group-list">
            {[...d.notes].reverse().map((n) => (
              <div key={n.id} className="edit-item">
                <div>
                  <p className="edit-item-title">{n.body || "Photos"}</p>
                  <p className="edit-item-meta">
                    {[n.room && rooms.find((r) => r.id === n.room)?.name, n.date && dayFormat.format(parseDate(n.date))]
                      .filter(Boolean)
                      .join(" · ") || "Whole job"}
                    {n.photos.length > 0 && ` · ${n.photos.length} photo${n.photos.length > 1 ? "s" : ""}`}
                  </p>
                </div>
                <button type="button" className="icon-button" aria-label="Remove note" onClick={() => run("removeNote", { id: n.id })}>
                  <X />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <ChangeOrdersEditor slug={slug} editable={d} act={run} />

      <SelectionsEditor slug={slug} rooms={rooms} editable={d} act={run} />

      <p className="label">Messages</p>
      <div className="group">
        <Link className="link-row" href={`/p/${slug}?sheet=messages`}>
          Open messages
          <ChevronRight />
        </Link>
      </div>

      <CloseoutEditor rooms={rooms} editable={d} act={run} />

      <PeopleEditor schedule={schedule} rooms={rooms} editable={d} act={run} />

      <Costing slug={slug} />

      {state.log.length > 0 && (
        <>
          <p className="label">Change log</p>
          <div className="group group-list">
            {state.log.slice(0, 60).map((l, i) => (
              <div key={`${l.at}-${i}`} className="edit-item">
                <p className="edit-item-title">{l.text}</p>
                <p className="edit-item-meta">{logTime.format(new Date(l.at))}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="push-bar glass">
        <span className="push-status">{state.draft ? "Changes not pushed" : "Homeowner is up to date"}</span>
        <button type="button" className="icon-button" aria-label="Undo" disabled={busy || !state.undo.length} onClick={() => run("undo")}>
          <Undo2 />
        </button>
        <button type="button" className="button push-button" disabled={busy || !state.draft} onClick={() => run("push")}>
          Push to homeowner
        </button>
      </div>
    </main>
  );
}

function NoteComposer({ slug, rooms, cal, last, act }: { slug: string; rooms: Room[]; cal: Calendar; last: number; act: Act }) {
  const today = isoDate(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [room, setRoom] = useState("");
  const [date, setDate] = useState(today);
  const days = Array.from({ length: last + 1 }, (_, i) => isoDate(workdayDate(cal, i)));

  return (
    <>
      <p className="label">Add a note</p>
      <div className="group">
        <textarea className="field" placeholder="What happened, what's next" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="edit-inline">
          <PhotoButton slug={slug} onAdd={(p) => setPhotos((cur) => [...cur, ...p])} />
          <select className="field" aria-label="Room" value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">Whole house</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select className="field" aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)}>
            <option value="">No day</option>
            {!days.includes(today) && <option value={today}>Today</option>}
            {days.map((iso) => (
              <option key={iso} value={iso}>
                {dayFormat.format(parseDate(iso))}
              </option>
            ))}
          </select>
        </div>
        {photos.length > 0 && (
          <div className="photos">
            {photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.url} src={p.url} alt="" />
            ))}
          </div>
        )}
        <button
          type="button"
          className="button"
          disabled={!body.trim() && !photos.length}
          onClick={async () => {
            if (await act("note", { body, photos, room: room || undefined, date: date || undefined })) {
              setBody("");
              setPhotos([]);
            }
          }}
        >
          Post note
        </button>
      </div>
    </>
  );
}

function PhaseRow({
  phase,
  rooms,
  cal,
  expect,
  open,
  onToggle,
  act,
}: {
  phase: PhaseEdit;
  rooms: Room[];
  cal: Calendar;
  expect: string | undefined;
  open: boolean;
  onToggle: () => void;
  act: Act;
}) {
  const template = templateById(phase.template);
  const [line, setLine] = useState(expect ?? template?.expect ?? "");
  const covered = Object.keys(phase.rooms);

  return (
    <div className="phase" data-done={phase.done}>
      <button type="button" className="phase-head" aria-expanded={open} onClick={onToggle}>
        <span className="edit-item-title">{phaseTitle(phase, rooms)}</span>
        <span className="edit-item-meta">
          {span(cal, phase)}
          {phase.done && " · Done"}
        </span>
      </button>
      {open && (
        <div className="phase-body">
          <label className="row-field">
            <span>Starts</span>
            <input
              type="date"
              value={isoDate(workdayDate(cal, phase.start))}
              onChange={(e) => e.target.value && act("phase", { id: phase.id, start: indexFor(cal, e.target.value) })}
            />
          </label>
          <div className="row-field">
            <span>Length</span>
            <span className="stepper">
              <button
                type="button"
                className="icon-button"
                aria-label="One day shorter"
                disabled={phase.days <= 1}
                onClick={() => act("phase", { id: phase.id, days: phase.days - 1 })}
              >
                <Minus />
              </button>
              <span>
                {phase.days} {phase.days === 1 ? "day" : "days"}
              </span>
              <button type="button" className="icon-button" aria-label="One day longer" onClick={() => act("phase", { id: phase.id, days: phase.days + 1 })}>
                <Plus />
              </button>
            </span>
          </div>
          <label className="row-field">
            <span>Done</span>
            <input type="checkbox" checked={phase.done} onChange={(e) => act("phase", { id: phase.id, done: e.target.checked })} />
          </label>
          <p className="edit-sub">Rooms</p>
          <div className="chips">
            {rooms.map((r) => {
              const on = covered.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  disabled={on && covered.length === 1}
                  onClick={() =>
                    act("phase", { id: phase.id, rooms: on ? covered.filter((x) => x !== r.id) : [...covered, r.id] })
                  }
                >
                  {r.name}
                </button>
              );
            })}
          </div>
          <p className="edit-sub">What to expect</p>
          <textarea className="field" value={line} onChange={(e) => setLine(e.target.value)} />
          <div className="edit-actions">
            <button
              type="button"
              className="button"
              disabled={line.trim() === (expect ?? template?.expect ?? "")}
              onClick={() => act("expect", { template: phase.template, text: line })}
            >
              Save
            </button>
            <button type="button" className="button button-quiet" onClick={() => act("removePhase", { id: phase.id })}>
              Remove day
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPhase({ rooms, act }: { rooms: Room[]; act: Act }) {
  const [template, setTemplate] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <div className="phase">
      <div className="phase-body">
        <p className="edit-sub">Add a day</p>
        <select className="field" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">Choose the work</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title(rooms.filter((r) => picked.includes(r.id)))}
            </option>
          ))}
        </select>
        {template && (
          <div className="chips">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                className="chip"
                aria-pressed={picked.includes(r.id)}
                onClick={() => setPicked((cur) => (cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id]))}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="button"
          disabled={!template || !picked.length}
          onClick={async () => {
            if (await act("addPhase", { template, rooms: picked })) {
              setTemplate("");
              setPicked([]);
            }
          }}
        >
          Add to the end
        </button>
      </div>
    </div>
  );
}

function OffDays({ offDays, act }: { offDays: string[]; act: Act }) {
  const [date, setDate] = useState("");
  return (
    <>
      {offDays.map((day) => (
        <div key={day} className="edit-item">
          <p className="edit-item-title">Off · {dayFormat.format(parseDate(day))}</p>
          <button type="button" className="icon-button" aria-label="Make it a workday" onClick={() => act("offDay", { date: day, off: false })}>
            <X />
          </button>
        </div>
      ))}
      <div className="edit-inline">
        <input type="date" className="field" aria-label="Off day" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          className="button"
          disabled={!date}
          onClick={async () => {
            if (await act("offDay", { date, off: true })) setDate("");
          }}
        >
          Add off day
        </button>
      </div>
    </>
  );
}

function ChangeOrdersEditor({ slug, editable, act }: { slug: string; editable: Editable; act: Act }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });

  return (
    <>
      <p className="label">Change orders</p>
      {editable.changeOrders.length > 0 && (
        <div className="group group-list">
          {editable.changeOrders.map((co) =>
            editing === co.id ? (
              <div key={co.id} className="phase-body">
                <input className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                <textarea className="field" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                <div className="edit-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={!draft.title.trim()}
                    onClick={async () => {
                      if (await act("editChangeOrder", { id: co.id, ...draft })) setEditing(null);
                    }}
                  >
                    Save
                  </button>
                  <button type="button" className="button button-quiet" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={co.id} className="edit-item">
                <div>
                  <p className="edit-item-title">
                    {co.title}
                    {co.price !== undefined && ` · ${usd.format(co.price)}`}
                  </p>
                  <p className="edit-item-meta">
                    {co.answer ? `Answered ${co.answer.choice === "other" ? "with something else" : co.answer.choice}` : "Waiting"}
                  </p>
                </div>
                {!co.answer && (
                  <span className="edit-item-actions">
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setEditing(co.id);
                        setDraft({ title: co.title, body: co.body });
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="link" onClick={() => act("withdrawChangeOrder", { id: co.id })}>
                      Withdraw
                    </button>
                  </span>
                )}
              </div>
            ),
          )}
        </div>
      )}
      <div className="group">
        <input className="field" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="field" placeholder="Details" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="edit-inline">
          <PhotoButton slug={slug} onAdd={(p) => setPhotos((c) => [...c, ...p])} />
          <span className="edit-item-meta">{photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""}` : ""}</span>
        </div>
        <button
          type="button"
          className="button"
          disabled={!title.trim()}
          onClick={async () => {
            if (await act("changeOrder", { title, body, photos })) {
              setTitle("");
              setBody("");
              setPhotos([]);
            }
          }}
        >
          Add change order
        </button>
      </div>
    </>
  );
}

type SelectionForm = { category: SelectionCategory | ""; name: string; style: string; room: string; photos: Photo[] };

const blankSelection: SelectionForm = { category: "", name: "", style: "", room: "", photos: [] };

function SelectionsEditor({ slug, rooms, editable, act }: { slug: string; rooms: Room[]; editable: Editable; act: Act }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<SelectionForm>(blankSelection);
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name;
  const startEdit = (s: Selection | null) => {
    setEditing(s?.id ?? "new");
    setForm(s ? { category: s.category, name: s.name, style: s.style ?? "", room: s.room ?? "", photos: s.photos } : blankSelection);
  };

  return (
    <>
      <p className="label">Selections</p>
      <div className="group group-list">
        {editable.selections.map((s) =>
          editing === s.id ? null : (
            <div key={s.id} className="edit-item">
              <div>
                <p className="edit-item-title">{s.name}</p>
                <p className="edit-item-meta">
                  {[s.category, s.style, roomName(s.room), s.photos.length ? `${s.photos.length} photo${s.photos.length > 1 ? "s" : ""}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="edit-item-actions">
                <button type="button" className="link" onClick={() => startEdit(s)}>
                  Edit
                </button>
                <button type="button" className="link" onClick={() => act("removeSelection", { id: s.id })}>
                  Remove
                </button>
              </span>
            </div>
          ),
        )}
        {editing ? (
          <div className="phase-body">
            <select
              className="field"
              aria-label="Kind of finish"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as SelectionCategory })}
            >
              <option value="">Choose the finish</option>
              {selectionCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input className="field" placeholder="Product" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="field" placeholder="Color or style" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} />
            <div className="edit-inline">
              <PhotoButton slug={slug} onAdd={(p) => setForm((f) => ({ ...f, photos: [...f.photos, ...p].slice(0, 6) }))} />
              <select className="field" aria-label="Room" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}>
                <option value="">Whole house</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {form.photos.length > 0 && (
              <div className="photos">
                {form.photos.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    className="photo-remove"
                    aria-label="Remove photo"
                    onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((x) => x.url !== p.url) }))}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" />
                    <X />
                  </button>
                ))}
              </div>
            )}
            <div className="edit-actions">
              <button
                type="button"
                className="button"
                disabled={!form.category || !form.name.trim()}
                onClick={async () => {
                  if (await act("selection", { id: editing === "new" ? undefined : editing, ...form, room: form.room || undefined })) {
                    setEditing(null);
                  }
                }}
              >
                Save
              </button>
              <button type="button" className="button button-quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="phase-body">
            <button type="button" className="button" onClick={() => startEdit(null)}>
              Add a selection
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function CloseoutEditor({ rooms, editable, act }: { rooms: Room[]; editable: Editable; act: Act }) {
  const { closeout } = editable;
  const [warranty, setWarranty] = useState(closeout.warranty);
  const [punch, setPunch] = useState("");
  const [punchRoom, setPunchRoom] = useState("");
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name;

  return (
    <>
      <p className="label">Closeout</p>
      <div className="group">
        <p className="edit-sub">Punch list</p>
        {closeout.punch.map((p) => (
          <div key={p.id} className="edit-item">
            <label className="check" data-done={p.done}>
              <input type="checkbox" checked={p.done} onChange={(e) => act("punchDone", { id: p.id, done: e.target.checked })} />
              <span>
                {p.room ? `${roomName(p.room)} · ` : ""}
                {p.text}
              </span>
            </label>
            <button type="button" className="icon-button" aria-label="Remove punch item" onClick={() => act("removePunch", { id: p.id })}>
              <X />
            </button>
          </div>
        ))}
        <div className="edit-inline">
          <select className="field" aria-label="Room" value={punchRoom} onChange={(e) => setPunchRoom(e.target.value)}>
            <option value="">Whole house</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
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
        <p className="edit-sub">Warranty</p>
        <textarea className="field" value={warranty} onChange={(e) => setWarranty(e.target.value)} />
        <button type="button" className="button" disabled={warranty === closeout.warranty} onClick={() => act("warranty", { warranty })}>
          Save warranty
        </button>
      </div>
      <div className="group">
        <p className="edit-sub">Documents</p>
        {closeout.documents.map((doc) => (
          <div key={doc.url} className="edit-item">
            <a className="edit-item-title" href={doc.url} target="_blank" rel="noreferrer">
              {doc.name}
            </a>
            <button type="button" className="icon-button" aria-label="Remove document" onClick={() => act("removeDocument", { url: doc.url })}>
              <X />
            </button>
          </div>
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
    </>
  );
}

function PeopleEditor({ schedule, rooms, editable, act }: { schedule: PhaseEdit[]; rooms: Room[]; editable: Editable; act: Act }) {
  const { people } = editable;
  const [pm, setPm] = useState(people.pm.name);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", trade: "", phases: [] as string[] });
  const startEdit = (id: string | null) => {
    const sub = people.subs.find((s) => s.id === id);
    setEditing(id ?? "new");
    setForm(sub ? { name: sub.name, trade: sub.trade, phases: sub.phases } : { name: "", trade: "", phases: [] });
  };

  return (
    <>
      <p className="label">People</p>
      <div className="group">
        <p className="edit-sub">Project manager</p>
        <div className="edit-inline">
          <input className="field" value={pm} onChange={(e) => setPm(e.target.value)} />
          <button type="button" className="button" disabled={!pm.trim() || pm === people.pm.name} onClick={() => act("pm", { name: pm })}>
            Save
          </button>
        </div>
      </div>
      <div className="group group-list">
        {people.subs.map((s) =>
          editing === s.id ? null : (
            <div key={s.id} className="edit-item">
              <div>
                <p className="edit-item-title">{s.name}</p>
                <p className="edit-item-meta">
                  {[s.trade, s.phases.length ? `${s.phases.length} production ${s.phases.length === 1 ? "day" : "days"}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="edit-item-actions">
                <button type="button" className="link" onClick={() => startEdit(s.id)}>
                  Edit
                </button>
                <button type="button" className="link" onClick={() => act("removeSub", { id: s.id })}>
                  Remove
                </button>
              </span>
            </div>
          ),
        )}
        {editing ? (
          <div className="phase-body">
            <input className="field" placeholder="Company or name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="field" placeholder="Trade" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} />
            <p className="edit-sub">On site for</p>
            <div className="chips">
              {schedule.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip"
                  aria-pressed={form.phases.includes(p.id)}
                  onClick={() =>
                    setForm({
                      ...form,
                      phases: form.phases.includes(p.id) ? form.phases.filter((x) => x !== p.id) : [...form.phases, p.id],
                    })
                  }
                >
                  {phaseTitle(p, rooms)}
                </button>
              ))}
            </div>
            <div className="edit-actions">
              <button
                type="button"
                className="button"
                disabled={!form.name.trim()}
                onClick={async () => {
                  if (await act("sub", { id: editing === "new" ? undefined : editing, ...form })) setEditing(null);
                }}
              >
                Save
              </button>
              <button type="button" className="button button-quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="phase-body">
            <button type="button" className="button" onClick={() => startEdit(null)}>
              Add a sub
            </button>
          </div>
        )}
      </div>
    </>
  );
}
