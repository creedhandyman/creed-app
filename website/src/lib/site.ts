// Single source of truth for business facts. Edit here, updates everywhere.
export const SITE = {
  name: "Creed Handyman",
  legalName: "Creed Handyman LLC",
  phone: "(316) 400-7414",
  phoneHref: "tel:+13164007414",
  email: "bernard@creedhm.com",
  domain: "https://creedhandyman.com",
  rate: "$55",
  minimum: "Two-hour minimum",
  city: "Wichita",
  region: "KS",
  county: "Sedgwick County",
  areaLine: "Wichita and all of Sedgwick County",
  hours: [
    { d: "Mon–Fri", h: "9:00 AM – 7:00 PM" },
    { d: "Saturday", h: "9:00 AM – 12:00 PM" },
    { d: "Sunday", h: "Closed" },
  ],
  cities: [
    "Wichita", "Derby", "Haysville", "Park City", "Bel Aire",
    "Valley Center", "Maize", "Goddard", "Kechi", "Cheney",
    "Clearwater", "Colwich", "Andale", "Garden Plain", "Mount Hope", "Bentley",
  ],
  logo: "/assets/logo.png",
  social: {
    facebook: "https://www.facebook.com/profile.php?id=100093350324125",
    instagram: "https://www.instagram.com/creedhandyman/",
  },
};

export const SERVICES = [
  {
    slug: "plumbing",
    name: "Plumbing",
    blurb: "Leaks, faucets, toilets, disposals, shut-off valves, supply lines.",
    intro: "Small plumbing problems don't stay small. We handle the fixes that fit inside a normal day — done right, no flood, no drama.",
    tasks: [
      "Faucet repair and replacement",
      "Toilet repair, rebuild, or swap",
      "Garbage disposal replacement",
      "Shut-off valves and supply lines",
      "P-traps and drain leaks under sinks",
      "Dishwasher and icemaker hookups",
      "Outdoor spigots and hose bibs",
      "Caulk and seal around tubs and sinks",
    ],
  },
  {
    slug: "electrical",
    name: "Electrical",
    blurb: "Fixtures, switches, outlets, ceiling fans, breaker swaps.",
    intro: "Fixtures, fans, switches, and the small electrical jobs most electricians won't put on their schedule.",
    tasks: [
      "Light fixture replacement",
      "Ceiling fan install and balancing",
      "Switches, dimmers, and smart switches",
      "Outlet replacement and GFCI upgrades",
      "Smoke and CO detector replacement",
      "Doorbells and video doorbells",
      "Thermostat swaps",
      "Breaker swaps",
    ],
  },
  {
    slug: "drywall-paint",
    name: "Drywall & paint",
    blurb: "Holes, cracks, texture matching, trim and touch-up work.",
    intro: "Holes, cracks, and water stains disappear — texture matched so you can't find the patch afterward.",
    tasks: [
      "Drywall hole and crack repair",
      "Texture matching — orange peel, knockdown",
      "Water-damage patch and repaint",
      "Ceiling stain sealing and repair",
      "Trim, baseboard, and door casing",
      "Caulking and paint touch-up",
      "Interior painting by the room",
      "Popcorn ceiling patching",
    ],
  },
  {
    slug: "doors-locks",
    name: "Doors & locks",
    blurb: "Sticking doors, hardware, deadbolts, rekeys, weatherstripping.",
    intro: "Doors that stick, latches that miss, locks that need changing — squared, aligned, and working like they should.",
    tasks: [
      "Sticking and rubbing door correction",
      "Hinge, latch, and strike adjustment",
      "Deadbolt and handleset installation",
      "Rekeying on turnovers",
      "Weatherstripping and door sweeps",
      "Interior door replacement",
      "Screen and storm door repair",
      "Closet and barn door tracks",
    ],
  },
  {
    slug: "mounting-assembly",
    name: "Mounting & assembly",
    blurb: "TVs, shelves, blinds, mirrors, flat-pack furniture.",
    intro: "Measured twice, anchored into studs, level the first time. Heavy things on walls the way they should be.",
    tasks: [
      "TV mounting with cords concealed",
      "Shelving and floating shelves",
      "Mirrors and heavy art",
      "Blinds and curtain rods",
      "Flat-pack furniture assembly",
      "Anchoring furniture for tip-over safety",
      "Grab bars, towel bars, and hooks",
      "Garage storage and racks",
    ],
  },
  {
    slug: "make-ready",
    name: "Make-ready",
    blurb: "Turnovers and punch lists between tenants, start to finish.",
    intro: "Between tenants is where we earn our keep — one crew works the whole punch list, and the unit comes back ready to show.",
    tasks: [
      "Full punch-list turnover work",
      "Patch, texture, and repaint",
      "Fixture and hardware swaps",
      "Rekeying",
      "Blinds and detector replacement",
      "Caulk and grout refresh",
      "Small plumbing and electrical items",
      "Photo-documented completion report",
    ],
  },
];

// The CREED itself — the acronym the company is named for. The homepage
// hero renders `lines` as a stacked acrostic; About + social titles use
// `sentence`.
export const CREED = {
  lines: [
    { letter: "C", rest: "ontinuously" },
    { letter: "R", rest: "aising" },
    { letter: "E", rest: "xpectations" },
    { letter: "E", rest: "fficiency &" },
    { letter: "D", rest: "edication" },
  ],
  tail: "for our customers",
  sentence: "Continuously Raising Expectations, Efficiency & Dedication — for our customers.",
};

