import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Deck } from "./types";

// Lightweight deck persistence. Decks contain large base64 images, so we
// persist to disk under a temp dir keyed by deck id. This keeps the app
// stateless-friendly and avoids a DB dependency for local-first hosting.

const ROOT = path.join(os.tmpdir(), "re-present-decks");

async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true });
}

function deckPath(id: string) {
  return path.join(ROOT, `${id}.json`);
}

export async function saveDeck(deck: Deck): Promise<void> {
  await ensureRoot();
  await fs.writeFile(deckPath(deck.id), JSON.stringify(deck), "utf8");
}

export async function loadDeck(id: string): Promise<Deck | null> {
  try {
    const raw = await fs.readFile(deckPath(id), "utf8");
    return JSON.parse(raw) as Deck;
  } catch {
    return null;
  }
}

export async function deleteDeck(id: string): Promise<void> {
  try {
    await fs.unlink(deckPath(id));
  } catch {
    // already gone
  }
}
