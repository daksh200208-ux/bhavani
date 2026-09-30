/**
 * Kanpur Tactical Safety & Live GPS Telemetry Platform - Core Server
 * Combines HTTP static asset serving, REST API endpoints,
 * cryptographic JWT authentication guard, 1Hz live multi-persona telemetry streaming,
 * dynamic red zone push synchronization, and 112 multi-channel SOS emergency broadcast.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { authenticateUser, verifyJwt } = require('./server/auth');
const { validateKanpurBounds, validateTelemetryPayload, KANPUR_BOUNDS } = require('./server/validation');
const { getActiveRedZones, upsertRedZone, evaluateGeofence } = require('./server/geofence');
const { PersonaSimulator, findNearestThana } = require('./server/personas');
const { UniversalWebSocketServer } = require('./server/wsEngine');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// Initialize Persona Simulator
const personaSimulator = new PersonaSimulator();

// Initialize WebSocket Engine
const wss = new UniversalWebSocketServer();

// Server start time for health metrics
const SERVER_START_TIME = Date.now();

/**
 * Helper to parse JSON request body
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB guard
        req.destroy();
        reject(new Error('Request entity too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        // Fallback for form-urlencoded or plain string
        try {
          const params = new URLSearchParams(body);
          const obj = Object.fromEntries(params.entries());
          resolve(obj);
        } catch (e) {
          resolve({});
        }
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// In-Memory Active Guardian Journeys ("Watch Over Me")
const activeTrips = new Map();

/**
 * Handle HTTP Requests (Static files + REST API)
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Handle CORS Pre-Flight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  // -------------------------------------------------------------------------
  // REST API ROUTES
  // -------------------------------------------------------------------------

  // 1. POST /api/auth/login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    try {
      const body = await parseRequestBody(req);
      const result = authenticateUser(body, clientIp);
      return sendJson(res, result.status, result);
    } catch (err) {
      return sendJson(res, 400, { error: 'Bad request payload' });
    }
  }

  // 2. GET /api/health
  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      activeConnections: wss.clients.size,
      uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
      timestamp: Date.now()
    });
  }

  // 3. POST /api/redzones (Dynamic Red Zone Hotspot Publishing)
  if (pathname === '/api/redzones' && method === 'POST') {
    // Check Authorization header or query param
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer '))
      ? authHeader.slice(7)
      : parsedUrl.query.token;

    const authCheck = verifyJwt(token);
    if (!authCheck.valid) {
      return sendJson(res, 401, { error: 'Unauthorized: Invalid or missing cryptographic token' });
    }

    try {
      const body = await parseRequestBody(req);
      const zoneData = body.zone || body;

      if (!zoneData.id || !zoneData.name) {
        return sendJson(res, 400, { error: 'Invalid zone payload: id and name are required' });
      }

      const result = upsertRedZone(zoneData);

      // Broadcast dynamic red zone to all connected clients (<500ms broadcast)
      const broadcastMsg = {
        type: 'RED_ZONE_PUSH',
        action: result.action,
        zone: result.zone,
        timestamp: Date.now()
      };
      wss.broadcast(broadcastMsg);

      // Also broadcast redundant sync event for backward compatibility
      wss.broadcast({
        type: 'RED_ZONE_SYNC',
        payload: { action: result.action, zone: result.zone },
        timestamp: Date.now()
      });

      return sendJson(res, 200, {
        success: true,
        action: result.action,
        zone: result.zone
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 4. GET /api/redzones
  if (pathname === '/api/redzones' && method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      zones: getActiveRedZones()
    });
  }

  // 5. POST /api/emergency/sos (REST Emergency Fallback Trigger)
  if (pathname === '/api/emergency/sos' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const lat = Number(body.lat) || 26.4499;
      const lng = Number(body.lng) || 80.3319;

      const boundsCheck = validateKanpurBounds(lat, lng);
      if (!boundsCheck.valid) {
        return sendJson(res, 400, { error: boundsCheck.error });
      }

      const unitId = body.unitId || 'UNIT-MANUAL-DISPATCH';
      const unitName = body.unitName || 'Field Patrol Unit';
      const locality = body.locality || 'Kanpur Metropolitan Zone';

      const nearestThana = findNearestThana(lat, lng);
      const distressPacket = createSosDistressPacket({
        unitId,
        unitName,
        lat,
        lng,
        locality,
        nearestThana
      });

      wss.broadcast(distressPacket);
      return sendJson(res, 200, { success: true, distress: distressPacket });
    } catch (err) {
      return sendJson(res, 400, { error: 'Failed to broadcast SOS distress' });
    }
  }

  // 6. POST /api/trip/start (Watch Over Me Live Guardian Journey Start)
  if (pathname === '/api/trip/start' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const lat = Number(body.lat) || 26.4499;
      const lng = Number(body.lng) || 80.3319;
      const tripId = 'TRIP-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const nearestThana = findNearestThana(lat, lng);

      const trip = {
        tripId,
        userName: body.userName || 'Citizen',
        destination: body.destination || 'Home',
        startLocality: body.startLocality || 'Kanpur Metropolitan Zone',
        currentCoords: [lat, lng],
        heading: Number(body.heading) || 0,
        speedKmh: Number(body.speedKmh) || 0,
        batteryPct: Number(body.batteryPct) !== undefined ? Number(body.batteryPct) : 100,
        guardianPhone: body.guardianPhone || '',
        nearestThana: nearestThana ? nearestThana.name : 'Kanpur Police',
        shoPhone: nearestThana ? nearestThana.phone : '112',
        startTime: Date.now(),
        lastUpdated: Date.now(),
        status: 'ACTIVE',
        breadcrumbs: [[lat, lng]]
      };

      activeTrips.set(tripId, trip);

      wss.broadcast({
        type: 'GUARDIAN_TRIP_STARTED',
        trip,
        timestamp: Date.now()
      });

      return sendJson(res, 200, { success: true, trip });
    } catch (err) {
      return sendJson(res, 400, { error: 'Failed to start journey tracking' });
    }
  }

  // 7. POST /api/trip/update (Live GPS telemetry heartbeat for journey)
  if (pathname === '/api/trip/update' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const tripId = body.tripId;
      if (!tripId || !activeTrips.has(tripId)) {
        return sendJson(res, 404, { error: 'Trip not found or expired' });
      }

      const trip = activeTrips.get(tripId);
      const lat = Number(body.lat) || trip.currentCoords[0];
      const lng = Number(body.lng) || trip.currentCoords[1];

      trip.currentCoords = [lat, lng];
      trip.heading = Number(body.heading) || trip.heading;
      trip.speedKmh = Number(body.speedKmh) || trip.speedKmh;
      if (body.batteryPct !== undefined) trip.batteryPct = Number(body.batteryPct);
      trip.lastUpdated = Date.now();
      trip.breadcrumbs.push([lat, lng]);
      if (trip.breadcrumbs.length > 100) trip.breadcrumbs.shift();

      const nearest = findNearestThana(lat, lng);
      if (nearest) {
        trip.nearestThana = nearest.name;
        trip.shoPhone = nearest.phone;
      }

      wss.broadcast({
        type: 'GUARDIAN_TRIP_UPDATE',
        trip,
        timestamp: Date.now()
      });

      return sendJson(res, 200, { success: true, trip });
    } catch (err) {
      return sendJson(res, 400, { error: 'Failed to update journey' });
    }
  }

  // 8. POST /api/trip/end (I Have Reached Safely)
  if (pathname === '/api/trip/end' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const tripId = body.tripId;
      if (!tripId || !activeTrips.has(tripId)) {
        return sendJson(res, 404, { error: 'Trip not found' });
      }

      const trip = activeTrips.get(tripId);
      trip.status = 'COMPLETED';
      trip.endTime = Date.now();

      wss.broadcast({
        type: 'GUARDIAN_TRIP_COMPLETED',
        tripId,
        message: `${trip.userName} has reached ${trip.destination} safely.`,
        timestamp: Date.now()
      });

      return sendJson(res, 200, { success: true, trip });
    } catch (err) {
      return sendJson(res, 400, { error: 'Failed to end journey' });
    }
  }

  // 9. GET /api/trip/status (Guardian Viewer endpoint)
  if (pathname === '/api/trip/status' && method === 'GET') {
    const tripId = parsedUrl.query.tripId || parsedUrl.query.id;
    if (!tripId || !activeTrips.has(tripId)) {
      return sendJson(res, 404, { error: 'Trip not found or expired' });
    }
    return sendJson(res, 200, { success: true, trip: activeTrips.get(tripId) });
  }

  // 10. POST /api/emergency/battery-distress (Critical Low Battery Beacon)
  if (pathname === '/api/emergency/battery-distress' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const lat = Number(body.lat) || 26.4499;
      const lng = Number(body.lng) || 80.3319;
      const batteryPct = Number(body.batteryPct) !== undefined ? Number(body.batteryPct) : 4;
      const locality = body.locality || 'Kanpur Metropolitan Zone';
      const nearestThana = findNearestThana(lat, lng);

      const beaconPacket = {
        type: 'BATTERY_CRITICAL_BEACON',
        distressId: 'BATTERY-' + Date.now(),
        lat,
        lng,
        batteryPct,
        locality,
        nearestThana: nearestThana ? nearestThana.name : 'Kanpur Police',
        shoPhone: nearestThana ? nearestThana.phone : '112',
        timestamp: Date.now(),
        message: `CRITICAL LOW BATTERY BEACON: Device shutting down at ${batteryPct}%. Last recorded coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)} in ${locality}. Nearest Police Station: ${nearestThana ? nearestThana.name : 'Kanpur Police'}.`
      };

      wss.broadcast(beaconPacket);
      return sendJson(res, 200, { success: true, beacon: beaconPacket });
    } catch (err) {
      return sendJson(res, 400, { error: 'Failed to broadcast battery distress beacon' });
    }
  }

  // -------------------------------------------------------------------------
  // STATIC ASSETS SERVING
  // -------------------------------------------------------------------------
  if (method === 'GET') {
    let targetPath = pathname;
    if (pathname === '/' || pathname === '/track' || pathname === '/track/') {
      targetPath = 'index.html';
    }
    let filePath = path.join(__dirname, targetPath);

    // Guard against path traversal
    const safePath = path.resolve(filePath);
    if (!safePath.startsWith(path.resolve(__dirname))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('403 Forbidden');
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 Not Found');
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const responseHeaders = {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff'
      };

      if (pathname === '/sw.js') {
        responseHeaders['Service-Worker-Allowed'] = '/';
        responseHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      } else if (pathname === '/manifest.json') {
        responseHeaders['Cache-Control'] = 'public, max-age=3600';
      } else {
        responseHeaders['Cache-Control'] = 'no-cache, must-revalidate';
      }

      res.writeHead(200, responseHeaders);
      const stream = fs.createReadStream(safePath);
      stream.pipe(res);
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

/**
 * Handle WebSocket Upgrade with Strict JWT Authentication
 */
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Accept connections on /telemetry and /ws
  if (pathname !== '/telemetry' && pathname !== '/ws') {
    socket.destroy();
    return;
  }

  // Extract JWT token from query parameter or authorization header
  let token = parsedUrl.query.token;
  if (!token && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  // Verify JWT cryptographic signature
  const auth = verifyJwt(token);

  // If token is missing or invalid:
  // Immediate socket termination with code 4401 and ZERO telemetry leakage
  if (!auth.valid) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Send close frame with 4401 "Unauthorized" immediately with 0 bytes of state or telemetry
      try {
        ws.close(4401, 'Unauthorized: Missing or invalid cryptographic token');
      } catch (e) {
        ws.terminate();
      }
    });
    return;
  }

  // Authenticated upgrade
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.user = auth.payload;

    // Send INIT_STATE snapshot immediately upon successful authentication
    const initState = {
      type: 'INIT_STATE',
      payload: {
        user: ws.user,
        trackedUsers: personaSimulator.getAllStates(),
        activeRedZones: getActiveRedZones(),
        serverConfig: {
          redZoneWarningRadiusMeters: 350,
          bounds: KANPUR_BOUNDS
        }
      },
      timestamp: Date.now()
    };
    ws.send(JSON.stringify(initState));

    // Handle inbound client messages
    ws.on('message', (message) => {
      handleClientWebSocketMessage(ws, message);
    });
  });
});

