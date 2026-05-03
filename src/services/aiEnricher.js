const Business = require("../models/Business");
const logger = require("../utils/logger");

const BATCH_SIZE = parseInt(process.env.AI_ENRICHMENT_BATCH_SIZE) || 10;

let anthropic = null;
function getClient() {
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require("@anthropic-ai/sdk");
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

async function enrichScanBusinesses(scanId, searchCategory) {
  const total = await Business.countDocuments({ scanId, aiEnriched: false, isValid: true, isDuplicate: false });
  if (total === 0) return;

  logger.info(`Enriching ${total} businesses for scan ${scanId}`);
  let processed = 0;

  while (processed < total) {
    const batch = await Business.find({
      scanId, aiEnriched: false, isValid: true, isDuplicate: false,
    }).limit(BATCH_SIZE);

    if (batch.length === 0) break;

    const enriched = getClient()
      ? await aiEnrichBatch(batch, searchCategory)
      : batch.map(b => heuristicEnrich(b, searchCategory));

    const bulkOps = enriched.map(e => ({
      updateOne: {
        filter: { _id: e._id },
        update: { $set: {
          description: e.description,
          estimatedSize: e.estimatedSize,
          estimatedAge: e.estimatedAge,
          correctedCategory: e.correctedCategory,
          confidenceScore: e.confidenceScore,
          aiEnriched: true,
        }},
      },
    }));
    await Business.bulkWrite(bulkOps);
    processed += batch.length;
  }

  logger.info(`Enrichment complete: ${processed} businesses`);
}

async function aiEnrichBatch(businesses, category) {
  try {
    const client = getClient();
    const list = businesses.map((b, i) => ({
      index: i, name: b.name, address: b.address || "Unknown",
      category, types: (b.types || []).join(", "),
      cuisine: b.cuisine || "", brand: b.brand || "",
      website: b.website || "", phone: b.phone || "",
    }));

    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: `Enrich these Indian businesses. For each, provide:
1. "description": 1 sentence, max 100 chars
2. "estimatedSize": "small"|"medium"|"large" (based on brand, type)
3. "estimatedAge": "1-2 years"|"5+ years"|"10+ years"|"Unknown"
4. "correctedCategory": fix if miscategorized, else null
5. "confidenceScore": 0.0-1.0 realness score

Businesses: ${JSON.stringify(list)}

Respond ONLY with a JSON array. No markdown.` }],
    });

    const text = msg.content[0]?.text || "[]";
    const parsed = JSON.parse(text.replace(/```json\n?|```\n?/g, "").trim());

    return businesses.map((biz, i) => {
      const e = parsed.find(p => p.index === i) || {};
      const obj = biz.toObject ? biz.toObject() : biz;
      return { ...obj,
        description: e.description || heuristicDescription(biz, category),
        estimatedSize: e.estimatedSize || estimateSize(biz),
        estimatedAge: e.estimatedAge || "Unknown",
        correctedCategory: e.correctedCategory || null,
        confidenceScore: e.confidenceScore ?? estimateConfidence(biz),
      };
    });
  } catch (err) {
    logger.error("AI enrichment failed, using heuristics:", err.message);
    return businesses.map(b => heuristicEnrich(b, category));
  }
}

function heuristicEnrich(business, category) {
  const biz = business.toObject ? business.toObject() : business;
  return { ...biz,
    description: heuristicDescription(biz, category),
    estimatedSize: estimateSize(biz),
    estimatedAge: "Unknown",
    correctedCategory: null,
    confidenceScore: estimateConfidence(biz),
  };
}

function heuristicDescription(biz, category) {
  const parts = [category.replace(/_/g, " ")];
  if (biz.cuisine) parts.push(`serving ${biz.cuisine.split(";")[0]}`);
  if (biz.brand) parts.push(`(${biz.brand})`);
  const addr = biz.address ? biz.address.split(",")[0] : "";
  if (addr) parts.push(`in ${addr}`);
  return parts.join(" ").slice(0, 100);
}

function estimateSize(biz) {

  if (biz.brand) return "medium";
  const tags = biz.osmTags instanceof Map ? Object.fromEntries(biz.osmTags) : (biz.osmTags || {});
  if (tags.capacity && parseInt(tags.capacity) > 100) return "large";
  if (tags.building === "commercial" || tags.building === "retail") return "medium";
  return "small";
}

function estimateConfidence(biz) {
  let score = 0.5;
  if (biz.name && biz.name.length > 2) score += 0.15;
  if (biz.address) score += 0.1;
  if (biz.phone || biz.website) score += 0.1;
  if (biz.openingHours) score += 0.1;
  if (biz.brand) score += 0.05;
  return Math.min(1, Math.round(score * 100) / 100);
}

module.exports = { enrichScanBusinesses };
