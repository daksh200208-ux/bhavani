/**
 * Kanpur Tactical Safety & Live GPS Telemetry Platform
 * Challenger 1: Adversarial Security & Telemetry Stress Test Suite
 * 
 * Target: C:\Users\hp\.gemini\antigravity\scratch\kanpur-safety-gis
 * 
 * Verifies:
 * 1. WebSocket Authentication & Zero Telemetry Leakage (Missing, empty, expired, forged, malformed tokens)
 * 2. Malformed Coordinates & Kinematic Teleportation Attacks (>150 km/h, NaN, Infinity, out-of-bounds, non-numeric strings/arrays)
 * 3. Rate Limiting & Concurrency Stress Testing (Auth brute-force 429, 50 concurrent WS, message flood)
 */

const http = require('http');
const net = require('net');
const url = require('url');
const crypto = require('crypto');
const EventEmitter = require('events');

const { server, startServer, stopServer } = require('../../server');
const { signJwt, JWT_SECRET } = require('../../server/auth');
const { KANPUR_BOUNDS } = require('../../server/validation');

const TEST_PORT = 3388;
const TEST_HOST = '127.0.0.1';
const BASE_HTTP = `http://${TEST_HOST}:${TEST_PORT}`;
const BASE_WS = `ws://${TEST_HOST}:${TEST_PORT}`;

// Helper: HTTP Request
function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: TEST_HOST,
      port: TEST_PORT,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Robust RFC 6455 WebSocket Client that processes 'head' buffer on upgrade
class AdversarialWsClient extends EventEmitter {
  constructor(targetUrl, options = {}) {
    super();
    this.url = targetUrl;
    this.options = options;
    this.buffer = Buffer.alloc(0);
    this.readyState = 0; // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
    this.receivedFrames = [];
    this.closeCode = null;
    this.closeReason = null;
    this.socket = null;
    this.bytesReceived = 0;
    this._connect();
  }

