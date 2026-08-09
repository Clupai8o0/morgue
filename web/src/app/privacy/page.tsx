import type { Metadata } from "next";
import { LegalPage, H2, P, UL, LI, Note } from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What morgue stores about you, and who else can see it.",
};

/**
 * Written from what the code actually does, not from a template.
 *
 * Every claim below is checkable: the hashed IPs are in lib/client-ip.ts, the
 * password hashing in lib/password.ts, the one-hour media URLs in lib/r2.ts,
 * the share-link expiry in lib/share.ts. If any of those change, this page is
 * wrong and has to change with them — a privacy policy that drifts from the
 * implementation is worse than none, because people rely on it.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="9 August 2026">
      <Note>
        This describes what the software does today. It has not been reviewed
        by a lawyer.
      </Note>

      <H2>What is stored</H2>
      <P>Only what an account needs to work:</P>
      <UL>
        <LI>
          <b>Your email address.</b> Lowercased, and used as the identity that
          different sign-in methods attach to.
        </LI>
        <LI>
          <b>Your name and avatar</b>, if a provider you connect gives them.
        </LI>
        <LI>
          <b>OAuth links.</b> Which providers you connected and the account id
          each one gave us, so signing in again finds the same vault.
        </LI>
        <LI>
          <b>A password hash</b>, if you set a password. Never the password —
          it is put through scrypt with a per-account salt and cannot be read
          back out.
        </LI>
        <LI>
          <b>The components you save</b>, and any files that belong to them.
        </LI>
        <LI>
          <b>Timestamps</b>: when the account was made and when it was last
          used.
        </LI>
      </UL>

      <H2>What is deliberately not stored</H2>
      <UL>
        <LI>
          <b>Raw IP addresses.</b> Rate limiting needs to recognise a repeat
          caller, not know where they live, so addresses are salted and hashed
          before being written. The hashes are pruned after 24 hours.
        </LI>
        <LI>
          <b>Analytics, tracking pixels, advertising identifiers, and
          third-party scripts.</b> There are none. Pages load nothing from a
          domain other than this one.
        </LI>
        <LI>
          <b>Password reset and confirmation links.</b> Only a hash of each is
          kept, and it is deleted the moment the link is used.
        </LI>
      </UL>

      <H2>Who else sees it</H2>
      <P>
        Running this service needs a small number of processors. Each sees only
        what its job requires:
      </P>
      <UL>
        <LI>
          <b>Neon</b> — the database. Accounts and metadata.
        </LI>
        <LI>
          <b>Cloudflare R2</b> — file storage. The private bucket has no public
          access; files are served through short-lived signed URLs that expire
          after an hour.
        </LI>
        <LI>
          <b>Resend</b> — outbound email. Sees the address a message is going
          to and its contents.
        </LI>
        <LI>
          <b>Vercel</b> — hosting. Sees requests as they are served.
        </LI>
        <LI>
          <b>GitHub and Google</b> — only if you choose to sign in with them,
          and only to confirm who you are.
        </LI>
      </UL>
      <P>
        Nothing is sold, and nothing is shared for advertising. Data is
        disclosed otherwise only where the law requires it.
      </P>

      <H2>Who can see your vault</H2>
      <P>
        Your vault is private by default. There is no public profile, no
        directory and no discovery: another account cannot browse to it, search
        it, or find out it exists.
      </P>
      <P>
        <b>Administrators cannot read your vault.</b> That is a deliberate
        limit, not an omission. An administrator can suspend an account and can
        disable a specific item when a valid complaint names it, but there is
        no path in the software that renders someone else&apos;s content to
        them.
      </P>
      <P>
        The one way anything leaves is a share link you create yourself. Those
        expire, are read-only, and can be revoked — see the Terms for the
        detail on revocation timing.
      </P>

      <H2>Keeping and deleting</H2>
      <UL>
        <LI>Account data is kept for as long as the account exists.</LI>
        <LI>
          You can delete your account yourself, at any time, from{" "}
          <span className="text-ink">/account</span>. It is immediate and there
          is no grace period.
        </LI>
        <LI>
          Deleting removes your account row, the OAuth links attached to it,
          your outstanding sign-in and reset links, your hashed rate-limit
          records, and your waitlist entry if you had one. Losing the waitlist
          entry means losing your approval — coming back means asking again.
        </LI>
        <LI>
          Share links you issued are <strong>revoked</strong> rather than
          deleted, and stop working. The record that they existed is kept,
          because a share link is valid by its signature: forgetting one would
          bring it back to life rather than kill it.
        </LI>
        <LI>Hashed rate-limit records are pruned after 24 hours.</LI>
        <LI>Backups may take up to 30 days to age out.</LI>
      </UL>

      <H2>Your rights</H2>
      <P>
        You can download everything we hold about you as a JSON file from{" "}
        <span className="text-ink">/account</span>, without asking anyone. It
        does not include the collection itself — the items in the vault belong
        to the operator and none of them is yours to take.
      </P>
      <P>
        You can also ask for a correction, or for deletion, by writing to the
        address below; expect a reply within 30 days. Depending on where you
        live you may also have the right to complain to a data protection
        regulator.
      </P>

      <H2>Contact</H2>
      <P>
        Clupai — Samridh Limbu
        <br />
        70 Elgar Road, Burwood, Victoria 3125, Australia
        <br />
        <a
          href="mailto:privacy@clupai.com"
          className="hover:text-ink underline underline-offset-4"
        >
          privacy@clupai.com
        </a>
      </P>
      <P>
        <span className="text-ink-muted">
          Australian privacy law applies to this service. If you are not
          satisfied with a response, you can complain to the Office of the
          Australian Information Commissioner at oaic.gov.au.
        </span>
      </P>
    </LegalPage>
  );
}