/**
 * Helper to create standardized SOS distress packet
 */
function createSosDistressPacket({ unitId, unitName, lat, lng, locality, nearestThana, heading, speedKmH }) {
  const now = Date.now();
  const timeStr = new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const station = nearestThana || findNearestThana(lat, lng);
  const distStr = station ? `${station.name} (${station.distKm || station.distanceKm || '0.5'} km away)` : 'HQ Command';
  const cugStr = station ? (station.cug || station.phone || '112') : '112';

  const whatsappText =
    `🚨 *EMERGENCY SOS - KANPUR TACTICAL GRID*\n` +
    `Time: ${timeStr}\n` +
    `Unit: ${unitName || unitId} (${unitId})\n` +
    `Sector: ${locality || 'Kanpur Metropolitan Area'}\n\n` +
    `📍 Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` +
    `🗺️ Live Map: https://maps.google.com/?q=${lat},${lng}\n` +
    `🏢 Nearest Thana: ${distStr}\n` +
    `📞 SHO CUG: ${cugStr}\n` +
    `⚡ Action Requested: Immediate QRT / PRV Intercept.`;

  const smsText = `EMERGENCY SOS: Unit ${unitName || unitId} at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Near ${distStr}. Immediate QRT response requested.`;

  return {
    type: 'SOS_EMERGENCY',
    distressId: `SOS-${now}-${Math.floor(Math.random() * 1000)}`,
    unitId,
    unitName: unitName || unitId,
    coords: [lat, lng],
    locality: locality || 'Kanpur Urban Sector',
    nearestThana: station,
    heading: heading || 0,
    speedKmH: speedKmH || 0,
    whatsappPayload: whatsappText,
    smsPayload: smsText,
    timestamp: now
  };
}

