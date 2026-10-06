// Single source of truth for business facts. Edit here, updates everywhere.
export const SITE = {
  name: "Creed Handyman",
  legalName: "Creed Handyman LLC",
  phone: "(316) 400-7414",
  phoneHref: "tel:+13164007414",
  email: "bernard@creedhm.com",
  domain: "https://www.creedhandyman.com",
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
  license: "8145054",
  insurer: "Hiscox",
  googleProfile: "https://share.google/iWyuFiCuRR2FXA2UN",
  smsHref: "sms:+13164007414",
  logo: "/assets/logo.webp",
  social: {
    facebook: "https://www.facebook.com/profile.php?id=100093350324125",
    instagram: "https://www.instagram.com/creedhandyman/",
    homeadvisor: "https://www.homeadvisor.com/rated.CreedHandyman.161678571.html",
  },
};

export const SERVICES = [
  {
    slug: "drywall-paint",
    name: "Painting & drywall",
    blurb: "Interior painting, drywall patches, texture matching, trim and touch-ups.",
    intro: "Fresh paint and clean walls do more for a room than anything else — holes, cracks, and stains patched and texture-matched first, so the finish looks new.",
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
    slug: "make-ready",
    name: "Make-ready & work orders",
    blurb: "Vacant-unit turnovers, punch lists, and small work orders, start to finish.",
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
  {
    slug: "flooring",
    name: "Flooring",
    blurb: "Carpet tear-out, vinyl and laminate plank installs, transitions and trim.",
    intro: "Worn carpet out, durable plank in — the fastest way to make a room or a rental feel new.",
    tasks: [
      "Carpet and pad tear-out and haul-away",
      "Luxury vinyl plank (LVP) installation",
      "Laminate plank installation",
      "Subfloor checks and prep",
      "Transitions and thresholds",
      "Baseboard and quarter-round",
      "Damaged plank repair",
      "Rental-grade flooring for turnovers",
    ],
  },
  {
    slug: "trash-outs",
    name: "Trash-outs & cleanouts",
    blurb: "Vacant-unit trash-outs and haul-away so the turnover can start.",
    intro: "Left-behind furniture, junk, and debris hauled out so the unit is empty and ready for repairs.",
    tasks: [
      "Vacant-unit trash-outs",
      "Furniture and appliance haul-away",
      "Garage and shed cleanouts",
      "Construction debris removal",
      "Move-out cleanouts for landlords",
      "Haul-away after our own repair work",
      "Photo documentation for property owners",
      "Bundled with make-ready turnovers",
    ],
  },
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
  after: "/assets/bernard-truck.webp",
  caption: "Bernard Reed, owner · Licensed & insured · Wichita",
};

// Before/after gallery. Drop images in /public/assets and keep these paths.
// The homepage shows the first two; /gallery shows them all.
export const GALLERY: {
  title: string;
  note: string;
  before: string;
  after: string;
  services?: string[]; // service slugs this job shows off (service pages list them)
}[] = [
  {
    title: "Bathroom remodel",
    note: "Dated vanity and vinyl floor out — new floating vanity, tile floor, backsplash, and a lighted mirror in.",
    before: "/assets/ba7-before.webp",
    after: "/assets/ba7-after.webp",
    services: ["plumbing"],
  },
  {
    title: "Rental turnover",
    note: "Stained carpet out, vinyl plank in, and the yellowed doors and trim repainted white.",
    before: "/assets/ba8-before.webp",
    after: "/assets/ba8-after.webp",
    services: ["make-ready", "flooring", "drywall-paint"],
  },
  {
    title: "Carpet-to-Pergo makeover",
    note: "The worn carpet came up, the solid subfloor underneath got new Pergo planks — and the room feels brand new.",
    before: "/assets/ba1-before.webp",
    after: "/assets/ba1-after.webp",
    services: ["flooring"],
  },
  {
    title: "Patched floor to new plank",
    note: "A floor of mismatched patches replaced with one clean run of vinyl plank.",
    before: "/assets/ba9-before.webp",
    after: "/assets/ba9-after.webp",
    services: ["flooring"],
  },
  {
    title: "Staircase refinish",
    note: "Bare, stained stair treads finished with new plank treads and risers.",
    before: "/assets/ba10-before.webp",
    after: "/assets/ba10-after.webp",
    services: ["flooring"],
  },
  {
    title: "Rental make-ready",
    note: "Carpet out, plank in, walls and trim repainted for turnover.",
    before: "/assets/ba2-before.webp",
    after: "/assets/ba2-after.webp",
    services: ["make-ready", "flooring", "drywall-paint"],
  },
  {
    title: "Garage repaint",
    note: "Peeling walls and ceiling scraped, prepped, and repainted clean white.",
    before: "/assets/ba11-before.webp",
    after: "/assets/ba11-after.webp",
    services: ["drywall-paint"],
  },
  {
    title: "Sliding patio door install",
    note: "Old exterior door gone — the opening framed out and a new sliding patio door installed.",
    before: "/assets/ba12-before.webp",
    after: "/assets/ba12-after.webp",
    services: ["doors-locks"],
  },
  {
    title: "Deck rescue and repaint",
    note: "Peeling paint scraped and sanded off, then the whole deck recoated.",
    before: "/assets/ba5-before.webp",
    after: "/assets/ba5-after.webp",
    services: ["drywall-paint"],
  },
  {
    title: "Deck stair rebuild",
    note: "The whole staircase remade from scratch, then restained.",
    before: "/assets/ba6-before.webp",
    after: "/assets/ba6-after.webp",
  },
  {
    title: "Fence replacement",
    note: "A leaning, weathered fence torn out and rebuilt with new posts and pickets.",
    before: "/assets/ba13-before.webp",
    after: "/assets/ba13-after.webp",
  },
  {
    title: "Basement window rebuild",
    note: "Rotted trim out, sealed up, and a new well cover fitted.",
    before: "/assets/ba4-before.webp",
    after: "/assets/ba4-after.webp",
  },
];

// Intro offer shown in the pricing sections (home + /pricing).
export const SPECIAL = {
  price: "$80",
  title: "Wichita house call special",
  note: "One small repair inside Wichita city limits — the visit and up to an hour of work for a flat $80.",
};

export const PRICE_POINTS = [
  { h: "Free estimates", p: "Send photos or have us look — the quote costs you nothing." },
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

// Customer reviews (verified on Angi). Shown on the homepage; add new ones
// at the top. Keep first name + last initial only.
export const REVIEWS = {
  source: "Google & Angi",
  rating: "5.0",
  items: [
    { name: "Alex E.", job: "Google review", text: "Exemplary service, their team came in and completed the job in great time for what it was and they paid close attention to detail and future durability! Thank you Creed Handyman!!" },
    { name: "Jacob G.", job: "Handyman", text: "I've worked with plenty of people in the past who procrastinate, or do half the job and expect me to accept it. It was the total opposite with Creed! Very professional, on time, and truly took his time to make sure everything was done properly. I wouldn't recommend any other handyman!" },
    { name: "Alissa S.", job: "Interior paint & repair", text: "I had multiple small holes around my bathroom window that were starting to create concerns. They replaced and installed new tiling as well as insulation to fix it. They were quick and efficient. I rely on them for all my house work, whether it's a small or a big project." },
    { name: "Danielle S.", job: "Bathroom renovation", text: "My bathrooms were renovated. The job was done exactly how I wanted. Excellent work!" },
    { name: "Sherry", job: "Google review", text: "Thanks for your quick response on handy work, we really appreciate your business." },
    { name: "Alexia M.", job: "Drain cleaning", text: "Cleaned my drains — I was having a lot of problems and haven't had a problem since. Very good customer service and prices." },
  ],
};

// Homepage FAQ (also emitted as FAQPage structured data).
export const FAQ = [
  { q: "Are estimates really free?", a: "Yes. Send photos through the quote form or have us take a look — you get the price before any work starts, and it costs you nothing." },
  { q: "How much do you charge?", a: "$55 an hour with a two-hour minimum, materials at cost. Inside Wichita there is also an $80 house-call special for one small repair — the visit and up to an hour of work." },
  { q: "Are you licensed and insured?", a: "Yes — license #8145054, with general liability insurance through Hiscox on every job." },
  { q: "Do you charge a trip fee?", a: "No trip charges inside Wichita. For the rest of Sedgwick County we will tell you up front if anything applies." },
  { q: "Do you work with landlords and property managers?", a: "Yes — vacant-unit turnovers, trash-outs, punch lists, and work orders are a big part of what we do, with one invoice per property and photo reports when the unit is ready." },
  { q: "What areas do you serve?", a: "Wichita and all of Sedgwick County, including Derby, Haysville, Park City, Bel Aire, Maize, Goddard, and Valley Center." },
];

// "Recent work" photo reel (single after shots). Short, plain captions.
export const RECENT = [
  { src: "/assets/recent-01.webp", caption: "Bathroom remodel" },
  { src: "/assets/recent-02.webp", caption: "New laminate flooring" },
  { src: "/assets/recent-03.webp", caption: "Tub surround & vanity" },
  { src: "/assets/recent-04.webp", caption: "Fireplace tile surround" },
  { src: "/assets/recent-05.webp", caption: "Deck stairs, rebuilt & stained" },
  { src: "/assets/recent-06.webp", caption: "Move-in ready" },
  { src: "/assets/recent-07.webp", caption: "Whole-house turnover" },
  { src: "/assets/recent-08.webp", caption: "Rental turnover" },
  { src: "/assets/recent-09.webp", caption: "Cozy bedroom, dark walls & lighting" },
  { src: "/assets/recent-10.webp", caption: "Kitchen turnover" },
];
