/**
 * Kanpur Tactical GIS - Multi-Persona Telemetry Simulator
 * Simulates 4 live patrol personas across Cantt, Panki, Kidwai Nagar, and Bada Chauraha
 * with kinematic interpolation, bearing calculation, battery telemetry,
 * nearest Thana lookup across 49 police stations, and 350m red zone proximity evaluation.
 */

const { KANPUR_POLICE_STATIONS, calculateDistanceKm } = require('../js/data/policeStations');
const { evaluateGeofence } = require('./geofence');

/**
 * Calculate true compass bearing between two coordinates
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (theta * toDeg + 360) % 360;
}

/**
 * Find the nearest police station from coordinates among 49 Kanpur stations
 */
function findNearestThana(lat, lng) {
  let nearest = null;
  let minDistance = Infinity;

  for (const station of KANPUR_POLICE_STATIONS) {
    const dist = calculateDistanceKm(lat, lng, station.lat, station.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = {
        id: station.id,
        name: station.name,
        cug: station.cug,
        phone: station.phone,
        sho: station.sho,
        distKm: dist
      };
    }
  }

  return nearest;
}

/**
 * Definition of the 4 Field Personas
 */
const PERSONAS_CONFIG = [
  {
    id: 'unit-cantt-eagle1',
    callSign: 'EAGLE-1 (Cantt QRT)',
    name: 'Insp. Vikramaditya Rai',
    sector: 'Cantt',
    color: '#38BDF8', // Cyan
    baseThanaId: 'thana-cantt',
    speedKmH: 34.5,
    batteryPct: 92,
    batteryDrainRate: 0.005,
    waypoints: [
      [26.4528, 80.3662], // Cantt Police Station
      [26.4565, 80.3638], // Mall Road Officer's Club
      [26.4612, 80.3605], // Civil Lines Southern Junction
      [26.4650, 80.3552], // Phoolbagh East Perimeter
      [26.4595, 80.3675], // Cantonment Garrison Church
      [26.4540, 80.3710], // Ordnance Factory Approach
      [26.4528, 80.3662]  // Return
    ]
  },
  {
    id: 'unit-panki-rhino3',
    callSign: 'RHINO-3 (Panki QRT)',
    name: 'SI Amit Tomar',
    sector: 'Panki',
    color: '#F59E0B', // Amber
    baseThanaId: 'thana-panki',
    speedKmH: 28.0,
    batteryPct: 84,
    batteryDrainRate: 0.006,
    waypoints: [
      [26.4678, 80.2452], // Panki Police Station
      [26.4715, 80.2408], // Panki Dham Mandir
      [26.4762, 80.2355], // Industrial Area Site 1
      [26.4695, 80.2312], // Gangaganj Crossing
      [26.4632, 80.2384], // Thermal Power Station Rd
      [26.4650, 80.2430], // Kalpi Road Connector
      [26.4678, 80.2452]  // Return
    ]
  },
  {
    id: 'unit-kidwai-panther2',
    callSign: 'PANTHER-2 (Kidwai Nagar Interceptor)',
    name: 'Insp. Arun Mishra',
    sector: 'Kidwai Nagar',
    color: '#EF4444', // Red
    baseThanaId: 'thana-babupurwa',
    speedKmH: 42.0,
    batteryPct: 76,
    batteryDrainRate: 0.008,
    waypoints: [
      [26.4385, 80.3341], // Babupurwa PS / Kidwai Nagar Chauraha
      [26.4342, 80.3312], // H-Block Commercial Market
      [26.4295, 80.3278], // K-Block Park
      [26.4350, 80.3230], // Juhi Gada Railway Buffer (210m from Babupurwa-Juhi Red Zone!)
      [26.4415, 80.3262], // Gaushala Chauraha
      [26.4420, 80.3325], // 40-Dukan Market
      [26.4385, 80.3341]  // Return
    ]
  },
  {
    id: 'unit-kotwali-chetak1',
    callSign: 'CHETAK-1 (Bada Chauraha Beat)',
    name: 'Inspector R. K. Singh',
    sector: 'Bada Chauraha',
    color: '#10B981', // Emerald Green
    baseThanaId: 'thana-kotwali',
    speedKmH: 22.0,
    batteryPct: 95,
    batteryDrainRate: 0.004,
    waypoints: [
      [26.4716, 80.3475], // Kotwali Police Station / Bada Chauraha
      [26.4745, 80.3512], // Som Dutt Plaza / VIP Road
      [26.4782, 80.3445], // Sarsaiya Ghat
      [26.4695, 80.3422], // Parade Ground Crossing
      [26.4678, 80.3465], // Naveen Market Arcade
      [26.4716, 80.3475]  // Return
    ]
  }
];

class PersonaSimulator {
  constructor() {
    this.units = new Map();
    this.initPersonas();
  }

