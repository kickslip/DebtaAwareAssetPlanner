import Link from "next/link";

export const metadata = {
  title: "Prototype privacy notice | DebtAware",
  description: "Data handling summary for the DebtAware product prototype.",
};

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <Link className="back-link" href="/account">
        ← Back to account
      </Link>
      <article className="privacy-document">
        <span className="account-eyebrow">PROTOTYPE NOTICE · DRAFT</span>
        <h1>Privacy and data handling</h1>
        <p>
          This notice describes the current DebtAware development prototype. It
          is not a final privacy policy and is not a claim of POPIA compliance.
          Legal and security review is required before public launch.
        </p>
        <h2>What the prototype stores</h2>
        <p>
          If you create an account, the API stores your email address, a
          one-way password hash, session-token hashes, financial profile
          entries, debt-account details, manually recorded payments, goals,
          notification preferences, and the time you acknowledged this notice.
          Passwords and raw session tokens are not stored in the database.
        </p>
        <h2>How the data is used</h2>
        <p>
          Data is used to provide your account workspace, keep debt and payment
          overviews up to date, and generate simple rules-based planning notes.
          The prototype does not connect to banks, make payments, send your
          financial profile to an LLM, or match you with real lenders.
        </p>
        <h2>Important prototype limitations</h2>
        <p>
          Email verification, password recovery, a production privacy contact,
          a retention schedule, hosting-region guarantees, and an
          incident-response process are not yet configured. Account export and
          deletion controls are available in the prototype but do not replace
          formal data-subject request procedures. Do not use this prototype
          with sensitive real financial data until those protections and the
          final policy are reviewed and completed.
        </p>
        <h2>Before launch</h2>
        <p>
          The product owner must define a lawful basis, purposes, retention and
          deletion rules, data-subject request handling, third-party processor
          terms, security controls, breach procedures, and any required
          registrations or assessments with qualified South African advisors.
        </p>
      </article>
    </main>
  );
}
