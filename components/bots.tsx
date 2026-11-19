"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import type { PublicAgent } from "@/lib/agents";

type View = { agents: PublicAgent[]; dispatchPaused: boolean; taskTypes: { type: string; does: string }[]; token?: string };

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Bots({ initial }: { initial: View }) {
  const [view, setView] = useState(initial);
  const [token, setToken] = useState<{ name: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", webhook_url: "", task_types: [] as string[] });

  const post = async (action: string, body: Record<string, unknown> = {}) => {
    const res = await fetch("/api/ohi/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "That did not go through.");
      return null;
    }
    setError("");
    setView(data);
    return data as View;
  };

  return (
    <main className="edit">
      <Link className="edit-up" href="/ohi">
        <ChevronLeft />
        Projects
      </Link>
      <h1 className="title" style={{ fontSize: 28 }}>
        Bots
      </h1>
      {error && <p className="cost-error">{error}</p>}

      <p className="label">Dispatch</p>
      <div className="group">
        <label className="row-field">
          <span>Stop every task going out</span>
          <input type="checkbox" checked={view.dispatchPaused} onChange={(e) => post("dispatch", { paused: e.target.checked })} />
        </label>
      </div>

      {token && (
        <>
          <p className="label">Token for {token.name}</p>
          <div className="group">
            <p>Copy it now; it is not shown again.</p>
            <input className="field" readOnly value={token.value} onFocus={(e) => e.target.select()} />
            <button type="button" className="button" onClick={() => setToken(null)}>
              Done
            </button>
          </div>
        </>
      )}

      <p className="label">Bots</p>
      <div className="group group-list">
        {view.agents.length === 0 && <p className="edit-item-meta">No bots yet.</p>}
        {view.agents.map((a) => (
          <div key={a.id} className="edit-item">
            <div>
              <p className="edit-item-title">
                {a.name}
                {a.paused && " · paused"}
              </p>
              <p className="edit-item-meta">
                {[
                  a.task_types.length ? a.task_types.join(", ") : "Every task",
                  a.webhook_url ? "webhook" : "polls",
                  a.last_seen_at ? `seen ${when.format(new Date(a.last_seen_at))}` : "not seen yet",
                ].join(" · ")}
              </p>
            </div>
            <span className="edit-item-actions">
              <button type="button" className="link" onClick={() => post("update", { id: a.id, paused: !a.paused })}>
                {a.paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className="link" onClick={() => post("remove", { id: a.id })}>
                Remove
              </button>
            </span>
          </div>
        ))}
      </div>

      <p className="label">Add a bot</p>
      <div className="group">
        <input className="field" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input
          className="field"
          placeholder="Webhook (https, optional)"
          value={form.webhook_url}
          onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
        />
        <p className="edit-sub">Takes (none picked takes every task)</p>
        <div className="chips">
          {view.taskTypes.map((t) => (
            <button
              key={t.type}
              type="button"
              className="chip"
              title={t.does}
              aria-pressed={form.task_types.includes(t.type)}
              onClick={() =>
                setForm({
                  ...form,
                  task_types: form.task_types.includes(t.type) ? form.task_types.filter((x) => x !== t.type) : [...form.task_types, t.type],
                })
              }
            >
              {t.type}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button"
          disabled={!form.name.trim()}
          onClick={async () => {
            const made = await post("create", form);
            if (made?.token) {
              setToken({ name: form.name, value: made.token });
              setForm({ name: "", webhook_url: "", task_types: [] });
            }
          }}
        >
          Make token
        </button>
      </div>
    </main>
  );
}
