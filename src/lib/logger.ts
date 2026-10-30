import 'server-only';
import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Structured JSON logging.
 * - Always writes to stdout (Vercel / any log drain picks this up).
 * - Locally also writes to logs/app.log, rotated at 10 MB (keeps app.log.1 … app.log.3).
 *   On read-only filesystems (Vercel) the file sink is skipped automatically.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP = 3;

function rotatingFileStream(file: string) {
  let size = 0;
  try {
    size = fs.existsSync(/*turbopackIgnore: true*/ file) ? fs.statSync(/*turbopackIgnore: true*/ file).size : 0;
  } catch {
    size = 0;
  }
  return {
    write(chunk: string) {
      try {
        if (size + chunk.length > MAX_BYTES) {
          for (let i = KEEP - 1; i >= 1; i--) {
            const from = `${file}.${i}`;
            if (fs.existsSync(/*turbopackIgnore: true*/ from)) fs.renameSync(/*turbopackIgnore: true*/ from, `${file}.${i + 1}`);
          }
          if (fs.existsSync(/*turbopackIgnore: true*/ file)) fs.renameSync(/*turbopackIgnore: true*/ file, `${file}.1`);
          size = 0;
        }
        fs.appendFileSync(/*turbopackIgnore: true*/ file, chunk);
        size += Buffer.byteLength(chunk);
      } catch {
        // never let logging break a request
      }
    },
  };
}

function buildStreams(): pino.StreamEntry[] {
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
  if (process.env.LOG_TO_FILE === 'false' || process.env.VERCEL) return streams;
  try {
    const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'logs');
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    streams.push({ stream: rotatingFileStream(path.join(dir, 'app.log')) });
  } catch {
    // read-only filesystem: stdout only
  }
  return streams;
}

const g = globalThis as unknown as { __cfLogger?: pino.Logger };

export const logger: pino.Logger =
  g.__cfLogger ??
  pino(
    {
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      base: { service: 'contextflow-ai', env: process.env.NODE_ENV },
      redact: ['*.password', '*.token', '*.apiKey', 'headers.authorization', 'headers.cookie'],
    },
    pino.multistream(buildStreams()),
  );
g.__cfLogger = logger;

export type Logger = pino.Logger;

export function requestLogger(requestId: string, extra: Record<string, unknown> = {}) {
  return logger.child({ requestId, ...extra });
}
