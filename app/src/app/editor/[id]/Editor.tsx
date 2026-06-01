"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { Deck, Slide, TextBlock } from "@/lib/types";

type Props = { deckId: string };

export default function Editor({ deckId }: Props) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertMsg, setConvertMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 960, h: 540 });

  // Load deck.
  useEffect(() => {
    fetch(`/api/deck/${deckId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setDeck(d);
      })
      .catch(() => setConvertMsg("Failed to load deck."));
  }, [deckId]);

  // Track canvas pixel size for absolute positioning.
  useEffect(() => {
    if (!deck) return;
    const update = () => {
      if (!canvasRef.current) return;
      const w = canvasRef.current.clientWidth;
      setCanvasSize({ w, h: w / deck.aspect });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [deck]);

  const slide: Slide | undefined = deck?.slides[current];

  const updateBlock = useCallback(
    (blockId: string, patch: Partial<TextBlock>) => {
      setDeck((prev) => {
        if (!prev) return prev;
        const slides = prev.slides.map((s, i) => {
          if (i !== current) return s;
          return {
            ...s,
            textBlocks: s.textBlocks.map((b) =>
              b.id === blockId ? { ...b, ...patch } : b
            ),
          };
        });
        return { ...prev, slides };
      });
    },
    [current]
  );

  const updateBbox = useCallback(
    (blockId: string, bbox: Partial<TextBlock["bbox"]>) => {
      setDeck((prev) => {
        if (!prev) return prev;
        const slides = prev.slides.map((s, i) => {
          if (i !== current) return s;
          return {
            ...s,
            textBlocks: s.textBlocks.map((b) =>
              b.id === blockId ? { ...b, bbox: { ...b.bbox, ...bbox } } : b
            ),
          };
        });
        return { ...prev, slides };
      });
    },
    [current]
  );

  function deleteBlock(blockId: string) {
    setDeck((prev) => {
      if (!prev) return prev;
      const slides = prev.slides.map((s, i) =>
        i === current
          ? { ...s, textBlocks: s.textBlocks.filter((b) => b.id !== blockId) }
          : s
      );
      return { ...prev, slides };
    });
    setSelected(null);
  }

  function addBlock() {
    if (!deck) return;
    const id = crypto.randomUUID();
    const block: TextBlock = {
      id,
      text: "New text",
      bbox: { x: 0.35, y: 0.45, w: 0.3, h: 0.1 },
      fontSize: 28,
      fontFamily: "Arial",
      bold: false,
      italic: false,
      underline: false,
      color: "#1a1a1a",
      align: "left",
      fill: null,
    };
    setDeck((prev) => {
      if (!prev) return prev;
      const slides = prev.slides.map((s, i) =>
        i === current ? { ...s, textBlocks: [...s.textBlocks, block] } : s
      );
      return { ...prev, slides };
    });
    setSelected(id);
  }

  async function save() {
    if (!deck) return;
    setSaving(true);
    await fetch(`/api/deck/${deckId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deck),
    });
    setSaving(false);
  }

  // Convert slides one-by-one for live progress, then reload.
  async function convertAll() {
    if (!deck) return;
    setConverting(true);
    const pending = deck.slides.filter((s) => !s.converted);
    let done = 0;
    for (const s of pending) {
      setConvertMsg(`Converting slide ${s.index + 1} of ${deck.slides.length}…`);
      try {
        await fetch("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckId, slideIndex: s.index }),
        });
        done++;
      } catch {
        // keep going
      }
    }
    const fresh = await fetch(`/api/deck/${deckId}`).then((r) => r.json());
    setDeck(fresh);
    setConverting(false);
    setConvertMsg(`Converted ${done} slide${done === 1 ? "" : "s"}.`);
  }

  if (!deck) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        {convertMsg || "Loading deck…"}
      </div>
    );
  }

  const selBlock = slide?.textBlocks.find((b) => b.id === selected) || null;
  const unconverted = deck.slides.filter((s) => !s.converted).length;

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold text-slate-900">
            re<span className="text-indigo-600">·</span>present
          </a>
          <span className="text-sm text-slate-400 truncate max-w-xs">
            {deck.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {convertMsg && (
            <span className="text-xs text-slate-500 mr-2">{convertMsg}</span>
          )}
          <button
            onClick={convertAll}
            disabled={converting || unconverted === 0}
            className="text-sm rounded-md bg-indigo-600 text-white px-3 py-1.5 font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {converting
              ? "Converting…"
              : unconverted === 0
              ? "All converted"
              : `Make editable (${unconverted})`}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-sm rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <a
            href={`/api/export?deckId=${deckId}&format=pptx`}
            className="text-sm rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
          >
            Export PPTX
          </a>
          <a
            href={`/api/export?deckId=${deckId}&format=pdf`}
            className="text-sm rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
          >
            Export PDF
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Slide thumbnails */}
        <aside className="w-44 bg-white border-r border-slate-200 overflow-y-auto p-2 space-y-2">
          {deck.slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setCurrent(i);
                setSelected(null);
              }}
              className={`block w-full rounded-md overflow-hidden border-2 ${
                i === current ? "border-indigo-500" : "border-transparent"
              }`}
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.background}
                  alt={`Slide ${i + 1}`}
                  className="w-full block"
                />
                <span className="absolute top-1 left-1 text-[10px] bg-black/60 text-white px-1 rounded">
                  {i + 1}
                </span>
                {!s.converted && (
                  <span className="absolute bottom-1 right-1 text-[9px] bg-amber-500 text-white px-1 rounded">
                    image
                  </span>
                )}
              </div>
            </button>
          ))}
        </aside>

        {/* Canvas */}
        <main className="flex-1 overflow-auto flex items-center justify-center p-8">
          <div
            ref={canvasRef}
            className="relative bg-white shadow-lg"
            style={{ width: "min(100%, 1100px)", height: canvasSize.h }}
            onMouseDown={(e) => {
              if (e.target === canvasRef.current) setSelected(null);
            }}
          >
            {slide?.background && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slide.background}
                alt=""
                className="absolute inset-0 w-full h-full object-fill pointer-events-none"
              />
            )}

            {slide?.textBlocks.map((b) => (
              <Rnd
                key={b.id}
                bounds="parent"
                size={{
                  width: b.bbox.w * canvasSize.w,
                  height: b.bbox.h * canvasSize.h,
                }}
                position={{
                  x: b.bbox.x * canvasSize.w,
                  y: b.bbox.y * canvasSize.h,
                }}
                onDragStop={(_e, d) =>
                  updateBbox(b.id, {
                    x: d.x / canvasSize.w,
                    y: d.y / canvasSize.h,
                  })
                }
                onResizeStop={(_e, _dir, ref, _delta, pos) =>
                  updateBbox(b.id, {
                    w: ref.offsetWidth / canvasSize.w,
                    h: ref.offsetHeight / canvasSize.h,
                    x: pos.x / canvasSize.w,
                    y: pos.y / canvasSize.h,
                  })
                }
                onMouseDown={() => setSelected(b.id)}
                className={`box-border ${
                  selected === b.id
                    ? "ring-2 ring-indigo-500"
                    : "hover:ring-1 hover:ring-indigo-300"
                }`}
                style={{ background: b.fill || "transparent" }}
              >
                <textarea
                  value={b.text}
                  onChange={(e) => updateBlock(b.id, { text: e.target.value })}
                  onFocus={() => setSelected(b.id)}
                  spellCheck={false}
                  className="w-full h-full resize-none bg-transparent outline-none overflow-hidden p-0 leading-tight"
                  style={{
                    fontSize: (b.fontSize / 720) * canvasSize.h,
                    fontFamily: b.fontFamily,
                    fontWeight: b.bold ? 700 : 400,
                    fontStyle: b.italic ? "italic" : "normal",
                    textDecoration: b.underline ? "underline" : "none",
                    color: b.color,
                    textAlign: b.align,
                  }}
                />
              </Rnd>
            ))}
          </div>
        </main>

        {/* Inspector */}
        <aside className="w-64 bg-white border-l border-slate-200 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Properties</h2>
            <button
              onClick={addBlock}
              className="text-xs rounded bg-slate-100 px-2 py-1 hover:bg-slate-200"
            >
              + Text
            </button>
          </div>

          {!selBlock && (
            <p className="text-xs text-slate-400">
              Select a text box to edit its style, or click “Make editable” to
              extract text from image-only slides.
            </p>
          )}

          {selBlock && (
            <div className="space-y-3 text-sm">
              <Field label="Font size">
                <input
                  type="number"
                  value={Math.round(selBlock.fontSize)}
                  onChange={(e) =>
                    updateBlock(selBlock.id, {
                      fontSize: Number(e.target.value),
                    })
                  }
                  className="w-full border border-slate-300 rounded px-2 py-1"
                />
              </Field>

              <Field label="Font family">
                <select
                  value={selBlock.fontFamily}
                  onChange={(e) =>
                    updateBlock(selBlock.id, { fontFamily: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded px-2 py-1"
                >
                  {["Arial", "Georgia", "Times New Roman", "Verdana", "Courier New", "Calibri", "Helvetica"].map(
                    (f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    )
                  )}
                </select>
              </Field>

              <div className="flex gap-2">
                <Toggle
                  active={selBlock.bold}
                  onClick={() => updateBlock(selBlock.id, { bold: !selBlock.bold })}
                  label="B"
                  bold
                />
                <Toggle
                  active={selBlock.italic}
                  onClick={() =>
                    updateBlock(selBlock.id, { italic: !selBlock.italic })
                  }
                  label="I"
                  italic
                />
                <Toggle
                  active={selBlock.underline}
                  onClick={() =>
                    updateBlock(selBlock.id, { underline: !selBlock.underline })
                  }
                  label="U"
                  underline
                />
              </div>

              <Field label="Alignment">
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => updateBlock(selBlock.id, { align: a })}
                      className={`flex-1 border rounded px-2 py-1 text-xs ${
                        selBlock.align === a
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-slate-300"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Text color">
                <input
                  type="color"
                  value={selBlock.color}
                  onChange={(e) =>
                    updateBlock(selBlock.id, { color: e.target.value })
                  }
                  className="w-full h-8 border border-slate-300 rounded"
                />
              </Field>

              <Field label="Box fill">
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={selBlock.fill || "#ffffff"}
                    onChange={(e) =>
                      updateBlock(selBlock.id, { fill: e.target.value })
                    }
                    className="flex-1 h-8 border border-slate-300 rounded"
                  />
                  <button
                    onClick={() => updateBlock(selBlock.id, { fill: null })}
                    className="text-xs border border-slate-300 rounded px-2 py-1"
                  >
                    none
                  </button>
                </div>
              </Field>

              <button
                onClick={() => deleteBlock(selBlock.id)}
                className="w-full text-xs text-red-600 border border-red-200 rounded px-2 py-1.5 hover:bg-red-50"
              >
                Delete text box
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  active,
  onClick,
  label,
  bold,
  italic,
  underline,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 border rounded py-1 ${
        active ? "border-indigo-500 bg-indigo-50" : "border-slate-300"
      }`}
      style={{
        fontWeight: bold ? 700 : 400,
        fontStyle: italic ? "italic" : "normal",
        textDecoration: underline ? "underline" : "none",
      }}
    >
      {label}
    </button>
  );
}
