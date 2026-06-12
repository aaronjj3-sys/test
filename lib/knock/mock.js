/* Realistic mock doors for development when APOLLO_API_KEY is missing.
   Always labeled source:"mock" so the UI can show these as demo data.
   Generates a large pool (~100 per mode) so pagination is testable. */

import { rankDoors } from "../apollo/scoring.js";
import { generateDraftPreview } from "./drafts.js";

const FIRST = ["Elena", "Jonas", "Theo", "Sara", "Devon", "Maya", "Dana", "Chris", "Nina", "Marcus", "Priya", "Tom", "Grace", "Omar", "Lena", "Ravi", "Sofia", "Petra", "Lina", "Dex", "Aiden", "Brooke", "Carmen", "Diego", "Esme", "Felix", "Gia", "Hugo", "Iris", "Jade", "Kai", "Luca", "Mira", "Noah", "Opal", "Pax", "Quinn", "Rhea", "Silas", "Tara"];
const LAST = ["Cruz", "Wirth", "Marks", "Okafor", "Lim", "Jensen", "Kim", "Patel", "Alvarez", "Webb", "Nair", "Reyes", "Liu", "Haddad", "Forsberg", "Tran", "Marin", "Vogel", "Park", "Mercer", "Boone", "Castillo", "Dawson", "Egan", "Flores", "Grant", "Hale", "Ito", "Joshi", "Klein"];

const COMPANIES = [
  ["Lattice Robotics", "latticerobotics.com", "San Francisco, CA"],
  ["Paperplane", "paperplane.io", "New York, NY"],
  ["Fieldnote", "fieldnote.app", "Los Angeles, CA"],
  ["Brightline Health", "brightline.health", "Remote"],
  ["Harbor", "harbor.dev", "San Francisco, CA"],
  ["Figma", "figma.com", "San Francisco, CA"],
  ["Anduril", "anduril.com", "Costa Mesa, CA"],
  ["Stripe", "stripe.com", "Remote"],
  ["Ramp", "ramp.com", "New York, NY"],
  ["Harbor Crest Capital", "harborcrest.com", "Newport Beach, CA"],
  ["Seedcraft Ventures", "seedcraft.vc", "San Francisco, CA"],
  ["Westcliff Capital", "westcliff.com", "Los Angeles, CA"],
  ["Notion", "notion.so", "San Francisco, CA"],
  ["Vercel", "vercel.com", "Remote"],
  ["Databricks", "databricks.com", "San Francisco, CA"],
  ["Linear", "linear.app", "Remote"],
  ["Mercury", "mercury.com", "San Francisco, CA"],
  ["Rippling", "rippling.com", "San Francisco, CA"],
  ["Scale AI", "scale.com", "San Francisco, CA"],
  ["Retool", "retool.com", "San Francisco, CA"],
];

const TITLES = {
  founders: [["Founder & CEO", "founder"], ["Co-founder", "founder"], ["Founder", "founder"], ["CEO", "c_suite"], ["Co-founder & CTO", "founder"]],
  hiring_managers: [["Design Recruiter", "manager"], ["Head of Talent", "head"], ["University Recruiter", "manager"], ["Talent Partner", "manager"], ["Hiring Manager, BizOps", "manager"]],
  investors: [["VP, Private Equity", "vp"], ["Partner", "partner"], ["Principal", "director"], ["Investor", "partner"], ["Managing Director", "partner"]],
  operators: [["Chief of Staff", "director"], ["Growth Lead", "head"], ["Business Operations", "manager"], ["Strategy & Ops", "manager"], ["Product Lead", "head"]],
  /* "all" mode: unrestricted — a deterministic mix across every persona plus non-persona roles */
  all: [
    ["Founder & CEO", "founder"], ["Head of Talent", "head"], ["Partner", "partner"], ["Chief of Staff", "director"],
    ["Senior Software Engineer", "senior"], ["Co-founder & CTO", "founder"], ["University Recruiter", "manager"],
    ["Principal", "director"], ["Growth Lead", "head"], ["Product Manager", "manager"],
  ],
};

const MOCK_MAX_PAGES = 5; // deterministic pagination cap for the demo pool

export function mockSourcing(input = {}) {
  const { profile = {}, searchMode = "founders", limit = 100 } = input;
  /* accept a cursor like the live Apollo path so the client logic is identical */
  const page = Math.max(1, Math.floor(Number(input.cursor?.page ?? input.page)) || 1);
  const userFilters = input.filters || {};
  const titles = TITLES[searchMode] || TITLES.founders;
  let pool = [];
  const count = Math.min(Math.max(limit, 25), 100);
  for (let i = 0; i < count; i++) {
    /* seed by page: a global index makes page 2+ deterministic AND distinct from page 1 */
    const g = (page - 1) * count + i;
    const name = `${FIRST[g % FIRST.length]} ${LAST[(g * 7 + page * 3 + Math.floor(g / FIRST.length)) % LAST.length]}`;
    const [title, seniority] = titles[g % titles.length];
    const [companyName, companyDomain, location] = COMPANIES[(g * 3 + page) % COMPANIES.length];
    pool.push({
      id: `mock_${searchMode}_p${page}_${i}`, // stable + unique across pages
      source: "mock",
      status: "found",
      apolloPersonId: undefined,
      name,
      firstName: name.split(" ")[0],
      title,
      seniority,
      companyName,
      companyDomain,
      location,
      linkedinUrl: i % 3 !== 2 ? `https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "")}` : undefined,
      matchScore: 0,
      matchReasons: [],
      signals: {},
    });
  }

  /* honor the dashboard filter bar so filtering is testable in mock mode */
  if (userFilters.locations?.length) {
    const locs = userFilters.locations.map((l) => l.toLowerCase());
    const filtered = pool.filter((p) => locs.some((l) => (p.location || "").toLowerCase().includes(l.split(",")[0])));
    if (filtered.length) pool = filtered;
  }
  const terms = [...(userFilters.keywords || []), ...(userFilters.industries || []), ...(userFilters.companies || [])].map((t) => t.toLowerCase());
  if (terms.length) {
    const filtered = pool.filter((p) =>
      terms.some((t) => `${p.name} ${p.title} ${p.companyName}`.toLowerCase().includes(t)));
    if (filtered.length) pool = filtered;
  }

  const ranked = rankDoors(pool, profile, {
    seniorities: ["founder", "owner", "c_suite", "partner", "vp", "head", "director", "manager"],
    allMode: searchMode === "all",
  }).slice(0, limit);
  for (const door of ranked) {
    door.draft = generateDraftPreview(profile, door);
    delete door.raw;
  }
  return {
    doors: ranked,
    meta: {
      page,
      perPage: Math.min(limit, 100),
      hasMore: page < MOCK_MAX_PAGES,
      cursor: page < MOCK_MAX_PAGES ? { plan: 0, page: page + 1 } : null,
      totalFetched: pool.length, // people pulled from the mock pool on this request
      searchedPeople: pool.length,
      returnedDoors: ranked.length,
      enrichedPeople: 0,
      creditsLikelyUsed: false,
      warnings: ["MOCK MODE: APOLLO_API_KEY not set. These are demo doors, not real Apollo results."],
    },
  };
}
