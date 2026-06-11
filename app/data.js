/* ============ Knock app, mock data layer ============ */

const PROFILE = {
  name: "Aaron Johnson",
  initials: "AJ",
  school: "UC Irvine, Paul Merage School of Business",
  degree: "B.A. Business Administration, Finance & Information Systems",
  gradYear: 2027,
  location: "San Diego, CA",
  email: "aaron@uci.edu",
  headline: "Strategy & ops student who ships before being asked to.",
  traits: ["Allergic to average", "Will do whatever it takes", "Ships fast", "Cold-email native"],
  voice: { tone: "Direct & warm", length: "Under 120 words", signoff: "- Aaron" },
  skills: ["Excel", "SQL", "Python", "Tableau", "Power BI", "PowerPoint", "Airtable", "Figma basics", "PitchBook"],
  experience: [
    {
      org: "Mastercard", role: "Incoming Corporate Strategy & Commercialization Intern", when: "2026 · offer",
      bullets: ["Supporting B2B strategy through product performance and executive reporting."],
    },
    {
      org: "IntegriTurf", role: "Revenue Operations & Automation Consultant", when: "2025",
      bullets: [
        "Streamlined manual data entry 50%+ by integrating an Airtable CRM across intake workflows.",
        "Delivered $70K+ in savings, cutting fulfillment time 25% via AI + order automation.",
      ],
    },
    {
      org: "JCommerce Distribution", role: "Founder", when: "2023 · 2025",
      bullets: ["Built a wholesale e-commerce company to $400K+ ARR across 250+ SKUs and 20+ distributors."],
    },
  ],
  story:
    "Started a $400K e-commerce business out of a garage before I could legally rent a car. I don't wait for postings, I find the person who owns the problem and show up with work already done.",
};

