/* Gmail integration — NOT IMPLEMENTED YET (needs Google Cloud OAuth credentials).
   Architecture this module will own once GOOGLE_CLIENT_ID/SECRET exist:

   1. "Connect Gmail" (separate from Google *login*) requests gmail.send +
      gmail.readonly scopes via OAuth consent.
   2. The refresh token is encrypted and stored in oauth_connections — server-side only.
   3. send() uses the Gmail API users.messages.send with the user's token, so mail
      comes from their real address (deliverability + authenticity).
   4. watch() registers a Pub/Sub watch on the inbox for reply detection;
      replies are matched to campaign_messages via In-Reply-To / thread IDs. */

export function gmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export async function sendEmail() {
  throw new Error("Gmail sending is not connected yet. Campaigns stay queued. See SETUP.md → Gmail.");
}
