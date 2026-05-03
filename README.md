# GeoGrid India v3 — Polygon Boundaries + Stripe Payments

Production-grade lead extraction for India with **real city polygon boundaries**, Stripe payments, and zero paid APIs.

## What's Fixed in v3

| Issue | Before | After |
|-------|--------|-------|
| City boundaries | Square bounding box | **Real polygon** from OSM admin boundaries |
| Grid clipping | All tiles processed | Only tiles **inside polygon** processed |
| 0-result tiles | Got subdivided wastefully | Marked **EMPTY**, never subdivided |
| Map zoom-out | Multiple earths repeating | `maxBounds` + `noWrap` — single map |
| Upgrade buttons | Non-functional | **Stripe Checkout** or dev activation |
| Admin login | Manual DB edit | `npm run seed` → admin@geogrid.com / Admin@123 |
| Map rendering | Sometimes blank | `invalidateSize()` + proper CSS |

## Quick Start

```bash
cd geogrid-india
npm install
cp .env.example .env
# Edit .env: set MONGODB_URI, REDIS_URL, JWT_SECRET
mkdir -p logs
npm run seed
npm run dev
```

Open **http://localhost:5000** → Sign in → Start scanning.

## Seeded Accounts

| Email | Password | Role |
|-------|----------|------|
| admin@geogrid.com | Admin@123 | admin (unlimited) |
| user@geogrid.com | User@123 | user (3 free scans) |

## Stripe Testing

Without Stripe keys: upgrade buttons activate plans instantly in dev mode.

With Stripe test mode: set `STRIPE_SECRET_KEY` in .env, use test card `4242 4242 4242 4242`.

Local webhook testing: `stripe listen --forward-to localhost:5000/api/payments/webhook`

## Cost: $0

All APIs free. Nominatim + Overpass (OSM), MongoDB Atlas free tier, Redis Cloud free tier.
