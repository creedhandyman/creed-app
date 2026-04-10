export interface Profile {
  id: string;
  email: string;
  password: string;
  name: string;
  role: "owner" | "manager" | "tech";
  rate: number;
  start_date: string;
  emp_num: string;
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
  status: "quoted" | "active" | "complete";
  created_by: string;
  created_at: string;
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
}

export interface Referral {
  id: string;
  name: string;
  source: string;
  status: "pending" | "contacted" | "converted";
  ref_date: string;
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
}

export interface Receipt {
  id: string;
  job_id: string;
  note: string;
  amount: number;
  receipt_date: string;
  photo_url: string;
}

export interface Material {
  n: string;
  c: number;
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
