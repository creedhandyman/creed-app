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
  caption: "Water-damaged subfloor to new Pergo planks · West Wichita",
};

// Before/after gallery. Drop images in /public/assets and keep these paths.
// The homepage shows the first two; /gallery shows them all.
export const GALLERY = [
  {
    title: "Floor tear-out and Pergo planks",
    note: "Stained subfloor pulled, new Pergo plank flooring laid and finished.",
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
    note: "Tired treads swapped out and the whole staircase recoated.",
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
