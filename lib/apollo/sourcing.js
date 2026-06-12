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

/** Defensive normalization — Apollo fields vary by record.
    Scoring-relevant raw fields (employment history, org industry/keywords,
    education when Apollo returns it) are preserved as explicit fields so they
    survive `delete door.raw` and reach both scoring and the prompt builders. */
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
    employmentHistory: (Array.isArray(p.employment_history) ? p.employment_history : [])
      .slice(0, 10)
      .map((e) => ({
        organizationName: e?.organization_name || undefined,
        title: e?.title || undefined,
        current: Boolean(e?.current),
        startDate: e?.start_date || undefined,
        endDate: e?.end_date || undefined,
        degree: e?.degree || undefined, // Apollo sometimes folds education rows in here
      })),
    education: Array.isArray(p.education) ? p.education.slice(0, 4) : undefined,
    organizationIndustry: org.industry || undefined,
    organizationKeywords: Array.isArray(org.keywords) ? org.keywords.slice(0, 12).map(String) : [],
    organizationFoundedYear: org.founded_year || undefined,
    organizationSize: org.estimated_num_employees || undefined,
    matchScore: 0,
    matchReasons: [],
    signals: {},
    raw: p,
  };
}

function safeDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return undefined; }
}

/** Explicit whitelist of profile fields the scorer is allowed to see.
    Keeps raw client blobs (resume text, samples, tokens) out of scoring and
    guarantees the signals scoring needs (experience orgs, degree, gradYear,
    locations, target companies) are always present. */
