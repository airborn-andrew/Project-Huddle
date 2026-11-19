"use client";

import { useState } from "react";
import { PhotoButton } from "@/components/photo-button";
import { Sheet } from "@/components/sheet";
import type { ChangeOrder, Photo, ProjectState, Role } from "@/lib/types";

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const choiceText = { yes: "Yes", no: "No", other: "Something else" } as const;

type Act = (action: string, body?: Record<string, unknown>) => Promise<boolean>;

export function ChangeOrders({
  slug,
  role,
  state,
  act,
  onClose,
}: {
  slug: string;
  role: Role;
  state: ProjectState;
  act: Act;
  onClose: () => void;
}) {
  const waiting = state.changeOrders.filter((c) => !c.answer);
  const answered = state.changeOrders.filter((c) => c.answer);

  return (
    <Sheet title="Change orders" onClose={onClose}>
      {state.changeOrders.length === 0 && <p className="empty">No change orders</p>}
      {waiting.map((c) => (
        <Card key={c.id} slug={slug} role={role} co={c} act={act} />
      ))}
      {answered.length > 0 && <p className="label">Answered</p>}
      {answered.map((c) => (
        <Card key={c.id} slug={slug} role={role} co={c} act={act} />
      ))}
    </Sheet>
  );
}

function Card({ slug, role, co, act }: { slug: string; role: Role; co: ChangeOrder; act: Act }) {
  const [other, setOther] = useState(false);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);

  const answer = async (choice: "yes" | "no" | "other") => {
    setBusy(true);
    await act("answer", { id: co.id, choice, note, photos });
    setBusy(false);
  };

  return (
    <article className="group">
      <h3>{co.title}</h3>
      {co.price !== undefined && <p className="co-price">{usd.format(co.price)}</p>}
      {co.body && <p>{co.body}</p>}
      <Thumbs photos={co.photos} />
      {co.answer ? (
        <div className="answer">
          <strong>{choiceText[co.answer.choice]}</strong> · {date.format(new Date(co.answer.at))}
          {co.answer.note && <p style={{ marginTop: 4 }}>{co.answer.note}</p>}
          <Thumbs photos={co.answer.photos} />
        </div>
      ) : role === "home" ? (
        other ? (
          <>
            <textarea className="field" placeholder="What would you like instead?" value={note} onChange={(e) => setNote(e.target.value)} />
            {photos.length > 0 && <Thumbs photos={photos} />}
            <div className="choices" style={{ gridTemplateColumns: "auto 1fr 1fr" }}>
              <PhotoButton slug={slug} onAdd={(p) => setPhotos((cur) => [...cur, ...p])} />
              <button type="button" className="choice" onClick={() => setOther(false)}>
                Back
              </button>
              <button
                type="button"
                className="choice"
                data-primary="true"
                disabled={busy || (!note.trim() && !photos.length)}
                onClick={() => answer("other")}
              >
                Submit
              </button>
            </div>
          </>
        ) : (
          <div className="choices">
            <button type="button" className="choice" data-primary="true" disabled={busy} onClick={() => answer("yes")}>
              Yes
            </button>
            <button type="button" className="choice" disabled={busy} onClick={() => answer("no")}>
              No
            </button>
            <button type="button" className="choice choice-wide" disabled={busy} onClick={() => setOther(true)}>
              Submit something else
            </button>
          </div>
        )
      ) : (
        <p className="answer" style={{ color: "var(--tertiary)" }}>
          Sent {date.format(new Date(co.createdAt))}
        </p>
      )}
    </article>
  );
}

function Thumbs({ photos }: { photos: Photo[] }) {
  if (!photos.length) return null;
  return (
    <div className="photos">
      {photos.map((p) => (
        <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}
