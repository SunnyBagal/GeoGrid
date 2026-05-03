# GeoGrid - Google Maps Lead Generation Platform

## What is this?

GeoGrid is a lead generation system that solves the "120 result limit" problem on Google Maps.  When you search for businesses on Google Maps [like "restaurants in Mumbai"], you only get 120 results max - even though there might be 50,000+ restaurants actually there.

We built a system that gets around this limit by breaking the search area into hundreds of small tiles, scraping each tile separately [each stays under 120], then merging everything together with smart deduplication.

**Result**: Instead of 120 businesses, you get ALL of them  [typically 10x-100x more results]

This is a 4-month internship project [January-April 2026] built by a team of 4 B.Tech students.

---

## The Problem  (with real example)

**Scenario**: You want to generate leads for all restaurants in Vashi, Navi Mumbai

**Google Maps search:**
- Search: "restaurants in Vashi"  
- Results shown: 120 businesses
- Message: "You've reached the end of the list"

**Reality:**
- Actual restaurants in Vashi: ~500+
- You're missing: 380 businesses [76% of the market]

**Business Impact:**
- If you're doing B2B sales [selling POS systems] → missing 76% of potential customers
- If you're doing market research → data is incomplete
- If you're doing competitive analysis → you dont know who your real competitors are

---

## Our Solution

We use a **grid subdivision algorithm** [similar to what Scrap.io and Outscraper do]:

```
Step 1: Convert "Vashi" to geographic coordinates
  → Bounding box: [19.05, 73.00, 19.08, 73.03]

Step 2: Break into small tiles [grid]
  → Generate ~12 tiles [each 1km x 1km]
  
Step 3: Scrape each tile separately
  → Tile 1: google.com/maps/search/restaurant/@19.055,73.005,16z  
  → Tile 2: google.com/maps/search/restaurant/@19.055,73.015,16z
  → ... 12 tiles total
  → Each tile returns 40-80 results [stays under 120 limit]
  
Step 4: Merge results
  → Total: ~630 businesses from all tiles
  
Step 5: Deduplicate
  → Remove ~150 duplicates [businesses on tile borders appear multiple times]
  → Final: 480 unique restaurants

Step 6: Enrich [optional]
  → Visit each website
  → Extract emails, social media links
  → Detect tech stack
```

**Output:** CSV file with 480 restaurants [vs 120 from normal search] + emails/social links

**Time taken:** 15-20 minutes

---

## Key Features

- ✅ **Overcomes 120-result limit** - get ALL businesses in an area [not just first 120]
- ✅ **Geographic hierarchy** - search by city, district, state, or country using admin codes
- ✅ **Smart deduplication** - 3-tier matching [place ID, coordinates, fuzzy name matching]
- ✅ **Website enrichment** - extracts emails, social links, tech stack from business websites
- ✅ **Export options** - download as CSV or XLSX
- ✅ **Real-time progress** - WebSocket updates showing tiles completed, results found
- ✅ **Self-hosted** - runs on your own server [no per-result costs]

---

## Tech Stack

**Backend:**
- Python 3.11+
- FastAPI [async web framework]
- PostgreSQL + PostGIS [geospatial database]
- Redis + Celery [job queue]
- Playwright [browser automation]

**Frontend:**
- React 18
- Tailwind CSS
- Vite

**Infrastructure:**
- Docker + Docker Compose
- Residential proxies [for scraping]
- 2captcha [CAPTCHA solving]

**Data Sources:**
- GeoNames database [11M+ places, free]
- Google Maps [scraped via Playwright]
- Business websites [for enrichment]

---

## Documentation

We have three detailed documents covering different aspects:

### 📄 [Project Overview](./docs/PROJECT_OVERVIEW.md)
High-level explanation of what we're building, why it matters, real examples of how it works, use cases, competitive analysis. **Start here** if you're new to the project.

