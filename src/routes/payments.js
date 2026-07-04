const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");
const logger = require("../utils/logger");

const PLANS = {
  premium: {
    name: "Premium",
    priceInr: 99900,
    scanLimit: 50,
    stripePriceLabel: "₹999/month",
  },
  pro: {
    name: "Pro",
    priceInr: 249900,
    scanLimit: 500,
    stripePriceLabel: "₹2,499/month",
  },
  enterprise: {
    name: "Enterprise",
    priceInr: 999900,
    scanLimit: 999999,
    stripePriceLabel: "₹9,999/month",
  },
};

router.post("/checkout", authenticate, async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = PLANS[planId];

    if (!plan) {
      return res.status(400).json({ error: "Invalid plan. Choose: premium, pro, enterprise" });
    }

    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith("sk_test_XX")) {
      return res.status(503).json({
        error: "Stripe not configured. Set STRIPE_SECRET_KEY in .env",
        testMode: true,
      });
    }

    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5050";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: req.user.email,
      metadata: {
        userId: req.user._id.toString(),
        planId,
      },
      line_items: [{
        price_data: {
          currency: "inr",
          product_data: {
            name: `GeoGrid ${plan.name} Plan`,
            description: `${plan.scanLimit} scans per month`,
          },
          unit_amount: plan.priceInr,
        },
        quantity: 1,
      }],
      success_url: `${clientUrl}/?payment=success&plan=${planId}`,
      cancel_url: `${clientUrl}/?payment=cancelled`,
    });

    logger.info(`Checkout session created for ${req.user.email}: ${planId}`);
    res.json({ url: session.url, sessionId: session.id });

  } catch (error) {
    logger.error("Checkout error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(200).json({ received: true, note: "Stripe not configured" });
  }

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { userId, planId } = session.metadata;

      if (userId && planId && PLANS[planId]) {
        const plan = PLANS[planId];
        await User.findByIdAndUpdate(userId, {
          plan: planId,
          scanLimit: plan.scanLimit,
          scansUsed: 0,
        });

        logger.info(`PAYMENT SUCCESS: User ${userId} upgraded to ${planId}`);
      }
    }

    res.json({ received: true });

  } catch (error) {
    logger.error("Webhook error:", error.message);
    res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }
});

router.post("/activate-test", authenticate, async (req, res) => {
  if (process.env.ENABLE_TEST_ACTIVATION !== "true" || process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Test activation disabled. Use real Stripe checkout." });
  }

  const { planId } = req.body;
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: "Invalid plan" });

  await User.findByIdAndUpdate(req.user._id, {
    plan: planId,
    scanLimit: plan.scanLimit,
    scansUsed: 0,
  });

  const updated = await User.findById(req.user._id);
  logger.info(`TEST activation: ${req.user.email} → ${planId}`);

  res.json({
    message: `Plan activated: ${plan.name}`,
    user: {
      id: updated._id, name: updated.name, email: updated.email,
      role: updated.role, plan: updated.plan,
      scansUsed: updated.scansUsed, scanLimit: updated.scanLimit,
    },
  });
});

router.get("/plans", (req, res) => {
  const plans = Object.entries(PLANS).map(([id, p]) => ({
    id, name: p.name, price: p.stripePriceLabel, scans: p.scanLimit,
  }));
  res.json({ plans });
});

module.exports = router;
