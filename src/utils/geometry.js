function pointInPolygon(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1], xi = ring[i][0];
    const yj = ring[j][1], xj = ring[j][0];

    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function rectIntersectsPolygon(rect, ring) {
  const { south, north, west, east } = rect;

  for (const [lng, lat] of ring) {
    if (lat >= south && lat <= north && lng >= west && lng <= east) {
      return true;
    }
  }

  const corners = [
    [south, west], [south, east],
    [north, west], [north, east],
    [(south + north) / 2, (west + east) / 2],
  ];
  for (const [lat, lng] of corners) {
    if (pointInPolygon(lat, lng, ring)) {
      return true;
    }
  }

  const rectEdges = [
    [[west, south], [east, south]],
    [[east, south], [east, north]],
    [[east, north], [west, north]],
    [[west, north], [west, south]],
  ];

  for (let i = 0; i < ring.length - 1; i++) {
    const polyEdge = [ring[i], ring[i + 1]];
    for (const rectEdge of rectEdges) {
      if (segmentsIntersect(polyEdge[0], polyEdge[1], rectEdge[0], rectEdge[1])) {
        return true;
      }
    }
  }

  return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

function direction(a, b, c) {
  return (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
}

function onSegment(a, b, c) {
  return Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0])
      && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
}

function rectIntersectsAnyRing(rect, rings) {
  if (!rings || !rings.length) return true;
  return rings.some(ring => rectIntersectsPolygon(rect, ring));
}

function polygonBbox(ring) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const [lng, lat] of ring) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, north, west, east };
}

function ringsBbox(rings) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const ring of rings) {
    const bb = polygonBbox(ring);
    if (bb.south < south) south = bb.south;
    if (bb.north > north) north = bb.north;
    if (bb.west < west) west = bb.west;
    if (bb.east > east) east = bb.east;
  }
  return { south, north, west, east };
}

// Returns ALL outer rings — a MultiPolygon city (islands, split districts)
// must keep every part, not just the largest one.
function extractRings(geojson) {
  if (!geojson || !geojson.type) return null;

  let rings = null;
  if (geojson.type === "Polygon") rings = [geojson.coordinates[0]];
  else if (geojson.type === "MultiPolygon") rings = geojson.coordinates.map(p => p[0]);

  if (!rings) return null;
  rings = rings.filter(r => Array.isArray(r) && r.length >= 4);
  return rings.length ? rings : null;
}

function simplifyRing(ring, tolerance = 0.001) {
  if (ring.length <= 4) return ring;

  function rdp(points, start, end, tol) {
    let maxDist = 0, maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist(points[i], points[start], points[end]);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > tol) {
      const left = rdp(points, start, maxIdx, tol);
      const right = rdp(points, maxIdx, end, tol);
      return [...left.slice(0, -1), ...right];
    }
    return [points[start], points[end]];
  }

  function perpendicularDist(point, lineStart, lineEnd) {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return Math.sqrt((point[0] - lineStart[0]) ** 2 + (point[1] - lineStart[1]) ** 2);
    return Math.abs(dy * point[0] - dx * point[1] + lineEnd[0] * lineStart[1] - lineEnd[1] * lineStart[0]) / len;
  }

  const simplified = rdp(ring, 0, ring.length - 1, tolerance);

  if (simplified[0][0] !== simplified[simplified.length - 1][0] ||
      simplified[0][1] !== simplified[simplified.length - 1][1]) {
    simplified.push(simplified[0]);
  }
  return simplified;
}

module.exports = {
  pointInPolygon,
  rectIntersectsPolygon,
  rectIntersectsAnyRing,
  polygonBbox,
  ringsBbox,
  extractRings,
  simplifyRing,
};
