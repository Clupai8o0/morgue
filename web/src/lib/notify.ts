import { Resend } from "resend";

/**
 * Owner notifications.
 *
 * Failing to send must never fail the request that triggered it. Someone who
 * successfully joined the waitlist should not see an error because an email
 * provider had a bad minute — the row is already committed, and the owner can
 * read it in the admin view regardless.
 */

const FROM = process.env.NOTIFY_FROM ?? "morgue <onboarding@resend.dev>";
const TO = process.env.NOTIFY_TO;

export async function notifyNewSignup({
  email,
  note,
}: {
  email: string;
  note: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !TO) {
    console.info("[notify] skipped — RESEND_API_KEY or NOTIFY_TO unset", { email });
    return;
  }

  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `morgue · access request from ${email}`,
      text: [
        `${email} requested access to morgue.`,
        note ? `\nThey said:\n${note}` : "\n(no note)",
        `\nReview: https://morgue.clupai.com/admin`,
      ].join("\n"),
    });
  } catch (err) {
    // Logged, swallowed. See the note at the top of this file.
    console.error("[notify] send failed", err);
  }
}

/**
 * Somebody asking for a bigger cap. Owner-directed, so the same contract as
 * notifyNewSignup: returns void, never throws, never reports.
 *
 * The row is already committed by the time this runs, which is the only reason
 * swallowing is acceptable — with RESEND_API_KEY or NOTIFY_TO unset the request
 * is still in the database and the admin page shows it, and says plainly that
 * nobody was emailed. A green tick with nothing recorded anywhere would be a
 * lie.
 *
 * Counts and plan names only. Never item titles or slugs: /privacy tells users
 * an administrator cannot read their vault, and an upgrade notification is
 * exactly the sort of convenience that would quietly make that false.
 */
export async function notifyUpgradeRequest({
  email,
  plan,
  note,
}: {
  email: string;
  plan: string;
  note: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !TO) {
    console.info("[notify] skipped — RESEND_API_KEY or NOTIFY_TO unset", { email });
    return;
  }

  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `morgue · upgrade request from ${email}`,
      text: [
        `${email} asked for more than the ${plan} plan allows.`,
        note ? `\nThey said:\n${note}` : "\n(no note)",
        // Hardcoded rather than built with absoluteUrl(): siteOrigin() throws
        // in production without AUTH_URL, and a notification must not be able
        // to fail the request it follows.
        `\nReview: https://morgue.clupai.com/admin`,
      ].join("\n"),
    });
  } catch (err) {
    // Logged, swallowed. See the note at the top of this file.
    console.error("[notify] send failed", err);
  }
}

/**
 * Mail sent TO a user rather than to the owner, which changes the failure
 * rule above: a reset email that silently fails leaves someone locked out with
 * no way to tell. So this one returns whether it sent.
 *
 * The caller still answers the HTTP request identically either way — see the
 * note in app/api/account/reset/route.ts on why "we couldn't email you" is an
 * account-enumeration oracle — but it logs loudly, which is the difference
 * between a mystery and a grep.
 */
async function sendToUser(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // In development this is the delivery mechanism: the link goes to the
    // server log so the flow can be walked without a mail provider.
    console.info(`[mail] RESEND_API_KEY unset — would have sent to ${to}:\n${text}`);
    return false;
  }
  try {
    const resend = new Resend(key);
    await resend.emails.send({ from: FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error("[mail] send failed", { to, subject, err });
    return false;
  }
}

export function sendPasswordReset(to: string, url: string): Promise<boolean> {
  return sendToUser(
    to,
    "morgue · reset your password",
    [
      "Someone asked to reset the morgue password for this address.",
      "",
      url,
      "",
      "The link works once and expires in an hour.",
      "If it wasn't you, nothing has changed and you can ignore this.",
    ].join("\n"),
  );
}

/**
 * Sent to the NEW address, which is the whole mechanism: the change is written
 * only when somebody proves they can read mail there.
 */
export function sendEmailChange(to: string, url: string): Promise<boolean> {
  return sendToUser(
    to,
    "morgue · confirm your new email",
    [
      "Someone asked to move a morgue account to this address.",
      "",
      url,
      "",
      "The link works once and expires in an hour.",
      "Nothing has changed yet, and nothing will until you open it.",
      "If it wasn't you, you can ignore this — the account it belongs to is",
      "unaffected and stays reachable at its current address.",
    ].join("\n"),
  );
}

export function sendEmailVerification(to: string, url: string): Promise<boolean> {
  return sendToUser(
    to,
    "morgue · confirm your email",
    [
      "Confirm this address to finish setting up your morgue account.",
      "",
      url,
      "",
      "The link works once and expires in 24 hours.",
    ].join("\n"),
  );
}
