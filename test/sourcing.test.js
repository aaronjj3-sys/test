/* Minimal verification: scoring order, batch chunking, request building, key health.
   Run: npm test */

import assert from "node:assert";
import { rankDoors } from "../lib/apollo/scoring.js";
import { normalizePerson, buildPeopleSearchFilters } from "../lib/apollo/sourcing.js";
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

/* 4. search modes build valid filter sets ("all" is intentionally unrestricted) */
for (const [mode, f] of Object.entries(SEARCH_MODES)) {
  if (mode === "all") {
    assert.equal(f.person_titles.length, 0, "all mode must not restrict titles");
    assert.equal(f.person_seniorities.length, 0, "all mode must not restrict seniorities");
    continue;
  }
  assert.ok(f.person_titles.length > 0, `${mode} needs titles`);
  assert.ok(f.person_seniorities.length > 0, `${mode} needs seniorities`);
}

/* 5. mock mode produces drafted, scored doors */
const mock = mockSourcing({ profile, searchMode: "founders", limit: 5 });
assert.ok(mock.doors.length > 0 && mock.doors.length <= 5);
assert.ok(mock.doors.every((d) => d.source === "mock" && d.draft?.subject && d.matchScore >= 0));
assert.equal(mock.meta.creditsLikelyUsed, false);

/* 6. "all" mode: results come back without a title filter and scores don't tank */
const allFilters = buildPeopleSearchFilters({ mode: SEARCH_MODES.all, page: 1, perPage: 50 });
assert.equal(allFilters.person_titles, undefined, "all mode must omit person_titles");
assert.equal(allFilters.person_seniorities, undefined, "all mode must omit person_seniorities");
const mockAll = mockSourcing({ profile, searchMode: "all", limit: 10 });
assert.ok(mockAll.doors.length > 0, "all mode must return doors");
assert.ok(mockAll.doors.every((d) => d.matchScore > 0), "all mode scores must not tank to 0");
const engineer = rankDoors(
  [{ id: "e", name: "E", title: "Software Engineer", companyName: "Acme", signals: {} }],
  profile,
  { allMode: true }
)[0];
assert.ok(engineer.matchScore > 0, "all-mode neutral baseline must apply when no persona matches");

/* 7. pagination meta: page passthrough + mock page 2 returns new people */
const page1 = mockSourcing({ profile, searchMode: "founders", limit: 25, page: 1 });
const page2 = mockSourcing({ profile, searchMode: "founders", limit: 25, page: 2 });
assert.equal(page1.meta.page, 1);
assert.equal(page2.meta.page, 2);
assert.equal(typeof page1.meta.perPage, "number");
assert.equal(typeof page1.meta.hasMore, "boolean");
assert.equal(typeof page1.meta.totalFetched, "number");
assert.ok(page1.meta.hasMore, "mock page 1 must report more pages");
const ids1 = new Set(page1.doors.map((d) => d.id));
assert.ok(page2.doors.every((d) => !ids1.has(d.id)), "page 2 ids must not duplicate page 1");
const names1 = new Set(page1.doors.map((d) => `${d.name}|${d.companyName}`));
assert.ok(page2.doors.some((d) => !names1.has(`${d.name}|${d.companyName}`)), "page 2 must contain new people");
const page2again = mockSourcing({ profile, searchMode: "founders", limit: 25, page: 2 });
assert.deepEqual(page2again.doors.map((d) => d.id), page2.doors.map((d) => d.id), "mock pagination must be deterministic");
assert.equal(buildPeopleSearchFilters({ mode: SEARCH_MODES.founders, page: 3, perPage: 50 }).page, 3, "page must pass through to Apollo params");

/* 8. filter composition: each dashboard filter is optional and composable */
const fIndustry = buildPeopleSearchFilters({ mode: SEARCH_MODES.all, userFilters: { industries: ["Fintech"] } });
assert.ok(fIndustry.q_keywords.includes("Fintech"), "industry-only maps to q_keywords");
assert.equal(fIndustry.person_locations, undefined);
const fIndLoc = buildPeopleSearchFilters({ mode: SEARCH_MODES.all, userFilters: { industries: ["Fintech"], locations: ["New York"] } });
assert.deepEqual(fIndLoc.person_locations, ["New York"], "locations map to person_locations");
assert.ok(fIndLoc.q_keywords.includes("Fintech"));
const fCombo = buildPeopleSearchFilters({
  mode: SEARCH_MODES.founders,
  userFilters: { industries: ["Fintech"], locations: ["New York"], companies: ["Ramp", "stripe.com"], keywords: ["payments"] },
});
assert.deepEqual(fCombo.person_locations, ["New York"]);
assert.ok(fCombo.q_organization_domains_list.includes("stripe.com"), "domain-looking companies map to q_organization_domains_list");
assert.ok(fCombo.q_keywords.includes("Ramp") && fCombo.q_keywords.includes("payments") && fCombo.q_keywords.includes("Fintech"),
  "bare company names, keywords, and industries compose into q_keywords");
assert.deepEqual(fCombo.person_titles, SEARCH_MODES.founders.person_titles, "persona modes keep their title filter");
const fNone = buildPeopleSearchFilters({ mode: SEARCH_MODES.all });
assert.equal(fNone.q_keywords, undefined, "no filters → no keyword param");

/* 9. key health (informational only) */
console.log(`APOLLO_API_KEY: ${process.env.APOLLO_API_KEY ? "present" : "absent (mock mode)"}`);
console.log("All sourcing tests passed ✓");
