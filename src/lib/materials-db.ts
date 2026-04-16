// Creed App — Curated Materials Database
// Based on Bernard's real shop list + Home Depot mid-range pricing
// Add HD SKUs as you find them — format: sku?: "305446612"

export interface MaterialItem {
  name: string;
  price: number;
  category: string;
  sku?: string;
  keywords: string[]; // for matching from inspection text
}

export const MATERIALS_DB: MaterialItem[] = [
  // ═══════════════════════════════════════════
  // PLUMBING
  // ═══════════════════════════════════════════

  // Toilet
  { name: "Toilet (complete)", price: 180, category: "Plumbing", keywords: ["toilet", "commode", "replace toilet"] },
  { name: "Fill valve", price: 9, sku: "147966", category: "Plumbing", keywords: ["fill valve", "toilet running", "tank fill"] },
  { name: "Flapper", price: 7, sku: "420456", category: "Plumbing", keywords: ["flapper", "toilet leak", "running toilet"] },
  { name: "Tank lever", price: 8, category: "Plumbing", keywords: ["tank lever", "flush handle", "toilet handle"] },
  { name: "Toilet floor bolts", price: 4, category: "Plumbing", keywords: ["floor bolt", "closet bolt", "toilet bolt"] },
  { name: "Tank to bowl bolts", price: 6, category: "Plumbing", keywords: ["tank bolt", "tank to bowl"] },
  { name: "Toilet supply line", price: 8, category: "Plumbing", keywords: ["toilet supply", "supply line", "water supply"] },
  { name: "Quarter turn stop valve", price: 12, category: "Plumbing", keywords: ["shut off", "stop valve", "quarter turn", "shutoff"] },
  { name: "Quarter turn double stop", price: 18, category: "Plumbing", keywords: ["double stop", "double shut"] },
  { name: "Flange repair kit", price: 10, category: "Plumbing", keywords: ["flange repair", "toilet flange"] },
  { name: "Toilet flange", price: 8, category: "Plumbing", keywords: ["flange", "closet flange"] },
  { name: "Toilet bolt caps", price: 3, category: "Plumbing", keywords: ["bolt cap", "toilet cap"] },
  { name: "Rubber toilet seal (wax-free)", price: 8, category: "Plumbing", keywords: ["wax ring", "toilet seal", "rubber seal"] },
  { name: "Toilet gasket", price: 5, category: "Plumbing", keywords: ["tank gasket", "toilet gasket"] },
  { name: "Toilet lid", price: 12, category: "Plumbing", keywords: ["toilet lid", "tank lid", "tank cover"] },
  { name: "Toilet seat", price: 13, sku: "634072", category: "Plumbing", keywords: ["toilet seat"] },

  // Tub/Shower
  { name: "Tub surround kit", price: 250, category: "Plumbing", keywords: ["tub surround", "shower surround"] },
  { name: "Silicone caulk (white)", price: 6, category: "Plumbing", keywords: ["caulk", "caulking", "silicone", "seal"] },
  { name: "Tile grout (10lb)", price: 16, category: "Plumbing", keywords: ["grout", "tile grout", "regrout"] },
  { name: "Tub handles (pair)", price: 15, category: "Plumbing", keywords: ["tub handle", "shower handle", "faucet handle"] },
  { name: "Tub stem escutcheon", price: 8, category: "Plumbing", keywords: ["escutcheon", "trim plate", "cover plate"] },
  { name: "Danco stem", price: 6, category: "Plumbing", keywords: ["danco stem", "faucet stem"] },
  { name: "Danco seats", price: 4, category: "Plumbing", keywords: ["danco seat", "faucet seat"] },
  { name: "Danco 1/2\" rubber washer", price: 3, category: "Plumbing", keywords: ["rubber washer", "faucet washer"] },
  { name: "Danco cartridge 10405", price: 18, category: "Plumbing", keywords: ["danco cartridge", "faucet cartridge", "cartridge"] },
  { name: "Danco diverter stem", price: 12, category: "Plumbing", keywords: ["diverter", "diverter stem"] },
  { name: "Tub face plate", price: 8, category: "Plumbing", keywords: ["tub face plate", "overflow plate"] },
  { name: "Tub rubber stopper", price: 5, category: "Plumbing", keywords: ["tub stopper", "drain stopper", "rubber stopper"] },
  { name: "Shower arm", price: 8, category: "Plumbing", keywords: ["shower arm"] },
  { name: "Shower head", price: 10, sku: "1002847992", category: "Plumbing", keywords: ["shower head", "showerhead"] },
  { name: "Shower rod", price: 15, category: "Plumbing", keywords: ["shower rod", "curtain rod"] },
  { name: "Tub spout", price: 18, category: "Plumbing", keywords: ["tub spout", "bathtub spout"] },
  { name: "Shower escutcheon 1/2\"", price: 6, category: "Plumbing", keywords: ["shower escutcheon"] },
  { name: "3\" nipple", price: 3, category: "Plumbing", keywords: ["nipple", "pipe nipple"] },
  { name: "4\" nipple", price: 4, category: "Plumbing", keywords: ["nipple", "pipe nipple"] },
  { name: "Tub strainer", price: 8, category: "Plumbing", keywords: ["tub strainer", "tub drain"] },

  // Faucets & Sink
  { name: "Kitchen faucet (2-handle w/ sprayer)", price: 79, sku: "1008028130", category: "Plumbing", keywords: ["kitchen faucet", "faucet with sprayer"] },
  { name: "Bathroom faucet", price: 27, sku: "217251", category: "Plumbing", keywords: ["bath faucet", "bathroom faucet", "lav faucet"] },
  { name: "Faucet supply line 20\"", price: 8, category: "Plumbing", keywords: ["faucet supply", "supply line"] },
  { name: "Kitchen sprayer hose", price: 15, category: "Plumbing", keywords: ["sprayer hose", "kitchen sprayer", "sprayer"] },
  { name: "Faucet sprayer holder", price: 5, category: "Plumbing", keywords: ["sprayer holder"] },
  { name: "1-1/4\" slip nut", price: 3, category: "Plumbing", keywords: ["slip nut", "slip joint"] },
  { name: "1-1/4\" P-trap", price: 8, category: "Plumbing", keywords: ["p-trap", "p trap", "drain trap"] },
  { name: "1-1/4\" extension tube", price: 5, category: "Plumbing", keywords: ["extension tube", "tailpiece"] },
  { name: "1-1/2\" P-trap", price: 10, category: "Plumbing", keywords: ["p-trap", "p trap", "kitchen drain"] },
  { name: "1-1/2\" extension tube", price: 6, category: "Plumbing", keywords: ["extension tube"] },
  { name: "1-1/2\" slip nut", price: 3, category: "Plumbing", keywords: ["slip nut"] },
  { name: "Pop-up drain assembly", price: 12, category: "Plumbing", keywords: ["pop up drain", "drain assembly", "pop-up"] },
  { name: "Pop-up ball joint rod 1/2\"", price: 5, category: "Plumbing", keywords: ["ball joint", "pop up rod"] },
  { name: "Dishwasher supply line", price: 12, category: "Plumbing", keywords: ["dishwasher supply", "dishwasher water"] },
  { name: "Dishwasher drain line", price: 10, category: "Plumbing", keywords: ["dishwasher drain"] },
  { name: "Plunger pop-up", price: 8, category: "Plumbing", keywords: ["plunger pop up"] },
  { name: "Strainer basket", price: 8, category: "Plumbing", keywords: ["strainer basket", "sink strainer"] },
  { name: "Disposal stopper", price: 5, category: "Plumbing", keywords: ["disposal stopper"] },
  { name: "Garbage disposal 1/2HP", price: 90, category: "Plumbing", keywords: ["garbage disposal", "disposal"] },
  { name: "Faucet springs & rubber seats", price: 5, category: "Plumbing", keywords: ["springs and seats", "faucet repair"] },
  { name: "Spray diverter", price: 6, category: "Plumbing", keywords: ["spray diverter"] },
  { name: "Faucet aerator (male/female)", price: 5, category: "Plumbing", keywords: ["aerator", "faucet aerator"] },
  { name: "Shower splash guard", price: 8, category: "Plumbing", keywords: ["splash guard", "shower splash"] },
  { name: "Toilet paper holder", price: 12, category: "Plumbing", keywords: ["tissue holder", "tp holder", "toilet paper holder"] },
  { name: "Tub overflow washer", price: 3, category: "Plumbing", keywords: ["overflow washer", "tub overflow"] },
  { name: "Towel bar 24\"", price: 15, category: "Plumbing", keywords: ["towel bar", "towel rack"] },

  // Water Heater
  { name: "Water heater (50 gal)", price: 500, category: "Plumbing", keywords: ["water heater", "hot water"] },
  { name: "Water heater upper thermostat", price: 12, category: "Plumbing", keywords: ["upper thermostat", "water heater thermostat"] },
  { name: "Water heater lower thermostat", price: 10, category: "Plumbing", keywords: ["lower thermostat"] },
  { name: "Water heater element 4500W", price: 15, category: "Plumbing", keywords: ["heating element", "water heater element"] },
  { name: "T&P relief valve 2\" shank", price: 12, category: "Plumbing", keywords: ["t and p valve", "relief valve", "t&p"] },

  // ═══════════════════════════════════════════
  // ELECTRICAL
  // ═══════════════════════════════════════════

  // Covers & Plates
  { name: "Light switch cover plate", price: 1, category: "Electrical", keywords: ["switch cover", "switch plate"] },
  { name: "Outlet cover plate", price: 1, category: "Electrical", keywords: ["outlet cover", "receptacle cover"] },
  { name: "Blank cover plate", price: 1, category: "Electrical", keywords: ["blank cover", "blank plate"] },
  { name: "GFI/double switch cover", price: 3, category: "Electrical", keywords: ["gfi cover", "combo cover"] },
  { name: "Square cover plate", price: 2, category: "Electrical", keywords: ["square cover"] },
  { name: "Double switch cover", price: 2, category: "Electrical", keywords: ["double switch cover", "2-gang cover"] },

  // Devices
  { name: "Standard outlet (receptacle)", price: 2, category: "Electrical", keywords: ["outlet", "receptacle", "plug"] },
  { name: "Light switch (single pole)", price: 2, category: "Electrical", keywords: ["light switch", "switch", "single pole"] },
  { name: "Outlet/switch combo", price: 5, category: "Electrical", keywords: ["combo", "outlet switch"] },
  { name: "Double switch single pole", price: 5, category: "Electrical", keywords: ["double switch"] },
  { name: "GFCI outlet", price: 38, sku: "1001370834", category: "Electrical", keywords: ["gfci", "gfi", "ground fault"] },
  { name: "Outlet box", price: 2, category: "Electrical", keywords: ["outlet box", "junction box", "electrical box"] },

  // Bulbs & Lighting
  { name: "LED A19 bulbs (4-pack)", price: 10, category: "Electrical", keywords: ["led bulb", "a19", "light bulb", "bulb"] },
  { name: "G25 globe bulbs", price: 8, category: "Electrical", keywords: ["g25", "globe bulb", "vanity bulb"] },
  { name: "Decorative candle bulb B10C", price: 5, category: "Electrical", keywords: ["candle bulb", "b10", "decorative bulb", "chandelier bulb"] },
  { name: "40W appliance bulb", price: 4, category: "Electrical", keywords: ["appliance bulb", "oven bulb", "fridge bulb"] },
  { name: "18\" fluorescent tube", price: 8, category: "Electrical", keywords: ["fluorescent", "tube light", "t8"] },

  // Fixtures
  { name: "Flush mount ceiling light", price: 33, sku: "1004160609", category: "Electrical", keywords: ["flush mount", "ceiling light", "light fixture"] },
  { name: "18\" LED under-cabinet light", price: 20, category: "Electrical", keywords: ["under cabinet", "led strip", "sink light"] },
  { name: "4-bulb vanity light fixture", price: 45, category: "Electrical", keywords: ["vanity light", "bathroom light", "4 bulb"] },
  { name: "Mini flush mount light", price: 18, category: "Electrical", sku: "805306", keywords: ["mini flush", "small ceiling light", "closet light"] },
  { name: "Closet pull chain light", price: 8, category: "Electrical", keywords: ["pull chain", "closet light"] },
  { name: "Pull chain", price: 3, category: "Electrical", keywords: ["pull chain"] },
  { name: "Ceiling fan 42\"", price: 85, category: "Electrical", keywords: ["ceiling fan", "fan"] },
  { name: "Bathroom exhaust fan", price: 45, category: "Electrical", keywords: ["exhaust fan", "vent fan", "bath fan"] },

  // Safety
  { name: "Smoke alarm (10yr sealed)", price: 18, category: "Electrical", keywords: ["smoke alarm", "smoke detector"] },
  { name: "Smoke & CO combo alarm", price: 20, sku: "1005173566", category: "Electrical", keywords: ["smoke co", "carbon monoxide", "combo alarm"] },
  { name: "Batteries AA (8-pack)", price: 6, category: "Electrical", keywords: ["aa battery", "batteries"] },
  { name: "Batteries AAA (8-pack)", price: 6, category: "Electrical", keywords: ["aaa battery"] },
  { name: "9V battery (2-pack)", price: 6, category: "Electrical", keywords: ["9v battery", "9 volt"] },

  // Wire & Misc
  { name: "18 gauge wire (50ft)", price: 12, category: "Electrical", keywords: ["18 gauge", "wire", "thermostat wire"] },
  { name: "Wire nut assortment", price: 5, category: "Electrical", keywords: ["wire nut", "wire connector"] },

  // ═══════════════════════════════════════════
  // HVAC
  // ═══════════════════════════════════════════
  { name: "Fuse R20", price: 3, category: "HVAC", keywords: ["fuse r20", "20 amp fuse"] },
  { name: "Fuse R30", price: 3, category: "HVAC", keywords: ["fuse r30", "30 amp fuse"] },
  { name: "Thermostat T701", price: 28, category: "HVAC", keywords: ["thermostat", "t701"] },
  { name: "Transformer 50354", price: 18, category: "HVAC", keywords: ["transformer", "24v transformer"] },
  { name: "Switching relay (general purpose)", price: 22, category: "HVAC", keywords: ["relay", "switching relay"] },
  { name: "Contactor", price: 25, category: "HVAC", keywords: ["contactor", "ac contactor"] },
  { name: "Sequencer", price: 28, category: "HVAC", keywords: ["sequencer", "heat sequencer"] },
  { name: "Capacitor 35+5 MFD", price: 15, category: "HVAC", keywords: ["capacitor", "35+5", "dual capacitor"] },
  { name: "Capacitor 30+5 MFD", price: 15, category: "HVAC", keywords: ["30+5", "capacitor"] },
  { name: "Capacitor 40+5 MFD", price: 16, category: "HVAC", keywords: ["40+5", "capacitor"] },
  { name: "Capacitor 30 MFD", price: 12, category: "HVAC", keywords: ["30 mfd", "run capacitor"] },
  { name: "Capacitor 45 MFD", price: 14, category: "HVAC", keywords: ["45 mfd"] },
  { name: "Capacitor 5 MFD", price: 8, category: "HVAC", keywords: ["5 mfd", "start capacitor"] },
  { name: "AC Leak Freeze", price: 25, category: "HVAC", keywords: ["leak freeze", "ac leak", "refrigerant leak"] },
  { name: "R410A refrigerant (25lb)", price: 250, category: "HVAC", keywords: ["r410a", "refrigerant", "freon"] },
  { name: "MO99 refrigerant (25lb)", price: 200, category: "HVAC", keywords: ["mo99", "refrigerant"] },
  { name: "Vent register 10x6", price: 6, category: "HVAC", keywords: ["vent register", "register", "floor vent", "10x6"] },
  { name: "Vent register 8x6", price: 5, category: "HVAC", keywords: ["vent register", "8x6"] },
  { name: "HVAC air filter (standard)", price: 8, category: "HVAC", keywords: ["air filter", "hvac filter", "furnace filter"] },

  // ═══════════════════════════════════════════
  // HARDWARE / DOORS / WINDOWS
  // ═══════════════════════════════════════════
  { name: "Mailbox lock", price: 8, category: "Hardware", keywords: ["mailbox lock", "mailbox"] },
  { name: "Mirror (wall)", price: 35, category: "Hardware", keywords: ["mirror", "wall mirror"] },
  { name: "Medicine cabinet", price: 55, category: "Hardware", keywords: ["medicine cabinet"] },
  { name: "Passage door knob", price: 12, category: "Hardware", keywords: ["passage knob", "door knob", "hall knob"] },
  { name: "Privacy door knob", price: 14, category: "Hardware", keywords: ["privacy knob", "bedroom knob", "bath knob"] },
  { name: "Deadbolt smart lock", price: 160, category: "Hardware", keywords: ["smart lock", "deadbolt", "keypad lock"] },
  { name: "Standard deadbolt", price: 25, category: "Hardware", keywords: ["deadbolt", "dead bolt"] },
  { name: "Door stop", price: 3, category: "Hardware", keywords: ["door stop", "doorstop", "door bumper"] },
  { name: "Door chain", price: 8, category: "Hardware", keywords: ["door chain", "chain lock"] },
  { name: "Door sweep", price: 10, category: "Hardware", keywords: ["door sweep", "bottom seal"] },
  { name: "Interior door hinge", price: 4, category: "Hardware", keywords: ["interior hinge", "door hinge", "hinge"] },
  { name: "Exterior door hinge", price: 6, category: "Hardware", keywords: ["exterior hinge"] },
  { name: "Door weatherstripping", price: 10, category: "Hardware", keywords: ["weatherstrip", "weather strip", "door seal"] },
  { name: "Storm door closer", price: 15, category: "Hardware", keywords: ["door closer", "storm door closer"] },
  { name: "Patio door security bar", price: 12, category: "Hardware", keywords: ["security bar", "patio bar", "sliding door bar"] },
  { name: "Screen door handle", price: 8, category: "Hardware", keywords: ["screen handle", "screen door handle"] },
  { name: "Screen door wheels", price: 6, category: "Hardware", keywords: ["screen wheels", "door wheels", "roller"] },
  { name: "Storm door chain stop", price: 5, category: "Hardware", keywords: ["chain stop", "storm chain"] },
  { name: "Bifold closet door pin", price: 3, category: "Hardware", keywords: ["bifold pin", "closet pin"] },
  { name: "Bifold pin holder", price: 3, category: "Hardware", keywords: ["pin holder", "bifold bracket"] },
  { name: "Bifold track", price: 8, category: "Hardware", keywords: ["bifold track"] },
  { name: "Bifold repair kit", price: 6, category: "Hardware", keywords: ["bifold repair", "bifold kit"] },
  { name: "Brushed nickel cabinet knobs (10pk)", price: 18, category: "Hardware", keywords: ["cabinet knob", "brushed nickel knob"] },
  { name: "Brushed nickel cabinet handles (10pk)", price: 22, category: "Hardware", keywords: ["cabinet handle", "cabinet pull", "brushed nickel handle"] },
  { name: "Cabinet hinges (pair)", price: 5, category: "Hardware", keywords: ["cabinet hinge"] },
  { name: "Cabinet magnetic catch", price: 3, category: "Hardware", keywords: ["cabinet magnet", "magnetic catch"] },
  { name: "Power Grab adhesive", price: 7, category: "Hardware", keywords: ["power grab", "construction adhesive"] },
  { name: "Cove base (4ft)", price: 3, category: "Hardware", keywords: ["cove base", "baseboard"] },
  { name: "Cove base adhesive", price: 8, category: "Hardware", keywords: ["cove adhesive", "base adhesive"] },
  { name: "Nuts & bolts assortment", price: 12, category: "Hardware", keywords: ["nuts bolts", "assortment", "hardware kit"] },
  { name: "Drywall screws 1\" (1lb)", price: 6, category: "Hardware", keywords: ["drywall screw", "1 inch screw"] },
  { name: "Drywall screws 2\" (1lb)", price: 7, category: "Hardware", keywords: ["drywall screw", "2 inch screw"] },
  { name: "Drywall screws 3\" (1lb)", price: 8, category: "Hardware", keywords: ["drywall screw", "3 inch screw"] },

  // Blinds
  { name: "Vertical blinds 78\"x84\"", price: 45, category: "Hardware", keywords: ["vertical blind", "patio blind"] },
  { name: "Vertical blind slats (pack)", price: 15, category: "Hardware", keywords: ["blind slat", "vertical slat"] },
  { name: "Cordless blind 72\"x48\"", price: 28, category: "Hardware", keywords: ["72 blind", "72x48"] },
  { name: "Cordless blind 46\"x48\"", price: 22, category: "Hardware", keywords: ["46 blind", "46x48"] },
  { name: "Cordless blind 43\"x48\"", price: 20, category: "Hardware", keywords: ["43 blind", "43x48"] },
  { name: "Cordless blind 35\"x48\"", price: 18, category: "Hardware", keywords: ["35 blind", "35x48", "35 inch"] },
  { name: "Cordless blind 27\"x72\"", price: 16, category: "Hardware", keywords: ["27 blind", "27x72"] },

  // ═══════════════════════════════════════════
  // APPLIANCES / PARTS
  // ═══════════════════════════════════════════
  { name: "GE 8\" drip pan", price: 8, category: "Appliances", keywords: ["8 drip pan", "drip pan", "stove drip"] },
  { name: "GE 6\" drip pan", price: 6, category: "Appliances", keywords: ["6 drip pan"] },
  { name: "GE 8\" burner element", price: 18, category: "Appliances", keywords: ["8 burner", "burner element", "stove burner"] },
  { name: "GE 6\" burner element", price: 14, category: "Appliances", keywords: ["6 burner"] },
  { name: "Oven bake element", price: 22, category: "Appliances", keywords: ["bake element", "oven element", "lower element"] },
  { name: "Oven broil element", price: 20, category: "Appliances", keywords: ["broil element", "upper element"] },
  { name: "Oven control board", price: 85, category: "Appliances", keywords: ["control board", "oven board"] },
  { name: "Dishwasher timer", price: 45, category: "Appliances", keywords: ["dishwasher timer"] },
  { name: "Dishwasher soap dispenser", price: 15, category: "Appliances", keywords: ["soap dispenser", "detergent dispenser"] },
  { name: "Dishwasher drain pump", price: 35, category: "Appliances", keywords: ["drain pump", "dishwasher pump"] },
  { name: "Dishwasher door gasket", price: 18, category: "Appliances", keywords: ["dishwasher gasket", "door gasket", "door seal"] },
  { name: "Refrigerator door gasket", price: 45, category: "Appliances", keywords: ["fridge gasket", "refrigerator gasket", "fridge seal"] },
  { name: "Evaporator fan motor", price: 35, category: "Appliances", keywords: ["evaporator fan", "fridge fan", "fan motor"] },
  { name: "Range hood 30\" filter", price: 8, category: "Appliances", keywords: ["range hood filter", "hood filter", "grease filter"] },
  { name: "Universal stove knob", price: 6, category: "Appliances", keywords: ["stove knob", "range knob", "burner knob"] },
  { name: "Dishwasher rack adjuster clip kit", price: 12, category: "Appliances", keywords: ["rack adjuster", "dishwasher rack", "rack clip"] },

  // ═══════════════════════════════════════════
  // PAINT
  // ═══════════════════════════════════════════
  { name: "Interior paint 5-gal (semi-gloss)", price: 127, sku: "654396", category: "Paint", keywords: ["5 gallon", "5-gal", "interior paint", "semi gloss"] },
  { name: "Interior paint 1-gal", price: 28, sku: "654973", category: "Paint", keywords: ["1 gallon", "1-gal", "paint gallon"] },
  { name: "Kilz spray primer", price: 8, category: "Paint", keywords: ["kilz", "spray primer", "primer spray"] },
  { name: "White semi-gloss spray paint", price: 6, category: "Paint", keywords: ["spray paint", "white spray"] },
  { name: "Primer (gallon)", price: 16, category: "Paint", keywords: ["primer", "prime"] },
  { name: "Primer (quart)", price: 10, category: "Paint", keywords: ["primer qt", "primer quart"] },
  { name: "18\" roller cover", price: 8, category: "Paint", keywords: ["18 roller", "large roller", "dreadlock roller"] },
  { name: "9\" roller cover", price: 5, category: "Paint", keywords: ["9 roller", "roller cover"] },
  { name: "4\" mini roller", price: 4, category: "Paint", keywords: ["4 roller", "mini roller", "trim roller"] },
  { name: "3\" paint brush (angled)", price: 8, category: "Paint", keywords: ["3 brush", "paint brush", "angled brush"] },
  { name: "2\" cut-in brush", price: 6, category: "Paint", keywords: ["2 brush", "cut in", "cutting brush"] },
  { name: "4\" wall patch (2-pack)", price: 5, category: "Paint", keywords: ["wall patch", "drywall patch"] },
  { name: "Drywall joint compound (qt)", price: 8, category: "Paint", keywords: ["drywall mud", "joint compound", "mud"] },
  { name: "Drywall sheet (4x8)", price: 14, category: "Paint", keywords: ["drywall", "sheetrock", "drywall sheet"] },
  { name: "Drywall sanding sponge", price: 5, category: "Paint", keywords: ["sanding sponge", "drywall sponge"] },
  { name: "Painter's tape (60yd)", price: 6, category: "Paint", keywords: ["painter tape", "blue tape", "masking tape"] },
  { name: "Drop cloth (9x12)", price: 10, category: "Paint", keywords: ["drop cloth", "plastic sheeting"] },
  { name: "Spackle tub", price: 8, category: "Paint", keywords: ["spackle", "spackling"] },

  // ═══════════════════════════════════════════
  // FLOORING
  // ═══════════════════════════════════════════
  { name: "LVP flooring (per sqft)", price: 2, category: "Flooring", keywords: ["lvp", "vinyl plank", "laminate", "flooring"] },
  { name: "Underlayment (per sqft)", price: 0.30, category: "Flooring", keywords: ["underlayment", "underlay"] },
  { name: "Transition strip", price: 15, category: "Flooring", keywords: ["transition", "t-mold", "reducer"] },
  { name: "Cove base (4ft)", price: 3, category: "Flooring", keywords: ["cove base"] },
  { name: "Cove base adhesive", price: 8, category: "Flooring", keywords: ["cove adhesive"] },
  { name: "Carpet (per sq yd)", price: 28, category: "Flooring", keywords: ["carpet"] },
  { name: "Carpet pad (per sq yd)", price: 8, category: "Flooring", keywords: ["carpet pad"] },

  // ═══════════════════════════════════════════
  // JANITORIAL
  // ═══════════════════════════════════════════
  { name: "Paper towels (6-roll)", price: 10, category: "Janitorial", keywords: ["paper towel"] },
  { name: "Nitrile gloves (box)", price: 12, category: "Janitorial", keywords: ["gloves", "nitrile"] },
  { name: "Shop vac bags 1.5gal (3pk)", price: 8, category: "Janitorial", keywords: ["shop vac bag", "vacuum bag"] },
  { name: "55-gallon trash bags (20ct)", price: 15, category: "Janitorial", keywords: ["trash bag", "garbage bag"] },
  { name: "All-purpose cleaner", price: 5, category: "Janitorial", keywords: ["all purpose", "cleaner"] },
  { name: "Hand soap", price: 4, category: "Janitorial", keywords: ["hand soap"] },
  { name: "Scrubbing brush", price: 5, category: "Janitorial", keywords: ["scrub brush", "cleaning brush"] },
  { name: "Cloth rags (bag)", price: 10, category: "Janitorial", keywords: ["rags", "cloth rag"] },
  { name: "Dishwasher cleaner", price: 5, category: "Janitorial", keywords: ["dishwasher magic", "dishwasher clean"] },
  { name: "Disposal cleaner", price: 4, category: "Janitorial", keywords: ["disposal cleaner"] },

  // ═══════════════════════════════════════════
  // SAFETY
  // ═══════════════════════════════════════════
  { name: "Fire extinguisher (2.5lb ABC)", price: 20, sku: "1002763584", category: "Safety", keywords: ["fire extinguisher"] },
];

// Lookup function — find best matching material from database
export function findMaterial(text: string): MaterialItem | null {
  const s = text.toLowerCase();
  let best: MaterialItem | null = null;
  let bestScore = 0;

  for (const item of MATERIALS_DB) {
    let score = 0;
    for (const kw of item.keywords) {
      if (s.includes(kw)) {
        score += kw.length; // longer keyword matches = better match
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore > 3 ? best : null; // minimum match threshold
}

// Get all materials in a category
export function getMaterialsByCategory(category: string): MaterialItem[] {
  return MATERIALS_DB.filter((m) => m.category === category);
}

// Search materials
export function searchMaterials(query: string): MaterialItem[] {
  const q = query.toLowerCase();
  return MATERIALS_DB.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    m.keywords.some((kw) => kw.includes(q))
  );
}
