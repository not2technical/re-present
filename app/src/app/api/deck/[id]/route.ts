import { NextRequest, NextResponse } from "next/server";
import { loadDeck, saveDeck } from "@/lib/store";
import type { Deck } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deck = await loadDeck(id);
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  return NextResponse.json(deck);
}

// Persist editor changes (text edits, moves, restyles).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await loadDeck(id);
  if (!existing) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  const body = (await req.json()) as Deck;
  // Trust client deck shape but keep the canonical id.
  const merged: Deck = { ...body, id };
  await saveDeck(merged);
  return NextResponse.json({ ok: true });
}
