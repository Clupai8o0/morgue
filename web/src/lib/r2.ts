import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2, via the S3 API.
 *
 * TWO BUCKETS, and the split is the security boundary:
 *
 *   morgue-public   showcase media for the landing page. Publicly readable.
 *   morgue-private  the collection. NO public access, ever.
 *
 * Gating the app is worthless if the underlying mp4 is fetchable by anyone
 * holding a CDN link — and CDN links leak into logs, analytics and browser
 * history. So the private bucket stays closed and every read is a short-lived
 * signed URL. Making public/private a property of *where the file lives*
 * rather than of code means a routing mistake can't expose the collection.
 *
 * R2 charges no egress, which is why video hover previews are affordable here
 * and would not be on S3.
 */

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;

export const R2_PRIVATE = process.env.R2_BUCKET_PRIVATE ?? "morgue-private";
export const R2_PUBLIC = process.env.R2_BUCKET_PUBLIC ?? "morgue-public";

/** Signed URLs live one hour: long enough to browse, short enough to matter. */
const SIGNED_TTL = 3600;

let client: S3Client | null = null;

export function r2Configured(): boolean {
  return Boolean(ACCOUNT && KEY && SECRET);
}

function s3(): S3Client {
  if (client) return client;
  if (!r2Configured()) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and " +
        "R2_SECRET_ACCESS_KEY in web/.env.local (see .env.example).",
    );
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: KEY!, secretAccessKey: SECRET! },
  });
  return client;
}

/**
 * Read an object server-side. Used for the JSON payload, where the server is
 * the consumer and no URL ever reaches the browser.
 */
export async function getObjectText(
  key: string,
  bucket = R2_PRIVATE,
): Promise<string> {
  const res = await s3().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!res.Body) throw Object.assign(new Error("empty body"), { code: "ENOENT" });
  return res.Body.transformToString();
}

/**
 * Mint a short-lived URL the browser can fetch directly.
 *
 * Called at most `pageSize` times per grid page — which is exactly why
 * pagination and the security model want the same thing. Signing 500 URLs to
 * open the vault would be absurd; signing 24 is free.
 */
export function signMediaUrl(key: string, bucket = R2_PRIVATE): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: SIGNED_TTL,
  });
}