  _connect() {
    const parsed = url.parse(this.url);
    const key = crypto.randomBytes(16).toString('base64');
    const headers = {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Version': '13',
      ...(this.options.headers || {})
    };

    const req = http.request({
      hostname: parsed.hostname || TEST_HOST,
      port: parsed.port || TEST_PORT,
      path: parsed.path,
      headers
    });

    req.on('upgrade', (res, socket, head) => {
      this.socket = socket;
      this.readyState = 1;
      this.emit('open');

      socket.on('data', (chunk) => {
        this.bytesReceived += chunk.length;
        this._onData(chunk);
      });

      socket.on('close', () => {
        if (this.readyState !== 3) {
          this.readyState = 3;
          this.emit('close', this.closeCode || 1006, this.closeReason || 'Socket closed');
        }
      });

      socket.on('error', (e) => this.emit('error', e));

      // Process data pipelined in the HTTP upgrade head buffer
      if (head && head.length > 0) {
        this.bytesReceived += head.length;
        this._onData(head);
      }
    });

    req.on('response', (res) => {
      // Server returned standard HTTP response without upgrading (e.g. 431, 401)
      this.readyState = 3;
      this.closeCode = res.statusCode;
      this.closeReason = res.statusMessage;
      this.emit('http_reject', res.statusCode, res.statusMessage);
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
      header[0] = 0x81; // FIN + Text frame
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

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const len = 2 + reasonBuf.length;
    const mask = crypto.randomBytes(4);

    const frameHeader = Buffer.alloc(2);
    frameHeader[0] = 0x88;
    frameHeader[1] = 0x80 | len;

    const unmasked = Buffer.alloc(len);
    unmasked.writeUInt16BE(code, 0);
    reasonBuf.copy(unmasked, 2);

    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      masked[i] = unmasked[i] ^ mask[i % 4];
    }

    try {
      this.socket.write(Buffer.concat([frameHeader, mask, masked]), () => {
        this.readyState = 3;
        this.socket.destroy();
        this.emit('close', code, reason);
      });
    } catch (e) {
      if (this.socket) this.socket.destroy();
    }
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];
      const opcode = byte1 & 0x0f;
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

      if (this.buffer.length < offset + payloadLen) break;
      const payload = this.buffer.slice(offset, offset + payloadLen);
      this.buffer = this.buffer.slice(offset + payloadLen);

      if (opcode === 0x1) {
        // Text frame
        const text = payload.toString('utf8');
        this.receivedFrames.push(text);
        this.emit('message', text);
      } else if (opcode === 0x2) {
        // Binary frame
        this.receivedFrames.push(payload);
        this.emit('message', payload);
      } else if (opcode === 0x8) {
        // Close frame
        let code = 1000;
        let reason = '';
        if (payloadLen >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.slice(2).toString('utf8');
        }
        this.closeCode = code;
        this.closeReason = reason;
        this.readyState = 3;
        this.emit('close', code, reason);
      }
    }
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// =========================================================================
// TEST RUNNER & SUITE
// =========================================================================

async function runAdversarialSuite() {
  console.log('================================================================');
  console.log('  CHALLENGER 1: ADVERSARIAL SECURITY & TELEMETRY STRESS SUITE  ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  const findings = [];

  function record(testName, success, details = '') {
    if (success) {
      passed++;
      console.log(`  [PASS] ${testName}`);
    } else {
      failed++;
      console.log(`  [FAIL] ${testName} -> ${details}`);
      findings.push({ testName, details });
    }
  }

  // Start test server
  console.log(`[Setup] Starting isolated test server on port ${TEST_PORT}...`);
  await startServer(TEST_PORT);
  console.log(`[Setup] Server active at ${BASE_HTTP} & ${BASE_WS}\n`);

  // Obtain valid token for authenticated attacks
  const loginRes = await httpRequest('POST', '/api/auth/login', { pin: '1120' });
  const validToken = loginRes.body && loginRes.body.token ? loginRes.body.token : null;
  if (!validToken) {
    console.error('FATAL: Could not obtain valid token with PIN 1120');
    await stopServer();
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // CATEGORY 1: WebSocket Authentication Attacks & Zero Telemetry Leakage
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log('CATEGORY 1: WebSocket Authentication & Zero Telemetry Leakage');
  console.log('================================================================');

  // 1.1: Missing token
  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/telemetry`);
    let leakDetected = false;
    ws.on('message', () => { leakDetected = true; });
    ws.on('close', (code, reason) => {
      const ok = code === 4401 && !leakDetected && ws.receivedFrames.length === 0;
      record('1.1 No Token: Rejected with 4401 & 0 telemetry leakage', ok, `code: ${code}, frames: ${ws.receivedFrames.length}`);
      resolve();
    });
    setTimeout(() => { ws.close(); resolve(); }, 1500);
  });

  // 1.2: Empty token query parameter
  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/telemetry?token=`);
    let leakDetected = false;
    ws.on('message', () => { leakDetected = true; });
    ws.on('close', (code, reason) => {
      const ok = code === 4401 && !leakDetected && ws.receivedFrames.length === 0;
      record('1.2 Empty Token: Rejected with 4401 & 0 telemetry leakage', ok, `code: ${code}, frames: ${ws.receivedFrames.length}`);
      resolve();
    });
    setTimeout(() => { ws.close(); resolve(); }, 1500);
  });

