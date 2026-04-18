import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Server-side payment verification: the success page passes ?session_id=<stripe session>
// and we confirm with Stripe that the session is actually paid before flipping the job
// status. Previously the success page flipped status client-side from the URL's job_id,
// which meant any visitor to /payment/success?job_id=X could mark X as paid without paying.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, jobId } = await req.json();
    if (!sessionId || !jobId) {
      return NextResponse.json({ error: "Missing sessionId or jobId" }, { status: 400 });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not completed", status: session.payment_status },
        { status: 402 }
      );
    }

    // Cross-check the session's stored job_id matches what the client claims,
    // so a valid session can't be used to mark a different job as paid.
    const sessionJobId = session.metadata?.job_id;
    if (sessionJobId && sessionJobId !== jobId) {
      return NextResponse.json({ error: "Job mismatch for session" }, { status: 400 });
    }

    // Use service role so the update bypasses RLS (the customer isn't logged in).
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await supabase
      .from("jobs")
      .update({ status: "paid" })
      .eq("id", jobId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("verify-payment error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
