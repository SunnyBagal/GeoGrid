const axios = require("axios");
const { cache } = require("../config/redis");
const logger = require("../utils/logger");

const OVERPASS_URL = process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT = 30;

let lastOverpassCall = 0;
async function overpassThrottle() {
  const now = Date.now();
  const wait = 1500 - (now - lastOverpassCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastOverpassCall = Date.now();
}

const CATEGORY_TAG_MAP = {
  restaurant: [
    'node["amenity"="restaurant"]',
    'node["amenity"="food_court"]',
    'way["amenity"="restaurant"]',
  ],
  cafe: [
    'node["amenity"="cafe"]',
    'node["shop"="coffee"]',
    'way["amenity"="cafe"]',
  ],
  bar: [
    'node["amenity"="bar"]',
    'node["amenity"="pub"]',
    'node["amenity"="biergarten"]',
  ],
  bakery: [
    'node["shop"="bakery"]',
    'node["amenity"="bakery"]',
  ],
  gym: [
    'node["leisure"="fitness_centre"]',
    'node["leisure"="sports_centre"]',
    'node["amenity"="gym"]',
    'way["leisure"="fitness_centre"]',
  ],
  beauty_salon: [
    'node["shop"="beauty"]',
    'node["shop"="cosmetics"]',
    'node["amenity"="beauty"]',
  ],
  hair_care: [
    'node["shop"="hairdresser"]',
    'node["shop"="barber"]',
  ],
  spa: [
    'node["leisure"="spa"]',
    'node["amenity"="spa"]',
    'node["shop"="massage"]',
  ],
  hospital: [
    'node["amenity"="hospital"]',
    'way["amenity"="hospital"]',
    'relation["amenity"="hospital"]',
    'node["amenity"="clinic"]',
  ],
  doctor: [
    'node["amenity"="doctors"]',
    'node["amenity"="clinic"]',
    'node["healthcare"="doctor"]',
    'node["healthcare"="clinic"]',
  ],
  dentist: [
    'node["amenity"="dentist"]',
    'node["healthcare"="dentist"]',
  ],
  pharmacy: [
    'node["amenity"="pharmacy"]',
    'node["shop"="chemist"]',
  ],
  school: [
    'node["amenity"="school"]',
    'way["amenity"="school"]',
    'node["amenity"="kindergarten"]',
  ],
  university: [
    'node["amenity"="university"]',
    'way["amenity"="university"]',
    'node["amenity"="college"]',
    'way["amenity"="college"]',
  ],
  lodging: [
    'node["tourism"="hotel"]',
    'way["tourism"="hotel"]',
    'node["tourism"="guest_house"]',
    'node["tourism"="hostel"]',
    'node["tourism"="motel"]',
  ],
  shopping_mall: [
    'node["shop"="mall"]',
    'way["shop"="mall"]',
    'node["shop"="department_store"]',
    'way["shop"="department_store"]',
  ],
  clothing_store: [
    'node["shop"="clothes"]',
    'node["shop"="fashion"]',
    'node["shop"="boutique"]',
  ],
  electronics_store: [
    'node["shop"="electronics"]',
    'node["shop"="computer"]',
    'node["shop"="mobile_phone"]',
  ],
  furniture_store: [
    'node["shop"="furniture"]',
    'node["shop"="interior_decoration"]',
  ],
  jewelry_store: [
    'node["shop"="jewelry"]',
    'node["shop"="jewellery"]',
  ],
  car_dealer: [
    'node["shop"="car"]',
    'way["shop"="car"]',
  ],
  car_repair: [
    'node["shop"="car_repair"]',
    'node["amenity"="car_repair"]',
    'node["shop"="tyres"]',
  ],
  gas_station: [
    'node["amenity"="fuel"]',
    'way["amenity"="fuel"]',
  ],
  bank: [
    'node["amenity"="bank"]',
    'way["amenity"="bank"]',
  ],
  atm: [
    'node["amenity"="atm"]',
  ],
  real_estate_agency: [
    'node["office"="estate_agent"]',
    'node["shop"="estate_agent"]',
  ],
  lawyer: [
    'node["office"="lawyer"]',
    'node["amenity"="lawyer"]',
  ],
  travel_agency: [
    'node["shop"="travel_agency"]',
    'node["office"="travel_agent"]',
  ],
  laundry: [
    'node["shop"="laundry"]',
    'node["shop"="dry_cleaning"]',
  ],
  supermarket: [
    'node["shop"="supermarket"]',
    'way["shop"="supermarket"]',
    'node["shop"="grocery"]',
    'node["shop"="convenience"]',
  ],
  movie_theater: [
    'node["amenity"="cinema"]',
    'way["amenity"="cinema"]',
  ],
  place_of_worship: [
    'node["amenity"="place_of_worship"]',
    'way["amenity"="place_of_worship"]',
  ],

  _default: [
    'node["amenity"]',
    'node["shop"]',
  ],
};

async function searchTile(tile, category) {
  const { south, north, west, east } = tile;
  const bboxStr = `${south},${west},${north},${east}`;

  const cacheKey = `overpass:${bboxStr}:${category}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    logger.debug(`Overpass cache hit for ${category} at [${south.toFixed(4)},${west.toFixed(4)}]`);
    return cached;
  }

  const tagQueries = CATEGORY_TAG_MAP[category] || CATEGORY_TAG_MAP._default;

  const unionBody = tagQueries.map(tq => `  ${tq}(${bboxStr});`).join("\n");

  const query = `
[out:json][timeout:${OVERPASS_TIMEOUT}];
(
${unionBody}
);
out center tags;
`;

  await overpassThrottle();

  try {
    const response = await axios.post(
      OVERPASS_URL,
      `data=${encodeURIComponent(query)}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          // Replace with your contact email — Overpass requires a real User-Agent.
          "User-Agent": "GeoGridIndia/1.0 (you@example.com)",
        },
        timeout: (OVERPASS_TIMEOUT + 10) * 1000,
      }
    );

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
    if (error.response?.status === 429) {
      logger.warn("Overpass rate limited — waiting 30s");
      await new Promise(r => setTimeout(r, 30000));
      return searchTile(tile, category);
    }
    if (error.response?.status === 504) {
      logger.warn("Overpass timeout — tile may be too large");
      return { results: 999, totalFromAPI: 0, pages: 0, places: [] };

    }
    logger.error(`Overpass error: ${error.message}`);
    throw error;
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
