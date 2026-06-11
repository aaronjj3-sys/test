/* Drip-send queue — placeholder until Gmail OAuth exists.

   Guardrails this module will enforce when real sending lands:
   - Nothing sends without explicit user approval (campaign launch).
   - Daily caps: start new users at 10–25/day, well under Gmail's
     500/day (personal) and 2,000/day (Workspace) limits.
   - Sends spaced randomly through the recipient's working hours,
     never blasted at once; weekends off by default.
   - Pause campaign + "do not contact again" states respected before every send. */

export const DAILY_SEND_CAP_NEW_USER = 15;

export async function processQueue() {
  throw new Error("Send queue requires the Gmail integration. See SETUP.md → Gmail.");
}
