import 'server-only';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

export const ALLOWED: Record<string, { ext: string; mime: string }> = {
  pdf: { ext: 'pdf', mime: 'application/pdf' },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  txt: { ext: 'txt', mime: 'text/plain' },
};

/** Determines the real file kind from extension AND magic bytes (never trusts the browser's MIME). */
export function detectKind(fileName: string, bytes: Uint8Array): keyof typeof ALLOWED | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf' && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf'; // %PDF
  if (ext === 'docx' && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'docx'; // PK (zip)
  if (ext === 'txt' && !bytes.subarray(0, 8192).includes(0)) return 'txt';
  return null;
}

export interface Extracted {
  /** Full text (capped) */
  text: string;
  /** Per-page text for PDFs; a single entry for DOCX/TXT */
  pages: string[];
  hasPages: boolean;
}

const clean = (t: string) => t.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Lightweight server-side text extraction: unpdf (PDF, per page), mammoth (DOCX), UTF-8 (TXT). */
export async function extractText(kind: keyof typeof ALLOWED, bytes: Uint8Array): Promise<Extracted> {
  let pages: string[] = [];
  if (kind === 'txt') {
    pages = [new TextDecoder('utf-8').decode(bytes)];
  } else if (kind === 'pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const res = await pdfText(pdf, { mergePages: false });
    pages = Array.isArray(res.text) ? res.text : [res.text];
  } else if (kind === 'docx') {
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    pages = [res.value];
  }
  pages = pages.map(clean);
  // Cap total text to keep indexing bounded on serverless.
  let total = 0;
  const capped: string[] = [];
  for (const p of pages) {
    if (total >= MAX_TEXT_CHARS) break;
    capped.push(p.slice(0, MAX_TEXT_CHARS - total));
    total += p.length;
  }
  return { text: capped.join('\n\n'), pages: capped, hasPages: kind === 'pdf' };
}

export function kindFromMime(mime: string): keyof typeof ALLOWED | null {
  return (Object.keys(ALLOWED) as (keyof typeof ALLOWED)[]).find((k) => ALLOWED[k].mime === mime) ?? null;
}
