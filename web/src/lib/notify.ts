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