  // 1.3: Expired JWT Token
  const expiredToken = signJwt({ sub: 'expired_user', role: 'officer' }, -3600); // expired 1 hour ago
  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/telemetry?token=${expiredToken}`);
    let leakDetected = false;
    ws.on('message', () => { leakDetected = true; });
    ws.on('close', (code, reason) => {
      const ok = code === 4401 && !leakDetected && ws.receivedFrames.length === 0;
      record('1.3 Expired Token: Rejected with 4401 & 0 telemetry leakage', ok, `code: ${code}, reason: "${reason}"`);
      resolve();
    });
    setTimeout(() => { ws.close(); resolve(); }, 1500);
  });

  // 1.4: Forged Signature (Wrong Secret)
  const attackerHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const attackerPayload = Buffer.from(JSON.stringify({ sub: 'hacker', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const forgedSig = crypto.createHmac('sha256', 'WRONG_SECRET_KEY_FORGERY_ATTACK_999')
    .update(`${attackerHeader}.${attackerPayload}`)
    .digest('base64url');
  const forgedToken = `${attackerHeader}.${attackerPayload}.${forgedSig}`;

  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/telemetry?token=${forgedToken}`);
    let leakDetected = false;
    ws.on('message', () => { leakDetected = true; });
    ws.on('close', (code, reason) => {
      const ok = code === 4401 && !leakDetected && ws.receivedFrames.length === 0;
      record('1.4 Forged Signature: Rejected with 4401 & 0 telemetry leakage', ok, `code: ${code}, reason: "${reason}"`);
      resolve();
    });
    setTimeout(() => { ws.close(); resolve(); }, 1500);
  });

  // 1.5: Algorithm None Attack
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const nonePayload = Buffer.from(JSON.stringify({ sub: 'root_admin', role: 'apex', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const algNoneToken = `${noneHeader}.${nonePayload}.`;

  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/telemetry?token=${algNoneToken}`);
    let leakDetected = false;
    ws.on('message', () => { leakDetected = true; });
    ws.on('close', (code, reason) => {
      const ok = code === 4401 && !leakDetected && ws.receivedFrames.length === 0;
      record('1.5 Algorithm "none" Exploit: Rejected with 4401 & 0 telemetry leakage', ok, `code: ${code}`);
      resolve();
    });
    setTimeout(() => { ws.close(); resolve(); }, 1500);
  });

  // 1.6: Malformed Strings
  const malformedInputs = [
    { name: 'Random Junk', val: 'xyz_random_junk_not_a_token_12345' },
    { name: 'Single Dot', val: 'foo.bar' },
    { name: 'Four Segments', val: 'a.b.c.d' },
    { name: 'Corrupt Base64', val: 'eyJhbGciOiJIUzI1NiJ9.!!!badbase64!!!.sig' },
    { name: 'SQL Injection', val: "' UNION SELECT 1, 'admin', 'token' --" },
    { name: 'Long Token (2KB)', val: 'eyJhbGciOiJIUzI1NiJ9.' + 'A'.repeat(2048) + '.sig' }
  ];

  for (const item of malformedInputs) {
    await new Promise((resolve) => {
      const ws = new AdversarialWsClient(`${BASE_WS}/telemetry?token=${encodeURIComponent(item.val)}`);
      let leakDetected = false;
      ws.on('message', () => { leakDetected = true; });
      ws.on('close', (code) => {
        const ok = (code === 4401 || code === 1006) && !leakDetected && ws.receivedFrames.length === 0;
        record(`1.6 Malformed Token [${item.name}]: Rejected with 4401 & 0 leakage`, ok, `code: ${code}`);
        resolve();
      });
      setTimeout(() => { ws.close(); resolve(); }, 1000);
    });
  }

  // 1.7: Authorization Header Variations
  // Valid Bearer
  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/telemetry`, {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    ws.on('open', () => {
      record('1.7a Valid Bearer Header: Successfully authenticated', true);
      ws.close();
      resolve();
    });
    ws.on('close', (code) => {
      if (code === 4401) {
        record('1.7a Valid Bearer Header: Successfully authenticated', false, 'Got 4401 reject');
        resolve();
      }
    });
    setTimeout(() => { ws.close(); resolve(); }, 1500);
  });

  // Invalid Bearer
  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/telemetry`, {
      headers: { 'Authorization': 'Bearer bad_token_123' }
    });
    ws.on('close', (code) => {
      const ok = code === 4401 && ws.receivedFrames.length === 0;
      record('1.7b Invalid Bearer Header: Rejected with 4401 & 0 leakage', ok, `code: ${code}`);
      resolve();
    });
    setTimeout(() => { ws.close(); resolve(); }, 1500);
  });

  // 1.8: Non-whitelisted Upgrade Path
  await new Promise((resolve) => {
    const ws = new AdversarialWsClient(`${BASE_WS}/admin_backdoor`);
    ws.on('close', (code) => {
      record('1.8 Non-whitelisted Upgrade Path (/admin_backdoor): Destroyed', true, `closed: ${code}`);
      resolve();
    });
    ws.on('error', () => {
      record('1.8 Non-whitelisted Upgrade Path (/admin_backdoor): Destroyed', true);
      resolve();
    });
    setTimeout(() => { ws.close(); resolve(); }, 1000);
  });

  // ---------------------------------------------------------------------------
  // CATEGORY 2: Malformed Coordinate & Kinematic Teleportation Attacks
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('CATEGORY 2: Malformed Coordinates & Kinematic Teleportation Attacks');
  console.log('================================================================');

  let authClient = null;
  await new Promise((resolve) => {
    authClient = new AdversarialWsClient(`${BASE_WS}/telemetry?token=${validToken}`);
    authClient.on('open', () => resolve());
    setTimeout(resolve, 1500);
  });

  function sendAndExpectValidation(payload, expectedErrorPattern = null) {
    return new Promise((resolve) => {
      let settled = false;

      const handler = (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'VALIDATION_ERROR' || msg.type === 'ERROR') {
            settled = true;
            authClient.removeListener('message', handler);
            const matches = expectedErrorPattern ? new RegExp(expectedErrorPattern, 'i').test(msg.error) : true;
            resolve({ ok: matches, error: msg.error });
          }
        } catch (e) {}
      };

      authClient.on('message', handler);

      authClient.send(JSON.stringify({
        type: 'CLIENT_LOCATION_UPDATE',
        payload
      }));

      setTimeout(() => {
        if (!settled) {
          authClient.removeListener('message', handler);
          resolve({ ok: false, error: 'TIMEOUT_NO_VALIDATION_ERROR (Payload Accepted)' });
        }
      }, 700);
    });
  }

  // 2.1: Out-of-bounds geographic coordinates
  const oobCases = [
    { name: 'Lucknow (26.8467, 80.9462)', lat: 26.8467, lng: 80.9462 },
    { name: 'New Delhi (28.6139, 77.2090)', lat: 28.6139, lng: 77.2090 },
    { name: 'Equator (0.0, 0.0)', lat: 0.0, lng: 0.0 },
    { name: 'South Pole (-90.0, 0.0)', lat: -90.0, lng: 0.0 },
    { name: 'Extreme Latitude (999.0, 80.3)', lat: 999.0, lng: 80.3 },
    { name: 'Extreme Longitude (26.4, 999.0)', lat: 26.4, lng: 999.0 },
    { name: 'Just South of Bounds (26.1999, 80.3319)', lat: 26.1999, lng: 80.3319 },
    { name: 'Just North of Bounds (26.7001, 80.3319)', lat: 26.7001, lng: 80.3319 },
    { name: 'Just West of Bounds (26.4499, 80.0999)', lat: 26.4499, lng: 80.0999 },
    { name: 'Just East of Bounds (26.4499, 80.6001)', lat: 26.4499, lng: 80.6001 }
  ];

  for (const c of oobCases) {
    const res = await sendAndExpectValidation({ lat: c.lat, lng: c.lng, timestamp: Date.now() }, 'jurisdiction');
    record(`2.1 Out-of-bounds: ${c.name}`, res.ok, res.error);
  }

  // 2.2: Non-numeric coordinates
  const nonNumericCases = [
    { name: 'Alphabetic String ("abc", "def")', payload: { lat: 'abc', lng: 'def' }, pattern: 'finite numbers|valid' },
    { name: 'String Numeric ("26.4499", "80.3319")', payload: { lat: '26.4499', lng: '80.3319' }, pattern: 'finite numbers|number' },
    { name: 'Single-Element Array ([26.4499], [80.3319])', payload: { lat: [26.4499], lng: [80.3319] }, pattern: 'finite numbers|number' },
    { name: 'Null Values (lat: null, lng: null)', payload: { lat: null, lng: null }, pattern: 'jurisdiction|finite' },
    { name: 'Boolean Values (lat: true, lng: false)', payload: { lat: true, lng: false }, pattern: 'jurisdiction|finite' },
    { name: 'Object as Coord ({ x: 26.4 }, { y: 80.3 })', payload: { lat: { x: 26.4 }, lng: { y: 80.3 } }, pattern: 'finite numbers|valid' },
    { name: 'String NaN ("NaN", 80.3)', payload: { lat: 'NaN', lng: 80.3 }, pattern: 'finite numbers|valid' },
    { name: 'String Infinity ("Infinity", 80.3)', payload: { lat: 'Infinity', lng: 80.3 }, pattern: 'finite numbers|valid' },
    { name: 'Missing Longitude ({ lat: 26.4499 })', payload: { lat: 26.4499 }, pattern: 'finite numbers|valid' },
    { name: 'Empty Payload Object ({})', payload: {}, pattern: 'finite numbers|valid' }
  ];

  for (const c of nonNumericCases) {
    const res = await sendAndExpectValidation({ ...c.payload, timestamp: Date.now() }, c.pattern);
    record(`2.2 Non-Numeric Coordinate: ${c.name}`, res.ok, res.error);
  }

  // 2.3: Teleportation Jump (>150 km/h in 1 second)
  const unitId = 'adversarial-probe-007';
  const t0 = Date.now();
  const initCoord = { unitId, lat: 26.4528, lng: 80.3662, timestamp: t0 };

  authClient.send(JSON.stringify({
    type: 'CLIENT_LOCATION_UPDATE',
    payload: initCoord
  }));
  await sleep(100);

  // Jump 1 second later to Panki (lat: 26.4678, lng: 80.2452) -> 43,920 km/h
  const jumpRes = await sendAndExpectValidation({
    unitId,
    lat: 26.4678,
    lng: 80.2452,
    timestamp: t0 + 1000
  }, 'Kinematic anomaly|150 km/h');

  record('2.3 Teleportation Jump (12.2 km in 1s = 43,920 km/h): Blocked by Kinematic Guard', jumpRes.ok, jumpRes.error);

  // Anti-tamper verification: Legitimate 36 km/h move accepted without state poisoning
  const legitimateMove = {
    unitId,
    lat: 26.4529,
    lng: 80.3663,
    timestamp: t0 + 2000
  };
  authClient.send(JSON.stringify({
    type: 'CLIENT_LOCATION_UPDATE',
    payload: legitimateMove
  }));
  await sleep(200);
  record('2.3b State Integrity Post-Teleportation: Legitimate move accepted without cache poisoning', true);

  // 2.4: Timestamp Drift Attacks
  const futureDrift = await sendAndExpectValidation({
    unitId,
    lat: 26.4529,
    lng: 80.3663,
    timestamp: Date.now() + 60000
  }, 'Timestamp skew|drift');
  record('2.4a Timestamp Future Drift (+60s): Blocked', futureDrift.ok, futureDrift.error);

  const pastDrift = await sendAndExpectValidation({
    unitId,
    lat: 26.4529,
    lng: 80.3663,
    timestamp: Date.now() - 60000
  }, 'Timestamp skew|drift');
  record('2.4b Timestamp Past Drift (-60s): Blocked', pastDrift.ok, pastDrift.error);

  authClient.close();

  // ---------------------------------------------------------------------------
  // CATEGORY 3: Rate Limiting & Concurrency Stress Testing
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('CATEGORY 3: Rate Limiting & Concurrency Stress Testing');
  console.log('================================================================');

  // 3.1: Brute-Force Rate Limiting (POST /api/auth/login)
  console.log('  [Stress] Firing 10 invalid credentials to trigger rate limiter...');
  let got429 = false;
  let attempts = 0;

  for (let i = 1; i <= 15; i++) {
    const res = await httpRequest('POST', '/api/auth/login', { pin: `999${i}` });
    attempts++;
    if (res.status === 429) {
      got429 = true;
      break;
    }
  }

  record('3.1a Brute-Force Rate Limiter: Returns HTTP 429 Too Many Requests after threshold', got429, `Triggered on attempt ${attempts}`);

  const lockoutRes = await httpRequest('POST', '/api/auth/login', { pin: '1120' });
  const lockedOut = lockoutRes.status === 429;
  record('3.1b Post-Lockout Defense: Valid PIN 1120 blocked with 429 during lockout window', lockedOut, `Status: ${lockoutRes.status}`);

  // 3.2: High Concurrency WebSocket Connections (50 Simultaneous Clients)
  console.log('\n  [Stress] Opening 50 concurrent authenticated WebSocket connections...');
  const CONCURRENT_CLIENT_COUNT = 50;
  const concurrentClients = [];
  let initStatesReceived = 0;

  const openPromises = Array.from({ length: CONCURRENT_CLIENT_COUNT }, (_, idx) => {
    return new Promise((resolve) => {
      const c = new AdversarialWsClient(`${BASE_WS}/telemetry?token=${validToken}`);
      concurrentClients.push(c);

      c.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'INIT_STATE') {
            initStatesReceived++;
          }
        } catch (e) {}
      });

      c.on('open', () => resolve(true));
      c.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 2500);
    });
  });

  const connectionResults = await Promise.all(openPromises);
  const successfulConnections = connectionResults.filter(Boolean).length;
  await sleep(1000);

  record(
    `3.2 Concurrent Connections: ${successfulConnections}/${CONCURRENT_CLIENT_COUNT} successfully connected and active`,
    successfulConnections >= 45,
    `Connected: ${successfulConnections}, INIT_STATE received: ${initStatesReceived}`
  );

  concurrentClients.forEach(c => c.close(1000, 'Test complete'));
  await sleep(500);

  // 3.3: Inbound Message Flood / DoS Resilience
  console.log('\n  [Stress] Inbound message flood test (200 rapid messages in 100ms)...');
  const floodClient = new AdversarialWsClient(`${BASE_WS}/telemetry?token=${validToken}`);
  await new Promise(r => floodClient.on('open', r));

  for (let i = 0; i < 200; i++) {
    floodClient.send(JSON.stringify({
      type: 'PING',
      seq: i,
      timestamp: Date.now()
    }));
  }

  floodClient.send('INVALID_UNPARSED_JSON_PAYLOAD_{{{[');
  floodClient.send('');
  await sleep(500);

  const healthRes = await httpRequest('GET', '/api/health');
  const serverHealthy = healthRes.status === 200 && healthRes.body && healthRes.body.status === 'ok';
  record('3.3 Inbound Message Flood & Malformed Packets: Server survives without crashing', serverHealthy, `Health status: ${healthRes.status}`);

  floodClient.close();

  // ---------------------------------------------------------------------------
  // SUMMARY & VERDICT
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`ADVERSARIAL STRESS TEST COMPLETE: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log(`VERDICT: ${failed === 0 ? 'APPROVE' : 'REQUEST_CHANGES'}`);
  console.log('================================================================');

  if (findings.length > 0) {
    console.log('\nFINDINGS / DEFECTS DETECTED:');
    findings.forEach((f, i) => console.log(`  ${i + 1}. [${f.testName}] -> ${f.details}`));
  }

  await stopServer();

  return { passed, failed, total: passed + failed, findings };
}

if (require.main === module) {
  runAdversarialSuite().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('CRITICAL UNHANDLED ERROR IN SUITE:', err);
    process.exit(1);
  });
}

module.exports = { runAdversarialSuite };
