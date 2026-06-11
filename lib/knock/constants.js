/* Knock sourcing guardrails. Apollo People Search is credit-free; enrichment is NOT. */

export const MAX_PEOPLE_SEARCH_RESULTS = 100; // Apollo People Search per_page max
export const MAX_PEOPLE_TO_ENRICH = 10;       // hard cap per user action — enrichment consumes Apollo credits
export const BULK_ENRICH_BATCH_SIZE = 10;     // Apollo bulk_match max batch size
export const DEFAULT_DOORS_LIMIT = 100;
export const MIN_MATCH_SCORE_TO_DISPLAY = 40;

export const MOCK_MODE = () =>
  process.env.NODE_ENV !== "production" && !process.env.APOLLO_API_KEY;

/* search-mode → Apollo people filters */
export const SEARCH_MODES = {
  founders: {
    person_titles: ["founder", "co-founder", "ceo"],
    person_seniorities: ["founder", "owner", "c_suite"],
  },
  hiring_managers: {
    person_titles: ["recruiter", "technical recruiter", "university recruiter", "talent partner", "head of people", "hiring manager"],
    person_seniorities: ["manager", "director", "head", "vp"],
  },
  investors: {
    person_titles: ["partner", "principal", "investor", "associate", "managing director"],
    person_seniorities: ["partner", "vp", "director", "manager"],
  },
  operators: {
    person_titles: ["chief of staff", "strategy", "business operations", "growth", "operations", "product"],
    person_seniorities: ["manager", "director", "head", "vp", "c_suite"],
  },
};
