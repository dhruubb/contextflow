/**
 * Page-aware, overlapping text chunker (no server-only import: also used by the seed script).
 * ~1,200 characters per chunk (≈300 tokens) with ~200 characters of overlap, breaking on
 * paragraph → sentence → word boundaries so chunks stay readable as citations.
 */
export interface Chunk {
  index: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export function chunkPages(pages: string[], opts: { size?: number; overlap?: number; hasPages?: boolean } = {}): Chunk[] {
  const size = opts.size ?? 1200;
  const overlap = opts.overlap ?? 200;
  const hasPages = opts.hasPages ?? pages.length > 1;

  // Join pages, remembering where each page starts.
  const starts: number[] = [];
  let text = '';
  pages.forEach((p, i) => {
    const clean = p.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (i > 0 && text) text += '\n\n';
    starts.push(text.length);
    text += clean;
  });
  if (!text.trim()) return [];
  const pageAt = (offset: number) => {
    let p = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= offset) p = i;
    return p + 1;
  };

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const window = text.slice(start + Math.floor(size * 0.6), end);
      const base = start + Math.floor(size * 0.6);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('\n'));
      const word = window.lastIndexOf(' ');
      if (para >= 0) end = base + para;
      else if (sentence >= 0) end = base + sentence + 1;
      else if (word >= 0) end = base + word;
    }
    const content = text.slice(start, end).trim();
    if (content.length >= 20 || chunks.length === 0) {
      chunks.push({
        index: chunks.length,
        content,
        pageStart: hasPages ? pageAt(start) : null,
        pageEnd: hasPages ? pageAt(Math.max(start, end - 1)) : null,
      });
    }
    if (end >= text.length) break;
    // Step back by `overlap`, then forward to the next word boundary.
    let next = Math.max(end - overlap, start + 1);
    const space = text.indexOf(' ', next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }
  return chunks;
}
