/* Minimal verification: scoring order, batch chunking, request building, key health.
   Run: npm test */

import assert from "node:assert";
import { rankDoors } from "../lib/apollo/scoring.js";
import { normalizePerson } from "../lib/apollo/sourcing.js";
import { mockSourcing } from "../lib/knock/mock.js";
import { BULK_ENRICH_BATCH_SIZE, SEARCH_MODES } from "../lib/knock/constants.js";

const profile = {
  story: "Built a $400K wholesale/ecommerce business in high school and wants founder mentorship",
  target: "YC founders, startup operators, investors, hiring managers",
  school: "UC Irvine",
  industries: ["SaaS", "Venture Capital"],
  quantifiedWins: ["Built $400K wholesale/ecommerce business"],
};

/* 1. scoring returns candidates in the right order */
const doors = rankDoors(
  [
    { id: "a", name: "A", title: "Software Engineer", companyName: "Acme", signals: {} },
    { id: "b", name: "B", title: "Founder & CEO", companyName: "Lattice", linkedinUrl: "x", signals: {} },
    { id: "c", name: "C", title: "Recruiter", companyName: "Stripe", signals: {} },
  ],
  profile,
  { companyDomains: [], companyNames: [], seniorities: [] }
);
assert.equal(doors[0].id, "b", "founder should rank first");
assert.ok(doors[0].matchScore > doors[2].matchScore, "scores should be ordered");
assert.ok(doors[0].matchReasons.length >= 2, "founder door should have multiple reasons");

/* 2. normalization is defensive against missing fields */
const n = normalizePerson({ id: "p1", first_name: "Maya" });
assert.equal(n.name, "Maya");
assert.equal(n.apolloPersonId, "p1");
assert.equal(n.email, undefined);

/* 3. enrichment chunks by 10 */
const ids = Array.from({ length: 23 }, (_, i) => i);
const chunks = [];
for (let i = 0; i < ids.length; i += BULK_ENRICH_BATCH_SIZE) chunks.push(ids.slice(i, i + BULK_ENRICH_BATCH_SIZE));
assert.deepEqual(chunks.map((c) => c.length), [10, 10, 3], "bulk enrich must chunk by 10");

/* 4. search modes build valid filter sets */
for (const [mode, f] of Object.entries(SEARCH_MODES)) {
  assert.ok(f.person_titles.length > 0, `${mode} needs titles`);
  assert.ok(f.person_seniorities.length > 0, `${mode} needs seniorities`);
}

/* 5. mock mode produces drafted, scored doors */
const mock = mockSourcing({ profile, searchMode: "founders", limit: 5 });
assert.ok(mock.doors.length > 0 && mock.doors.length <= 5);
assert.ok(mock.doors.every((d) => d.source === "mock" && d.draft?.subject && d.matchScore >= 0));
assert.equal(mock.meta.creditsLikelyUsed, false);

/* 6. key health (informational only) */
console.log(`APOLLO_API_KEY: ${process.env.APOLLO_API_KEY ? "present" : "absent (mock mode)"}`);
console.log("All sourcing tests passed ✓");