/**
 * Process inbound WebSocket messages from clients
 */
function handleClientWebSocketMessage(ws, message) {
  let parsed;
  try {
    parsed = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString('utf8'));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'ERROR', error: 'Malformed JSON payload' }));
    return;
  }

  const type = parsed.type;
  const payload = parsed.payload || parsed;

  // 1. PING -> PONG
  if (type === 'PING') {
    ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
    return;
  }

  // 2. CLIENT_LOCATION_UPDATE
  if (type === 'CLIENT_LOCATION_UPDATE' || type === 'TELEMETRY_UPDATE') {
    const validation = validateTelemetryPayload(payload);
    if (!validation.valid) {
      ws.send(JSON.stringify({
        type: 'VALIDATION_ERROR',
        error: validation.error,
        timestamp: Date.now()
      }));
      return;
    }

    const sanitized = validation.sanitized;
    const clientUnitId = payload.unitId || (ws.user ? ws.user.sub : 'client-unit');
    const nearestThana = findNearestThana(sanitized.lat, sanitized.lng);
    const redZoneStatus = evaluateGeofence(sanitized.lat, sanitized.lng);

    const clientTelemetry = {
      type: 'TELEMETRY_UPDATE',
      unit: {
        id: clientUnitId,
        name: ws.user ? ws.user.name : 'Officer',
        callSign: ws.user ? ws.user.callsign : 'PATROL-UNIT',
        sector: ws.user ? ws.user.sector : 'Kanpur Grid',
        color: '#38BDF8',
        lat: sanitized.lat,
        lng: sanitized.lng,
        heading: sanitized.heading,
        speedKmH: sanitized.speedKmH,
        batteryPct: sanitized.batteryPct,
        nearestThana,
        redZoneStatus,
        breadcrumbs: [[sanitized.lat, sanitized.lng]],
        timestamp: sanitized.timestamp
      }
    };

    // Broadcast updated position to all other connected clients
    wss.broadcast(clientTelemetry, (c) => c !== ws);

    // If entering 350m red zone, broadcast geofence alert
    if (redZoneStatus.status === 'PROXIMITY_350M' || redZoneStatus.status === 'BREACH') {
      const alertPacket = {
        type: 'GEOFENCE_ALERT',
        unitId: clientUnitId,
        unitName: ws.user ? ws.user.name : 'Officer',
        callSign: ws.user ? ws.user.callsign : 'PATROL-UNIT',
        zoneId: redZoneStatus.activeZone ? redZoneStatus.activeZone.id : 'unknown',
        zoneName: redZoneStatus.activeZone ? redZoneStatus.activeZone.name : 'Active Red Zone',
        riskLevel: redZoneStatus.activeZone ? redZoneStatus.activeZone.riskLevel : 'HIGH',
        distanceMeters: redZoneStatus.distanceMeters,
        status: redZoneStatus.status,
        message: `⚠️ HAZARD ALERT: Unit ${ws.user ? ws.user.callsign : clientUnitId} is ${redZoneStatus.distanceMeters}m from Red Zone (${redZoneStatus.activeZone ? redZoneStatus.activeZone.name : 'Crime Hotspot'})`,
        timestamp: Date.now()
      };
      wss.broadcast(alertPacket);
    }
    return;
  }

  // 3. CLIENT_SOS_TRIGGER
  if (type === 'CLIENT_SOS_TRIGGER' || type === 'TRIGGER_SOS') {
    const lat = Number(payload.lat) || 26.4499;
    const lng = Number(payload.lng) || 80.3319;
    const unitId = payload.unitId || (ws.user ? ws.user.sub : 'unit-field');
    const unitName = payload.unitName || (ws.user ? ws.user.name : 'Field Unit');
    const locality = payload.locality || 'Kanpur Grid';

    const distress = createSosDistressPacket({
      unitId,
      unitName,
      lat,
      lng,
      locality,
      nearestThana: findNearestThana(lat, lng)
    });

    // Broadcast to ALL connected monitoring consoles
    wss.broadcast(distress);

    // Also send legacy event name for full backward compatibility
    wss.broadcast({
      type: 'SOS_BROADCAST',
      payload: distress,
      timestamp: Date.now()
    });
    return;
  }

  // 4. ADMIN_CREATE_REDZONE
  if (type === 'ADMIN_CREATE_REDZONE' || type === 'PUBLISH_RED_ZONE') {
    const zone = payload.zone || payload;
    if (zone && zone.id) {
      const result = upsertRedZone(zone);
      const pushPacket = {
        type: 'RED_ZONE_PUSH',
        action: result.action,
        zone: result.zone,
        timestamp: Date.now()
      };
      wss.broadcast(pushPacket);
      wss.broadcast({
        type: 'RED_ZONE_SYNC',
        payload: { action: result.action, zone: result.zone },
        timestamp: Date.now()
      });
    }
  }
}

