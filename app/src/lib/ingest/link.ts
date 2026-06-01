// Resolve a presentation link into a downloadable file buffer.
// Supports Google Slides (public) and direct file URLs.

export type FetchedFile = {
  buffer: Buffer;
  kind: "pdf" | "pptx" | "markdown";
  title: string;
};

function googleSlidesId(url: string): string | null {
  const m = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function fetchPresentationLink(url: string): Promise<FetchedFile> {
  const gsId = googleSlidesId(url);
  if (gsId) {
    // Export public Google Slides as PDF (high fidelity, page-per-slide).
    const exportUrl = `https://docs.google.com/presentation/d/${gsId}/export/pdf`;
    const res = await fetch(exportUrl);
    if (!res.ok) {
      throw new Error(
        `Could not fetch Google Slides (HTTP ${res.status}). Make sure the deck is shared as "anyone with the link".`
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, kind: "pdf", title: `google-slides-${gsId}` };
  }

  // Generic URL: fetch and infer kind from content-type / extension.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch URL (HTTP ${res.status}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  const lower = url.toLowerCase();

  if (ct.includes("pdf") || lower.endsWith(".pdf")) {
    return { buffer, kind: "pdf", title: basename(url) };
  }
  if (
    ct.includes("presentation") ||
    lower.endsWith(".pptx") ||
    lower.endsWith(".ppt")
  ) {
    return { buffer, kind: "pptx", title: basename(url) };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || ct.includes("markdown")) {
    return { buffer, kind: "markdown", title: basename(url) };
  }
  // Default to PDF attempt.
  return { buffer, kind: "pdf", title: basename(url) };
}

function basename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last || u.hostname;
  } catch {
    return "presentation";
  }
}
