/* POST /api/sourcing/enrich
   Just-in-time Apollo enrichment for approved contacts. This consumes Apollo
   credits, so it is capped and only called when a selected door has no email. */

import { bulkPeopleEnrich, apolloConfigured } from "../../lib/apollo/client.js";
import { BULK_ENRICH_BATCH_SIZE, MAX_PEOPLE_TO_ENRICH } from "../../lib/knock/constants.js";

function cleanDoor(door, match) {
  const email = match.email && !String(match.email).includes("not_unlocked") ? match.email : "";
  return {
    id: door.id,
    apolloPersonId: door.apolloPersonId,
    email: email || door.email || "",
    emailStatus: match.email_status || door.emailStatus || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { doors = [] } = req.body || {};
  if (!Array.isArray(doors) || doors.length === 0) {
    return res.status(400).json({ error: "doors are required" });
  }

  if (!apolloConfigured()) {
    return res.status(200).json({
      ok: true,
      enriched: [],
      meta: {
        enrichedPeople: 0,
        creditsLikelyUsed: false,
        warnings: ["Apollo is not configured, so emails could not be enriched."],
      },
    });
  }

  const candidates = doors
    .filter((d) => d?.apolloPersonId && !d.email)
    .slice(0, MAX_PEOPLE_TO_ENRICH);

  const enriched = [];
  const warnings = [];
  let enrichedPeople = 0;

  for (let i = 0; i < candidates.length; i += BULK_ENRICH_BATCH_SIZE) {
    const batch = candidates.slice(i, i + BULK_ENRICH_BATCH_SIZE);
    try {
      const result = await bulkPeopleEnrich(batch.map((d) => ({ id: d.apolloPersonId })));
      const matches = result.matches || [];
      for (const match of matches) {
        const door = batch.find((d) => d.apolloPersonId === match.id);
        if (!door) continue;
        const cleaned = cleanDoor(door, match);
        if (cleaned.email) enrichedPeople++;
        enriched.push(cleaned);
      }
    } catch (err) {
      warnings.push(`Apollo enrichment failed: ${err.message}`);
    }
  }

  return res.status(200).json({
    ok: true,
    enriched,
    meta: {
      enrichedPeople,
      creditsLikelyUsed: candidates.length > 0,
      warnings,
    },
  });
}
