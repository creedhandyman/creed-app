export interface Organization {
  id: string;
  name: string;
  phone: string;
  email: string;
  license_num: string;
  address: string;
  logo_url: string;
  default_rate: number;
  markup_pct: number;
  tax_pct: number;
  trade_rates?: string; // JSON: { "Plumbing": 65, "Electrical": 70, ... }
  licensed_trades?: string; // JSON array: ["Electrical","Plumbing","HVAC","Roofing"]
  quest_config?: string;
  stripe_account_id?: string;
  stripe_connected?: boolean;
  trial_start?: string;
  subscription_status?: string; // trial | active | past_due | canceled
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  plan?: string; // solo | team
  billing_enforced?: boolean;
  site_content?: string;
  site_published?: boolean;
  site_slug?: string;
  trip_fee?: number;
  gallery_photos?: string; // JSON: [{url, caption}]
  site_theme?: string; // JSON: {primaryColor, showGallery, showReviews, showAbout, showServices, showWhyUs}
  created_at?: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: "owner" | "manager" | "tech" | "apprentice";
  rate: number;
  photo_url?: string;
  start_date: string;
  emp_num: string;
  org_id: string;
  created_at?: string;
}

export interface Client {
  id: string;
  org_id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  created_at?: string;
}

export interface Job {
  id: string;
  property: string;
  client: string;
  job_date: string;
  rooms: string;
  total: number;
  total_labor: number;
  total_mat: number;
  total_hrs: number;
  status: "quoted" | "accepted" | "scheduled" | "active" | "complete" | "invoiced" | "paid" | "inspection";
  created_by: string;
  created_at: string;
  trade: string;
  callback: boolean;
  is_upsell: boolean;
  requested_tech: string;
  client_signature?: string;
  signature_date?: string;
  org_id?: string;
  is_recurring?: boolean;
  recurrence_rule?: string; // weekly | biweekly | monthly | quarterly
  next_due?: string;
  parent_job_id?: string;
  // Archive flag for jobs the client never accepted (or never moved on).
  // Status field is preserved (typically "quoted") so a restore brings the
  // job back to its original state without losing context.
  archived?: boolean;
  archived_at?: string;
  // Set when the user has triggered a review-request prompt for this job
  // (via SMS / email / copy). Stops the auto-prompt from re-firing every
  // time the row re-renders after completion.
  review_requested_at?: string;
}

export interface TimeEntry {
  id: string;
  job: string;
  entry_date: string;
  hours: number;
  amount: number;
  user_id: string;
  user_name: string;
  start_time?: string;
  end_time?: string;
}

export interface Review {
  id: string;
  client_name: string;
  review_text: string;
  rating: number;
  created_at?: string;
  employee_names?: string;
}

export interface Referral {
  id: string;
  name: string;
  source: string;
  status: "pending" | "contacted" | "converted";
  ref_date: string;
  created_at?: string;
}

export interface ScheduleEntry {
  id: string;
  sched_date: string;
  job: string;
  note: string;
  created_at?: string;
}

export interface PayHistory {
  id: string;
  user_id: string;
  name: string;
  pay_date: string;
  hours: number;
  amount: number;
  entries: number;
  created_at?: string;
  details?: string;
}

export interface Receipt {
  id: string;
  job_id: string;
  note: string;
  amount: number;
  receipt_date: string;
  photo_url: string;
}

export interface QuestPayout {
  id: string;
  org_id: string;
  user_id: string;
  quest_key: string;
  bonus_amount: number;
  paid_date: string;
  created_at?: string;
}

export interface Material {
  n: string;
  c: number;          // line total (= qty × unitPrice when both are set)
  qty?: number;       // quantity, defaults to 1 if absent
  unitPrice?: number; // per-unit price, defaults to c (lump sum) if absent
}

/** Inspection findings (Inspector + Voice Walk both produce these). */
export interface InspectionItem {
  name: string;       // e.g. "Sink/Faucet"
  condition: string;  // "S" | "F" | "P" | "D"
  notes: string;
  photos: string[];   // public URLs
}

export interface InspectionRoom {
  name: string;
  sqft: number;
  items: InspectionItem[];
}

export interface RoomItem {
  id: string;
  detail: string;
  condition: string;
  comment: string;
  laborHrs: number;
  materials: Material[];
}

export interface Room {
  name: string;
  items: RoomItem[];
}