  initPersonas() {
    for (const conf of PERSONAS_CONFIG) {
      const startWp = conf.waypoints[0];
      const nextWp = conf.waypoints[1];
      const initialBearing = calculateBearing(startWp[0], startWp[1], nextWp[0], nextWp[1]);

      const state = {
        ...conf,
        lat: startWp[0],
        lng: startWp[1],
        heading: Math.round(initialBearing),
        targetWpIndex: 1,
        progress: 0.0,
        breadcrumbs: [[startWp[0], startWp[1]]],
        lastUpdated: Date.now()
      };

      state.nearestThana = findNearestThana(state.lat, state.lng);
      state.redZoneStatus = evaluateGeofence(state.lat, state.lng);

      this.units.set(conf.id, state);
    }
  }

  /**
   * Advance the simulation by 1 step (~1 second tick)
   * @returns {Array<object>} Current state of all 4 personas
   */
  tick() {
    const updates = [];
    const now = Date.now();

    for (const [id, unit] of this.units.entries()) {
      const fromWpIndex = (unit.targetWpIndex - 1 + unit.waypoints.length) % unit.waypoints.length;
      const toWpIndex = unit.targetWpIndex;

      const p1 = unit.waypoints[fromWpIndex];
      const p2 = unit.waypoints[toWpIndex];

      // Segment distance in km
      const segDistKm = calculateDistanceKm(p1[0], p1[1], p2[0], p2[1]);
      // Speed in km per second
      const speedKmPerSec = unit.speedKmH / 3600;
      // Step increment along this segment
      const stepIncrement = segDistKm > 0 ? (speedKmPerSec / segDistKm) : 0.05;

      unit.progress += stepIncrement;

      if (unit.progress >= 1.0) {
        unit.progress = 0.0;
        unit.targetWpIndex = (unit.targetWpIndex + 1) % unit.waypoints.length;
      }

      // Linear interpolation between waypoints
      const curP1 = unit.waypoints[(unit.targetWpIndex - 1 + unit.waypoints.length) % unit.waypoints.length];
      const curP2 = unit.waypoints[unit.targetWpIndex];

      const lat = curP1[0] + (curP2[0] - curP1[0]) * unit.progress;
      const lng = curP1[1] + (curP2[1] - curP1[1]) * unit.progress;

      unit.lat = lat;
      unit.lng = lng;
      unit.heading = Math.round(calculateBearing(curP1[0], curP1[1], curP2[0], curP2[1]));

      // Battery drain
      unit.batteryPct = Math.max(15, parseFloat((unit.batteryPct - unit.batteryDrainRate).toFixed(1)));

      // Add to breadcrumb history (keep max 25)
      unit.breadcrumbs.push([lat, lng]);
      if (unit.breadcrumbs.length > 25) {
        unit.breadcrumbs.shift();
      }

      // Dynamic nearest Thana lookup
      unit.nearestThana = findNearestThana(lat, lng);

      // Geofence proximity status
      unit.redZoneStatus = evaluateGeofence(lat, lng);
      unit.lastUpdated = now;

      updates.push({
        id: unit.id,
        name: unit.name,
        callSign: unit.callSign,
        sector: unit.sector,
        color: unit.color,
        lat: unit.lat,
        lng: unit.lng,
        heading: unit.heading,
        speedKmH: unit.speedKmH,
        batteryPct: unit.batteryPct,
        nearestThana: unit.nearestThana,
        redZoneStatus: unit.redZoneStatus,
        breadcrumbs: unit.breadcrumbs,
        timestamp: now
      });
    }

    return updates;
  }

  /**
   * Get latest snapshot of all 4 personas
   */
  getAllStates() {
    return Array.from(this.units.values()).map(unit => ({
      id: unit.id,
      name: unit.name,
      callSign: unit.callSign,
      sector: unit.sector,
      color: unit.color,
      lat: unit.lat,
      lng: unit.lng,
      heading: unit.heading,
      speedKmH: unit.speedKmH,
      batteryPct: unit.batteryPct,
      nearestThana: unit.nearestThana,
      redZoneStatus: unit.redZoneStatus,
      breadcrumbs: unit.breadcrumbs,
      timestamp: unit.lastUpdated
    }));
  }

  /**
   * Manually override or position a persona (useful for geofence testing)
   */
  setPersonaPosition(id, lat, lng) {
    const unit = this.units.get(id);
    if (!unit) return null;
    unit.lat = lat;
    unit.lng = lng;
    unit.breadcrumbs.push([lat, lng]);
    if (unit.breadcrumbs.length > 25) unit.breadcrumbs.shift();
    unit.nearestThana = findNearestThana(lat, lng);
    unit.redZoneStatus = evaluateGeofence(lat, lng);
    unit.lastUpdated = Date.now();
    return unit;
  }
}

module.exports = {
  PERSONAS_CONFIG,
  calculateBearing,
  findNearestThana,
  PersonaSimulator
};
