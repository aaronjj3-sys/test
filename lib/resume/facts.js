/* Deterministic resume fact extraction. Used standalone in mock/dev mode and
   as the fallback (and sanity check) for the Claude-powered parser. */

const KNOWN_SCHOOLS = [
  "University of California, Irvine", "University of California, Los Angeles", "University of California, Berkeley",
  "University of California, San Diego", "University of Southern California", "Stanford University",
  "Harvard University", "Yale University", "Princeton University", "Columbia University",
  "New York University", "University of Michigan", "University of Texas at Austin",
  "Georgia Institute of Technology", "Massachusetts Institute of Technology", "Carnegie Mellon University",
  "University of Washington", "University of Illinois Urbana-Champaign", "Arizona State University",
  "Purdue University", "Cornell University", "Duke University", "Northwestern University",
  "University of Pennsylvania", "Boston University", "Indiana University", "Ohio State University",
];
const SCHOOL_ALIASES = {
  uci: "University of California, Irvine", "uc irvine": "University of California, Irvine",
  ucla: "University of California, Los Angeles", "uc berkeley": "University of California, Berkeley",
  ucsd: "University of California, San Diego", usc: "University of Southern California",
  mit: "Massachusetts Institute of Technology", cmu: "Carnegie Mellon University",
  nyu: "New York University", "georgia tech": "Georgia Institute of Technology",
};

const SKILL_DICT = [
  "Excel", "SQL", "Python", "JavaScript", "TypeScript", "Java", "C++", "R", "Tableau", "Power BI",
  "PowerPoint", "Airtable", "Figma", "PitchBook", "Notion", "HubSpot", "Salesforce", "Looker",
  "Google Analytics", "Jira", "Asana", "Zapier", "Webflow", "Shopify", "QuickBooks", "Bloomberg",
  "Photoshop", "Illustrator", "Canva", "AutoCAD", "MATLAB", "Pandas", "NumPy", "React", "Node.js",
  "AWS", "GCP", "Snowflake", "dbt", "A/B testing", "SEO", "CRM", "Financial modeling", "DCF",
];

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** 0..1 similarity built on token overlap + character bigrams (no deps). */
export function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  /* generic words carry no identity: "Stanford University" must not match
     "University of California, Irvine" on the shared word "university" */
  const GENERIC = new Set(["university", "college", "school", "institute", "of", "the", "at", "state", "and"]);
  const toks = (s) => new Set(s.split(" ").filter((t) => t && !GENERIC.has(t)));
  const ta = toks(na), tb = toks(nb);
  /* containment (min denominator): "uc irvine" should strongly match the
     full "university of california, irvine" */
  const tokOverlap = ta.size && tb.size
    ? [...ta].filter((t) => tb.has(t)).length / Math.min(ta.size, tb.size)
    : 0;
  const grams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const strip = (s) => s.split(" ").filter((t) => !GENERIC.has(t)).join(" ");
  const ga = grams(strip(na)), gb = grams(strip(nb));
  const giOverlap = ga.size && gb.size
    ? [...ga].filter((g) => gb.has(g)).length / Math.min(ga.size, gb.size)
    : 0;
  return Math.max(tokOverlap, giOverlap);
}

/** If the user typed a school that fuzzily matches the resume's, prefer the
    resume spelling (it's almost always the carefully formatted one). */
export function correctSchool(typed, fromResume) {
  if (!fromResume) return typed || "";
  if (!typed) return fromResume;
  const aliased = SCHOOL_ALIASES[normalize(typed)];
  if (aliased) return aliased === fromResume || similarity(aliased, fromResume) >= 0.45 ? fromResume : aliased;
  return similarity(typed, fromResume) >= 0.45 ? fromResume : typed;
}

