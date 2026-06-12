/* Door scoring: deterministic, transparent, capped 0-100, with human-readable reasons.

   Weights (signal -> points):
     persona: founder 35, investor 32, hiring/talent 30, operator 28, open-search baseline 20
     alumni (same school) 25
     shared employer (their history vs your experience orgs) 22
     works at a target company now 15
     past employer is one of your target companies 14
     industry fit (org industry/keywords vs profile.industries) 12, title-only fallback 8
     location metro match 10
     matches your target roles 8, actively hiring 8
     seniority fit 6, founder-story resonance 6, story vs org keywords 6
     skills overlap 5, degree/major adjacency 4
     recently started current role 3, early-stage company 3
     tiebreakers (score only, never a reason): exact target-title 3, linkedin 2,
       verified email 2 (any email 1)

   Expected spread: persona-only lands ~35-50, persona+industry+location ~60-75,
   and an alumni or shared-employer hit pushes 80-95. matchReasons are the top 3
   signals by weight, phrased like a human would say them. */

const FOUNDER_RE = /\b(founder|co-?founder|ceo)\b/i;
const INVESTOR_RE = /\b(partner|investor|principal|managing director|gp\b|general partner)\b/i;
const TALENT_RE = /\b(recruit|talent|hiring|people|hr\b)\b/i;
const OPERATOR_RE = /\b(chief of staff|operations|growth|strategy|product|marketing)\b/i;

const ORG_NOISE_RE = /\b(inc|llc|corp|co|ltd|company|group|holdings|technologies|technology|labs|the)\b/g;
const STORY_STOPWORDS = new Set([
  "their", "there", "about", "above", "after", "before", "because", "being", "could",
  "should", "would", "really", "wants", "want", "while", "where", "which", "with",
  "working", "works", "things", "every", "people", "person", "wants",
]);
const DEGREE_NOISE_RE = /\b(b\.?a\.?|b\.?s\.?|m\.?a\.?|m\.?s\.?|mba|ph\.?d\.?|bachelors?|masters?|minor|major|degree|in|of|arts|science|sciences)\b/gi;

const lower = (s) => String(s || "").toLowerCase();

/** Company names normalized for comparison: "Mastercard Inc." == "mastercard". */
function normalizeOrgName(s) {
  return lower(s)
    .replace(ORG_NOISE_RE, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function orgNamesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b));
}

/** "UC Irvine" should also hit "University of California, Irvine" and vice versa. */
function schoolVariants(school) {
  const s = lower(school).trim();
  if (!s) return [];
  const out = new Set([s]);
  const uc = s.match(/^uc\s+([a-z]+)$/);
  if (uc) {
    out.add(`university of california, ${uc[1]}`);
    out.add(`university of california ${uc[1]}`);
  }
  const long = s.match(/^university of california,?\s+([a-z]+)$/);
  if (long) out.add(`uc ${long[1]}`);
  return [...out];
}

/** Employment history rows, whether sourcing preserved them explicitly or raw. */
function employmentEntries(door) {
  const explicit = Array.isArray(door.employmentHistory) ? door.employmentHistory : [];
  const rows = explicit.length
    ? explicit
    : Array.isArray(door.raw?.employment_history) ? door.raw.employment_history : [];
  return rows.map((e) => ({
    org: e?.organizationName || e?.organization_name || "",
    title: e?.title || "",
    current: Boolean(e?.current),
    startDate: e?.startDate || e?.start_date || "",
  }));
}

/** Org industry + keywords, from explicit fields or the raw Apollo blob. */
function companyContext(door) {
  const rawOrg = door.raw?.organization || door.raw?.account || {};
  const industry = door.organizationIndustry || rawOrg.industry || "";
  const keywords = (door.organizationKeywords?.length ? door.organizationKeywords : rawOrg.keywords) || [];
  const foundedYear = door.organizationFoundedYear || rawOrg.founded_year || null;
  const size = door.organizationSize || rawOrg.estimated_num_employees || null;
  return {
    industry: String(industry),
    keywords: keywords.map(String),
    foundedYear: Number(foundedYear) || null,
    size: Number(size) || null,
  };
}

