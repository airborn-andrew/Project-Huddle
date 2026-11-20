"use client";

import { useState } from "react";
import { Sheet } from "@/components/sheet";

/**
 * Hands the layout to the homeowner's own AI and takes its changes back. The
 * file and a snapshot of the room go out through the phone's share sheet (or
 * download on a computer); the file the AI sends back is uploaded and checked
 * like any other save.
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
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  return (
    <Sheet title="Share with your AI" onClose={onClose}>
      <section className="ai-step">
        <h3 className="ai-step-title">Send the layout</h3>
        <p className="ai-step-text">
          Your AI gets the layout file and a picture of the room. Ask for changes in your own words, and ask it to send the layout back as a file.
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
        <p className="ai-step-text">Upload the file your AI sends back, and the room updates.</p>
        <label className="button button-quiet ai-file" aria-disabled={busy}>
          {busy ? "Checking the file" : "Upload the file"}
          <input
            type="file"
            accept=".json,.txt,application/json,text/plain"
            hidden
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              const wrong = await onUpload(await file.text());
              setBusy(false);
              if (wrong) setProblems(wrong);
              else onClose();
            }}
          />
        </label>
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
