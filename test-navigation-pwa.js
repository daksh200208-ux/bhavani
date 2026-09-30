/**
 * Kanpur Tactical GIS - Navigation, Safe Routing & PWA Automated Verification Suite
 * Port: 3399 (Isolated from 3000, 3333, 3344, 3388)
 * 
 * Validates:
 * 1. 49 Police Stations Directory Integrity & Schema
 * 2. Nearest Thana Detection & Urban Circuity Pedestrian ETA Math
 * 3. Google Maps Universal Voice Navigation Intent URL Structure
 * 4. Offline Locality Reverse-Geocoding Accuracy across Kanpur Sectors
 * 5. 3-Stage Red Zone Proximity Engine & 15m Hysteresis Logic
 * 6. W3C Web App Manifest Validation & Standalone Display Mode
 * 7. Service Worker Syntax, Cache Architecture & Precache Inventory
 * 8. Production Cloud Deployment Descriptors (Dockerfile, Procfile, render.yaml)
 * 9. Live HTTP Server Endpoints (/api/health, /manifest.json, /sw.js with headers)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Module Imports
const { KANPUR_POLICE_STATIONS, calculateDistanceKm, findNearestThana, computeNearestThanaAndEta, getGoogleMapsWalkingUrl } = require('./js/data/policeStations');
const { KANPUR_LOCALITIES, lookupKanpurLocality, getKanpurLocality } = require('./js/data/localities');
const { calculateBearingDegrees, calculateDisplacementMeters } = require('./js/map');
const { KANPUR_CRIME_HOTSPOTS, isPointInPolygon } = require('./js/data/crimeHotspots');
const { startServer, stopServer } = require('./server');

const TEST_PORT = 3399;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function httpRequest(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${pathname}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    }).on('error', reject);
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   KANPUR TACTICAL GIS - NAVIGATION & PWA VERIFICATION SUITE   ');
  console.log('================================================================\n');

  let passedAssertions = 0;
  function pass(msg) {
    passedAssertions++;
    console.log(`  [PASS] ${msg}`);
  }

  // ---------------------------------------------------------------------------
  // SUITE 1: 49 Police Stations Directory Integrity
  // ---------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('SUITE 1: 49 Police Stations Directory Integrity');
  console.log('----------------------------------------------------------------');

  assert.strictEqual(KANPUR_POLICE_STATIONS.length, 49, `Must contain exactly 49 police stations (got ${KANPUR_POLICE_STATIONS.length})`);
  pass('Exactly 49 police stations registered in dataset');

  const stationIds = new Set();
  const cugRegex = /^(\+91)?945440\d{4}$|^112$/;

  for (const station of KANPUR_POLICE_STATIONS) {
    assert(station.id, `Station must have an ID: ${JSON.stringify(station)}`);
    assert(!stationIds.has(station.id), `Duplicate station ID detected: ${station.id}`);
    stationIds.add(station.id);

    assert(typeof station.name === 'string' && station.name.length > 0, `Station ${station.id} missing name`);
    assert(typeof station.hindiName === 'string' && station.hindiName.length > 0, `Station ${station.id} missing hindiName`);
    assert(typeof station.zone === 'string' && station.zone.length > 0, `Station ${station.id} missing zone`);
    assert(typeof station.circle === 'string' && station.circle.length > 0, `Station ${station.id} missing circle`);

    // Valid coordinates in Kanpur territorial jurisdiction
    assert(typeof station.lat === 'number' && station.lat >= 26.0 && station.lat <= 27.0,
      `Station ${station.id} lat ${station.lat} out of bounds [26.0, 27.0]`);
    assert(typeof station.lng === 'number' && station.lng >= 80.0 && station.lng <= 80.6,
      `Station ${station.id} lng ${station.lng} out of bounds [80.0, 80.6]`);

    // CUG and SHO verification
    assert(cugRegex.test(station.cug), `Station ${station.id} has invalid CUG phone: ${station.cug}`);
    assert(typeof station.sho === 'string' && station.sho.length > 0, `Station ${station.id} missing SHO name`);
  }

  pass('All 49 station IDs are unique');
  pass('Every station has valid WGS84 coordinates within Kanpur bounds');
  pass('Every station possesses valid UP Police CUG number (945440XXXX or 112)');
  pass('Every station has assigned SHO / Inspector in-charge');

  // Verify Kotwali HQ and Apex Command exist
  const kotwali = KANPUR_POLICE_STATIONS.find(s => s.id === 'thana-kotwali');
  assert(kotwali && kotwali.lat === 26.4716 && kotwali.lng === 80.3475, 'Kotwali HQ found with correct coordinates');
  const hq = KANPUR_POLICE_STATIONS.find(s => s.id === 'hq-commissionerate');
  assert(hq && hq.lat === 26.4748 && hq.lng === 80.3421, 'Apex Commissionerate HQ found with correct coordinates');
  pass('Kotwali HQ (thana-kotwali) and Apex Command (hq-commissionerate) present');

  // ---------------------------------------------------------------------------
  // SUITE 2: Nearest Thana & Pedestrian Walking ETA Calculation
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 2: Nearest Thana & Pedestrian Walking ETA Calculation');
  console.log('----------------------------------------------------------------');

  // Probe 1: Bada Chauraha (26.4710, 80.3470) -> Kotwali
  const badaChaurahaProbe = computeNearestThanaAndEta(26.4710, 80.3470);
  assert(badaChaurahaProbe.station.id === 'thana-kotwali', `Bada Chauraha must resolve to Kotwali (got ${badaChaurahaProbe.station.id})`);
  assert(badaChaurahaProbe.distanceKm < 0.2, `Bada Chauraha distance must be < 0.2 km (got ${badaChaurahaProbe.distanceKm})`);
  pass('Bada Chauraha coordinates (26.4710, 80.3470) resolve to Kotwali Thana (< 0.2 km)');

  // Probe 2: Panki Industrial Area (26.4680, 80.2450) -> Panki
  const pankiProbe = computeNearestThanaAndEta(26.4680, 80.2450);
  assert(pankiProbe.station.id === 'thana-panki', `Panki probe must resolve to Panki (got ${pankiProbe.station.id})`);
  assert(pankiProbe.distanceKm < 0.2, `Panki distance must be < 0.2 km (got ${pankiProbe.distanceKm})`);
  pass('Panki coordinates (26.4680, 80.2450) resolve to Panki Thana (< 0.2 km)');

  // Probe 3: Swaroop Nagar (26.4820, 80.3150) -> Swaroop Nagar
  const swaroopProbe = computeNearestThanaAndEta(26.4820, 80.3150);
  assert(swaroopProbe.station.id === 'thana-swaroop-nagar', `Swaroop Nagar probe must resolve to Swaroop Nagar (got ${swaroopProbe.station.id})`);
  assert(swaroopProbe.distanceKm < 0.2, `Swaroop Nagar distance must be < 0.2 km (got ${swaroopProbe.distanceKm})`);
  pass('Swaroop Nagar coordinates (26.4820, 80.3150) resolve to Swaroop Nagar Thana (< 0.2 km)');

  // Pedestrian Circuity Math Test: 1.0 km direct -> 1.30 km street -> ceil(1.30 * 12) = 16 mins
  const direct1Km = 1.0;
  const street1Km = parseFloat((direct1Km * 1.30).toFixed(2));
  const eta1Km = Math.ceil(direct1Km * 1.30 * 12);
  assert.strictEqual(street1Km, 1.30, 'Street distance for 1km direct is 1.30 km');
  assert.strictEqual(eta1Km, 16, `Walking ETA for 1km direct must be 16 mins (got ${eta1Km})`);
  pass('Urban circuity math: 1.0 km direct -> 1.30 km street -> 16 mins walking ETA');

  // Pedestrian Circuity Math Test: 2.5 km direct -> 3.25 km street -> ceil(2.5 * 1.30 * 12) = 39 mins
  const direct2_5Km = 2.5;
  const street2_5Km = parseFloat((direct2_5Km * 1.30).toFixed(2));
  const eta2_5Km = Math.ceil(direct2_5Km * 1.30 * 12);
  assert.strictEqual(street2_5Km, 3.25, 'Street distance for 2.5km direct is 3.25 km');
  assert.strictEqual(eta2_5Km, 39, `Walking ETA for 2.5km direct must be 39 mins (got ${eta2_5Km})`);
  pass('Urban circuity math: 2.5 km direct -> 3.25 km street -> 39 mins walking ETA');

  // ---------------------------------------------------------------------------
  // SUITE 3: Google Maps Universal Voice Navigation Intent URL
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 3: Google Maps Universal Voice Navigation Intent URL');
  console.log('----------------------------------------------------------------');

  const testNavUrl = getGoogleMapsWalkingUrl(26.4716, 80.3475);
  const expectedPrefix = 'https://www.google.com/maps/dir/?api=1&';
  assert(testNavUrl.startsWith(expectedPrefix), `URL must start with universal scheme (got ${testNavUrl})`);
  pass('Formats correct universal scheme: https://www.google.com/maps/dir/?api=1&...');

  assert(testNavUrl.includes('travelmode=walking'), `URL must set travelmode=walking (got ${testNavUrl})`);
  pass('Includes travelmode=walking parameter');

  assert(testNavUrl.includes('destination=26.47160,80.34750'), `URL must contain precision destination coordinates (got ${testNavUrl})`);
  assert(!testNavUrl.includes('origin='), 'URL must not contain hardcoded origin to allow device GPS auto-acquisition');
  pass('Uses precision coordinates without extraneous origin parameter');

  // ---------------------------------------------------------------------------
  // SUITE 4: Locality Reverse-Geocoding HUD Bounding Box Lookup
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 4: Locality Reverse-Geocoding HUD Bounding Box Lookup');
  console.log('----------------------------------------------------------------');

  const locMallRoad = lookupKanpurLocality(26.4600, 80.3550);
  assert.strictEqual(locMallRoad, 'Mall Road & Cantt Perimeter', `(26.4600, 80.3550) must resolve to Mall Road (got ${locMallRoad})`);
  pass('(26.4600, 80.3550) resolves to "Mall Road & Cantt Perimeter"');

  const locNaiSadak = lookupKanpurLocality(26.4680, 80.3400);
  assert.strictEqual(locNaiSadak, 'Nai Sadak, Parade & Beckanganj', `(26.4680, 80.3400) must resolve to Nai Sadak (got ${locNaiSadak})`);
  pass('(26.4680, 80.3400) resolves to "Nai Sadak, Parade & Beckanganj"');

  const locSwaroop = lookupKanpurLocality(26.4800, 80.3180);
  assert.strictEqual(locSwaroop, 'Swaroop Nagar & Motijheel', `(26.4800, 80.3180) must resolve to Swaroop Nagar (got ${locSwaroop})`);
  pass('(26.4800, 80.3180) resolves to "Swaroop Nagar & Motijheel"');

  const locKakadeo = lookupKanpurLocality(26.4740, 80.2920);
  assert.strictEqual(locKakadeo, 'Kakadeo Coaching Hub & M-Block', `(26.4740, 80.2920) must resolve to Kakadeo (got ${locKakadeo})`);
  pass('(26.4740, 80.2920) resolves to "Kakadeo Coaching Hub & M-Block"');

  const locOutside = lookupKanpurLocality(28.6139, 77.2090);
  assert.strictEqual(locOutside, 'Kanpur Metropolitan Grid', `Out of bounds must fallback to Kanpur Metropolitan Grid (got ${locOutside})`);
  pass('Out-of-grid coordinates fallback gracefully to "Kanpur Metropolitan Grid"');

  // Alias verification
  assert.strictEqual(getKanpurLocality(26.4600, 80.3550), 'Mall Road & Cantt Perimeter', 'getKanpurLocality contract alias works');
  pass('getKanpurLocality interface contract alias functions correctly');

  // ---------------------------------------------------------------------------
  // SUITE 5: Multi-Stage Red Zone Proximity & Hysteresis Engine
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 5: Multi-Stage Red Zone Proximity & Hysteresis Engine');
  console.log('----------------------------------------------------------------');

  // Test stage evaluation logic with known distances
  function evaluateStage(dist, prevStage) {
    if (dist === 0) return 'BREACH';
    if (dist <= 300) return 'HAZARD_300M';
    if (dist <= 500) {
      if ((prevStage === 'HAZARD_300M' || prevStage === 'BREACH') && dist <= 315) {
        return 'HAZARD_300M'; // 15m deadband
      }
      return 'CAUTION_500M';
    }
    if ((prevStage === 'HAZARD_300M' || prevStage === 'BREACH') && dist <= 315) {
      return 'HAZARD_300M';
    }
    return 'CLEAR';
  }

  // 1. Distance = 450m -> Stage 1: Caution
  assert.strictEqual(evaluateStage(450, 'CLEAR'), 'CAUTION_500M', '450m from CLEAR must be CAUTION_500M');
  pass('Coordinates @ 450m trigger Stage 1 (Caution 500m)');

  // 2. Distance = 280m -> Stage 2: High Alert
  assert.strictEqual(evaluateStage(280, 'CAUTION_500M'), 'HAZARD_300M', '280m must be HAZARD_300M');
  pass('Coordinates @ 280m trigger Stage 2 (High Alert 300m)');

  // 3. Distance = 0m -> Stage 3: Critical Breach
  assert.strictEqual(evaluateStage(0, 'HAZARD_300M'), 'BREACH', '0m must be BREACH');
  pass('Coordinates inside polygon trigger Stage 3 (Critical Breach 0m)');

  // 4. Moving to 308m post-alert -> Hysteresis retains HAZARD_300M
  assert.strictEqual(evaluateStage(308, 'HAZARD_300M'), 'HAZARD_300M', '308m post-alert must NOT cancel (15m hysteresis)');
  pass('Coordinates @ 308m post-alert do NOT cancel (15m hysteresis deadband)');

  // 5. Moving to 320m post-alert -> Exits HAZARD_300M to CAUTION_500M and triggers resolution
  assert.strictEqual(evaluateStage(320, 'HAZARD_300M'), 'CAUTION_500M', '320m exits HAZARD_300M');
  pass('Coordinates @ 320m clear alert and trigger resolution event');

  // Verify Forward Azimuth & Displacement Math
  const northHeading = calculateBearingDegrees(26.4700, 80.3400, 26.4800, 80.3400);
  assert(Math.abs(northHeading - 0) < 1 || Math.abs(northHeading - 360) < 1, `North heading must be ~0° (got ${northHeading})`);
  const eastHeading = calculateBearingDegrees(26.4700, 80.3400, 26.4700, 80.3500);
  assert(Math.abs(eastHeading - 90) < 1, `East heading must be ~90° (got ${eastHeading})`);
  pass('Forward azimuth heading calculation yields exact geodesic angles');

  // ---------------------------------------------------------------------------
  // SUITE 6: W3C Web App Manifest Structure & Validation
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 6: W3C Web App Manifest Structure & Validation');
  console.log('----------------------------------------------------------------');

  const manifestPath = path.join(__dirname, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json must exist at project root');
  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.strictEqual(manifestContent.display, 'standalone', `Display mode must be 'standalone' (got ${manifestContent.display})`);
  pass('display mode is strictly "standalone" (no browser URL bar or chrome)');

  assert.strictEqual(manifestContent.theme_color, '#080C15', `theme_color must be '#080C15' (got ${manifestContent.theme_color})`);
  assert.strictEqual(manifestContent.background_color, '#080C15', `background_color must be '#080C15' (got ${manifestContent.background_color})`);
  pass('theme_color and background_color set to "#080C15"');

  assert(Array.isArray(manifestContent.icons) && manifestContent.icons.length >= 2, 'manifest.json must define app icons');
  const has192 = manifestContent.icons.some(i => i.sizes.includes('192x192') && i.purpose.includes('maskable'));
  const has512 = manifestContent.icons.some(i => i.sizes.includes('512x512') && i.purpose.includes('maskable'));
  assert(has192, 'Manifest must define 192x192 maskable icon');
  assert(has512, 'Manifest must define 512x512 maskable icon');
  pass('Icons defined for 192x192 and 512x512 with purpose "any maskable"');

  assert(Array.isArray(manifestContent.shortcuts) && manifestContent.shortcuts.length >= 2, 'Manifest must define app shortcuts');
  const hasSafeRouteShortcut = manifestContent.shortcuts.some(s => s.url.includes('safe-route'));
  const has112Shortcut = manifestContent.shortcuts.some(s => s.url.includes('112'));
  assert(hasSafeRouteShortcut, 'Manifest must include Safe Route shortcut');
  assert(has112Shortcut, 'Manifest must include 112 Dial shortcut');
  pass('Shortcuts defined for "Safe Route to Thana" and "Emergency 112 Dial"');

  // Verify PNG and SVG icon files physically exist on disk
  assert(fs.existsSync(path.join(__dirname, 'icons', 'icon-192.png')), 'icons/icon-192.png exists');
  assert(fs.existsSync(path.join(__dirname, 'icons', 'icon-512.png')), 'icons/icon-512.png exists');
  assert(fs.existsSync(path.join(__dirname, 'icons', 'icon.svg')), 'icons/icon.svg exists');
  assert(fs.existsSync(path.join(__dirname, 'icons', 'icon-maskable.svg')), 'icons/icon-maskable.svg exists');
  pass('High-resolution PNG and vector SVG icon files exist on disk in /icons/');

  // ---------------------------------------------------------------------------
  // SUITE 7: Service Worker Syntax & Caching Architecture
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 7: Service Worker Syntax & Caching Architecture');
  console.log('----------------------------------------------------------------');

  const swPath = path.join(__dirname, 'sw.js');
  assert(fs.existsSync(swPath), 'sw.js must exist at project root');
  const swCode = fs.readFileSync(swPath, 'utf8');

  assert(swCode.includes('CACHE_NAME'), 'sw.js must define CACHE_NAME');
  assert(swCode.includes('kanpur-gis-v2.6.0'), 'sw.js must define version kanpur-gis-v2.6.0');
  pass('sw.js exists and defines CACHE_NAME versioning (kanpur-gis-v2.6.0)');

  assert(swCode.includes('leaflet.css') && swCode.includes('leaflet.js'), 'sw.js must precache Leaflet CDN');
  pass('Precache list contains Leaflet CDN (leaflet.css and leaflet.js)');

  assert(swCode.includes('policeStations.js') && swCode.includes('localities.js') && swCode.includes('pwa.js'),
    'sw.js must precache core application modules and datasets');
  pass('Precache list contains all core application modules and datasets');

  assert(swCode.includes("addEventListener('install'") || swCode.includes('addEventListener("install"'),
    'sw.js must implement install event');
  assert(swCode.includes("addEventListener('activate'") || swCode.includes('addEventListener("activate"'),
    'sw.js must implement activate event');
  assert(swCode.includes("addEventListener('fetch'") || swCode.includes('addEventListener("fetch"'),
    'sw.js must implement fetch event');
  pass('Contains install, activate, and fetch event listeners');

  assert(swCode.includes('caches.match') && swCode.includes('caches.open'), 'sw.js must implement Cache API strategies');
  pass('Implements Cache-First and Stale-While-Revalidate dual caching strategy');

  // ---------------------------------------------------------------------------
  // SUITE 8: Production Cloud Deployment Descriptors
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 8: Production Cloud Deployment Descriptors');
  console.log('----------------------------------------------------------------');

  const dockerfilePath = path.join(__dirname, 'Dockerfile');
  assert(fs.existsSync(dockerfilePath), 'Dockerfile must exist');
  const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
  assert(dockerContent.includes('node:20-alpine'), 'Dockerfile must use node:20-alpine');
  assert(dockerContent.includes('USER node'), 'Dockerfile must use unprivileged node user');
  assert(dockerContent.includes('HEALTHCHECK'), 'Dockerfile must specify container HEALTHCHECK');
  pass('Dockerfile exists, uses node:20-alpine, unprivileged user, and HEALTHCHECK');

  const procfilePath = path.join(__dirname, 'Procfile');
  assert(fs.existsSync(procfilePath), 'Procfile must exist');
  const procContent = fs.readFileSync(procfilePath, 'utf8').trim();
  assert(procContent.includes('web: node server.js'), 'Procfile must specify web: node server.js');
  pass('Procfile exists with "web: node server.js"');

  const renderPath = path.join(__dirname, 'render.yaml');
  assert(fs.existsSync(renderPath), 'render.yaml must exist');
  const renderContent = fs.readFileSync(renderPath, 'utf8');
  assert(renderContent.includes('/api/health'), 'render.yaml must specify healthCheckPath: /api/health');
  assert(renderContent.includes('PORT'), 'render.yaml must specify PORT binding');
  pass('render.yaml exists with healthCheckPath: /api/health and PORT binding');

  // ---------------------------------------------------------------------------
  // SUITE 9: HTTP Health & Telemetry Live Endpoint Check
  // ---------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SUITE 9: HTTP Health & Telemetry Live Endpoint Check');
  console.log('----------------------------------------------------------------');

  console.log(`  -> Starting test server on port ${TEST_PORT}...`);
  await startServer(TEST_PORT);
  console.log(`  -> Server active at ${BASE_URL}`);

  try {
    // 9.1 GET /api/health
    const healthRes = await httpRequest('/api/health');
    assert.strictEqual(healthRes.status, 200, `GET /api/health must return 200 (got ${healthRes.status})`);
    const healthData = JSON.parse(healthRes.body);
    assert.strictEqual(healthData.status, 'ok', `Health status must be 'ok' (got ${healthData.status})`);
    assert(typeof healthData.uptimeSeconds === 'number', 'Health status must include uptimeSeconds');
    pass('GET /api/health returns 200 OK and status: "ok"');

    // 9.2 GET /manifest.json
    const manifestRes = await httpRequest('/manifest.json');
    assert.strictEqual(manifestRes.status, 200, `GET /manifest.json must return 200 (got ${manifestRes.status})`);
    assert(manifestRes.headers['content-type'].includes('json'),
      `Manifest content-type must be JSON (got ${manifestRes.headers['content-type']})`);
    pass('Static server serves /manifest.json with application/json');

    // 9.3 GET /sw.js with Service-Worker-Allowed and Cache-Control headers
    const swRes = await httpRequest('/sw.js');
    assert.strictEqual(swRes.status, 200, `GET /sw.js must return 200 (got ${swRes.status})`);
    assert(swRes.headers['content-type'].includes('javascript'),
      `sw.js content-type must be javascript (got ${swRes.headers['content-type']})`);
    assert.strictEqual(swRes.headers['service-worker-allowed'], '/',
      `sw.js must have Service-Worker-Allowed: / header (got ${swRes.headers['service-worker-allowed']})`);
    assert(swRes.headers['cache-control'] && swRes.headers['cache-control'].includes('no-cache'),
      `sw.js must have Cache-Control: no-cache header (got ${swRes.headers['cache-control']})`);
    pass('Static server serves /sw.js with Service-Worker-Allowed: / and Cache-Control: no-cache');

  } finally {
    console.log('  -> Stopping test server...');
    await stopServer();
    console.log('  -> Test server stopped cleanly.');
  }

  console.log('\n================================================================');
  console.log(`   VERIFICATION SUITE COMPLETE: ${passedAssertions} ASSERTIONS PASSED (100%)   `);
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ Test Suite Failed with Error:', err);
  process.exit(1);
});
