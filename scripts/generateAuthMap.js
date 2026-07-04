// Generates client/india-map.svg — the auth-page illustration.
// Fetches India's real boundary from Nominatim, fills it with a dot lattice,
// and overlays animated scan markers on major cities. Run once (committed
// output), re-run only if you want to change the look:
//   node scripts/generateAuthMap.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { pointInPolygon, extractRings, polygonBbox } = require("../src/utils/geometry");

const UA = "GeoGridIndia/3.0 (sunnybagal.1110@gmail.com)";

// Projection: equirectangular over India's bbox with latitude aspect correction
const LON_W = 68.0, LON_E = 97.5, LAT_S = 6.5, LAT_N = 37.2;
const H = 520;
const K = H / (LAT_N - LAT_S);
const ASPECT = Math.cos((22 * Math.PI) / 180);
const W = Math.round((LON_E - LON_W) * ASPECT * K);
const px = (lng, lat) => [
  +(((lng - LON_W) * ASPECT * K)).toFixed(1),
  +(((LAT_N - lat) * K)).toFixed(1),
];

const CITIES = [
  { name: "DELHI", lat: 28.61, lng: 77.21, delay: 0, label: [8, 3] },
  { name: "MUMBAI", lat: 19.08, lng: 72.88, delay: -1.1, label: [-58, 3], scanFrame: true },
  { name: "BENGALURU", lat: 12.97, lng: 77.59, delay: -2.2, label: [8, 10] },
  { name: "KOLKATA", lat: 22.57, lng: 88.36, delay: -0.6, label: [8, 3] },
  { name: "HYDERABAD", lat: 17.38, lng: 78.48, delay: -1.7, label: [8, 3] },
  { name: "CHENNAI", lat: 13.08, lng: 80.27, delay: -2.8, label: [8, 3] },
];

(async () => {
  const resp = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: { q: "India", format: "json", limit: 1, polygon_geojson: 1, polygon_threshold: 0.1 },
    headers: { "User-Agent": UA },
    timeout: 30000,
  });
  const geojson = resp.data?.[0]?.geojson;
  const rings = extractRings(geojson);
  if (!rings || !rings.length) throw new Error("No India polygon returned");

  // Drop micro-islands; keep mainland + Andaman-scale rings
  const kept = rings.filter(r => {
    const bb = polygonBbox(r);
    return (bb.north - bb.south) * (bb.east - bb.west) > 0.03;
  });
  console.log(`rings: ${rings.length} → kept ${kept.length}`);

  // Dot lattice: whole dots strictly inside any ring
  const STEP = 12.5;
  const dots = [];
  for (let y = STEP / 2; y < H; y += STEP) {
    for (let x = STEP / 2; x < W; x += STEP) {
      const lng = x / (ASPECT * K) + LON_W;
      const lat = LAT_N - y / K;
      if (kept.some(r => pointInPolygon(lat, lng, r)))
        dots.push(`<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="1.7"/>`);
    }
  }
  console.log(`dots: ${dots.length}`);

  // Faint outline of the mainland (largest ring)
  const mainland = kept.reduce((a, b) => {
    const A = polygonBbox(a), B = polygonBbox(b);
    return (A.north - A.south) * (A.east - A.west) >= (B.north - B.south) * (B.east - B.west) ? a : b;
  });
  const outline = mainland.map(([lng, lat], i) => {
    const [x, y] = px(lng, lat);
    return `${i === 0 ? "M" : "L"}${x} ${y}`;
  }).join("") + "Z";

  const cities = CITIES.map(c => {
    const [x, y] = px(c.lng, c.lat);
    let s = `<g>`;
    if (c.scanFrame) {
      s += `<rect x="${x - 17}" y="${y - 17}" width="34" height="34" fill="rgba(255,133,187,0.06)" stroke="#FF85BB" stroke-width="1.2" stroke-dasharray="4 3"/>`;
      s += `<path d="M${x} ${y - 17}V${y + 17}M${x - 17} ${y}H${x + 17}" stroke="rgba(255,133,187,0.45)" stroke-width="0.7"/>`;
      s += `<rect x="${x}" y="${y - 17}" width="8.5" height="8.5" stroke="rgba(255,176,32,0.8)" stroke-width="0.7" fill="rgba(255,176,32,0.15)"/>`;
    }
    s += `<circle class="ring" style="animation-delay:${c.delay}s" cx="${x}" cy="${y}" r="6" fill="none" stroke="rgba(91,138,255,0.65)" stroke-width="1.5"/>`;
    s += `<circle cx="${x}" cy="${y}" r="3" fill="#5B8AFF"/><circle cx="${x}" cy="${y}" r="1.3" fill="#DCE6FF"/>`;
    s += `<text x="${x + c.label[0]}" y="${y + c.label[1]}" class="lbl">${c.name}</text></g>`;
    return s;
  }).join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none" role="img" aria-label="Dot-matrix map of India with GeoGrid scan markers on major cities">
  <style>
    .ring{transform-origin:center;transform-box:fill-box;animation:ping 3.4s cubic-bezier(0,0,.2,1) infinite}
    @keyframes ping{0%{transform:scale(.35);opacity:.9}75%,100%{transform:scale(2.6);opacity:0}}
    .lbl{font:600 9px 'IBM Plex Mono',monospace;letter-spacing:.08em;fill:rgba(232,236,244,0.55)}
    @media(prefers-reduced-motion:reduce){.ring{animation:none;opacity:.3}}
  </style>
  <path d="${outline}" stroke="rgba(126,162,255,0.28)" stroke-width="1"/>
  <g fill="rgba(91,138,255,0.30)">
    ${dots.join("")}
  </g>
  ${cities}
</svg>
`;

  const out = path.join(__dirname, "..", "client", "india-map.svg");
  fs.writeFileSync(out, svg);
  console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB)`);
})().catch(e => { console.error("generateAuthMap failed:", e.message); process.exit(1); });