/* why[] = personalization hooks the agent "found"; signal = recent activity */
const CONTACTS = [
  {
    id: "maya", domain: "figma.com", name: "Maya Jensen", initials: "MJ", role: "Design Recruiter", company: "Figma",
    source: "hiring", type: "job", match: 96, location: "San Francisco, CA", color: "lavender",
    tags: ["Replied to 3 students this month", "Owns intern pipeline"],
    signal: "Posted 2d ago: “our intern class ships real features”",
    why: ["She runs the Summer '27 intern pipeline", "Replies to short, specific notes", "Cares about shipped work over GPAs"],
    email: "maya@figma.com",
  },
  {
    id: "ravi", domain: "stripe.com", name: "Ravi Tran", initials: "RT", role: "Eng Manager · UCI alum '19", company: "Stripe",
    source: "alumni", type: "coffee", match: 94, location: "South Bay, CA", color: "mint",
    tags: ["UCI alum", "Hires interns every summer"],
    signal: "Alum, Paul Merage mentor list, active this quarter",
    why: ["Same school, eight years ahead of you", "Mentors first-gen students", "His team owns billing growth"],
    email: "ravi.tran@stripe.com",
  },
  {
    id: "elena", domain: "latticerobotics.com", name: "Elena Cruz", initials: "EC", role: "Founder & CEO", company: "Lattice Robotics (YC W26)",
    source: "yc", type: "job", match: 91, location: "Remote", color: "blush",
    tags: ["YC W26", "Founding team of 5", "Hiring ops generalist"],
    signal: "YC directory: “first ops hire” listed 5 days ago",
    why: ["She needs an ops generalist yesterday", "You automated rev-ops at IntegriTurf", "Founders answer founders, lead with your $400K story"],
    email: "elena@latticerobotics.com",
  },
  {
    id: "marcus", domain: "harborcrest.com", name: "Marcus Webb", initials: "MW", role: "VP, Private Equity", company: "Harbor Crest Capital",
    source: "vc", type: "coffee", match: 88, location: "Newport Beach, CA", color: "butter",
    tags: ["20 min from campus", "Spoke at Merage last fall"],
    signal: "Firm just closed Fund III ($240M)",
    why: ["He guest-lectured at your school", "Fund III means new associate workload", "Finance + IS double focus maps to his diligence stack"],
    email: "mwebb@harborcrest.com",
  },
  {
    id: "dana", domain: "anduril.com", name: "Dana Kim", initials: "DK", role: "Head of Talent", company: "Anduril",
    source: "hiring", type: "job", match: 87, location: "Costa Mesa, CA", color: "lavender",
    tags: ["12 intern reqs open", "Likes portfolio links"],
    signal: "Opened 12 Summer '27 intern roles this week",
    why: ["A dozen open reqs means inbox triage, short wins", "Defense-tech values builders with proof", "You're 15 minutes away"],
    email: "dkim@anduril.com",
  },
  {
    id: "sofia", domain: "deloitte.com", name: "Sofia Marin", initials: "SM", role: "Case Comp Director", company: "Deloitte, SoCal",
    source: "hiring", type: "case", match: 85, location: "Los Angeles, CA", color: "mint",
    tags: ["Runs national case comp", "Sponsors student orgs"],
    signal: "Sponsorship apps open for Spring cycle",
    why: ["She picks sponsored schools next month", "Your club needs a partner, she needs reach at UCI", "Past winners got fast-track interviews"],
    email: "smarin@deloitte.com",
  },
  {
    id: "jonas", domain: "paperplane.health", name: "Jonas Feld", initials: "JF", role: "Co-founder", company: "Paperplane Health (YC S25)",
    source: "yc", type: "job", match: 84, location: "Remote", color: "blush",
    tags: ["YC S25", "Solo on growth"],
    signal: "Tweeted: “drowning in growth ops, send help”",
    why: ["He literally asked for help publicly", "Your Airtable CRM build is the exact fix", "Small team = real scope on day one"],
    email: "jonas@paperplane.health",
  },
  {
    id: "grace", domain: "disney.com", name: "Grace Obi", initials: "GO", role: "Strategy Manager · UCI alum '21", company: "Disney",
    source: "alumni", type: "coffee", match: 83, location: "Burbank, CA", color: "butter",
    tags: ["UCI alum", "Was a Merage TA"],
    signal: "Promoted to Strategy Manager 3 weeks ago",
    why: ["Congratulate the promotion, timing is everything", "She TA'd the strategy class you aced", "Disney strategy takes spring externs"],
    email: "grace.obi@disney.com",
  },
  {
    id: "theo", domain: "ramp.com", name: "Theo Brandt", initials: "TB", role: "Hiring Manager, BizOps", company: "Ramp",
    source: "hiring", type: "job", match: 82, location: "New York, NY", color: "lavender",
    tags: ["Posted role 5h ago", "Python required"],
    signal: "BizOps intern req opened 5 hours ago",
    why: ["Early applicant window, first 24h matter", "Ramp loves operators who automate", "Your SQL + Python clears the bar"],
    email: "theo.brandt@ramp.com",
  },
  {
    id: "lina", domain: "westcliff.vc", name: "Lina Park", initials: "LP", role: "Partner", company: "Westcliff Ventures",
    source: "vc", type: "coffee", match: 80, location: "Irvine, CA", color: "mint",
    tags: ["Invests in student founders", "Office hours monthly"],
    signal: "Announced campus office hours for winter",
    why: ["She backs student founders, you built one", "Office hours fill in 48h", "Warm her up before the JCommerce story"],
    email: "lina@westcliff.vc",
  },
  {
    id: "omar", domain: "fieldnote.ai", name: "Omar Haddad", initials: "OH", role: "Founder", company: "Fieldnote AI (YC W26)",
    source: "yc", type: "job", match: 79, location: "San Diego, CA", color: "blush",
    tags: ["YC W26", "Hiring founding analyst"],
    signal: "YC directory: founding analyst role, equity-heavy",
    why: ["Same city as you", "Founding analyst = your dream scope", "He answered 4 cold emails last batch (public thread)"],
    email: "omar@fieldnote.ai",
  },
  {
    id: "nina", domain: "ey.com", name: "Nina Castellanos", initials: "NC", role: "Campus Recruiter", company: "EY",
    source: "hiring", type: "case", match: 76, location: "Irvine, CA", color: "butter",
    tags: ["Owns UCI relationship", "Sponsors case comps"],
    signal: "Booking spring campus events now",
    why: ["She decides which clubs EY sponsors", "Your case comp needs a headline sponsor", "She met your club at the fall fair"],
    email: "nina.castellanos@ey.com",
  },
  {
    id: "petra", domain: "brightline.co", name: "Petra Vogel", initials: "PV", role: "COO", company: "Brightline Logistics",
    source: "vc", type: "job", match: 74, location: "Long Beach, CA", color: "lavender",
    tags: ["PE-backed", "Scaling ops team"],
    signal: "Company acquired by Harbor Crest in Oct",
    why: ["Post-acquisition = ops hiring spree", "Your fulfillment automation story lands here", "PE-backed ops is your finance+IS sweet spot"],
    email: "pvogel@brightline.co",
  },
];

