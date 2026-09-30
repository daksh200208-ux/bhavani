/**
 * Kanpur Tactical GIS - Dynamic Geofencing & Proximity Calculation Engine
 * Computes exact Ray-Casting point-in-polygon containment and
 * minimum geodesic boundary distance for 350m tactical proximity alerting.
 */

const { KANPUR_CRIME_HOTSPOTS, isPointInPolygon } = require('../js/data/crimeHotspots');
const { calculateHaversineKm } = require('./validation');

const PROXIMITY_THRESHOLD_METERS = 350;

/**
 * In-memory active red zones registry (starts with certified Kanpur hotspots, supports dynamic push)
 */
let activeRedZones = JSON.parse(JSON.stringify(KANPUR_CRIME_HOTSPOTS));

/**
 * Get all active red zones
 */
function getActiveRedZones() {
  return activeRedZones;
}

/**
 * Add or update a dynamic red zone
 * @param {object} zone
 */
function upsertRedZone(zone) {
  if (!zone || !zone.id) {
    throw new Error('Red zone must possess a unique id');
  }
  const index = activeRedZones.findIndex(z => z.id === zone.id);
  if (index >= 0) {
    activeRedZones[index] = { ...activeRedZones[index], ...zone, updatedAt: Date.now() };
    return { action: 'UPDATE', zone: activeRedZones[index] };
  } else {
    const newZone = {
      ...zone,
      createdAt: Date.now(),
      isDynamic: true
    };
    activeRedZones.unshift(newZone);
    return { action: 'ADD', zone: newZone };
  }
}

/**
 * Compute shortest distance in meters from a point (lat, lng) to a line segment (A -> B)
 */
function distancePointToSegmentMeters(lat, lng, latA, lngA, latB, lngB) {
  const R = 6371000; // meters
  const toRad = Math.PI / 180;

  const midLat = ((latA + latB) / 2) * toRad;
  const cosMidLat = Math.cos(midLat);

  // Vector AB in local planar meters
  const dx = (lngB - lngA) * toRad * R * cosMidLat;
  const dy = (latB - latA) * toRad * R;

  // Vector AP in local planar meters
  const px = (lng - lngA) * toRad * R * cosMidLat;
  const py = (lat - latA) * toRad * R;

  const segLenSq = dx * dx + dy * dy;
  if (segLenSq === 0) {
    return Math.sqrt(px * px + py * py);
  }

  // Projection of P onto AB
  let t = (px * dx + py * dy) / segLenSq;
  t = Math.max(0, Math.min(1, t));

  // Nearest point on segment
  const nearX = t * dx;
  const nearY = t * dy;

  const distSq = (px - nearX) * (px - nearX) + (py - nearY) * (py - nearY);
  return Math.sqrt(distSq);
}

/**
 * Compute minimum distance in meters from a coordinate point to a polygon boundary
 * @param {number} lat
 * @param {number} lng
 * @param {Array<[number, number]>} polygon
 * @returns {number} Distance in meters
 */
function distancePointToPolygonBoundaryMeters(lat, lng, polygon) {
  if (!polygon || polygon.length < 3) return Infinity;

  let minDistance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p1 = polygon[j];
    const p2 = polygon[i];
    const d = distancePointToSegmentMeters(lat, lng, p1[0], p1[1], p2[0], p2[1]);
    if (d < minDistance) {
      minDistance = d;
    }
  }

  return minDistance;
}

/**
 * Evaluate geofence status of a coordinate against all active red zones
 * @param {number} lat
 * @param {number} lng
 * @returns {{ isInside: boolean, isNear: boolean, activeZone: object|null, distanceMeters: number, status: string }}
 */
function evaluateGeofence(lat, lng) {
  let closestZone = null;
  let minDistanceMeters = Infinity;
  let isInsideAny = false;

  for (const zone of activeRedZones) {
    // 1. Ray-casting point-in-polygon containment
    if (zone.polygon && zone.polygon.length >= 3) {
      const inside = isPointInPolygon([lat, lng], zone.polygon);
      if (inside) {
        return {
          isInside: true,
          isNear: true,
          activeZone: zone,
          distanceMeters: 0,
          status: 'BREACH'
        };
      }

      // 2. Minimum distance to polygon boundary
      const boundaryDist = distancePointToPolygonBoundaryMeters(lat, lng, zone.polygon);
      if (boundaryDist < minDistanceMeters) {
        minDistanceMeters = boundaryDist;
        closestZone = zone;
      }
    } else if (zone.center && zone.radiusMeters) {
      // Circular hotspot fallback
      const centerDistKm = calculateHaversineKm(lat, lng, zone.center[0], zone.center[1]);
      const centerDistMeters = centerDistKm * 1000;
      const boundaryDist = Math.max(0, centerDistMeters - zone.radiusMeters);
      if (boundaryDist === 0) {
        return {
          isInside: true,
          isNear: true,
          activeZone: zone,
          distanceMeters: 0,
          status: 'BREACH'
        };
      }
      if (boundaryDist < minDistanceMeters) {
        minDistanceMeters = boundaryDist;
        closestZone = zone;
      }
    }
  }

  const isNear = minDistanceMeters <= PROXIMITY_THRESHOLD_METERS;
  return {
    isInside: false,
    isNear,
    activeZone: isNear ? closestZone : null,
    distanceMeters: Math.round(minDistanceMeters),
    status: isNear ? 'PROXIMITY_350M' : 'SAFE'
  };
}

module.exports = {
  PROXIMITY_THRESHOLD_METERS,
  getActiveRedZones,
  upsertRedZone,
  distancePointToSegmentMeters,
  distancePointToPolygonBoundaryMeters,
  evaluateGeofence
};