/**
 * 1Hz Real-Time Telemetry Simulation Broadcast Loop
 * Computes live coordinates for Cantt, Panki, Kidwai Nagar, and Bada Chauraha personas
 * and streams updates to all authenticated WebSocket clients every second.
 */
let telemetryInterval = setInterval(() => {
  if (wss.clients.size === 0) return;

  const updates = personaSimulator.tick();

  // 1. Broadcast individual TELEMETRY_UPDATE for each unit
  for (const unit of updates) {
    wss.broadcast({
      type: 'TELEMETRY_UPDATE',
      unit,
      timestamp: Date.now()
    });

    // 2. Evaluate and broadcast GEOFENCE_ALERT if unit is in 350m proximity buffer or breach
    if (unit.redZoneStatus && (unit.redZoneStatus.status === 'PROXIMITY_350M' || unit.redZoneStatus.status === 'BREACH')) {
      const zoneName = unit.redZoneStatus.activeZone ? unit.redZoneStatus.activeZone.name : 'Crime Red Zone';
      const zoneId = unit.redZoneStatus.activeZone ? unit.redZoneStatus.activeZone.id : 'unknown';
      const riskLevel = unit.redZoneStatus.activeZone ? unit.redZoneStatus.activeZone.riskLevel : 'HIGH';

      wss.broadcast({
        type: 'GEOFENCE_ALERT',
        unitId: unit.id,
        unitName: unit.name,
        callSign: unit.callSign,
        sector: unit.sector,
        zoneId,
        zoneName,
        riskLevel,
        distanceMeters: unit.redZoneStatus.distanceMeters,
        status: unit.redZoneStatus.status,
        message: `⚠️ HAZARD ALERT: Unit ${unit.callSign} is ${unit.redZoneStatus.distanceMeters}m from ${riskLevel} Red Zone (${zoneName})`,
        timestamp: Date.now()
      });
    }
  }

  // 3. Broadcast aggregated TELEMETRY_BROADCAST for multi-client dashboards
  wss.broadcast({
    type: 'TELEMETRY_BROADCAST',
    payload: { users: updates },
    timestamp: Date.now()
  });
}, 1000);

