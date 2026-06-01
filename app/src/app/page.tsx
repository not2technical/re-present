"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setStatus("Imported. Opening editor…");
      router.push(`/editor/${data.deckId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
      setStatus(null);
    }
  }

  async function handleLink() {
    if (!link.trim()) return;
    setError(null);
    setBusy(true);
    setStatus("Fetching presentation…");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setStatus("Imported. Opening editor…");
      router.push(`/editor/${data.deckId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold tracking-tight text-slate-900">
            re<span className="text-indigo-600">·</span>present
          </h1>
          <p className="mt-3 text-slate-600 text-lg">
            Turn flattened slide decks back into fully editable presentations.
          </p>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8"
        >
          <button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-slate-300 rounded-xl py-12 text-center hover:border-indigo-400 hover:bg-indigo-50/40 transition disabled:opacity-50"
          >
            <div className="text-slate-700 font-medium">
              Drop a file here, or click to upload
            </div>
            <div className="text-sm text-slate-400 mt-1">
              PowerPoint (.pptx), PDF, or Markdown (.md)
            </div>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pptx,.ppt,.pdf,.md,.markdown"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          <div className="flex items-center gap-3 my-6">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-xs uppercase tracking-wider text-slate-400">
              or
            </span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a Google Slides or file URL"
              disabled={busy}
              onKeyDown={(e) => e.key === "Enter" && handleLink()}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={handleLink}
              disabled={busy || !link.trim()}
              className="rounded-lg bg-indigo-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Import
            </button>
          </div>

          {status && (
            <p className="mt-5 text-sm text-indigo-600 text-center">{status}</p>
          )}
          {error && (
            <p className="mt-5 text-sm text-red-600 text-center">{error}</p>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Runs locally. Conversion uses the Claude API — set ANTHROPIC_API_KEY.
        </p>
      </div>
    </main>
  );
}
