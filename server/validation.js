/**
 * Kanpur Tactical GIS - Coordinate & Telemetry Payload Validator
 * Enforces Kanpur metropolitan geographic bounding box,
 * kinematic teleportation guard (150 km/h threshold),
 * timestamp drift checks, and strict payload schema validation.
 */

// Bounding box for Kanpur Metropolitan Police Commissionerate
const KANPUR_BOUNDS = {
  minLat: 26.2000,
  maxLat: 26.7000,
  minLng: 80.1000,
  maxLng: 80.6000
};

// Maximum realistic ground speed in urban Kanpur conditions (150 km/h)
const MAX_REALISTIC_SPEED_KMH = 150;

// Maximum acceptable clock drift between client and server (10,000 ms)
const MAX_TIMESTAMP_DRIFT_MS = 10000;

// Cache of last valid location per unit/session for kinematic checking
const lastKnownPositions = new Map();

/**
 * Calculate Great-Circle distance in kilometers between two coordinates
 */
function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's mean radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Validate that latitude and longitude fall strictly within Kanpur metropolitan bounds
 * @param {number} lat
 * @param {number} lng
 * @returns {{ valid: boolean, error?: string }}
 */
function validateKanpurBounds(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' ||
      isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
    return { valid: false, error: 'Coordinates must be valid finite numbers' };
  }

  if (lat < KANPUR_BOUNDS.minLat || lat > KANPUR_BOUNDS.maxLat) {
    return {
      valid: false,
      error: `Latitude ${lat.toFixed(4)} is outside Kanpur jurisdiction [${KANPUR_BOUNDS.minLat}, ${KANPUR_BOUNDS.maxLat}]`
    };
  }

  if (lng < KANPUR_BOUNDS.minLng || lng > KANPUR_BOUNDS.maxLng) {
    return {
      valid: false,
      error: `Longitude ${lng.toFixed(4)} is outside Kanpur jurisdiction [${KANPUR_BOUNDS.minLng}, ${KANPUR_BOUNDS.maxLng}]`
    };
  }

  return { valid: true };
}

/**
 * Validate coordinate stream against kinematic teleportation / impossible velocity
 * @param {string} unitId
 * @param {number} lat
 * @param {number} lng
 * @param {number} timestamp
 * @returns {{ valid: boolean, error?: string, apparentSpeedKmh?: number }}
 */
function validateKinematicSpeed(unitId, lat, lng, timestamp = Date.now()) {
  const prev = lastKnownPositions.get(unitId);
  if (!prev) {
    lastKnownPositions.set(unitId, { lat, lng, time: timestamp });
    return { valid: true };
  }

  const timeDeltaSec = (timestamp - prev.time) / 1000;
  // If consecutive updates are received faster than 100ms or time went backward
  if (timeDeltaSec <= 0) {
    return { valid: true };
  }

  const distKm = calculateHaversineKm(prev.lat, prev.lng, lat, lng);
  const apparentSpeedKmh = (distKm / timeDeltaSec) * 3600;

  if (apparentSpeedKmh > MAX_REALISTIC_SPEED_KMH) {
    return {
      valid: false,
      error: `Kinematic anomaly: Apparent speed ${apparentSpeedKmh.toFixed(1)} km/h exceeds 150 km/h threshold`,
      apparentSpeedKmh
    };
  }

  // Update last known position
  lastKnownPositions.set(unitId, { lat, lng, time: timestamp });
  return { valid: true, apparentSpeedKmh };
}

/**
 * Validate incoming telemetry payload envelope
 * @param {object} payload
 * @returns {{ valid: boolean, error?: string, sanitized?: object }}
 */
function validateTelemetryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Malformed telemetry packet: Expected JSON object' };
  }

  // Enforce strict numeric type validation: strings, booleans, arrays and objects are strictly rejected
  if (typeof payload.lat !== 'number' || typeof payload.lng !== 'number' ||
      isNaN(payload.lat) || isNaN(payload.lng) || !isFinite(payload.lat) || !isFinite(payload.lng)) {
    return { valid: false, error: 'Coordinates must be valid finite numbers' };
  }

  const lat = payload.lat;
  const lng = payload.lng;

  const boundsCheck = validateKanpurBounds(lat, lng);
  if (!boundsCheck.valid) {
    return { valid: false, error: boundsCheck.error };
  }

  // Timestamp drift check if timestamp provided
  if (payload.timestamp !== undefined) {
    const ts = Number(payload.timestamp);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
      return { valid: false, error: 'Timestamp skew exceeds allowable drift window (±10s)' };
    }
  }

  const unitId = payload.unitId || 'client-unit';
  const speedCheck = validateKinematicSpeed(unitId, lat, lng, payload.timestamp || Date.now());
  if (!speedCheck.valid) {
    return { valid: false, error: speedCheck.error };
  }

  return {
    valid: true,
    sanitized: {
      lat,
      lng,
      heading: typeof payload.heading === 'number' && !isNaN(payload.heading) ? ((payload.heading % 360) + 360) % 360 : 0,
      speedKmH: typeof payload.speedKmH === 'number' && !isNaN(payload.speedKmH) ? Math.max(0, payload.speedKmH) : (speedCheck.apparentSpeedKmh || 0),
      batteryPct: typeof payload.batteryPct === 'number' && !isNaN(payload.batteryPct) ? Math.min(100, Math.max(0, payload.batteryPct)) : 85,
      timestamp: payload.timestamp || Date.now()
    }
  };
}

module.exports = {
  KANPUR_BOUNDS,
  MAX_REALISTIC_SPEED_KMH,
  calculateHaversineKm,
  validateKanpurBounds,
  validateKinematicSpeed,
  validateTelemetryPayload
};