export function buildScoringProfile(profile = {}) {
  return {
    school: profile.school,
    degree: profile.degree,
    gradYear: profile.gradYear,
    location: profile.location,
    locations: profile.locations || [],
    industries: profile.industries || [],
    targetRoles: profile.targetRoles || [],
    targetCompanies: profile.targetCompanies || [],
    skills: profile.skills || [],
    story: profile.story,
    target: profile.target,
    experienceOrgs: (profile.experience || []).map((e) => e?.org).filter(Boolean),
  };
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

/**
 * Pure builder for Apollo mixed_people/api_search params (credit-free search only).
 * Every dashboard filter is independently optional and composable. Honest mapping:
 *   - locations  → person_locations            (exact Apollo param)
 *   - companies  → q_organization_domains_list when the value looks like a domain (exact);
 *                  bare company NAMES fall back to q_keywords (approximate —
 *                  Organization Search would be exact but consumes credits)
 *   - industries → q_keywords                  (approximate — no dedicated people-search param wired)
 *   - keywords   → q_keywords                  (approximate by design)
 * "all" mode sends no person_titles/person_seniorities at all (unrestricted).
 */
export function buildPeopleSearchFilters({ mode = {}, profile = {}, targetCompanies = {}, userFilters = {}, organizationIds = [], page = 1, perPage = MAX_PEOPLE_SEARCH_RESULTS }) {
  const filters = { page, per_page: perPage };

  if (mode.person_titles?.length) {
    filters.person_titles = mode.person_titles;
    filters.include_similar_titles = true;
  }
  if (mode.person_seniorities?.length) filters.person_seniorities = mode.person_seniorities;

  if (profile.locations?.length && !profile.locations.includes("Any")) {
    filters.person_locations = profile.locations.filter((l) => l !== "Remote");
  }
  if (organizationIds.length) filters.organization_ids = organizationIds;
  else if (targetCompanies.domains?.length) filters.q_organization_domains_list = targetCompanies.domains;

  /* user search filters from the dashboard filter bar */
  if (userFilters.locations?.length) {
    filters.person_locations = [...new Set([...(filters.person_locations || []), ...userFilters.locations])];
  }
  if (userFilters.companies?.length && !filters.organization_ids) {
    /* values with a dot are treated as domains (exact); bare names go to q_keywords below */
    const domains = userFilters.companies.filter((c) => /\./.test(c));
    if (domains.length) {
      filters.q_organization_domains_list = domains.concat(filters.q_organization_domains_list || []);
    }
  }
  const keywordTerms = [
    ...(userFilters.keywords || []),
    ...(userFilters.industries || []),
    ...(userFilters.companies || []).filter((c) => !/\./.test(c)),
  ];
  if (keywordTerms.length) filters.q_keywords = keywordTerms.join(" ");

  return filters;
}

/**
 * Search plans, broadest-last. Plan 0 is the combined query (all filter terms
 * ANDed into one q_keywords string — most relevant, narrowest). When the user
 * gave 2+ keyword-ish terms, each term also gets its own plan so the queue
 * keeps filling with relevant people after the combined query runs dry.
 * Walking plans in order is what makes pagination exhaustive.
 */
export function buildSearchPlans({ mode, profile, targetCompanies, userFilters = {}, organizationIds, perPage }) {
  const build = (filters) => {
    const f = buildPeopleSearchFilters({ mode, profile, targetCompanies, userFilters: filters, organizationIds, page: 1, perPage });
    delete f.page;
    delete f.per_page;
    return f;
  };
  const plans = [build(userFilters)];
  const domainCompanies = (userFilters.companies || []).filter((c) => /\./.test(c));
  const terms = [
    ...(userFilters.keywords || []),
    ...(userFilters.industries || []),
    ...(userFilters.companies || []).filter((c) => !/\./.test(c)),
  ].map((t) => String(t).trim()).filter(Boolean);
  if (terms.length > 1) {
    for (const term of terms) {
      plans.push(build({ ...userFilters, keywords: [term], industries: [], companies: domainCompanies }));
    }
  }
  /* drop duplicate plans (e.g. single-term searches collapse to plan 0) */
  const seen = new Set();
  return plans.filter((p) => {
    const key = JSON.stringify(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function sourceDoorsFromApollo(input) {
  const { profile = {}, targetCompanies = {}, searchMode = "founders" } = input;
  const userFilters = input.filters || {};
  const limit = Math.min(input.limit || DEFAULT_DOORS_LIMIT, MAX_PEOPLE_SEARCH_RESULTS);
  const page = Math.max(1, Math.floor(Number(input.page)) || 1);
  const warnings = [];

  if (!apolloConfigured()) {
    throw Object.assign(new Error("APOLLO_API_KEY is not configured"), { status: 500 });
  }

  const mode = SEARCH_MODES[searchMode] || SEARCH_MODES.founders;

  /* 1. resolve orgs only when the user actually gave companies.
     NOTE: per Apollo docs, Organization Search DOES consume credits
     (unlike People Search) — so we only call it when names need resolving,
     and domains are passed straight to People Search without it. */
  let organizationIds = targetCompanies.apolloOrganizationIds || [];
  let orgSearchUsed = false;
  if (targetCompanies.names?.length && !organizationIds.length) {
    try {
      organizationIds = await resolveOrganizations({ names: targetCompanies.names });
      orgSearchUsed = true;
      warnings.push("Organization Search was used to resolve company names (consumes Apollo credits).");
    } catch (err) {
      warnings.push(`Organization lookup failed (${err.message}); searching without company filter.`);
    }
  }

  /* 2. People Search — credit-free discovery, no emails returned.
     Exhaustive pagination: the request walks search plans (combined query
     first, then broader per-term queries) page by page until it has `limit`
     people or every plan is out of pages. The position is returned as
     meta.cursor { plan, page }; the client echoes it back to keep going, so
     "next page" keeps finding people until Apollo truly has no more. */
  const perPage = Math.min(limit, MAX_PEOPLE_SEARCH_RESULTS);
  const plans = buildSearchPlans({ mode, profile, targetCompanies, userFilters, organizationIds, perPage });
  const cursorIn = input.cursor && Number.isFinite(Number(input.cursor.plan))
    ? {
        plan: Math.max(0, Math.floor(Number(input.cursor.plan))),
        page: Math.max(1, Math.floor(Number(input.cursor.page)) || 1),
      }
    : { plan: 0, page };

  const MAX_FETCHES_PER_REQUEST = 4; // bound Apollo calls per API request
  const people = [];
  const seenPeople = new Set();
  let cursor = { ...cursorIn };
  let searchedPeople = 0;
  let exhausted = cursor.plan >= plans.length;
  let fetches = 0;

  while (!exhausted && people.length < limit && fetches < MAX_FETCHES_PER_REQUEST) {
    const plan = plans[cursor.plan];
    let search;
    try {
      search = await peopleSearch({ ...plan, page: cursor.page, per_page: perPage });
    } catch (err) {
      if (fetches === 0) throw err; // first call failing is a real error
      warnings.push(`Apollo page fetch failed (${err.message}); returning what was found.`);
      break;
    }
    fetches += 1;
    const batch = search.people || search.contacts || [];
    searchedPeople += batch.length;
    for (const person of batch) {
      const key = person.id || person.linkedin_url || person.email || person.name;
      if (key && seenPeople.has(key)) continue;
      if (key) seenPeople.add(key);
      people.push(person);
    }
    const pagination = search.pagination || {};
    const morePages = pagination.total_pages != null
      ? cursor.page < pagination.total_pages
      : batch.length >= perPage; /* full page back → assume another page exists */
    cursor = morePages
      ? { plan: cursor.plan, page: cursor.page + 1 }
      : { plan: cursor.plan + 1, page: 1 };
    if (cursor.plan >= plans.length) exhausted = true;
  }
  const hasMore = !exhausted;

  /* 3–6. normalize, score, take the top slice */
  const icpFilters = {
    companyDomains: targetCompanies.domains || [],
    companyNames: targetCompanies.names || [],
    seniorities: mode.person_seniorities || [],
    /* unrestricted mode → scoring applies a neutral persona baseline */
    allMode: !(mode.person_titles?.length || mode.person_seniorities?.length),
  };
  const scoringProfile = buildScoringProfile(profile);
  /* no hard trim: the cursor already moved past everyone fetched, so trimming
     would silently drop people. The last page may overflow `limit` slightly. */
  let doors = rankDoors(people.map(normalizePerson), scoringProfile, icpFilters);

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
    doors = rankDoors(doors, scoringProfile, icpFilters);
  }

  /* 10. drafts + final shape */
  for (const door of doors) {
    door.draft = generateDraftPreview(profile, door);
    delete door.raw; // keep response light; raw stays server-side only
  }

  return {
    doors,
    meta: {
      page,
      perPage,
      hasMore,
      cursor: hasMore ? cursor : null, // echo back to continue the walk
      searchPlans: plans.length,
      totalFetched: searchedPeople, // people pulled from Apollo on this request
      searchedPeople,
      returnedDoors: doors.length,
      enrichedPeople,
      creditsLikelyUsed: enrichedPeople > 0 || orgSearchUsed,
      warnings,
    },
  };
}