function findSchool(text) {
  const lower = normalize(text);
  for (const [alias, canon] of Object.entries(SCHOOL_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) return canon;
  }
  for (const s of KNOWN_SCHOOLS) {
    if (lower.includes(normalize(s))) return s;
  }
  const m = text.match(/\b(?:University of [A-Z][A-Za-z]+(?:[,\s]+[A-Z][A-Za-z]+)?|[A-Z][A-Za-z.&' ]{2,40}\s(?:University|College|Institute of Technology|Polytechnic))\b/);
  return m ? m[0].trim().replace(/\s+/g, " ") : "";
}

function findDegree(text) {
  const m = text.match(/\b(?:B\.?\s?[AS]\.?|Bachelor(?:'s)?\s+of|M\.?B\.?A\.?|M\.?S\.?|Master(?:'s)?\s+of)(?:\s+(?:in\s+)?[A-Z][A-Za-z,&\- ]{2,60})?/);
  if (!m) return "";
  return m[0].trim().replace(/\s+/g, " ").replace(/[,\s]+(?:Class|Expected|GPA).*$/i, "").replace(/[,.]$/, "");
}

function findGradYear(text) {
  const m =
    text.match(/(?:class of|expected(?: graduation)?|graduating|anticipated)\D{0,12}(20\d\d)/i) ||
    text.match(/(?:B\.?\s?[AS]\.?|Bachelor)[^\n]{0,80}?(20\d\d)/);
  return m ? m[1] : "";
}

function findLocation(text) {
  const m = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s?(CA|NY|TX|WA|MA|IL|FL|CO|GA|NC|VA|PA|AZ|OR|NJ|MI|OH|MN|UT|DC)\b/);
  return m ? `${m[1]}, ${m[2]}` : "";
}

function findSkills(text) {
  return SKILL_DICT.filter((s) =>
    new RegExp(`(?<![A-Za-z])${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z])`, "i").test(text));
}

function findWins(text) {
  const wins = [];
  const re = /[^.\n•·]*(?:\$\s?\d[\d,.]*\s?[KkMmBb]?|\d{1,3}\s?%|\b\d[\d,]*\+?\s+(?:users|customers|members|sales|clients|downloads|followers|SKUs|distributors))[^.\n•·]*/g;
  let m;
  while ((m = re.exec(text)) && wins.length < 6) {
    const w = m[0].trim().replace(/^[-–•·\s]+/, "");
    if (w.length > 12 && w.length < 180 && !wins.includes(w)) wins.push(w);
  }
  return wins;
}

/** Heuristic experience blocks: a line with a year range names the role/org;
    bullet lines that follow become highlights. */
function findExperience(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items = [];
  const yearRe = /\b(20\d\d)\s*[-–—to]+\s*(20\d\d|present|current|now)\b/i;
  for (let i = 0; i < lines.length && items.length < 6; i++) {
    const ym = lines[i].match(yearRe);
    if (!ym) continue;
    const header = lines[i].replace(yearRe, "").replace(/[|·•,–—-]+\s*$/, "").trim();
    const prev = lines[i - 1] && !yearRe.test(lines[i - 1]) && lines[i - 1].length < 80 ? lines[i - 1] : "";
    /* the role/org line is whichever of (this line minus the years, previous line) has content */
    const headline = header || prev;
    if (!headline || headline.length > 110) continue;
    let role = headline, org = "";
    const split = headline.split(/\s*(?:\||·|—|–| - | at |, )\s*/);
    if (split.length >= 2) { role = split[0].trim(); org = split.slice(1).join(", ").trim(); }
    else if (header && prev) { role = prev; org = header; }
    if (!role || role.length > 90) continue;
    const bullets = [];
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      if (yearRe.test(lines[j])) break;
      const b = lines[j].replace(/^[-–•·▪*]\s*/, "");
      if (b === lines[j]) break; /* only marker-prefixed lines are bullets */
      bullets.push(b);
      if (bullets.length >= 3) break;
    }
    items.push({
      role: role.slice(0, 90),
      org: (org || "").slice(0, 60),
      when: `${ym[1]} · ${/present|current|now/i.test(ym[2]) ? "Present" : ym[2]}`,
      bullets: bullets.slice(0, 3),
    });
  }
  return items;
}

const SECTION_ALIASES = [
  ["education", "Education"],
  ["professional experience", "Professional Experience"],
  ["experience", "Experience"],
  ["work experience", "Professional Experience"],
  ["leadership", "Leadership"],
  ["leadership experience", "Leadership"],
  ["extracurricular", "Extracurricular"],
  ["extracurriculars", "Extracurricular"],
  ["projects", "Projects"],
  ["project experience", "Projects"],
  ["awards", "Awards"],
  ["honors", "Awards"],
  ["certifications", "Certifications"],
  ["skills", "Skills"],
  ["interests", "Interests"],
];

function sectionTitle(line) {
  const clean = line.replace(/[:|]+$/g, "").trim();
  const norm = normalize(clean);
  const hit = SECTION_ALIASES.find(([alias]) => norm === alias);
  if (hit) return hit[1];
  return "";
}

function makeSectionItem(lines) {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (!clean.length) return null;
  const head = clean[0].replace(/^[-*•·▪]\s*/, "");
  const bullets = clean.slice(1)
    .map((l) => l.replace(/^[-*•·▪]\s*/, "").trim())
    .filter((l) => l && l !== head)
    .slice(0, 3);
  const parts = head.split(/\s*(?:\||·| - |, )\s*/).filter(Boolean);
  return {
    role: (parts[0] || head).slice(0, 90),
    org: (parts.length > 1 ? parts.slice(1, -1).join(", ") || parts[1] : "").slice(0, 60),
    when: (head.match(/\b(?:20\d\d|19\d\d)\b(?:\s*[-–—to]+\s*(?:20\d\d|present|current|now))?/i)?.[0] || "").replace(/[–—]/g, "-"),
    bullets,
  };
}

function findSections(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sections = [];
  let current = null;
  let entry = [];

  const flushEntry = () => {
    if (!current || !entry.length) return;
    const item = makeSectionItem(entry);
    if (item) current.items.push(item);
    entry = [];
  };
  const flushSection = () => {
    flushEntry();
    if (current?.items?.length) sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const title = sectionTitle(line);
    if (title) {
      flushSection();
      current = { title, items: [] };
      continue;
    }
    if (!current) continue;
    const startsBullet = /^[-*•·▪]\s*/.test(line);
    const looksLikeNewEntry = !startsBullet && entry.length && line.length < 120;
    if (looksLikeNewEntry) flushEntry();
    entry.push(line);
  }
  flushSection();
  return sections.slice(0, 8);
}

export function extractResumeFacts(text) {
  if (!text) return { school: "", degree: "", gradYear: "", location: "", skills: [], quantifiedWins: [], sections: [], experience: [] };
  return {
    school: findSchool(text),
    degree: findDegree(text),
    gradYear: findGradYear(text),
    location: findLocation(text),
    skills: findSkills(text),
    quantifiedWins: findWins(text),
    sections: findSections(text),
    experience: findExperience(text),
  };
}
