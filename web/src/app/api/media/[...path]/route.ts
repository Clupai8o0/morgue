import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Readable } from "node:stream";

/**
 * Resolves preview media.
 *
 * This route exists so the app has ONE media abstraction across both
 * environments. Locally it streams from the sibling site/media directory;
 * in production it will 302 to a short-lived signed R2 URL. The grid never
 * knows which, so nothing about the card component changes when storage does.
 *
 * The private R2 bucket has no public access, which is the whole point — app
 * auth is worthless if the underlying mp4 is fetchable by anyone holding a
 * CDN link. See the storage task.
 */

const LOCAL_DIR =
  process.env.MORGUE_SITE_DIR ?? path.resolve(process.cwd(), "..", "site");

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  // Production: hand the browser a short-lived signed URL and get out of the
  // way. Proxying gigabytes of video through a serverless function would be
  // slow, expensive, and would throw away R2's zero-egress advantage.
  // Access itself is already gated in proxy.ts before this route runs.
  if (process.env.MORGUE_DATA_SOURCE === "r2") {
    const { signMediaUrl } = await import("@/lib/r2");
    try {
      const signed = await signMediaUrl(`media/${segments.join("/")}`);
      return Response.redirect(signed, 302);
    } catch (err) {
      console.error("[media] sign failed", err);
      return new Response("Media unavailable", { status: 502 });
    }
  }

  const root = path.join(LOCAL_DIR, "media");
  const target = path.join(root, ...segments);

  // Containment check. The segments come from the URL, so this is the real
  // boundary, not a formality.
  if (!target.startsWith(root + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  const type = TYPES[path.extname(target).toLowerCase()];
  if (!type) return new Response("Unsupported media type", { status: 415 });

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    size = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  // Range support is not optional for video: Safari will refuse to play an
  // mp4 served without it, and hover previews restart from currentTime = 0
  // on every enter, which is a seek.
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "content-range": `bytes */${size}` },
        });
      }

      const stream = Readable.toWeb(
        createReadStream(target, { start, end }),
      ) as NodeReadableStream<Uint8Array>;

      return new Response(stream as unknown as BodyInit, {
        status: 206,
        headers: {
          "content-type": type,
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
          "cache-control": "private, max-age=3600",
        },
      });
    }
  }

  const stream = Readable.toWeb(
    createReadStream(target),
  ) as NodeReadableStream<Uint8Array>;

  return new Response(stream as unknown as BodyInit, {
    headers: {
      "content-type": type,
      "content-length": String(size),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    },
  });
}