/**
 * Heartbeat interval (every 15s) to prune dead sockets
 */
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      wss.clients.delete(client);
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 15000);

// Graceful Shutdown
function shutdown() {
  clearInterval(telemetryInterval);
  clearInterval(heartbeatInterval);
  wss.closeAll(1001, 'Server shutting down');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Export for testing and standalone execution
module.exports = {
  server,
  wss,
  personaSimulator,
  startServer: (port = PORT) => {
    return new Promise((resolve) => {
      server.listen(port, HOST, () => {
        console.log(`[Kanpur Tactical GIS Server] Listening on http://localhost:${port}`);
        console.log(`[WebSocket Telemetry] Endpoint active at ws://localhost:${port}/telemetry`);
        resolve(server);
      });
    });
  },
  stopServer: () => {
    return new Promise((resolve) => {
      clearInterval(telemetryInterval);
      clearInterval(heartbeatInterval);
      wss.closeAll(1001, 'Test complete');
      server.close(resolve);
    });
  }
};

// Auto-start if invoked directly
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`================================================================`);
    console.log(`   KANPUR TACTICAL GIS & LIVE TELEMETRY PLATFORM (v2.5.0 PRO)   `);
    console.log(`================================================================`);
    console.log(` [HTTP Server]       http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(` [WebSocket Hub]     ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/telemetry`);
    console.log(` [Auth PIN]          1120 (Cryptographic HS256 Token Issuance)`);
    console.log(` [Live Personas]     Cantt (EAGLE-1), Panki (RHINO-3),`);
    console.log(`                     Kidwai Nagar (PANTHER-2), Bada Chauraha (CHETAK-1)`);
    console.log(` [Geofence Grid]     350m Proximity Alert & Dynamic Red Zone Sync`);
    console.log(`================================================================`);
  });
}
