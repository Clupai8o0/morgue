import type { Metadata } from "next";
import { LegalPage, H2, P, UL, LI, Note } from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms",
  description: "The rules for using morgue, and what happens when they are broken.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="9 August 2026">
      <Note>
        This has not been reviewed by a lawyer. Before launch it needs the
        operator&apos;s legal name, a governing jurisdiction, and a real
        address for the copyright agent below — a takedown contact that does
        not reach anybody is worse than no contact at all.
      </Note>

      <H2>What this is</H2>
      <P>
        morgue is a private reference collection for UI components and web
        animations. Accounts are created by invitation. Each account gets a
        vault that is private to it.
      </P>

      <H2>The part that matters most</H2>
      <P>
        <b>Only save things you are allowed to save.</b> Much of what belongs in
        a collection like this is licensed — paid templates, commercial
        components, code from a client project. A licence to use something in
        your own work is usually not a licence to redistribute it.
      </P>
      <P>
        Your vault is private, and keeping a personal reference copy of
        something you have licensed is generally fine. <b>Sharing is where that
        changes.</b> A share link hands the contents to someone else. Only share
        what you made, or what its licence lets you pass on.
      </P>

      <H2>Not allowed</H2>
      <UL>
        <LI>Uploading content you have no right to upload.</LI>
        <LI>
          Using a share link to distribute licensed third-party material to
          people who have not licensed it.
        </LI>
        <LI>
          Malware, phishing pages, or anything designed to harm whoever opens
          it.
        </LI>
        <LI>
          Content that is illegal where the service operates, or that sexualises
          children.
        </LI>
        <LI>
          Attacking the service: scraping other accounts, probing for other
          people&apos;s data, or trying to defeat the limits on your own.
        </LI>
        <LI>Sharing your account. Invitations are for one person.</LI>
      </UL>

      <H2>Copyright complaints</H2>
      <P>
        If something here infringes your copyright, write to the address below
        with: what the work is, where in this service it appears, your contact
        details, and a statement that you believe in good faith the use is not
        authorised.
      </P>
      <P>
        <b>Note how a complaint is actioned, because it is unusual.</b>{" "}
        Administrators cannot read a user&apos;s vault — the software has no
        path that renders one account&apos;s content to another. A complaint is
        therefore actioned by disabling the specific item named, identified by
        its owner and its slug, without it being viewed. So a complaint must
        identify the item precisely enough to act on. This limit exists to keep
        the privacy promise on the Privacy page true, and it is a real
        constraint on how quickly and how finely a report can be resolved.
      </P>
      <P>
        Repeat infringers have their accounts terminated. If your content was
        disabled and you believe that was wrong, reply to the notice and say
        why.
      </P>

      <H2>Share links</H2>
      <UL>
        <LI>Read-only, and they expire — 30 days at the outside.</LI>
        <LI>
          Anyone holding the link can open what it covers. Treat one like a
          password.
        </LI>
        <LI>
          <b>Revoking is not instant.</b> A link is a signed token rather than a
          database row, so revocation is checked when the link is redeemed and
          a session already opened with it lasts up to an hour longer.
        </LI>
      </UL>

      <H2>Your content stays yours</H2>
      <P>
        You keep every right you had. The only permission granted is the
        technical one needed to run the service: to store your content, and to
        serve it to you and to anyone you share a link with.
      </P>

      <H2>Accounts</H2>
      <UL>
        <LI>Keep your sign-in methods secure and your email address current.</LI>
        <LI>
          An account may be suspended for breaking these terms. Where it is
          reasonable to do so, you will be told why.
        </LI>
        <LI>
          You can delete your account at any time. Deleting removes your vault
          and your files.
        </LI>
      </UL>

      <H2>No warranty</H2>
      <P>
        The service is provided as it is, with no guarantee of availability and
        no guarantee that data will not be lost.{" "}
        <b>Keep your own copy of anything you would be upset to lose.</b> To the
        extent the law allows, the operator is not liable for indirect or
        consequential loss.
      </P>

      <H2>Changes</H2>
      <P>
        These terms may change. Material changes will be announced to account
        holders before taking effect, and the date at the top of this page will
        move.
      </P>

      <H2>Contact</H2>
      <P>
        <span className="text-ink-muted">
          [operator legal name] · [postal address] · Copyright agent:
          copyright@[domain] · General: hello@[domain]
        </span>
      </P>
      <P>
        <span className="text-ink-muted">
          Governing law: [jurisdiction].
        </span>
      </P>
    </LegalPage>
  );
}
