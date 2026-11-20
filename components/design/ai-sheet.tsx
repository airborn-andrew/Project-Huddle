"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/sheet";

/**
 * Hands the layout to the homeowner's own AI and takes its changes back. The
 * file and a snapshot of the room go out through the phone's share sheet (or
 * download on a computer); what comes back is uploaded as a file or pasted in,
 * and checked like any other save.
 */
export function AiSheet({
  onSend,
  onUpload,
  onClose,
}: {
  onSend: () => Promise<void>;
  onUpload: (text: string) => Promise<string[] | null>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [canPaste, setCanPaste] = useState(false);
  useEffect(() => setCanPaste(Boolean(navigator.clipboard?.readText)), []);

  const submit = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    const wrong = await onUpload(value);
    setBusy(false);
    if (wrong) setProblems(wrong);
    else onClose();
  };

  return (
    <Sheet title="Share with your AI" onClose={onClose}>
      <section className="ai-step">
        <h3 className="ai-step-title">Send the layout</h3>
        <p className="ai-step-text">
          Your AI gets the layout file and a picture of the room. The file explains itself, so you can ask for changes in your own words.
        </p>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSend();
            setBusy(false);
          }}
        >
          Send to your AI
        </button>
      </section>

      <section className="ai-step">
        <h3 className="ai-step-title">Bring the changes back</h3>
        <p className="ai-step-text">Upload the file your AI sends back, or copy its answer and paste it here.</p>
        <label className="button button-quiet ai-file">
          Upload the file
          <input
            type="file"
            accept=".json,.txt,application/json,text/plain"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) await submit(await file.text());
            }}
          />
        </label>
        {canPaste && (
          <button
            type="button"
            className="button button-quiet ai-file"
            disabled={busy}
            onClick={async () => {
              const copied = await navigator.clipboard.readText().catch(() => "");
              if (copied.trim()) {
                setText(copied);
                await submit(copied);
              }
            }}
          >
            Paste what you copied
          </button>
        )}
        <textarea className="field" placeholder="Or paste here" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="button" disabled={busy || !text.trim()} onClick={() => submit(text)}>
          Use these changes
        </button>
        {problems.length > 0 && (
          <div className="ai-problems" role="alert">
            <p>Nothing changed yet. Ask your AI to fix this and send the file again:</p>
            <ul>
              {problems.slice(0, 6).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </Sheet>
  );
}
