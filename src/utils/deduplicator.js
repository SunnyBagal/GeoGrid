const stringSimilarity = require("string-similarity");
const logger = require("./logger");

const PROXIMITY_THRESHOLD_DEG = 0.0005;
const NAME_SIMILARITY_THRESHOLD = 0.75;

function deduplicateBatch(businesses, existingBusinesses = []) {
  const unique = [];
  const duplicates = [];
  const seenIds = new Set(existingBusinesses.map(b => b.osmId || b.placeId));

  const afterIdDedup = [];
  for (const biz of businesses) {
    const id = biz.osmId || biz.placeId;
    if (seenIds.has(id)) {
      duplicates.push({ ...biz, duplicateReason: "exact_id" });
      continue;
    }
    seenIds.add(id);
    afterIdDedup.push(biz);
  }

  const pool = [...existingBusinesses, ...unique];
  for (const biz of afterIdDedup) {
    const dupe = findFuzzyDuplicate(biz, pool);
    if (dupe) {
      duplicates.push({ ...biz, duplicateReason: "fuzzy_match", duplicateOf: dupe.osmId || dupe.placeId });
      continue;
    }
    unique.push(biz);
    pool.push(biz);
  }

  if (duplicates.length > 0) {
    logger.debug(`Dedup: ${businesses.length} → ${unique.length} unique, ${duplicates.length} dupes`);
  }
  return { unique, duplicates };
}

function findFuzzyDuplicate(biz, pool) {
  if (!pool.length) return null;
  const norm = normalizeName(biz.name);
  for (const existing of pool) {
    const latDiff = Math.abs((biz.latitude || 0) - (existing.latitude || 0));
    const lngDiff = Math.abs((biz.longitude || 0) - (existing.longitude || 0));
    if (latDiff > PROXIMITY_THRESHOLD_DEG || lngDiff > PROXIMITY_THRESHOLD_DEG) continue;
    const sim = stringSimilarity.compareTwoStrings(norm, normalizeName(existing.name));
    if (sim >= NAME_SIMILARITY_THRESHOLD) return existing;
  }
  return null;
}

function normalizeName(name) {
  return (name || "").toLowerCase()
    .replace(/[''`"]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(the|a|an|and|of|in|at|by|for|pvt|ltd|llp|inc|private|limited)\b/g, "")
    .replace(/\s+/g, " ").trim();
}

function validateBusiness(biz) {
  const flags = [];
  if (!biz.name || biz.name.trim().length < 2) flags.push("missing_name");
  if (!biz.address && !biz.latitude) flags.push("missing_location");
  if (/^\d+$/.test((biz.name || "").trim())) flags.push("spam_numeric_name");
  if ((biz.name || "").length > 200) flags.push("spam_long_name");
  return { isValid: flags.length === 0, flags };
}

module.exports = { deduplicateBatch, validateBusiness, normalizeName };
