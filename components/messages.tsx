"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PhotoButton } from "@/components/photo-button";
import { Sheet } from "@/components/sheet";
import type { Photo, ProjectState, Role, Room } from "@/lib/types";

const stamp = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Messages({
  slug,
  role,
  rooms,
  room: only,
  state,
  act,
  onClose,
}: {
  slug: string;
  role: Role;
  rooms: Room[];
  /** Show only the messages about this room. */
  room?: string;
  state: ProjectState;
  act: (action: string, body?: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [room, setRoom] = useState(only ?? "");
  const messages = only ? state.messages.filter((m) => m.room === only) : state.messages;
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    if (!body.trim() && !photos.length) return;
    setSending(true);
    if (await act("message", { body, photos, room: room || undefined })) {
      setBody("");
      setPhotos([]);
      setRoom(only ?? "");
    }
    setSending(false);
  };

  const footer = (
    <div>
      {photos.length > 0 && (
        <div className="composer-pending">
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.url} src={p.url} alt="" />
          ))}
        </div>
      )}
      <div className="composer">
        <PhotoButton slug={slug} onAdd={(p) => setPhotos((cur) => [...cur, ...p])} />
        <select
          className="icon-button"
          style={{ width: "auto", padding: "0 10px", borderRadius: 19, appearance: "none" }}
          aria-label="Room"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
        >
          <option value="">Room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <textarea
          rows={1}
          placeholder="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="icon-button"
          data-primary="true"
          aria-label="Send"
          disabled={sending || (!body.trim() && !photos.length)}
          onClick={send}
        >
          <ArrowUp />
        </button>
      </div>
    </div>
  );

  return (
    <Sheet title={only ? `Messages · ${roomName(only)}` : "Messages"} onClose={onClose} footer={footer}>
      <div className="thread">
        {messages.length === 0 && <p className="empty">No messages yet</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const gap = !prev || +new Date(m.at) - +new Date(prev.at) > 30 * 60 * 1000;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {gap && <p className="msg-meta">{stamp.format(new Date(m.at))}</p>}
              <div className="msg" data-mine={m.from === role}>
                {m.room && <span className="bubble-room">{roomName(m.room)}</span>}
                {m.body}
                {m.photos.length > 0 && (
                  <div className="photos">
                    {m.photos.map((p) => (
                      <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {m.from !== role && (!messages[i + 1] || messages[i + 1].from === role) && (
                <p className="msg-meta" style={{ textAlign: "left", margin: "0 0 4px 6px" }}>
                  {m.from === "ohi" ? "OHI" : "Homeowner"}
                </p>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </Sheet>
  );
}