/* Pre-existing outreach state so the dashboard feels lived-in */
const SEED_OUTREACH = [
  { contactId: "ravi", stage: "replied", lastTouch: "2h ago", opens: 3,
    note: "“Happy to chat, grab time on my calendly?”" },
  { contactId: "grace", stage: "opened", lastTouch: "5h ago", opens: 2, note: null },
  { contactId: "marcus", stage: "sent", lastTouch: "1d ago", opens: 0, note: null },
  { contactId: "sofia", stage: "meeting", lastTouch: "3d ago", opens: 4,
    note: "Intro call booked, Thu 2:00 PM" },
  { contactId: "theo", stage: "drafted", lastTouch: "just now", opens: 0, note: null },
];

const SEED_THREADS = [
  {
    contactId: "ravi", unread: true, warm: true, when: "2:14 PM",
    subject: "Re: fellow anteater in billing-land",
    messages: [
      { from: "you", time: "Yesterday, 9:41 AM",
        text: "Hi Ravi, fellow Anteater (Merage '27). I automated a rev-ops stack that saved a client $70K last summer and I'm trying to learn how billing infra works at real scale. Could I get 15 minutes of your time? I'll come with three specific questions, not a resume dump., Aaron" },
      { from: "them", time: "Today, 2:14 PM",
        text: "Ha, “not a resume dump” got me. Zot zot. Happy to chat; grab any slot on my calendly this week. Bring the $70K story, that's the interesting part." },
    ],
  },
  {
    contactId: "sofia", unread: false, warm: true, when: "Mon",
    subject: "Re: UCI x Deloitte case comp, sponsorship",
    messages: [
      { from: "you", time: "Last Thu, 8:15 AM",
        text: "Hi Sofia, I run the strategy club at UCI Merage (120 active members). We're hosting a case comp this spring and want Deloitte as the headline. Past sponsors got direct pipeline to our top 10 finishers. 15 minutes to walk you through the deck?" },
      { from: "them", time: "Mon, 11:02 AM",
        text: "We're finalizing the spring sponsorship slate this month, so good timing. Booked the Thursday slot your scheduling link offered. Send the deck ahead please." },
      { from: "you", time: "Mon, 11:30 AM",
        text: "Deck attached, see you Thursday at 2. Thank you!" },
    ],
  },
  {
    contactId: "grace", unread: false, warm: false, when: "Tue",
    subject: "congrats on Strategy Manager",
    messages: [
      { from: "you", time: "Tue, 9:02 AM",
        text: "Grace, saw the promotion to Strategy Manager, congrats! You TA'd my strategy class section two years ago (I was the one who kept asking about Disney+ bundling economics). Would love 15 minutes to hear what the jump from senior analyst was like." },
    ],
  },
];

/* Agent run script, steps rendered with delays in the drawer */
function agentScript(c) {
  return [
    { icon: "search", label: `Researching ${c.name.split(" ")[0]}`, detail: `Reading ${c.company} site, recent posts, ${c.source === "yc" ? "YC directory entry" : c.source === "alumni" ? "alumni database" : "open roles & team page"}…`, ms: 1400 },
    { icon: "hook", label: "Finding the hook", detail: c.why[0], ms: 1300 },
    { icon: "story", label: "Matching your story", detail: c.why[1] || "Mapping your experience to what they need right now", ms: 1300 },
    { icon: "pen", label: "Drafting in your voice", detail: `${PROFILE.voice.tone} · ${PROFILE.voice.length}`, ms: 1500 },
  ];
}

