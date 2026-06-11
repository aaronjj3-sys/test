/* Core sourcing flow: search first (free), enrich second (credits), score throughout. */

import { peopleSearch, bulkPeopleEnrich, organizationSearch, apolloConfigured } from "./client.js";
import { rankDoors } from "./scoring.js";
import { generateDraftPreview } from "../knock/drafts.js";
import {
  MAX_PEOPLE_SEARCH_RESULTS,
  MAX_PEOPLE_TO_ENRICH,
  BULK_ENRICH_BATCH_SIZE,
  DEFAULT_DOORS_LIMIT,
  SEARCH_MODES,
} from "../knock/constants.js";

/** Defensive normalization — Apollo fields vary by record. */
export function normalizePerson(p) {
  const org = p.organization || p.account || {};
  return {
    id: `apollo_${p.id}`,
    source: "apollo",
    status: "found",
    apolloPersonId: p.id,
    apolloOrganizationId: org.id || undefined,
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown",
    firstName: p.first_name || undefined,
    lastName: p.last_name || undefined,
    title: p.title || p.headline || undefined,
    companyName: org.name || undefined,
    companyDomain: org.primary_domain || (org.website_url ? safeDomain(org.website_url) : undefined),
    linkedinUrl: p.linkedin_url || undefined,
    email: p.email && !String(p.email).includes("not_unlocked") ? p.email : undefined,
    emailStatus: p.email_status || undefined,
    location: [p.city, p.state, p.country].filter(Boolean).join(", ") || undefined,
    photoUrl: p.photo_url || undefined,
    seniority: p.seniority || undefined,
    matchScore: 0,
    matchReasons: [],
    signals: {},
    raw: p,
  };
}

function safeDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return undefined; }
}

/** Resolve target company names/domains → Apollo organization IDs (cache upstream). */
export async function resolveOrganizations(targetCompanies = {}) {
  const ids = [...(targetCompanies.apolloOrganizationIds || [])];
  if (targetCompanies.names?.length || targetCompanies.domains?.length) {
    const res = await organizationSearch({
      q_organization_name: targetCompanies.names?.join(" ") || undefined,
      q_organization_domains_list: targetCompanies.domains || undefined,
      page: 1,
      per_page: 25,
    });
    for (const org of res.organizations || res.accounts || []) {
      if (org.id) ids.push(org.id);
    }
  }
  return [...new Set(ids)];
}

export async function sourceDoorsFromApollo(input) {
  const { profile = {}, targetCompanies = {}, searchMode = "founders" } = input;
  const limit = Math.min(input.limit || DEFAULT_DOORS_LIMIT, MAX_PEOPLE_SEARCH_RESULTS);
  const warnings = [];

  if (!apolloConfigured()) {
    throw Object.assign(new Error("APOLLO_API_KEY is not configured"), { status: 500 });
  }

  const mode = SEARCH_MODES[searchMode] || SEARCH_MODES.founders;

  /* 1. resolve orgs only when the user actually gave companies */
  let organizationIds = targetCompanies.apolloOrganizationIds || [];
  if ((targetCompanies.names?.length || targetCompanies.domains?.length) && !organizationIds.length) {
    try {
      organizationIds = await resolveOrganizations(targetCompanies);
    } catch (err) {
      warnings.push(`Organization lookup failed (${err.message}); searching without company filter.`);
    }
  }

  /* 2. People Search — credit-free discovery, no emails returned */
  const filters = {
    person_titles: mode.person_titles,
    person_seniorities: mode.person_seniorities,
    include_similar_titles: true,
    page: 1,
    per_page: MAX_PEOPLE_SEARCH_RESULTS,
  };
  if (profile.locations?.length && !profile.locations.includes("Any")) {
    filters.person_locations = profile.locations.filter((l) => l !== "Remote");
  }
  if (organizationIds.length) filters.organization_ids = organizationIds;
  else if (targetCompanies.domains?.length) filters.q_organization_domains_list = targetCompanies.domains;

  const search = await peopleSearch(filters);
  const people = search.people || search.contacts || [];
  const searchedPeople = people.length;

  /* 3–6. normalize, score, take the top slice */
  const icpFilters = {
    companyDomains: targetCompanies.domains || [],
    companyNames: targetCompanies.names || [],
    seniorities: mode.person_seniorities,
  };
  let doors = rankDoors(people.map(normalizePerson), profile, icpFilters).slice(0, limit);

  /* 7. enrichment is OFF by default — it consumes Apollo credits.
     Pass enrich:true only when the user approves leads and needs verified emails. */
  let enrichedPeople = 0;
  if (input.enrich) {
    const toEnrich = doors.slice(0, MAX_PEOPLE_TO_ENRICH);
    for (let i = 0; i < toEnrich.length; i += BULK_ENRICH_BATCH_SIZE) {
      const batch = toEnrich.slice(i, i + BULK_ENRICH_BATCH_SIZE);
      try {
        /* APOLLO CREDITS CONSUMED HERE */
        const res = await bulkPeopleEnrich(batch.map((d) => ({ id: d.apolloPersonId })));
        for (const match of res.matches || []) {
          const door = doors.find((d) => d.apolloPersonId === match.id);
          if (door && match.email && !String(match.email).includes("not_unlocked")) {
            door.email = match.email;
            door.emailStatus = match.email_status || door.emailStatus;
            enrichedPeople++;
          }
        }
      } catch (err) {
        warnings.push(`Enrichment batch failed: ${err.message}`);
      }
    }
    doors = rankDoors(doors, profile, icpFilters);
  }

  /* 10. drafts + final shape */
  for (const door of doors) {
    door.draft = generateDraftPreview(profile, door);
    delete door.raw; // keep response light; raw stays server-side only
  }

  return {
    doors,
    meta: {
      searchedPeople,
      returnedDoors: doors.length,
      enrichedPeople,
      creditsLikelyUsed: enrichedPeople > 0,
      warnings,
    },
  };
}