function contentWords(text, minLen = 5) {
  return lower(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= minLen && !STORY_STOPWORDS.has(w));
}

export function scoreDoor(door, profile = {}, filters = {}) {
  const signals = door.signals || {};
  const weighted = []; /* { w, text } — sorted by weight for matchReasons */
  let score = 0;
  const add = (w, text) => {
    score += w;
    if (text) weighted.push({ w, text });
  };

  const title = lower(door.title);
  const company = lower(door.companyName);
  const org = companyContext(door);
  const employment = employmentEntries(door);
  const orgKeywordText = org.keywords.join(" ").toLowerCase();
  const haystack = `${title} ${company} ${lower(org.industry)} ${orgKeywordText}`;

  /* ---- persona base ---- */
  if (FOUNDER_RE.test(title)) {
    signals.founder = true;
    add(35, "Founder match");
  } else if (INVESTOR_RE.test(title)) {
    signals.investor = true;
    add(32, "Investor title match");
  } else if (TALENT_RE.test(title)) {
    signals.hiring = true;
    add(30, "Hiring / talent role");
  } else if (OPERATOR_RE.test(title)) {
    signals.operator = true;
    add(28, "Operator role match");
  } else if (filters.allMode) {
    /* "all" mode has no persona restriction — a neutral baseline keeps
       unrestricted results from tanking just because no persona regex hit */
    add(20, "Open search candidate");
  }

  /* ---- uncommon commonalities: the strongest cold-email openers ---- */
  const variants = schoolVariants(profile.school);
  if (variants.length) {
    const empOrgText = employment.map((e) => lower(e.org)).join(" | ");
    const rawBlob = door.raw ? lower(JSON.stringify(door.raw)) : "";
    if (variants.some((v) => empOrgText.includes(v) || rawBlob.includes(v))) {
      signals.alumni = true;
      add(25, `Fellow ${profile.school} alum`);
    }
  }

  const experienceOrgs = (profile.experienceOrgs || (profile.experience || []).map((e) => e?.org))
    .filter(Boolean)
    .map((o) => ({ display: String(o), norm: normalizeOrgName(o) }))
    .filter((o) => o.norm);
  if (experienceOrgs.length && employment.length) {
    const shared = experienceOrgs.find((mine) =>
      employment.some((e) => orgNamesMatch(mine.norm, normalizeOrgName(e.org))));
    if (shared) {
      signals.sharedEmployer = true;
      add(22, `Worked at ${shared.display} like you`);
    }
  }

  /* ---- target companies: now (filters) and in their past (profile) ---- */
  const targetDomains = filters.companyDomains || [];
  const targetNames = (filters.companyNames || []).map((n) => lower(n));
  if (
    (door.companyDomain && targetDomains.includes(door.companyDomain)) ||
    targetNames.some((n) => company.includes(n))
  ) {
    signals.targetCompany = true;
    add(15, door.companyName ? `Works at ${door.companyName}, one of your target companies` : "Works at a target company");
  }

  const profileTargetCos = Array.isArray(profile.targetCompanies)
    ? profile.targetCompanies
    : profile.targetCompanies?.names || [];
  const pastTargets = [...new Set([...profileTargetCos, ...(filters.companyNames || [])])]
    .filter(Boolean)
    .map((n) => ({ display: String(n), norm: normalizeOrgName(n) }))
    .filter((n) => n.norm);
  if (pastTargets.length && employment.length) {
    const companyNorm = normalizeOrgName(door.companyName);
    const past = pastTargets.find((t) =>
      !orgNamesMatch(t.norm, companyNorm) && /* current employer already counted above */
      employment.some((e) => orgNamesMatch(t.norm, normalizeOrgName(e.org))));
    if (past) {
      signals.pastTargetCompany = true;
      add(14, `Spent time at ${past.display}, a company you target`);
    }
  }

  /* ---- industry fit: org data is strong evidence, title words are weak ---- */
  const industries = (profile.industries || []).map(String).filter(Boolean);
  const orgIndustryText = `${lower(org.industry)} ${orgKeywordText}`;
  const strongIndustry = industries.find((i) => orgIndustryText.includes(i.toLowerCase()));
  if (strongIndustry) {
    signals.relevantIndustry = true;
    add(12, `${strongIndustry} matches your target industries`);
  } else {
    const weakIndustry = industries.find((i) => `${title} ${company}`.includes(i.toLowerCase()));
    if (weakIndustry) {
      signals.relevantIndustry = true;
      add(8, "Relevant company context");
    }
  }

  /* ---- location: metro-level contains match against your locations ---- */
  const personLoc = lower(door.location);
  if (personLoc) {
    const cities = [profile.location, ...(profile.locations || [])]
      .filter((l) => l && !/^(any|remote)$/i.test(String(l).trim()))
      .map((l) => String(l).split(",")[0].trim())
      .filter((c) => c.length >= 3);
    const nearby = cities.find((c) => personLoc.includes(c.toLowerCase()));
    if (nearby) {
      signals.locationMatch = true;
      add(10, `Based in ${nearby} near you`);
    }
  }

  /* ---- profile-aware boosts: what the user said they're targeting ---- */
  const targetRoles = (profile.targetRoles || []).map(String);
  const roleWords = targetRoles
    .flatMap((r) => r.toLowerCase().split(/[^a-z]+/))
    .filter((w) => w.length > 3)
    .map((w) => w.replace(/s$/, ""));
  if (roleWords.some((w) => title.includes(w))) {
    signals.targetRole = true;
    add(8, "Matches the roles you target");
  }

  if (signals.activelyHiring) add(8, "Actively hiring right now");

  const seniorities = filters.seniorities || [];
  if (door.seniority && seniorities.includes(door.seniority)) add(6, "Strong seniority fit");

  /* story/goal resonance: founder story -> founders/investors care */
  const story = `${profile.story || ""} ${profile.target || ""}`.toLowerCase();
  if ((signals.founder || signals.investor) && /\b(built|founder|business|started|launched)\b/.test(story)) {
    add(6, "Strong fit for your founder story");
  }
  if (orgKeywordText) {
    const storyWords = new Set(contentWords(story));
    if (contentWords(orgKeywordText).some((w) => storyWords.has(w))) {
      signals.storyResonance = true;
      add(6, "Their company's focus echoes your story");
    }
  }

  const skillWords = (profile.skills || []).map((s) => lower(s)).filter((s) => s.length > 2);
  if (skillWords.some((s) => haystack.includes(s))) {
    signals.skillOverlap = true;
    add(5, "Overlaps with your skills");
  }

  const majorWords = contentWords(String(profile.degree || "").replace(DEGREE_NOISE_RE, " "));
  if (majorWords.length && majorWords.some((w) => haystack.includes(w))) {
    signals.degreeAdjacent = true;
    add(4, "Close to your field of study");
  }

  /* ---- company stage + role recency (small, deterministic) ---- */
  const nowYear = Number(filters.nowYear) || new Date().getFullYear();
  const current = employment.find((e) => e.current && e.startDate);
  if (current && Number(String(current.startDate).slice(0, 4)) >= nowYear - 2) {
    signals.recentRole = true;
    add(3, "Recently stepped into this role");
  }
  if ((org.foundedYear && org.foundedYear >= nowYear - 7) || (org.size && org.size <= 200)) {
    signals.earlyStage = true;
    add(3, "Early-stage company");
  }

  /* ---- deterministic tiebreakers: score only, never a reason ---- */
  if (targetRoles.some((r) => r.trim().toLowerCase() === title.trim())) {
    signals.exactTitle = true;
    add(3);
  }
  if (door.linkedinUrl) {
    signals.hasLinkedIn = true;
    add(2);
  }
  if (door.emailStatus === "verified") {
    signals.hasEmail = true;
    add(2);
  } else if (door.email) {
    signals.hasEmail = true;
    add(1);
  }

  door.matchScore = Math.max(0, Math.min(100, Math.round(score)));
  door.matchReasons = weighted
    .sort((a, b) => b.w - a.w) /* stable: equal weights keep evaluation order */
    .slice(0, 3)
    .map((r) => r.text);
  door.signals = signals;
  return door;
}

export const rankDoors = (doors, profile, filters) =>
  doors
    .map((d) => scoreDoor(d, profile, filters))
    .sort((a, b) => b.matchScore - a.matchScore);