/* Personalized draft the agent "writes" */
function draftEmail(c) {
  const first = c.name.split(" ")[0];
  const subj = {
    maya: "intern who ships before being asked",
    ravi: "fellow anteater in billing-land",
    elena: "your first ops hire (I've done this before)",
    marcus: "Merage student, 3 questions about Fund III",
    dana: "Anduril intern reqs, 15 min from campus",
    sofia: "UCI x Deloitte case comp, sponsorship",
    jonas: "saw your growth-ops tweet. send help = me",
    grace: "congrats on Strategy Manager",
    theo: "BizOps req (5h old), early applicant",
    lina: "student founder, $400K ARR, office hours?",
    omar: "founding analyst, I'm in San Diego too",
    nina: "EY x UCI case comp, spring slate",
    petra: "post-acquisition ops, automation story",
  }[c.id] || `quick note from a UCI student`;

  const bodies = {
    job: `Hi ${first}, I'm Aaron, a Merage student at UC Irvine. ${c.why[1] || ""} Last summer I cut a client's fulfillment time 25% and saved them $70K by automating their rev-ops stack; before that I built a $400K e-commerce business from scratch.\n\n${c.why[0]}. I'd love to show you what I'd do in the role, I've already sketched a 30-day plan. 15 minutes this week?\n\n${PROFILE.voice.signoff}`,
    coffee: `Hi ${first}, Aaron Johnson, UCI Merage '27. ${c.why[0]}. I'm not asking for a job, I want 15 minutes and I'll bring three specific questions, not a resume dump.\n\nFor context: I founded a $400K wholesale business and spent last summer automating revenue ops. ${c.why[2] || ""}\n\nAny slot works. ${PROFILE.voice.signoff}`,
    case: `Hi ${first}, I run the strategy club at UCI Merage (120 active members). ${c.why[1] || "We're hosting a spring case competition and want a headline sponsor."}\n\n${c.why[0]}. Past sponsors got direct pipeline to our top finishers. Can I send the one-page deck?\n\n${PROFILE.voice.signoff}`,
  };
  return { subject: subj, body: bodies[c.type] || bodies.job };
}

/* Simulated replies for the demo loop */
const SIM_REPLIES = {
  maya: "Short and specific, thank you. Send the 30-day sketch and your portfolio; if it holds up I'll pull you into the intern screen this cycle.",
  elena: "Ok “I've done this before” is a bold subject line but you backed it up. Can you do a 20-min call tomorrow? Bring the Airtable CRM story.",
  theo: "Good timing and good instincts. I'll flag you to the recruiter, mention this thread when the application asks how you heard about us.",
  jonas: "lol. ok. you're hired for a trial project, kidding, mostly. what's your availability this week?",
  omar: "San Diego founding analyst pipeline is officially open. Coffee Friday? I'm near UTC.",
  dana: "We do like builders. Apply to req #4417 and reply here with the confirmation #, I'll make sure a human reads it.",
  default: "Thanks for the note, this stood out. Let's find 15 minutes; send me a couple of times that work.",
};

const STAGES = [
  { id: "drafted", label: "Drafted", hint: "Waiting for your approval" },
  { id: "sent", label: "Sent", hint: "Knocked, waiting" },
  { id: "opened", label: "Opened", hint: "They're reading" },
  { id: "replied", label: "Replied", hint: "Door is open" },
  { id: "meeting", label: "Meeting booked", hint: "Go win" },
];

const SOURCES = [
  { id: "all", label: "All sources" },
  { id: "yc", label: "YC directory" },
  { id: "alumni", label: "Alumni" },
  { id: "hiring", label: "Hiring now" },
  { id: "vc", label: "VC & PE" },
];

const ASKS = [
  { id: "all", label: "Every ask" },
  { id: "job", label: "Jobs & internships" },
  { id: "coffee", label: "Coffee chats" },
  { id: "case", label: "Case comp & sponsors" },
];
