/* Reply classification — placeholder until inbox watching exists.

   Planned flow: Gmail Pub/Sub (or polling) delivers inbound messages →
   match to campaign_messages by thread ID → Claude classifies into
   warm | delay | ooo | cold | unknown with confidence + suggested reply →
   warm threads bump to the top of the Knock inbox. */

export const LABELS = ["warm", "delay", "ooo", "cold", "unknown"];

export async function classifyReply() {
  throw new Error("Reply classification requires the Gmail integration + ANTHROPIC_API_KEY. See SETUP.md.");
}
