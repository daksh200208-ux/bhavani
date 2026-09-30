/**
 * Adversarial Test Suite for Kanpur Tactical Safety & Live GPS Telemetry Platform
 * Challenger 2: Adversarial Geofence, Red Zones & SOS Redundancy
 * 
 * Verifies:
 * 1. Geofence Boundary Tests:
 *    - 349m from boundary -> MUST trigger 350m proximity alert
 *    - 351m and 375m from boundary -> MUST NOT trigger alert (hysteresis verification)
 *    - Strictly inside irregular polygon -> MUST trigger CRITICAL BREACH alert
 * 2. Dynamic Red Zone Push Latency:
 *    - Multiple WebSocket clients connected
 *    - POST /api/redzones with new hotspot
 *    - Latency to all clients strictly <500ms
 * 3. Multi-Channel SOS Broadcast:
 *    - CLIENT_SOS_TRIGGER from client
 *    - All clients receive enriched SOS_EMERGENCY with Thana, SHO CUG, distance, coords, WhatsApp + SMS text
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const EventEmitter = require('events');

const { server, startServer, stopServer, wss } = require('../server');
const { signJwt, verifyJwt } = require('../server/auth');
const {
  evaluateGeofence,
  upsertRedZone,
  getActiveRedZones,
  distancePointToSegmentMeters,
  distancePointToPolygonBoundaryMeters,
  PROXIMITY_THRESHOLD_METERS
} = require('../server/geofence');
const { isPointInPolygon } = require('../js/data/crimeHotspots');
const { findNearestThana } = require('../server/personas');

const TEST_PORT = 3344;
const BASE_HTTP = `http://127.0.0.1:${TEST_PORT}`;
const BASE_WS = `ws://127.0.0.1:${TEST_PORT}`;

// =========================================================================
// UNIVERSAL WEBSOCKET CLIENT (ws or native RFC 6455 fallback)
// =========================================================================
function createWsClient(wsUrl, options = {}) {
  try {
    const WsModule = require('ws');
    return new WsModule(wsUrl, options);
  } catch (err) {
    return new NativeWsClient(wsUrl, options);
  }
}

class NativeWsClient extends EventEmitter {
  constructor(wsUrl, options = {}) {
    super();
    this.url = wsUrl;
    this.readyState = 0; // CONNECTING
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this._connect();
  }

  _connect() {
    const parsed = url.parse(this.url);
    const key = crypto.randomBytes(16).toString('base64');

    const req = http.request({
      hostname: parsed.hostname || '127.0.0.1',
      port: parsed.port || 80,
      path: parsed.path,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });

    req.on('upgrade', (res, socket, head) => {
      this.socket = socket;
      this.readyState = 1; // OPEN
      this.emit('open');

      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', () => {
        if (this.readyState !== 3) {
          this.readyState = 3;
          this.emit('close', 1006, 'Socket closed');
        }
      });
      socket.on('error', (e) => this.emit('error', e));
    });

    req.on('response', (res) => {
      this.readyState = 3;
      this.emit('close', res.statusCode, res.statusMessage);
    });

    req.on('error', (e) => {
      this.readyState = 3;
      this.emit('error', e);
    });

    req.end();
  }

  send(data) {
    if (this.readyState !== 1 || !this.socket) return;
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
    const len = payload.length;

    let header;
    if (len < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = 0x80 | len;
      const maskKey = crypto.randomBytes(4);
      maskKey.copy(header, 2);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) {
        masked[i] = payload[i] ^ maskKey[i % 4];
      }
      this.socket.write(Buffer.concat([header, masked]));
    } else if (len <= 65535) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
      const maskKey = crypto.randomBytes(4);
      maskKey.copy(header, 4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) {
        masked[i] = payload[i] ^ maskKey[i % 4];
      }
      this.socket.write(Buffer.concat([header, masked]));
    }
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3 || !this.socket) return;
    this.readyState = 2;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const len = 2 + reasonBuf.length;
    const buf = Buffer.alloc(6 + len);
    buf[0] = 0x88;
    buf[1] = 0x80 | len;
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(buf, 2);
    const unmasked = Buffer.alloc(len);
    unmasked.writeUInt16BE(code, 0);
    reasonBuf.copy(unmasked, 2);
    for (let i = 0; i < len; i++) {
      buf[6 + i] = unmasked[i] ^ maskKey[i % 4];
    }
    this.socket.write(buf);
    setTimeout(() => {
      if (this.socket) this.socket.destroy();
      this.readyState = 3;
      this.emit('close', code, reason);
    }, 50);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      const isMasked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) break;
        payloadLen = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) break;
        payloadLen = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) break;
        maskKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) break;

      const payload = this.buffer.slice(offset, offset + payloadLen);
      this.buffer = this.buffer.slice(offset + payloadLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x01) { // Text frame
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x08) { // Close frame
        const closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const closeReason = payload.length > 2 ? payload.slice(2).toString('utf8') : '';
        this.readyState = 3;
        this.emit('close', closeCode, closeReason);
        if (this.socket) this.socket.destroy();
      } else if (opcode === 0x09) { // Ping
        // Pong
      }
    }
  }
}

// HTTP request helper
function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(`${BASE_HTTP}${path}`);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const reqHeaders = { ...headers };
    if (data) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: method.toUpperCase(),
      headers: reqHeaders
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => { resBody += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(resBody); } catch (e) { json = resBody; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Sleep helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// =========================================================================
// TEST EXECUTION RUNNER
// =========================================================================
async function runAdversarialSuite() {
  console.log('================================================================');
  console.log('   KANPUR ADVERSARIAL TEST SUITE: GEOFENCE, RED ZONES & SOS     ');
  console.log('   Agent: Challenger 2 (Empirical Testing & Verification)       ');
  console.log('================================================================\n');

  const testResults = {
    boundary349m: false,
    boundary351m: false,
    boundary375m: false,
    irregularPolygonBreach: false,
    redZonePushLatency: false,
    sosEnrichmentAndBroadcast: false,
    details: {}
  };

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`  ❌ FAIL: ${message}`);
      throw new Error(message);
    } else {
      console.log(`  ✅ PASS: ${message}`);
      passedTests++;
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 1: MATHEMATICAL & ALGORITHMIC BOUNDARY ANALYSIS
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('SECTION 1: Precise Boundary & Geofence Distance Analysis');
  console.log('----------------------------------------------------------------');

  // Let's create an irregular polygon red zone to test boundary and containment
  // Irregular polygon in clear sector (between Babupurwa and Chakeri):
  // Lat: 26.4320 to 26.4400, Lng: 80.3600 to 80.3750 (Isolated from all existing hotspots)
  const irregularZone = {
    id: 'zone-adv-irregular-poly',
    name: 'Adv Irregular Flashpoint Belt',
    riskLevel: 'CRITICAL',
    polygon: [
      [26.4400, 80.3600], // P0
      [26.4400, 80.3750], // P1 (horizontal edge along lat 26.4400, lng 80.3600 to 80.3750)
      [26.4320, 80.3750], // P2
      [26.4320, 80.3680], // P3 (concavity inner corner)
      [26.4360, 80.3680], // P4
      [26.4360, 80.3600]  // P5
    ]
  };

  upsertRedZone(irregularZone);
  console.log('  -> Registered dynamic irregular test polygon: zone-adv-irregular-poly');

  // Along segment P0-P1: latA = 26.4400, lngA = 80.3600; latB = 26.4400, lngB = 80.3750
  // Midpoint longitude = 80.3675.
  // We place points north of this segment at lng = 80.3675.
  // 1 degree latitude = 111194.9266 meters.
  const METERS_PER_DEG_LAT = (Math.PI / 180) * 6371000;
  console.log(`  -> Coordinate constant: 1 deg lat = ${METERS_PER_DEG_LAT.toFixed(4)} meters`);

  // Target distances: 349m, 351m, 375m
  const deltaLat349 = 349.0 / METERS_PER_DEG_LAT;
  const deltaLat351 = 351.0 / METERS_PER_DEG_LAT;
  const deltaLat375 = 375.0 / METERS_PER_DEG_LAT;

  const point349 = [26.4400 + deltaLat349, 80.3675];
  const point351 = [26.4400 + deltaLat351, 80.3675];
  const point375 = [26.4400 + deltaLat375, 80.3675];

  // Point strictly inside the irregular polygon:
  // Inside the upper block: lat 26.4380, lng 80.3650
  const pointInside = [26.4380, 80.3650];

  // Point in the concave cutout (exterior, but within bounding box):
  // lat 26.4340, lng 80.3640 is OUTSIDE the cutout!
  const pointInCutout = [26.4340, 80.3640];

  // Test 1.1: Math distance at 349m
  const eval349 = evaluateGeofence(point349[0], point349[1]);
  console.log(`  -> Evaluation @ 349m: distance=${eval349.distanceMeters}m, status="${eval349.status}", isNear=${eval349.isNear}, isInside=${eval349.isInside}`);
  assert(eval349.distanceMeters === 349, `Computed distance @ 349m is exactly 349m (got ${eval349.distanceMeters}m)`);
  assert(eval349.status === 'PROXIMITY_350M', `Status @ 349m is 'PROXIMITY_350M' (got ${eval349.status})`);
  assert(eval349.isNear === true, `isNear @ 349m is true`);
  testResults.boundary349m = true;

  // Test 1.2: Math distance at 351m (hysteresis boundary)
  const eval351 = evaluateGeofence(point351[0], point351[1]);
  console.log(`  -> Evaluation @ 351m: distance=${eval351.distanceMeters}m, status="${eval351.status}", isNear=${eval351.isNear}, isInside=${eval351.isInside}`);
  assert(eval351.distanceMeters === 351, `Computed distance @ 351m is exactly 351m (got ${eval351.distanceMeters}m)`);
  assert(eval351.status === 'SAFE', `Status @ 351m is 'SAFE' (got ${eval351.status})`);
  assert(eval351.isNear === false, `isNear @ 351m is false (hysteresis enforced)`);
  testResults.boundary351m = true;

  // Test 1.3: Math distance at 375m (clear safe margin)
  const eval375 = evaluateGeofence(point375[0], point375[1]);
  console.log(`  -> Evaluation @ 375m: distance=${eval375.distanceMeters}m, status="${eval375.status}", isNear=${eval375.isNear}, isInside=${eval375.isInside}`);
  assert(eval375.distanceMeters === 375, `Computed distance @ 375m is exactly 375m (got ${eval375.distanceMeters}m)`);
  assert(eval375.status === 'SAFE', `Status @ 375m is 'SAFE' (got ${eval375.status})`);
  assert(eval375.isNear === false, `isNear @ 375m is false`);
  testResults.boundary375m = true;

  // Test 1.4: Point strictly inside irregular polygon
  const evalInside = evaluateGeofence(pointInside[0], pointInside[1]);
  console.log(`  -> Evaluation strictly inside: distance=${evalInside.distanceMeters}m, status="${evalInside.status}", isNear=${evalInside.isNear}, isInside=${evalInside.isInside}`);
  assert(evalInside.isInside === true, `Strictly inside irregular polygon reports isInside=true`);
  assert(evalInside.distanceMeters === 0, `Strictly inside irregular polygon reports distance=0m`);
  assert(evalInside.status === 'BREACH', `Strictly inside irregular polygon reports status='BREACH'`);
  testResults.irregularPolygonBreach = true;

  // Test 1.5: Point in concavity cutout (must NOT be inside)
  const evalCutout = evaluateGeofence(pointInCutout[0], pointInCutout[1]);
  console.log(`  -> Evaluation in concavity cutout: distance=${evalCutout.distanceMeters}m, status="${evalCutout.status}", isInside=${evalCutout.isInside}`);
  assert(evalCutout.isInside === false, `Concavity cutout point is NOT inside irregular polygon`);

  // -------------------------------------------------------------------------
  // SECTION 2: LIVE SERVER & WEBSOCKET GEOFENCE INTEGRATION
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SECTION 2: Server WebSocket Live Geofence Alert Triggering');
  console.log('----------------------------------------------------------------');

  await startServer(TEST_PORT);
  console.log(`  -> Test server listening on ${BASE_HTTP}`);

  const adminToken = signJwt({ sub: 'admin-tester', name: 'Command Officer', role: 'admin' });
  const clientToken1 = signJwt({ sub: 'unit-challenger-1', name: 'Patrol 1', role: 'officer', callsign: 'CHALLENGER-1' });
  const clientToken2 = signJwt({ sub: 'unit-challenger-2', name: 'Patrol 2', role: 'officer', callsign: 'CHALLENGER-2' });

  const wsClient1 = createWsClient(`${BASE_WS}/telemetry?token=${clientToken1}`);
  const wsClient2 = createWsClient(`${BASE_WS}/telemetry?token=${clientToken2}`);

  await Promise.all([
    new Promise(r => wsClient1.on('open', r)),
    new Promise(r => wsClient2.on('open', r))
  ]);
  console.log('  -> 2 authenticated WebSocket clients connected.');

  // Test 2.1: Send coordinate @ 349m -> MUST trigger GEOFENCE_ALERT
  let alertReceived349 = null;
  const alertPromise349 = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'GEOFENCE_ALERT' && msg.unitId === 'unit-challenger-1') {
          alertReceived349 = msg;
          wsClient2.removeListener('message', handler);
          resolve();
        }
      } catch (e) {}
    };
    wsClient2.on('message', handler);
    setTimeout(resolve, 2000);
  });

  wsClient1.send(JSON.stringify({
    type: 'CLIENT_LOCATION_UPDATE',
    payload: {
      unitId: 'unit-challenger-1',
      lat: point349[0],
      lng: point349[1],
      heading: 180,
      speedKmH: 30,
      batteryPct: 90,
      timestamp: Date.now()
    }
  }));

  await alertPromise349;
  assert(alertReceived349 !== null, 'Client @ 349m triggered GEOFENCE_ALERT on peer monitor');
  assert(alertReceived349.status === 'PROXIMITY_350M', `Alert status is 'PROXIMITY_350M' (got ${alertReceived349.status})`);
  assert(alertReceived349.distanceMeters === 349, `Alert distance is 349m (got ${alertReceived349.distanceMeters}m)`);
  console.log(`  -> Alert payload verified: "${alertReceived349.message}"`);

  // Test 2.2: Send coordinate @ 351m -> MUST NOT trigger GEOFENCE_ALERT
  let alertReceived351 = null;
  const alertPromise351 = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'GEOFENCE_ALERT' && msg.unitId === 'unit-challenger-1') {
          alertReceived351 = msg;
        }
      } catch (e) {}
    };
    wsClient2.on('message', handler);
    setTimeout(() => {
      wsClient2.removeListener('message', handler);
      resolve();
    }, 1500);
  });

  wsClient1.send(JSON.stringify({
    type: 'CLIENT_LOCATION_UPDATE',
    payload: {
      unitId: 'unit-challenger-1',
      lat: point351[0],
      lng: point351[1],
      heading: 180,
      speedKmH: 30,
      batteryPct: 90,
      timestamp: Date.now()
    }
  }));

  await alertPromise351;
  assert(alertReceived351 === null, 'Client @ 351m did NOT trigger GEOFENCE_ALERT (hysteresis verified)');

  // Test 2.3: Send coordinate @ 375m -> MUST NOT trigger GEOFENCE_ALERT
  let alertReceived375 = null;
  const alertPromise375 = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'GEOFENCE_ALERT' && msg.unitId === 'unit-challenger-1') {
          alertReceived375 = msg;
        }
      } catch (e) {}
    };
    wsClient2.on('message', handler);
    setTimeout(() => {
      wsClient2.removeListener('message', handler);
      resolve();
    }, 1500);
  });

  wsClient1.send(JSON.stringify({
    type: 'CLIENT_LOCATION_UPDATE',
    payload: {
      unitId: 'unit-challenger-1',
      lat: point375[0],
      lng: point375[1],
      heading: 180,
      speedKmH: 30,
      batteryPct: 90,
      timestamp: Date.now()
    }
  }));

  await alertPromise375;
  assert(alertReceived375 === null, 'Client @ 375m did NOT trigger GEOFENCE_ALERT');

  // Test 2.4: Send coordinate strictly INSIDE irregular polygon -> MUST trigger CRITICAL BREACH
  let breachAlertReceived = null;
  const breachPromise = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'GEOFENCE_ALERT' && msg.unitId === 'unit-challenger-breach') {
          breachAlertReceived = msg;
          wsClient2.removeListener('message', handler);
          resolve();
        }
      } catch (e) {}
    };
    wsClient2.on('message', handler);
    setTimeout(resolve, 2000);
  });

  wsClient1.send(JSON.stringify({
    type: 'CLIENT_LOCATION_UPDATE',
    payload: {
      unitId: 'unit-challenger-breach',
      lat: pointInside[0],
      lng: pointInside[1],
      heading: 180,
      speedKmH: 15,
      batteryPct: 88,
      timestamp: Date.now()
    }
  }));

  await breachPromise;
  assert(breachAlertReceived !== null, 'Client inside irregular polygon triggered GEOFENCE_ALERT');
  assert(breachAlertReceived.status === 'BREACH', `Breach status is 'BREACH' (got ${breachAlertReceived.status})`);
  assert(breachAlertReceived.distanceMeters === 0, `Breach distance is 0m (got ${breachAlertReceived.distanceMeters}m)`);
  console.log(`  -> Critical breach payload: "${breachAlertReceived.message}"`);

  // -------------------------------------------------------------------------
  // SECTION 3: DYNAMIC RED ZONE PUSH LATENCY (<500MS SLA)
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SECTION 3: Dynamic Red Zone Push Latency (<500ms SLA)');
  console.log('----------------------------------------------------------------');

  // Connect a cluster of 6 concurrent WebSocket clients
  const clientClusterSize = 6;
  const clientCluster = [];
  console.log(`  -> Connecting ${clientClusterSize} concurrent WebSocket clients...`);

  for (let i = 0; i < clientClusterSize; i++) {
    const tok = signJwt({ sub: `cluster-user-${i}`, name: `Cluster Officer ${i}`, role: 'officer' });
    const cl = createWsClient(`${BASE_WS}/telemetry?token=${tok}`);
    clientCluster.push(cl);
  }

  await Promise.all(clientCluster.map(c => new Promise(r => c.on('open', r))));
  console.log(`  -> All ${clientClusterSize} clients connected and authenticated.`);

  const dynamicHotspot = {
    id: `zone-flash-hotspot-${Date.now()}`,
    name: 'Tactical Dynamic Flashpoint Hotspot',
    riskLevel: 'CRITICAL',
    category: 'Armed Robbery Intercept',
    color: '#DC2626',
    center: [26.4700, 80.3100],
    radiusMeters: 500,
    polygon: [
      [26.4740, 80.3060],
      [26.4740, 80.3140],
      [26.4660, 80.3140],
      [26.4660, 80.3060]
    ]
  };

  const receiveTimestamps = new Map();
  let pushReceivedCount = 0;

  const clusterPushPromise = new Promise((resolve) => {
    clientCluster.forEach((c, idx) => {
      c.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'RED_ZONE_PUSH' && msg.zone && msg.zone.id === dynamicHotspot.id) {
            receiveTimestamps.set(idx, Date.now());
            pushReceivedCount++;
            if (pushReceivedCount === clientCluster.length) {
              resolve();
            }
          }
        } catch (e) {}
      });
    });
    setTimeout(resolve, 3000); // 3s guard
  });

  const pushStartTime = Date.now();
  const pushHttpRes = await httpRequest('POST', '/api/redzones', { zone: dynamicHotspot }, {
    'Authorization': `Bearer ${adminToken}`
  });

  await clusterPushPromise;
  const totalPushLatencyMs = Date.now() - pushStartTime;

  console.log(`  -> POST /api/redzones HTTP status: ${pushHttpRes.status}`);
  console.log(`  -> Clients that received RED_ZONE_PUSH: ${pushReceivedCount}/${clientCluster.length}`);
  console.log(`  -> Measured broadcast latency across all clients: ${totalPushLatencyMs}ms`);

  assert(pushHttpRes.status === 200, `POST /api/redzones returned 200 OK (got ${pushHttpRes.status})`);
  assert(pushReceivedCount === clientCluster.length, `All ${clientCluster.length} clients received RED_ZONE_PUSH`);
  assert(totalPushLatencyMs < 500, `Broadcast latency is strictly <500ms (measured: ${totalPushLatencyMs}ms)`);
  testResults.redZonePushLatency = true;

  // -------------------------------------------------------------------------
  // SECTION 4: MULTI-CHANNEL SOS BROADCAST & ENRICHMENT
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SECTION 4: Multi-Channel SOS Broadcast & Redundancy Verification');
  console.log('----------------------------------------------------------------');

  const sosDistressCoord = [26.4499, 80.3319]; // Near Babupurwa / Juhi
  const expectedThana = findNearestThana(sosDistressCoord[0], sosDistressCoord[1]);
  console.log(`  -> Expected nearest Thana for coordinates [${sosDistressCoord}]: ${expectedThana.name} (${expectedThana.distKm || expectedThana.distanceKm} km, CUG: ${expectedThana.cug || expectedThana.phone})`);

  let sosReceivedClientsCount = 0;
  let sampleDistressPacket = null;

  const sosBroadcastPromise = new Promise((resolve) => {
    // Monitor clients 1 to 5 for incoming SOS
    clientCluster.slice(1).forEach((c) => {
      c.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'SOS_EMERGENCY') {
            sosReceivedClientsCount++;
            sampleDistressPacket = msg;
            if (sosReceivedClientsCount === (clientCluster.length - 1)) {
              resolve();
            }
          }
        } catch (e) {}
      });
    });
    setTimeout(resolve, 3000);
  });

  // Client 0 triggers CLIENT_SOS_TRIGGER
  clientCluster[0].send(JSON.stringify({
    type: 'CLIENT_SOS_TRIGGER',
    payload: {
      unitId: 'unit-sos-test',
      unitName: 'Officer Under Attack',
      lat: sosDistressCoord[0],
      lng: sosDistressCoord[1],
      locality: 'Juhi Depot Crossing',
      reason: 'Hostile mob ambush'
    }
  }));

  await sosBroadcastPromise;
  console.log(`  -> Peer clients that received SOS_EMERGENCY: ${sosReceivedClientsCount}/${clientCluster.length - 1}`);

  assert(sampleDistressPacket !== null, 'SOS_EMERGENCY packet was received by peer clients');
  assert(sampleDistressPacket.type === 'SOS_EMERGENCY', `Packet type is 'SOS_EMERGENCY'`);
  assert(Array.isArray(sampleDistressPacket.coords) && sampleDistressPacket.coords[0] === sosDistressCoord[0], 'Coordinates match distressed unit');
  assert(sampleDistressPacket.nearestThana && sampleDistressPacket.nearestThana.name, `Nearest Thana is enriched (got: ${sampleDistressPacket.nearestThana?.name})`);
  assert(sampleDistressPacket.nearestThana.cug || sampleDistressPacket.nearestThana.phone, `SHO CUG phone is present in packet (got: ${sampleDistressPacket.nearestThana?.cug || sampleDistressPacket.nearestThana?.phone})`);
  assert(typeof sampleDistressPacket.whatsappPayload === 'string' && sampleDistressPacket.whatsappPayload.includes('EMERGENCY SOS'), 'WhatsApp payload is properly formatted with emergency header');
  assert(sampleDistressPacket.whatsappPayload.includes(expectedThana.name), 'WhatsApp payload mentions nearest Thana');
  assert(sampleDistressPacket.whatsappPayload.includes('maps.google.com'), 'WhatsApp payload contains Google Maps link');
  assert(typeof sampleDistressPacket.smsPayload === 'string' && sampleDistressPacket.smsPayload.startsWith('EMERGENCY SOS'), 'SMS payload is properly formatted');
  assert(sampleDistressPacket.distressId && sampleDistressPacket.distressId.startsWith('SOS-'), 'Unique distressId generated');

  console.log(`  -> WhatsApp Text sample:\n${sampleDistressPacket.whatsappPayload}`);
  console.log(`  -> SMS Text sample: "${sampleDistressPacket.smsPayload}"`);
  testResults.sosEnrichmentAndBroadcast = true;

  // -------------------------------------------------------------------------
  // SECTION 5: ADVERSARIAL EDGE CASES & SECURITY STRESS HARNESS
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SECTION 5: Adversarial Edge Cases & Security Stress Harness');
  console.log('----------------------------------------------------------------');

  // 5.1 Boundary threshold analysis (349.9m vs 350.1m)
  const deltaLat349_9 = 349.9 / METERS_PER_DEG_LAT;
  const point349_9 = [26.4400 + deltaLat349_9, 80.3675];
  const eval349_9 = evaluateGeofence(point349_9[0], point349_9[1]);
  console.log(`  -> Evaluation @ 349.9m: distance=${eval349_9.distanceMeters}m, status="${eval349_9.status}"`);
  assert(eval349_9.status === 'PROXIMITY_350M', 'Status @ 349.9m is PROXIMITY_350M (inside threshold)');

  const deltaLat350_1 = 350.1 / METERS_PER_DEG_LAT;
  const point350_1 = [26.4400 + deltaLat350_1, 80.3675];
  const eval350_1 = evaluateGeofence(point350_1[0], point350_1[1]);
  console.log(`  -> Evaluation @ 350.1m: distance=${eval350_1.distanceMeters}m, status="${eval350_1.status}"`);
  assert(eval350_1.status === 'SAFE', 'Status @ 350.1m is SAFE (outside threshold)');

  // 5.2 Point directly on the boundary edge
  const pointOnEdge = [26.4400, 80.3675];
  const evalOnEdge = evaluateGeofence(pointOnEdge[0], pointOnEdge[1]);
  console.log(`  -> Evaluation on edge: distance=${evalOnEdge.distanceMeters}m, status="${evalOnEdge.status}"`);
  assert(evalOnEdge.distanceMeters === 0, 'Distance directly on boundary edge is 0m');
  assert(evalOnEdge.isNear === true, 'isNear on boundary edge is true');

  // 5.3 Security Guard: Unauthenticated POST /api/redzones -> MUST return 401
  const unauthRes = await httpRequest('POST', '/api/redzones', { zone: { id: 'unauth-zone', name: 'Rogue Zone' } });
  console.log(`  -> Unauthenticated POST /api/redzones status: ${unauthRes.status}`);
  assert(unauthRes.status === 401, 'Unauthenticated red zone creation rejected with 401');

  // 5.4 Security Guard: Tampered / Forged Token POST /api/redzones -> MUST return 401
  const forgedToken = adminToken.slice(0, -6) + 'xxxxxx';
  const forgedRes = await httpRequest('POST', '/api/redzones', { zone: { id: 'forged-zone', name: 'Rogue Zone' } }, {
    'Authorization': `Bearer ${forgedToken}`
  });
  console.log(`  -> Forged token POST /api/redzones status: ${forgedRes.status}`);
  assert(forgedRes.status === 401, 'Forged cryptographic token rejected with 401');

  // 5.5 Missing id/name in POST /api/redzones -> MUST return 400
  const malformedRes = await httpRequest('POST', '/api/redzones', { invalid: 'payload' }, {
    'Authorization': `Bearer ${adminToken}`
  });
  console.log(`  -> Malformed payload POST /api/redzones status: ${malformedRes.status}`);
  assert(malformedRes.status === 400, 'Malformed red zone payload rejected with 400');

  // 5.6 Rapid Burst Push: Push 5 dynamic hotspots in a tight loop and verify all clients receive all 5 pushes
  const burstCount = 5;
  const burstZoneIds = [];
  const burstReceivedMap = new Map(); // zoneId -> Set of client indices
  for (let i = 0; i < burstCount; i++) {
    const zid = `burst-zone-${Date.now()}-${i}`;
    burstZoneIds.push(zid);
    burstReceivedMap.set(zid, new Set());
  }

  const burstPromise = new Promise((resolve) => {
    clientCluster.forEach((c, cIdx) => {
      c.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'RED_ZONE_PUSH' && burstReceivedMap.has(msg.zone?.id)) {
            burstReceivedMap.get(msg.zone.id).add(cIdx);
            let allComplete = true;
            for (const zid of burstZoneIds) {
              if (burstReceivedMap.get(zid).size < clientCluster.length) {
                allComplete = false;
                break;
              }
            }
            if (allComplete) resolve();
          }
        } catch (e) {}
      });
    });
    setTimeout(resolve, 3000);
  });

  const burstStartTime = Date.now();
  for (let i = 0; i < burstCount; i++) {
    await httpRequest('POST', '/api/redzones', {
      zone: {
        id: burstZoneIds[i],
        name: `Burst Tactical Zone ${i}`,
        riskLevel: 'HIGH',
        center: [26.4450 + (i * 0.001), 80.3650],
        radiusMeters: 400
      }
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
  }

  await burstPromise;
  const burstElapsed = Date.now() - burstStartTime;
  let burstTotalDeliveries = 0;
  for (const zid of burstZoneIds) {
    burstTotalDeliveries += burstReceivedMap.get(zid).size;
  }
  const expectedDeliveries = burstCount * clientCluster.length;
  console.log(`  -> Burst deliveries: ${burstTotalDeliveries}/${expectedDeliveries} across ${clientCluster.length} clients in ${burstElapsed}ms`);
  assert(burstTotalDeliveries === expectedDeliveries, `All ${expectedDeliveries} burst deliveries received with 0 dropped frames`);

  // 5.7 SOS with missing optional fields -> fallback defaults supplied
  let fallbackSosPacket = null;
  const fallbackSosPromise = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'SOS_EMERGENCY' && msg.unitId === 'unit-sparse') {
          fallbackSosPacket = msg;
          clientCluster[1].removeListener('message', handler);
          resolve();
        }
      } catch (e) {}
    };
    clientCluster[1].on('message', handler);
    setTimeout(resolve, 2000);
  });

  clientCluster[0].send(JSON.stringify({
    type: 'CLIENT_SOS_TRIGGER',
    payload: {
      unitId: 'unit-sparse',
      lat: 26.4665,
      lng: 80.3412
    }
  }));

  await fallbackSosPromise;
  assert(fallbackSosPacket !== null, 'Sparse SOS packet successfully broadcasted');
  assert(fallbackSosPacket.unitName === 'Cluster Officer 0' || fallbackSosPacket.unitName === 'unit-sparse', `UnitName securely fell back to authenticated user name '${fallbackSosPacket.unitName}'`);
  assert(fallbackSosPacket.locality.length > 0, 'Default locality supplied cleanly');
  assert(fallbackSosPacket.whatsappPayload.includes('maps.google.com'), 'WhatsApp text generated despite sparse fields');

  // 5.8 String coordinate inputs in SOS -> coerced cleanly without NaN
  let stringCoordSosPacket = null;
  const stringSosPromise = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'SOS_EMERGENCY' && msg.unitId === 'unit-str-coords') {
          stringCoordSosPacket = msg;
          clientCluster[1].removeListener('message', handler);
          resolve();
        }
      } catch (e) {}
    };
    clientCluster[1].on('message', handler);
    setTimeout(resolve, 2000);
  });

  clientCluster[0].send(JSON.stringify({
    type: 'CLIENT_SOS_TRIGGER',
    payload: {
      unitId: 'unit-str-coords',
      lat: '26.4776',
      lng: '80.2942',
      locality: 'Kakadeo Hub'
    }
  }));

  await stringSosPromise;
  assert(stringCoordSosPacket !== null, 'String coordinates coerced and broadcasted');
  assert(typeof stringCoordSosPacket.coords[0] === 'number' && !isNaN(stringCoordSosPacket.coords[0]), 'Lat coerced to valid finite number');
  assert(typeof stringCoordSosPacket.coords[1] === 'number' && !isNaN(stringCoordSosPacket.coords[1]), 'Lng coerced to valid finite number');

  // 5.9 REST Emergency Fallback: POST /api/emergency/sos -> broadcasts to WebSocket clients
  let restFallbackReceived = null;
  const restSosPromise = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'SOS_EMERGENCY' && msg.unitId === 'unit-rest-fallback') {
          restFallbackReceived = msg;
          clientCluster[2].removeListener('message', handler);
          resolve();
        }
      } catch (e) {}
    };
    clientCluster[2].on('message', handler);
    setTimeout(resolve, 2000);
  });

  const restSosRes = await httpRequest('POST', '/api/emergency/sos', {
    unitId: 'unit-rest-fallback',
    unitName: 'PRV Unit 14',
    lat: 26.4230,
    lng: 80.2890,
    locality: 'Barra Bypass Cut'
  });

  await restSosPromise;
  console.log(`  -> POST /api/emergency/sos response status: ${restSosRes.status}`);
  assert(restSosRes.status === 200, 'REST emergency dispatch returned 200 OK');
  assert(restFallbackReceived !== null, 'REST emergency dispatch broadcasted to connected WebSocket clients');
  assert(restFallbackReceived.nearestThana.name.includes('Barra'), 'Barra Thana correctly identified for Barra coordinates');

  // -------------------------------------------------------------------------
  // CLEANUP & SUMMARY
  // -------------------------------------------------------------------------
  wsClient1.close();
  wsClient2.close();
  clientCluster.forEach(c => c.close());
  await stopServer();

  console.log('\n================================================================');
  console.log(`ADVERSARIAL VERIFICATION COMPLETE: ${passedTests}/${totalTests} ASSERTIONS PASSED (100%)`);
  console.log('================================================================\n');

  return {
    success: true,
    totalTests,
    passedTests,
    testResults,
    sampleDistressPacket,
    totalPushLatencyMs
  };
}

if (require.main === module) {
  runAdversarialSuite()
    .then((res) => {
      console.log('Adversarial Test Suite execution successful.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Adversarial Test Suite execution failed:', err);
      process.exit(1);
    });
}

module.exports = { runAdversarialSuite };
