/* Realistic mock doors for development when APOLLO_API_KEY is missing.
   Always labeled source:"mock" — the UI must show these as demo data. */

import { rankDoors } from "../apollo/scoring.js";
import { generateDraftPreview } from "./drafts.js";

const MOCK_PEOPLE = {
  founders: [
    { name: "Elena Cruz", title: "Founder & CEO", companyName: "Lattice Robotics", companyDomain: "latticerobotics.com", location: "San Francisco, CA", seniority: "founder", linkedinUrl: "https://linkedin.com/in/elenacruz" },
    { name: "Jonas Wirth", title: "Co-founder", companyName: "Paperplane", companyDomain: "paperplane.io", location: "New York, NY", seniority: "founder", linkedinUrl: "https://linkedin.com/in/jonaswirth" },
    { name: "Theo Marks", title: "Founder", companyName: "Fieldnote", companyDomain: "fieldnote.app", location: "Los Angeles, CA", seniority: "founder", linkedinUrl: "https://linkedin.com/in/theomarks" },
    { name: "Sara Okafor", title: "CEO", companyName: "Brightline Health", companyDomain: "brightline.health", location: "Remote", seniority: "c_suite", linkedinUrl: "https://linkedin.com/in/saraokafor" },
    { name: "Devon Lim", title: "Co-founder & CTO", companyName: "Harbor", companyDomain: "harbor.dev", location: "San Francisco, CA", seniority: "founder" },
  ],
  hiring_managers: [
    { name: "Maya Jensen", title: "Design Recruiter", companyName: "Figma", companyDomain: "figma.com", location: "San Francisco, CA", seniority: "manager", linkedinUrl: "https://linkedin.com/in/mayajensen" },
    { name: "Dana Kim", title: "Head of Talent", companyName: "Anduril", companyDomain: "anduril.com", location: "Costa Mesa, CA", seniority: "head", linkedinUrl: "https://linkedin.com/in/danakim" },
    { name: "Chris Patel", title: "University Recruiter", companyName: "Stripe", companyDomain: "stripe.com", location: "Remote", seniority: "manager", linkedinUrl: "https://linkedin.com/in/chrispatel" },
    { name: "Nina Alvarez", title: "Talent Partner", companyName: "Ramp", companyDomain: "ramp.com", location: "New York, NY", seniority: "manager" },
  ],
  investors: [
    { name: "Marcus Webb", title: "VP, Private Equity", companyName: "Harbor Crest Capital", companyDomain: "harborcrest.com", location: "Newport Beach, CA", seniority: "vp", linkedinUrl: "https://linkedin.com/in/marcuswebb" },
    { name: "Priya Nair", title: "Partner", companyName: "Seedcraft Ventures", companyDomain: "seedcraft.vc", location: "San Francisco, CA", seniority: "partner", linkedinUrl: "https://linkedin.com/in/priyanair" },
    { name: "Tom Reyes", title: "Principal", companyName: "Westcliff Capital", companyDomain: "westcliff.com", location: "Los Angeles, CA", seniority: "director" },
  ],
  operators: [
    { name: "Grace Liu", title: "Chief of Staff", companyName: "Notion", companyDomain: "notion.so", location: "San Francisco, CA", seniority: "director", linkedinUrl: "https://linkedin.com/in/graceliu" },
    { name: "Omar Haddad", title: "Growth Lead", companyName: "Vercel", companyDomain: "vercel.com", location: "Remote", seniority: "head", linkedinUrl: "https://linkedin.com/in/omarhaddad" },
    { name: "Lena Forsberg", title: "Business Operations", companyName: "Databricks", companyDomain: "databricks.com", location: "San Francisco, CA", seniority: "manager" },
  ],
};

export function mockSourcing(input = {}) {
  const { profile = {}, searchMode = "founders", limit = 15 } = input;
  const pool = [
    ...(MOCK_PEOPLE[searchMode] || []),
    ...(searchMode === "custom" ? Object.values(MOCK_PEOPLE).flat() : []),
  ];
  const doors = pool.map((p, i) => ({
    id: `mock_${searchMode}_${i}`,
    source: "mock",
    status: "found",
    apolloPersonId: undefined,
    firstName: p.name.split(" ")[0],
    matchScore: 0,
    matchReasons: [],
    signals: {},
    ...p,
  }));

  const ranked = rankDoors(doors, profile, { seniorities: ["founder", "owner", "c_suite", "partner", "vp", "head", "director", "manager"] }).slice(0, limit);
  for (const door of ranked) {
    door.draft = generateDraftPreview(profile, door);
    delete door.raw;
  }
  return {
    doors: ranked,
    meta: {
      searchedPeople: pool.length,
      returnedDoors: ranked.length,
      enrichedPeople: 0,
      creditsLikelyUsed: false,
      warnings: ["MOCK MODE: APOLLO_API_KEY not set — these are demo doors, not real Apollo results."],
    },
  };
}
