import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Hand-wrapped rather than `promisify(scryptCb)`, whose declared overloads in
 * @types/node stop at three arguments — the options object we need is the
 * fourth, so the promisified form does not typecheck at all.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Password hashing.
 *
 * ── Why scrypt and not argon2id ─────────────────────────────────────────────
 *
 * argon2id is the first choice in the OWASP Password Storage cheat sheet and
 * scrypt is the named fallback "if argon2id is not available". It is not
 * available here without cost: every argon2 binding for Node is a native
 * module, and this app deploys to Vercel functions where a native module means
 * prebuilt binaries for the right libc, a `serverExternalPackages` entry, and
 * a dependency that can break the build on a Node upgrade. scrypt is in Node
 * core, is memory-hard in the same way, and is explicitly sanctioned.
 *
 * The parameters below are OWASP's second listed configuration — N=2^16, r=8,
 * p=2 — which is deliberately not their first (N=2^17, r=8, p=1). That one
 * needs 128 MiB *per concurrent hash*; on a function sized in gigabytes, a
 * handful of simultaneous sign-ins is an out-of-memory crash, and a login
 * endpoint is exactly where an attacker gets to choose the concurrency. 64 MiB
 * with double the parallelism is the same work for the attacker and a
 * survivable footprint for us.
 *
 * ── Why the parameters are inside the hash string ───────────────────────────
 *
 * Stored as `scrypt$N$r$p$salt$hash`. Cost has to go up over the years, and a
 * scheme that hardcodes it can only raise cost by invalidating every existing
 * password. Reading the parameters back out of the record means an old hash
 * keeps verifying with the old cost, and `needsRehash` says when to quietly
 * upgrade it on the next successful sign-in. The `scrypt$` prefix is also the
 * migration path off scrypt entirely: an `argon2id$` branch can be added in
 * `verifyPassword` and both will coexist.
 */

const ALGO = "scrypt";
const N = 1 << 16; // CPU/memory cost
const R = 8; // block size
const P = 2; // parallelism
const KEYLEN = 32;
/** 128 * N * r is ~64 MiB here; Node's default cap is 32 MiB and would throw. */
const MAXMEM = 192 * 1024 * 1024;

/** Long enough to be worth typing, short enough not to be a denial of service. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Your password cannot be your email address.";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [ALGO, N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/**
 * A hash of a password nobody has, used to spend the same time verifying a
 * user that does not exist as one that does. Without it, "no such account"
 * returns in microseconds and "wrong password" in ~100ms, which is a working
 * account-enumeration oracle no matter how carefully the response body is
 * worded. Computed once, lazily — building it at import time would put a
 * 64 MiB scrypt on the cold-start path of every route that touches auth.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString("hex"));
  return dummy;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== ALGO) return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A stored record is attacker-controlled only if the database is already
  // lost, but an absurd N read from a corrupted row would hang the request
  // rather than fail it.
  if (n > 1 << 20 || r > 32 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  let key: Buffer;
  try {
    key = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** True when a verified password was stored at a cost we have since raised. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== ALGO) return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}
