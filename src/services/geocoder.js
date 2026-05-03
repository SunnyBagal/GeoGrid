const axios = require("axios");
const { cache } = require("../config/redis");
const logger = require("../utils/logger");
const { extractOuterRing, simplifyRing, polygonBbox } = require("../utils/geometry");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || "GeoGridIndia/3.0";

let lastCall = 0;
async function throttle() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

const INDIA = { south: 6.5, north: 37.0, west: 68.0, east: 97.5 };

async function geocodeLocation(query) {
  const cacheKey = `geo3:${query.toLowerCase().trim()}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  await throttle();
  logger.info(`Geocoding: "${query}"`);

  const searchQuery = /india/i.test(query) ? query : `${query}, India`;

  const response = await axios.get(NOMINATIM_URL, {
    params: {
      q: searchQuery,
      format: "json",
      addressdetails: 1,
      limit: 5,
      countrycodes: "in",
      polygon_geojson: 1,
      polygon_threshold: 0.002,
    },
    headers: { "User-Agent": USER_AGENT },
    timeout: 15000,
  });

  if (!response.data?.length) {
    throw new Error(`No results found for "${query}" in India.`);
  }

  const result = pickBestResult(response.data);
  const { lat, lon, boundingbox, display_name, type, osm_type, osm_id, geojson } = result;

  let polygon = null;
  let polygonSimplified = null;
  let bbox;

  if (geojson && (geojson.type === "Polygon" || geojson.type === "MultiPolygon")) {
    const outerRing = extractOuterRing(geojson);

    if (outerRing && outerRing.length >= 4) {
      polygon = outerRing;

      polygonSimplified = outerRing.length > 200
        ? simplifyRing(outerRing, 0.0015)
        : outerRing;

      bbox = polygonBbox(outerRing);

      const latPad = (bbox.north - bbox.south) * 0.02;
      const lngPad = (bbox.east - bbox.west) * 0.02;
      bbox.south -= latPad;
      bbox.north += latPad;
      bbox.west -= lngPad;
      bbox.east += lngPad;

      logger.info(`Polygon found: ${outerRing.length} vertices → simplified to ${polygonSimplified.length}`);
    }
  }

  if (!polygon) {
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
    polygonSimplified,
    hasPolygon: !!polygon,
  };

  await cache.set(cacheKey, output, 86400);
  logger.info(`Geocoded: "${display_name}" [polygon: ${!!polygon}]`);
  return output;
}

function pickBestResult(results) {

  const withPoly = results.filter(r =>
    r.geojson && (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon")
  );

  const priority = ["city", "town", "suburb", "village", "administrative",
    "municipality", "neighbourhood", "residential", "postcode"];

  const pool = withPoly.length > 0 ? withPoly : results;
  for (const pt of priority) {
    const m = pool.find(r => r.type === pt || r.class === "boundary");
    if (m) return m;
  }
  return pool[0];
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
