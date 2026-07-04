const axios = require("axios");
const { cache } = require("../config/redis");
const logger = require("../utils/logger");

// Public Overpass mirrors. Each keeps its own cooldown clock: a 429 from one
// server parks only that server, and traffic rotates to the next mirror
// instead of stalling the whole scan.
const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const OVERPASS_TIMEOUT = 45;

const endpointCooldown = new Map(); // url → epoch ms until usable again

function pickEndpoint() {
  const now = Date.now();
  let best = null, bestWait = Infinity;
  for (const url of OVERPASS_ENDPOINTS) {
    const wait = Math.max(0, (endpointCooldown.get(url) || 0) - now);
    if (wait === 0) return { url, wait: 0 };
    if (wait < bestWait) { bestWait = wait; best = url; }
  }
  return { url: best, wait: bestWait };
}

function parkEndpoint(url, ms) {
  endpointCooldown.set(url, Math.max(endpointCooldown.get(url) || 0, Date.now() + ms));
}

// Serialize ALL Overpass traffic through one gate: public servers allow ~2
// slots per IP, and merely spacing request *starts* still lets concurrent
// workers overlap in flight and trip the rate limiter.
let lastOverpassCall = 0;
let requestChain = Promise.resolve();

function withOverpassSlot(fn) {
  const run = requestChain.then(async () => {
    const wait = Math.max(1500 - (Date.now() - lastOverpassCall), 0);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastOverpassCall = Date.now();
    }
  });
  requestChain = run.then(() => {}, () => {});
  return run;
}

// Tag filters per category. Each entry becomes an `nwr[...]` union member, so
// nodes, ways AND relations are covered for every tag — the old map queried
// nodes only for most categories and silently dropped mapped-as-way POIs.
const CATEGORY_TAG_MAP = {
  restaurant: ['["amenity"="restaurant"]', '["amenity"="fast_food"]', '["amenity"="food_court"]'],
  cafe: ['["amenity"="cafe"]', '["amenity"="ice_cream"]', '["shop"="coffee"]'],
  bar: ['["amenity"="bar"]', '["amenity"="pub"]', '["amenity"="biergarten"]'],
  bakery: ['["shop"="bakery"]', '["shop"="confectionery"]'],
  gym: ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]', '["amenity"="gym"]'],
  beauty_salon: ['["shop"="beauty"]', '["shop"="cosmetics"]'],
  hair_care: ['["shop"="hairdresser"]', '["shop"="barber"]'],
  spa: ['["leisure"="spa"]', '["amenity"="spa"]', '["shop"="massage"]'],
  hospital: ['["amenity"="hospital"]', '["healthcare"="hospital"]', '["amenity"="clinic"]'],
  doctor: ['["amenity"="doctors"]', '["amenity"="clinic"]', '["healthcare"="doctor"]', '["healthcare"="clinic"]'],
  dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
  pharmacy: ['["amenity"="pharmacy"]', '["shop"="chemist"]', '["healthcare"="pharmacy"]'],
  school: ['["amenity"="school"]', '["amenity"="kindergarten"]'],
  university: ['["amenity"="university"]', '["amenity"="college"]'],
  lodging: ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="hostel"]', '["tourism"="motel"]'],
  shopping_mall: ['["shop"="mall"]', '["shop"="department_store"]'],
  clothing_store: ['["shop"="clothes"]', '["shop"="fashion"]', '["shop"="boutique"]', '["shop"="tailor"]'],
  electronics_store: ['["shop"="electronics"]', '["shop"="computer"]', '["shop"="mobile_phone"]'],
  furniture_store: ['["shop"="furniture"]', '["shop"="interior_decoration"]'],
  jewelry_store: ['["shop"="jewelry"]', '["shop"="jewellery"]'],
  car_dealer: ['["shop"="car"]', '["shop"="motorcycle"]'],
  car_repair: ['["shop"="car_repair"]', '["amenity"="car_repair"]', '["shop"="tyres"]'],
  gas_station: ['["amenity"="fuel"]'],
  bank: ['["amenity"="bank"]'],
  atm: ['["amenity"="atm"]'],
  real_estate_agency: ['["office"="estate_agent"]', '["shop"="estate_agent"]'],
  lawyer: ['["office"="lawyer"]'],
  travel_agency: ['["shop"="travel_agency"]', '["office"="travel_agent"]'],
  laundry: ['["shop"="laundry"]', '["shop"="dry_cleaning"]'],
  supermarket: ['["shop"="supermarket"]', '["shop"="grocery"]', '["shop"="convenience"]'],
  movie_theater: ['["amenity"="cinema"]'],
  place_of_worship: ['["amenity"="place_of_worship"]'],

  _default: ['["amenity"]', '["shop"]'],
};