// Hero photo. Drop the file in /public/assets. Falls back to a placeholder if missing.
export const HERO = {
  after: "/assets/hero.jpg",
  caption: "This room had a water-damaged subfloor. You'd never know. · West Wichita",
};

// Before/after gallery. Drop images in /public/assets and keep these paths.
// The homepage shows the first two; /gallery shows them all.
export const GALLERY = [
  {
    title: "Water-damaged floor rescue",
    note: "The stained subfloor came out, new Pergo planks went in — from write-off to showpiece.",
    before: "/assets/ba1-before.jpg",
    after: "/assets/ba1-after.jpg",
  },
  {
    title: "Rental make-ready",
    note: "Carpet out, plank in, walls and trim repainted for turnover.",
    before: "/assets/ba2-before.jpg",
    after: "/assets/ba2-after.jpg",
  },
  {
    title: "Deck rescue and repaint",
    note: "Peeling paint scraped and sanded off, then the whole deck recoated.",
    before: "/assets/ba5-before.jpg",
    after: "/assets/ba5-after.jpg",
  },
  {
    title: "Deck stair rebuild",
    note: "The whole staircase remade from scratch, then restained.",
    before: "/assets/ba6-before.jpg",
    after: "/assets/ba6-after.jpg",
  },
  {
    title: "Basement window rebuild",
    note: "Rotted trim out, sealed up, and a new well cover fitted.",
    before: "/assets/ba4-before.jpg",
    after: "/assets/ba4-after.jpg",
  },
];

export const PRICE_POINTS = [
  { h: "No mystery fees", p: "The quote is the number on the invoice." },
  { h: "No trip charges inside Wichita", p: "Driving to you is on us." },
  { h: "Materials billed at cost", p: "Receipts on request, no markup." },
  { h: "Cleanup and haul-away included", p: "The old material leaves with the truck." },
];

// Per-city service-area pages (local SEO). Each renders via
// components/CityPage.tsx at /<slug>; linked from the footer and sitemap.
export const CITY_PAGES = [
  {
    slug: "handyman-derby-ks",
    city: "Derby",
    intro: "Straight down Rock Road from our Wichita home base — Derby calls get quoted before we start, same as everyone.",
    body: [
      "Derby is one of the fastest-growing towns in Kansas, and its housing shows every era from 1970s ranches to brand-new builds. We handle the punch lists both kinds generate: sticking doors, drywall cracks as foundations settle, fixture upgrades, and the fit-and-finish work builders leave behind.",
      "With McConnell AFB next door, Derby also turns over a lot of rentals. Our make-ready service runs the whole between-tenants list — patch and paint, rekeys, blinds, detectors — and closes with a photo report when the unit is ready to show.",
    ],
    jobs: [
      "Drywall crack and settling repairs",
      "Door adjustment and hardware",
      "Ceiling fans and light fixtures",
      "Faucets, toilets, and disposals",
      "Rental make-ready turnovers",
      "TV mounting and furniture assembly",
    ],
  },
  {
    slug: "handyman-haysville-ks",
    city: "Haysville",
    intro: "Ten minutes south on Broadway — the Peach Capital of Kansas is squarely inside our service area.",
    body: [
      "Much of Haysville's housing is sturdy mid-century ranch stock, and that generation of home is where a good handyman earns his keep: original plumbing fixtures due for replacement, worn flooring, weathered decks and stairs, and the water damage that shows up around bathrooms and water heaters.",
      "We repair honestly — patch and match rather than replace whole rooms — and when a job needs a licensed specialty contractor, we say so before any money changes hands.",
    ],
    jobs: [
      "Faucet, toilet, and supply-line replacement",
      "Water-damage drywall repairs",
      "Deck and stair repair and staining",
      "Interior painting and trim",
      "Flooring repairs and plank installs",
      "Doors, locks, and weatherstripping",
    ],
  },
  {
    slug: "handyman-goddard-ks",
    city: "Goddard",
    intro: "West down Kellogg from Wichita — Goddard is an easy run from our home base.",
    body: [
      "Goddard is growing fast west of Wichita, and newer subdivisions come with their own to-do lists: builder-grade fixtures worth upgrading, TVs and shelving to mount, playsets and flat-pack furniture to assemble, and the small fixes the builder never came back for.",
      "Established Goddard homes get the full menu too — plumbing and electrical swaps, drywall and paint, doors and locks, and make-ready turnovers for rentals.",
    ],
    jobs: [
      "TV mounting with cords concealed",
      "Fixture and hardware upgrades",
      "Furniture, playset, and gym assembly",
      "Drywall patching and paint touch-ups",
      "Ceiling fans and smart thermostats",
      "Fence gate and deck repairs",
    ],
  },
];

// The Creed HM lead form — the direct way to send a work order / quote
// request into the app (photos + details land as a lead with referral
// attribution). Every Request-a-quote button + the contact and
// property-managers work-order links point here.
export const WORK_ORDER = {
  url: "https://www.creedhm.com/lead/creedhandyman?tech=78353c52-0de5-4a05-b57e-5eb0bd54813f",
  label: "Submit a work order",
};

// Where the quote form sends leads: the Creed app's public lead-intake
// endpoint. Submissions land in the app as a "lead" job and notify the
// crew. The slug identifies this business — server resolves everything
// else from it.
export const LEADS = {
  endpoint: "https://www.creedhm.com/api/leads",
  slug: "creedhandyman",
};
