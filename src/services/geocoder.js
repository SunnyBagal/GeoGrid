const axios = require("axios");
const { cache } = require("../config/redis");
const logger = require("../utils/logger");
const { extractRings, simplifyRing, polygonBbox, ringsBbox } = require("../utils/geometry");

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
// The public Overpass servers 504 under load routinely; the boundary lookup
// is a one-shot query per scan, so walk through mirrors until one answers.
const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || "GeoGridIndia/3.0";

let lastCall = 0;
async function throttle() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

const INDIA = { south: 6.5, north: 37.0, west: 68.0, east: 97.5 };

async function geocodeLocation(query) {
  const cacheKey = `geo4:${query.toLowerCase().trim()}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  await throttle();
  logger.info(`Geocoding: "${query}"`);

  const searchQuery = /india/i.test(query) ? query : `${query}, India`;

  const response = await axios.get(`${NOMINATIM_BASE}/search`, {
    params: {
      q: searchQuery,
      format: "json",
      addressdetails: 1,
      limit: 10,
      countrycodes: "in",
      polygon_geojson: 1,
      polygon_threshold: 0.002,
      dedupe: 0,
    },
    headers: { "User-Agent": USER_AGENT },
    timeout: 15000,
  });

  if (!response.data?.length) {
    throw new Error(`No results found for "${query}" in India.`);
  }

  const result = pickBestResult(response.data);
  const { lat, lon, boundingbox, display_name, type, osm_type, osm_id } = result;

  let rings = extractRings(result.geojson);

  // Place nodes (e.g. "Mumbai") come back as Points with no boundary geometry,
  // and OSM may not even have a single relation for the whole city (Greater
  // Mumbai = Mumbai City District + Mumbai Suburban District). Resolve the
  // admin boundary relations by name and merge their polygons.
  if (!rings) {
    try {
      rings = await resolveBoundaryByName(result);
    } catch (err) {
      logger.warn(`Boundary fallback failed for "${query}": ${err.message}`);
    }
  }

  let bbox;
  let polygons = null;
  let polygon = null;

  if (rings) {
    polygons = rings.map(r => (r.length > 200 ? simplifyRing(r, 0.0015) : r));
    polygon = polygons.reduce((a, b) => (ringBboxArea(b) > ringBboxArea(a) ? b : a));

    bbox = ringsBbox(polygons);
    const latPad = (bbox.north - bbox.south) * 0.02;
    const lngPad = (bbox.east - bbox.west) * 0.02;
    bbox.south -= latPad;
    bbox.north += latPad;
    bbox.west -= lngPad;
    bbox.east += lngPad;

    const totalVerts = polygons.reduce((a, r) => a + r.length, 0);
    logger.info(`Boundary resolved: ${polygons.length} ring(s), ${totalVerts} vertices`);
  } else {
    logger.warn(`No polygon for "${query}" — using expanded bounding box`);
    const raw = {
      south: parseFloat(boundingbox[0]),
      north: parseFloat(boundingbox[1]),
      west: parseFloat(boundingbox[2]),
      east: parseFloat(boundingbox[3]),
    };
    const factor = getExpansionFactor(type, raw);
    bbox = expandBbox(raw, factor);
    bbox = ensureMinSize(bbox, 0.008);
  }

  bbox = clamp(bbox);

  const output = {
    bbox,
    center: { lat: parseFloat(lat), lng: parseFloat(lon) },
    resolvedName: display_name,
    osmType: osm_type,
    osmId: osm_id,
    polygon,
    polygons,
    hasPolygon: !!polygons,
  };

  // A polygon-less result may just mean the boundary lookup failed
  // transiently — don't poison the cache with it for a whole day.
  await cache.set(cacheKey, output, output.hasPolygon ? 86400 : 600);
  logger.info(`Geocoded: "${display_name}" [rings: ${polygons ? polygons.length : 0}]`);
  return output;
}

// Rank: administrative boundaries with real polygons first, then places with
// polygons, then plain place results by settlement size. The old version
// matched `class === "boundary"` on the first priority pass, which defeated
// the whole ranking.
function pickBestResult(results) {
  const PLACE_RANK = {
    city: 30, town: 28, municipality: 26, suburb: 24, village: 22,
    neighbourhood: 20, residential: 16, postcode: 14, locality: 12,
  };

  const score = r => {
    let s = 0;
    const hasPoly = r.geojson && (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon");
    const isBoundary = r.class === "boundary" && r.type === "administrative";
    const isPlace = r.class === "place";

    if (hasPoly && (isBoundary || isPlace)) s += 100;
    else if (hasPoly) s += 5;

    if (isBoundary) s += 40;
    if (isPlace) s += PLACE_RANK[r.type] ?? 8;
    s += Math.min((r.importance || 0) * 10, 9);
    return s;
  };

  return results.slice().sort((a, b) => score(b) - score(a))[0];
}

// Find administrative boundary relations whose name starts with the resolved
// place name, near the geocoded point; then pull their (server-simplified)
// polygons via Nominatim's lookup API. Picks the lowest admin_level group so
// "Mumbai" matches its two districts, not the nine "Mumbai Zone N" wards.
async function resolveBoundaryByName(result) {
  const name = (result.display_name || "").split(",")[0].trim();
  if (name.length < 2) return null;

  const bb = result.boundingbox.map(parseFloat); // [s, n, w, e]
  const latPad = Math.max((bb[1] - bb[0]) * 0.5, 0.05);
  const lngPad = Math.max((bb[3] - bb[2]) * 0.5, 0.05);
  const s = bb[0] - latPad, n = bb[1] + latPad, w = bb[2] - lngPad, e = bb[3] + lngPad;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Case-sensitive prefix regex: display_name is already properly cased, and
  // case-insensitive regex forces a full scan on the Overpass side.
  const q = `[out:json][timeout:25];
relation["boundary"="administrative"]["admin_level"~"^[3-9]$"]["name"~"^${escaped}"](${s},${w},${n},${e});
out tags;`;

  let resp = null;
  let lastErr = null;
  const attempts = [...OVERPASS_ENDPOINTS, ...OVERPASS_ENDPOINTS];
  for (const endpoint of attempts) {
    await throttle();
    try {
      resp = await axios.post(endpoint, `data=${encodeURIComponent(q)}`, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": USER_AGENT,
        },
        timeout: 30000,
      });
      break;
    } catch (err) {
      lastErr = err;
      logger.warn(`Boundary lookup via ${endpoint} failed (${err.message}) — trying next mirror`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (!resp) throw lastErr;

  const candidates = (resp.data?.elements || [])
    .filter(el => el.tags?.admin_level && !isNaN(parseInt(el.tags.admin_level)));
  if (!candidates.length) return null;

  const minLevel = Math.min(...candidates.map(el => parseInt(el.tags.admin_level)));
  const picked = candidates
    .filter(el => parseInt(el.tags.admin_level) === minLevel)
    .slice(0, 6);

  logger.info(
    `Boundary fallback for "${name}": ${picked.length} relation(s) at admin_level ${minLevel} ` +
    `(${picked.map(el => el.tags.name).join(", ")})`
  );

  await throttle();
  const lookup = await axios.get(`${NOMINATIM_BASE}/lookup`, {
    params: {
      osm_ids: picked.map(el => `R${el.id}`).join(","),
      format: "json",
      polygon_geojson: 1,
      polygon_threshold: 0.002,
    },
    headers: { "User-Agent": USER_AGENT },
    timeout: 15000,
  });

  const rings = [];
  for (const item of lookup.data || []) {
    const r = extractRings(item.geojson);
    if (r) rings.push(...r);
  }
  return rings.length ? rings : null;
}

function ringBboxArea(ring) {
  const bb = polygonBbox(ring);
  return (bb.north - bb.south) * (bb.east - bb.west);
}

function getExpansionFactor(type, bbox) {
  const area = (bbox.north - bbox.south) * (bbox.east - bbox.west);
  const map = { city: 0.08, town: 0.1, suburb: 0.15, village: 0.2, neighbourhood: 0.2, postcode: 0.25, administrative: 0.08 };
  let f = map[type] || 0.12;
  if (area < 0.0001) f = Math.max(f, 0.3);
  else if (area > 0.1) f = Math.min(f, 0.05);
  return f;
}

function expandBbox(b, f) {
  const latE = (b.north - b.south) * f, lngE = (b.east - b.west) * f;
  return { south: b.south - latE, north: b.north + latE, west: b.west - lngE, east: b.east + lngE };
}

function ensureMinSize(b, m) {
  if (b.north - b.south < m) { const c = (b.north + b.south) / 2; b.south = c - m / 2; b.north = c + m / 2; }
  if (b.east - b.west < m) { const c = (b.east + b.west) / 2; b.west = c - m / 2; b.east = c + m / 2; }
  return b;
}

function clamp(b) {
  return { south: Math.max(b.south, INDIA.south), north: Math.min(b.north, INDIA.north), west: Math.max(b.west, INDIA.west), east: Math.min(b.east, INDIA.east) };
}

module.exports = { geocodeLocation };
