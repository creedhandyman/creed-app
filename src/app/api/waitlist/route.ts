import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Public waitlist endpoint. Called from /pricing when a visitor clicks a
 * tier CTA. Inserts a row in `waitlist` so Bernard has a launch-list of
 * interested orgs before real Stripe billing is wired up.
 *
 * Unauthenticated; uses service-role key. We don't enforce uniqueness on
 * email — a person resubmitting with a different plan choice is signal,
 * not spam.
 */

interface Body {
  email: string;
  company_name?: string;
  interested_plan?: "solo" | "crew" | "pro";
  interested_pm?: boolean;
  source?: string;
}

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const email = trim(body.email);
    const company = trim(body.company_name);
    const plan = trim(body.interested_plan);
    const pm = body.interested_pm === true;
    const source = trim(body.source) || "pricing_page";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
    }
    if (plan && !["solo", "crew", "pro"].includes(plan)) {
      return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error } = await supabase.from("waitlist").insert({
      email,
      company_name: company || null,
      interested_plan: plan || null,
      interested_pm: pm,
      source,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("waitlist error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
