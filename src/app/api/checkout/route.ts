import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const PLATFORM_FEE_PERCENT = 2; // 2% platform fee

export async function POST(req: NextRequest) {
  try {
    const { jobId, property, client, amount, orgName, stripeAccountId } = await req.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const origin = req.headers.get("origin") || "http://localhost:3000";
    const amountCents = Math.round(amount * 100);

    // Build checkout session options
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Property Repairs — ${property}`,
              description: `${orgName || "Handyman Service"} · Invoice for ${client || "Client"}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/payment/success?job_id=${jobId}`,
      cancel_url: `${origin}/payment/cancel`,
      metadata: {
        job_id: jobId,
        property,
        client,
      },
    };

    // If connected account, route payment there with platform fee
    if (stripeAccountId) {
      const feeAmount = Math.round(amountCents * (PLATFORM_FEE_PERCENT / 100));
      sessionParams.payment_intent_data = {
        application_fee_amount: feeAmount,
        transfer_data: {
          destination: stripeAccountId,
        },
      };
    }

    const session = await getStripe().checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
