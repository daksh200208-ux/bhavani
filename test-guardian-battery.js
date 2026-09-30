/**
 * Automated Verification Suite: Feature 3 (Watch Over Me) & Feature 5 (Dead-Battery Distress Beacon)
 * Pure Node.js Standard Library (Zero-npm runtime dependency)
 * Tests REST endpoints, WebSocket broadcasts, static routing, and client module integrity.
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedCount++;
  }
}

// ---------------------------------------------------------------------------
// Zero-Dependency Native RFC 6455 WebSocket Client
// ---------------------------------------------------------------------------
class NativeWsClient extends EventEmitter {
  constructor(wsUrl) {
    super();
    this.url = wsUrl;
    this.readyState = 0; // CONNECTING
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this._connect();
  }

  _connect() {
    const u = new URL(this.url);
    const key = crypto.randomBytes(16).toString('base64');

    const req = http.request({
      hostname: u.hostname || '127.0.0.1',
      port: u.port || 80,
      path: u.pathname + u.search,
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

      if (head && head.length > 0) {
        this._onData(head);
      }

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
    const maskKey = crypto.randomBytes(4);
    let header;

    if (len <= 125) {
      header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = 0x80 | len;
      maskKey.copy(header, 2);
    } else if (len <= 65535) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
      maskKey.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
      maskKey.copy(header, 10);
    }

    const maskedPayload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      maskedPayload[i] = payload[i] ^ maskKey[i % 4];
    }

    this.socket.write(Buffer.concat([header, maskedPayload]));
  }

  close() {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) {}
    }
    this.readyState = 3;
    this.emit('close', 1000, 'Normal');
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];
      const opcode = byte1 & 0x0f;
      const isMasked = (byte2 & 0x80) !== 0;
      let payloadLen = byte2 & 0x7f;
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
        for (let i = 0; i < payloadLen; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP Request Helper
// ---------------------------------------------------------------------------
function makeRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint, BASE_URL);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', (err) => reject(err));

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 KANPUR TACTICAL GIS - GUARDIAN & BATTERY BEACON TEST SUITE');
  console.log('=============================================================\n');

  // --- Suite 1: Client Script Integrity ---
  console.log('📋 Suite 1: Client Script Integrity');
  try {
    const guardianScript = fs.readFileSync(path.join(__dirname, 'js', 'guardian.js'), 'utf8');
    assert(guardianScript.includes('class GuardianJourneyManager'), 'js/guardian.js defines GuardianJourneyManager');
    assert(guardianScript.includes('checkGuardianViewerMode'), 'js/guardian.js contains guardian viewer mode check');
    assert(guardianScript.includes('shareJourneyToWhatsApp'), 'js/guardian.js contains WhatsApp journey sharing');

    const batteryScript = fs.readFileSync(path.join(__dirname, 'js', 'batteryBeacon.js'), 'utf8');
    assert(batteryScript.includes('class DeadBatteryBeaconManager'), 'js/batteryBeacon.js defines DeadBatteryBeaconManager');
    assert(batteryScript.includes('triggerDeadBatteryDistress'), 'js/batteryBeacon.js contains distress beacon trigger');
    assert(batteryScript.includes('getBattery'), 'js/batteryBeacon.js checks Hardware Battery API');

    const appScript = fs.readFileSync(path.join(__dirname, 'js', 'app.js'), 'utf8');
    assert(appScript.includes('GuardianJourneyManager'), 'js/app.js instantiates GuardianJourneyManager');
    assert(appScript.includes('DeadBatteryBeaconManager'), 'js/app.js instantiates DeadBatteryBeaconManager');

    const styles = fs.readFileSync(path.join(__dirname, 'css', 'styles.css'), 'utf8');
    assert(styles.includes('.watch-over-me-btn'), 'css/styles.css includes .watch-over-me-btn styles');
    assert(styles.includes('.battery-pill'), 'css/styles.css includes .battery-pill styles');
    assert(styles.includes('.reached-safely-btn'), 'css/styles.css includes .reached-safely-btn styles');

    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
    assert(sw.includes('/js/guardian.js'), 'sw.js precaches /js/guardian.js');
    assert(sw.includes('/js/batteryBeacon.js'), 'sw.js precaches /js/batteryBeacon.js');
  } catch (err) {
    assert(false, `Script integrity check failed: ${err.message}`);
  }

  // --- Suite 2: WebSocket Connection for Telemetry Broadcasts ---
  console.log('\n📡 Suite 2: WebSocket Live Telemetry Broadcasts');
  let wsClient;
  const receivedWsMessages = [];

  // Authenticate first to acquire cryptographic JWT token
  const loginRes = await makeRequest('POST', '/api/auth/login', { pin: '1120' });
  const validToken = loginRes.body && loginRes.body.token;
  assert(!!validToken, 'Authenticated with PIN 1120 to acquire valid JWT token');

  await new Promise((resolve) => {
    wsClient = new NativeWsClient(`${WS_URL}/telemetry?token=${validToken}`);
    wsClient.on('open', () => {
      assert(true, 'WebSocket client connected successfully via Native RFC 6455');
      resolve();
    });
    wsClient.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        receivedWsMessages.push(parsed);
      } catch (e) {}
    });
    wsClient.on('error', (e) => {
      console.warn('WS error:', e.message);
      resolve();
    });
    setTimeout(resolve, 800);
  });

  // --- Suite 3: Feature 3 - Watch Over Me Journey Lifecycle ---
  console.log('\n🛡️ Suite 3: Watch Over Me Journey REST & Lifecycle');
  let testTripId = null;

  // 3.1 Start Trip
  try {
    const startRes = await makeRequest('POST', '/api/trip/start', {
      userName: 'Aanya Sharma',
      destination: 'Swaroop Nagar',
      guardianPhone: '9876543210',
      startLocality: 'Mall Road, Cantt',
      lat: 26.4720,
      lng: 80.3340,
      batteryPct: 82
    });

    assert(startRes.status === 200, 'POST /api/trip/start returns 200 OK');
    assert(startRes.body && startRes.body.success === true, 'Start trip reports success: true');
    assert(startRes.body && startRes.body.trip && startRes.body.trip.tripId.startsWith('TRIP-'), 'Valid TRIP-ID generated');
    assert(startRes.body.trip.destination === 'Swaroop Nagar', 'Destination matches Swaroop Nagar');
    assert(startRes.body.trip.status === 'ACTIVE', 'Trip status is ACTIVE');
    assert(startRes.body.trip.nearestThana, `Nearest Thana identified: ${startRes.body.trip.nearestThana}`);
    
    testTripId = startRes.body.trip.tripId;
  } catch (err) {
    assert(false, `POST /api/trip/start failed: ${err.message}`);
  }

  // 3.2 Update Trip GPS Heartbeat
  if (testTripId) {
    try {
      const updateRes = await makeRequest('POST', '/api/trip/update', {
        tripId: testTripId,
        lat: 26.4750,
        lng: 80.3310,
        heading: 45,
        speedKmh: 12.5,
        batteryPct: 80
      });

      assert(updateRes.status === 200, 'POST /api/trip/update returns 200 OK');
      assert(updateRes.body.trip.currentCoords[0] === 26.4750, 'Updated latitude saved correctly');
      assert(updateRes.body.trip.batteryPct === 80, 'Updated battery percentage saved');
      assert(updateRes.body.trip.breadcrumbs.length >= 2, 'Breadcrumb trail extended');
    } catch (err) {
      assert(false, `POST /api/trip/update failed: ${err.message}`);
    }

    // 3.3 Query Trip Status (Guardian Viewer Endpoint)
    try {
      const statusRes = await makeRequest('GET', `/api/trip/status?tripId=${testTripId}`);
      assert(statusRes.status === 200, 'GET /api/trip/status returns 200 OK');
      assert(statusRes.body.trip.tripId === testTripId, 'Fetched trip matches queried tripId');
      assert(statusRes.body.trip.status === 'ACTIVE', 'Trip status is currently ACTIVE');
    } catch (err) {
      assert(false, `GET /api/trip/status failed: ${err.message}`);
    }

    // 3.4 Complete Trip (I Have Reached Safely)
    try {
      const endRes = await makeRequest('POST', '/api/trip/end', { tripId: testTripId });
      assert(endRes.status === 200, 'POST /api/trip/end returns 200 OK');
      assert(endRes.body.trip.status === 'COMPLETED', 'Trip marked COMPLETED');
      assert(endRes.body.trip.endTime > 0, 'Trip endTime recorded');

      // Verify status query now reflects COMPLETED
      const verifyEndRes = await makeRequest('GET', `/api/trip/status?tripId=${testTripId}`);
      assert(verifyEndRes.body.trip.status === 'COMPLETED', 'Guardian status query returns COMPLETED');
    } catch (err) {
      assert(false, `POST /api/trip/end failed: ${err.message}`);
    }
  }

  // 3.5 Negative Testing for Trip API
  try {
    const fakeTripRes = await makeRequest('GET', '/api/trip/status?tripId=TRIP-NONEXISTENT');
    assert(fakeTripRes.status === 404, 'Querying non-existent trip returns 404 Not Found');

    const fakeUpdateRes = await makeRequest('POST', '/api/trip/update', { tripId: 'TRIP-FAKE', lat: 26.45, lng: 80.33 });
    assert(fakeUpdateRes.status === 404, 'Updating non-existent trip returns 404 Not Found');
  } catch (err) {
    assert(false, `Negative testing failed: ${err.message}`);
  }

  // --- Suite 4: Feature 5 - Dead-Battery Distress Beacon ---
  console.log('\n🪫 Suite 4: Dead-Battery Distress Beacon REST & Broadcast');
  try {
    const beaconRes = await makeRequest('POST', '/api/emergency/battery-distress', {
      lat: 26.4499,
      lng: 80.3319,
      batteryPct: 3,
      locality: 'Panki Industrial Area',
      nearestThana: 'Panki Police Station',
      shoPhone: '+91-512-2560100',
      isTest: false
    });

    assert(beaconRes.status === 200, 'POST /api/emergency/battery-distress returns 200 OK');
    assert(beaconRes.body && beaconRes.body.success === true, 'Distress broadcast reports success: true');
    assert(beaconRes.body.beacon.type === 'BATTERY_CRITICAL_BEACON', 'Distress type is BATTERY_CRITICAL_BEACON');
    assert(beaconRes.body.beacon.batteryPct === 3, 'Recorded critical battery percentage is 3%');
    assert(beaconRes.body.beacon.distressId.startsWith('BATTERY-'), 'Assigned valid BATTERY- distress ID');
    assert(beaconRes.body.beacon.message.includes('Device shutting down'), 'Distress payload formatted message for dispatches');
  } catch (err) {
    assert(false, `POST /api/emergency/battery-distress failed: ${err.message}`);
  }

  // --- Suite 5: Verify WebSocket Broadcasts Were Received ---
  console.log('\n📣 Suite 5: Verifying Real-Time WebSocket Notifications');
  await new Promise((r) => setTimeout(r, 600));

  const tripStartedBroadcast = receivedWsMessages.find(m => m.type === 'GUARDIAN_TRIP_STARTED');
  assert(!!tripStartedBroadcast, 'WebSocket broadcasted GUARDIAN_TRIP_STARTED to connected listeners');

  const tripUpdateBroadcast = receivedWsMessages.find(m => m.type === 'GUARDIAN_TRIP_UPDATE');
  assert(!!tripUpdateBroadcast, 'WebSocket broadcasted GUARDIAN_TRIP_UPDATE to connected listeners');

  const tripCompletedBroadcast = receivedWsMessages.find(m => m.type === 'GUARDIAN_TRIP_COMPLETED');
  assert(!!tripCompletedBroadcast, 'WebSocket broadcasted GUARDIAN_TRIP_COMPLETED to connected listeners');

  const batteryBeaconBroadcast = receivedWsMessages.find(m => m.type === 'BATTERY_CRITICAL_BEACON');
  assert(!!batteryBeaconBroadcast, 'WebSocket broadcasted BATTERY_CRITICAL_BEACON across the tactical mesh');

  if (wsClient) {
    wsClient.close();
  }

  // --- Suite 6: Static Routing & PWA Resilience ---
  console.log('\n🌐 Suite 6: Static Routing & Deep Linking');
  try {
    const trackRouteRes = await makeRequest('GET', '/track?trip=TRIP-SAMPLE');
    assert(trackRouteRes.status === 200, 'GET /track deep-link serves 200 OK');
    assert(typeof trackRouteRes.body === 'string' && trackRouteRes.body.includes('Kanpur Tactical GIS'), '/track route serves main HTML application shell');

    const guardianJsRes = await makeRequest('GET', '/js/guardian.js');
    assert(guardianJsRes.status === 200, 'GET /js/guardian.js serves 200 OK');

    const batteryJsRes = await makeRequest('GET', '/js/batteryBeacon.js');
    assert(batteryJsRes.status === 200, 'GET /js/batteryBeacon.js serves 200 OK');
  } catch (err) {
    assert(false, `Static routing verification failed: ${err.message}`);
  }

  console.log('\n=============================================================');
  console.log(`🏁 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test run failed with fatal error:', err);
  process.exit(1);
});