async function searchTile(tile, category) {
  const { south, north, west, east } = tile;
  const bboxStr = `${south},${west},${north},${east}`;

  const cacheKey = `overpass2:${bboxStr}:${category}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    logger.debug(`Overpass cache hit for ${category} at [${south.toFixed(4)},${west.toFixed(4)}]`);
    return cached;
  }

  const tagFilters = CATEGORY_TAG_MAP[category] || CATEGORY_TAG_MAP._default;
  const unionBody = tagFilters.map(f => `  nwr${f}(${bboxStr});`).join("\n");

  const query = `
[out:json][timeout:${OVERPASS_TIMEOUT}];
(
${unionBody}
);
out center tags;
`;

  const maxAttempts = OVERPASS_ENDPOINTS.length * 2;
  let attempt = 0;

  while (true) {
    attempt++;
    try {
      const response = await withOverpassSlot(async () => {
        const pick = pickEndpoint();
        if (pick.wait > 0) await new Promise(r => setTimeout(r, pick.wait));
        try {
          return await axios.post(
            pick.url,
            `data=${encodeURIComponent(query)}`,
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                // Replace with your contact email — Overpass requires a real User-Agent.
                "User-Agent": "GeoGridIndia/1.0 (sunnybagal.1110@gmail.com)",
              },
              timeout: (OVERPASS_TIMEOUT + 10) * 1000,
            }
          );
        } catch (err) {
          err.endpoint = pick.url;
          throw err;
        }
      });

      const elements = response.data?.elements || [];

      const places = [];
      const seenIds = new Set();

      for (const el of elements) {
        const id = `${el.type}/${el.id}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const tags = el.tags || {};
        const name = tags.name || tags["name:en"] || tags.brand || null;
        if (!name) continue;

        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        if (!lat || !lon) continue;

        places.push({
          osmId: id,
          placeId: id,
          name,
          latitude: lat,
          longitude: lon,
          address: buildAddress(tags),
          city: tags["addr:city"] || "",
          state: tags["addr:state"] || "",
          pincode: tags["addr:postcode"] || "",
          website: tags.website || tags["contact:website"] || tags.url || "",
          phone: tags.phone || tags["contact:phone"] || "",
          email: tags.email || tags["contact:email"] || "",
          openingHours: tags.opening_hours || "",
          cuisine: tags.cuisine || "",
          brand: tags.brand || "",
          types: extractTypes(tags, category),
          osmTags: tags,

          rating: null,
          totalReviews: 0,
          businessStatus: "OPERATIONAL",
        });
      }

      const result = {
        results: places.length,
        totalFromAPI: elements.length,
        pages: 1,
        places,
      };

      await cache.set(cacheKey, result, 7200);

      logger.debug(
        `Overpass: ${category} at [${south.toFixed(4)},${west.toFixed(4)}] → ` +
        `${places.length} named places (${elements.length} total elements)`
      );

      return result;

    } catch (error) {
      const status = error.response?.status;
      const url = error.endpoint || "unknown";
      const host = url.replace(/^https?:\/\//, "").split("/")[0];

      if (status === 429) {
        // Park this mirror and rotate to the next one immediately.
        const retryAfter = parseInt(error.response.headers?.["retry-after"]) || 0;
        parkEndpoint(url, Math.max(retryAfter * 1000, 60000));
        logger.warn(`Overpass 429 from ${host} — parked 60s, rotating (attempt ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) continue;
        const err = new Error("All Overpass mirrors rate limited");
        err.isOverpassBusy = true;
        throw err;
      }

      // Gateway/query timeout: DO NOT fabricate a result count (the old code
      // returned `results: 999`, force-subdividing whatever tile hit a busy
      // server — including ocean tiles). Park the mirror briefly and rotate;
      // only give up (→ tile worker splits the tile) once every mirror failed.
      if (status === 504 || error.code === "ECONNABORTED" || status === 502 || status === 503) {
        sawTimeout = true;
        parkEndpoint(url, 15000);
        logger.warn(`Overpass ${status || error.code} from ${host} — rotating (attempt ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) continue;
        const err = new Error(`Overpass timeout for tile [${south.toFixed(4)},${west.toFixed(4)}] on all mirrors`);
        err.isOverpassTimeout = true;
        throw err;
      }

      logger.error(`Overpass error from ${host}: ${error.message}`);
      throw error;
    }
  }
}

function buildAddress(tags) {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"] || tags["addr:neighbourhood"],
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : (tags["addr:full"] || "");
}

function extractTypes(tags, searchCategory) {
  const types = [searchCategory];
  if (tags.amenity) types.push(tags.amenity);
  if (tags.shop) types.push(`shop:${tags.shop}`);
  if (tags.leisure) types.push(tags.leisure);
  if (tags.tourism) types.push(tags.tourism);
  if (tags.healthcare) types.push(tags.healthcare);
  if (tags.office) types.push(`office:${tags.office}`);
  if (tags.cuisine) types.push(...tags.cuisine.split(";").map(c => c.trim()));
  return [...new Set(types)];
}

module.exports = { searchTile, CATEGORY_TAG_MAP };
