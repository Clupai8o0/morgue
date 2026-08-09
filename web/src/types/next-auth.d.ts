import type { DefaultSession } from "next-auth";

/**
 * What this app puts on the session and the token.
 *
 * These are augmentations, not definitions — the fields are set in the `jwt`
 * and `session` callbacks in src/auth.ts and this file only teaches TypeScript
 * that they exist. If a name changes there and not here, the compiler goes
 * quiet while the runtime reads undefined, so keep the two together.
 */

declare module "next-auth" {
  interface Session {
    user: {
      /** The `users.id` uuid. Every owner-scoped query keys on this. */
      id: string;
      role: "user" | "admin";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** users.id */
    uid?: string;
    role?: "user" | "admin";
    /** users.sessionVersion at mint time — compared to revoke. */
    sv?: number;
    /** Unix seconds of the last database re-check. Throttles the query. */
    cka?: number;
  }
}

export {};
