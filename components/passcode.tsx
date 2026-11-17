"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const LENGTH = 6;
const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function Passcode({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [code, setCodeState] = useState("");
  // A ref keeps fast typing from reading a stale value between renders.
  const codeRef = useRef("");
  const setCode = useCallback((value: string) => {
    codeRef.current = value;
    setCodeState(value);
  }, []);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      const res = await fetch(`/api/p/${slug}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      if (res.ok) {
        router.replace(`/p/${slug}`);
        router.refresh();
        return;
      }
      setBusy(false);
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setCode("");
      }, 420);
    },
    [router, slug, setCode],
  );

  const press = useCallback(
    (digit: string) => {
      if (busy || codeRef.current.length >= LENGTH) return;
      const next = codeRef.current + digit;
      setCode(next);
      if (next.length === LENGTH) submit(next);
    },
    [busy, setCode, submit],
  );

  const back = useCallback(() => setCode(codeRef.current.slice(0, -1)), [setCode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, back]);

  return (
    <main className="lock">
      <div className="lock-inner">
        <h1 className="lock-title">{name}</h1>
        <div className="dots" data-shake={shake} aria-label={`${code.length} of ${LENGTH} digits entered`}>
          {Array.from({ length: LENGTH }, (_, i) => (
            <span key={i} className="dot" data-filled={i < code.length} />
          ))}
        </div>
        <div className="keypad">
          {keys.map((k) => (
            <button key={k} type="button" className="key" onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <span />
          <button type="button" className="key" onClick={() => press("0")}>
            0
          </button>
          <button type="button" className="key-text" onClick={back} disabled={!code.length}>
            Delete
          </button>
        </div>
      </div>
    </main>
  );
}