### 🏗 [System Architecture](./docs/SYSTEM_ARCHITECTURE.md)  
Complete system design - all components, how they interact, data flow, deployment setup. This is the "forest view" [not individual trees]. Good for understanding the overall structure.

### ⚙️ [Technical Deep Dive](./docs/TECHNICAL_DEEPDIVE.md)
Implementation details for each component - database schemas with sample data, API endpoints, core algorithms, worker implementation. This is where you go when actually building something.

---

## Quick Start [for development]

**Prerequisites:**
- Docker + Docker Compose
- 8GB RAM, 4 CPU cores recommended
- Residential proxy subscription [optional for MVP testing]

**Setup:**

```bash
# Clone repo
git clone https://github.com/your-org/geogrid.git
cd geogrid

# Set environment variables
cp .env.example .env
# Edit .env with your database password, proxy details, etc

# Start all services
docker-compose up -d

# Initialize database
docker-compose exec api alembic upgrade head

# Load GeoNames data [India only for MVP]
docker-compose exec api python scripts/load_geonames.py --country=IN

# Load categories
docker-compose exec api python scripts/load_categories.py

# Check logs
docker-compose logs -f worker
```

**Access:**
- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs
- Database: localhost:5432

---

## Project Timeline

**Month 1 [January]:** Research + Core Algorithm
- Week 1: Research [grid subdivision, scraping, deduplication]
- Week 2-3: Build grid generator + basic scraper
- Week 4: Database setup + deduplication logic

**Month 2 [February]:** Scale + Workers  
- Week 5-6: Multi-worker system [parallel scraping]
- Week 7-8: City-scale testing + optimization

**Month 3 [March]:** Enrichment + Export
- Week 9-10: Website enrichment [emails, social links]
- Week 11-12: Export functionality + caching

**Month 4 [April]:** Frontend + Demo
- Week 13-14: React dashboard
- Week 15-16: Polish + final demo

**Target demo date:** End of April 2026

---

## Team

**Sunny** [Tech Lead]  
Grid algorithm, scraping infrastructure, worker management

**Sakshi** [Full-stack Developer]  
Scraper implementation, API development, testing

**Tushar** [Data Engineer]  
Deduplication logic, database design, data quality

**Sneha** [Project Coordinator]  
Frontend dashboard, documentation, team coordination

**Michael** [CTO / Mentor]  
Architecture, technical guidance, project oversight

---

## Sunny's Implementation Notes — GeoGrid India v3

Production-grade lead extraction for India with **real city polygon boundaries**, Stripe payments, and zero paid APIs.

### What's Fixed in v3

| Issue | Before | After |
|-------|--------|-------|
| City boundaries | Square bounding box | **Real polygon** from OSM admin boundaries |
| Grid clipping | All tiles processed | Only tiles **inside polygon** processed |
| 0-result tiles | Got subdivided wastefully | Marked **EMPTY**, never subdivided |
| Map zoom-out | Multiple earths repeating | `maxBounds` + `noWrap` — single map |
| Upgrade buttons | Non-functional | **Stripe Checkout** or dev activation |
| Admin login | Manual DB edit | `npm run seed` → admin@geogrid.com / Admin@123 |
| Map rendering | Sometimes blank | `invalidateSize()` + proper CSS |

### Quick Start (this implementation)

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

### Seeded Accounts

| Email | Password | Role |
|-------|----------|------|
| admin@geogrid.com | Admin@123 | admin (unlimited) |
| user@geogrid.com | User@123 | user (3 free scans) |

### Stripe Testing

Without Stripe keys: upgrade buttons activate plans instantly in dev mode.

With Stripe test mode: set `STRIPE_SECRET_KEY` in .env, use test card `4242 4242 4242 4242`.

Local webhook testing: `stripe listen --forward-to localhost:5000/api/payments/webhook`

### Cost: $0

All APIs free. Nominatim + Overpass (OSM), MongoDB Atlas free tier, Redis Cloud free tier.

---

**Being built with ❤️ by the InteleCorp internship team**

**January 2026**
