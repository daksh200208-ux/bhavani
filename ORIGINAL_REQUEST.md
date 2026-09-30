# Original User Request

## Initial Request — 2026-09-27T12:40:45Z

A hardened, real-time tactical safety and live GPS telemetry platform for Kanpur, Uttar Pradesh, featuring secure multi-user tracking across distinct sectors (Cantt, Panki, Kidwai Nagar, Bada Chauraha), dynamic server-pushed crime red zones, and fail-safe 112 emergency dispatch.

Working directory: `C:\Users\hp\.gemini\antigravity\scratch\kanpur-safety-gis`
Integrity mode: development

## Requirements

### R1. Hardened Security & Anti-Tamper Access Control
- Implement a secure authentication layer utilizing cryptographic JWT tokens and session verification to restrict console and telemetry access strictly to designated personnel.
- Protect all API and WebSocket endpoints against injection, replay attacks, coordinate spoofing, and unauthorized snooping with payload validation and rate limiting.

### R2. High-Performance Real-Time Multi-User Tracking
- Build a lightweight Node.js + WebSocket server supporting low-latency bidirectional location streaming.
- Enable simultaneous real-time tracking of multiple designated field users across Kanpur (demonstrated with 4 live personas in Cantt, Panki, Kidwai Nagar, and Bada Chauraha).
- Render smooth live movement on the tactical map with distinctive user pins, bearing indicators, breadcrumb history, battery/connection telemetry, and distance to nearest Thana.

### R3. Dynamic Real-Time Red Zones & Geofencing Engine
- Enable live server synchronization of crime red zones: when high-command or dispatch publishes a new hotspot or updates risk boundaries, all connected clients receive the update instantly without page reloads.
- Run continuous server and client geofencing to detect whenever any tracked user enters within 350m of an active red zone, triggering audible and visual emergency alerts across all monitoring screens.

### R4. Automated SOS & 112 Emergency Redundancy
- Retain instant native smartphone dialing (`tel:112`) on tap.
- Provide automatic multi-channel dispatch: when distress is triggered by any user, their exact live coordinates, reverse geocoded locality, nearest police station, and current bearing are broadcasted to all monitors and formatted for instant WhatsApp/SMS dispatch.

## Acceptance Criteria

### Security & Access Control
- [ ] Unauthorized WebSocket or HTTP requests without valid cryptographic tokens are rejected immediately with 401/403 and zero telemetry leakage.
- [ ] Malformed or out-of-bounds coordinate payloads are discarded with defensive error handling.

### Real-Time Live Tracking
- [ ] 4 tracked users in distinct Kanpur sectors (Cantt, Panki, Kidwai Nagar, Bada Chauraha) stream coordinates concurrently via WebSockets with update intervals under 1 second.
- [ ] Map displays moving pins smoothly using interpolation or animation without map flickering or UI lag.
- [ ] Tapping any tracked user focuses on their location and displays their live speed, nearest Thana, and safety zone status.

### Dynamic Safety Grid & Geofence
- [ ] Pushing a new red zone from the server reflects on all connected client maps within 500ms without page refresh.
- [ ] When any tracked user crosses within 350m of a red zone, a high-priority hazard banner and alert event trigger immediately.

### Verification Suite
- [ ] Automated test script (`test-realtime.js`) verifies concurrent multi-client WebSocket connection, live coordinate broadcasting, token verification, and geofence alert firing.
- [ ] Frontend functions smoothly in both desktop and mobile viewports with active map controls and SOS buttons.

## Follow-up Request — 2026-09-27T13:57:55Z

Personal safety navigator and live tactical GIS platform for Kanpur, Uttar Pradesh, featuring Google Maps-style "Follow Me" live tracking, real-time passing red zone alerts, 1-tap emergency route to the nearest police station with Google Maps turn-by-turn voice directions, standalone Chrome PWA installation, and offline emergency resilience without laptop dependency.

Working directory: `C:\Users\hp\.gemini\antigravity\scratch\kanpur-safety-gis`
Integrity mode: development

## Requirements

### R1. Google Maps-Style "Follow Me" Navigation & Locality HUD
- Implement high-accuracy continuous GPS tracking (`navigator.geolocation.watchPosition`) with smooth map auto-panning that keeps the user centered as she walks or travels.
- Display a directional navigation beacon oriented to her walking bearing/heading.
- Provide a dynamic top HUD showing the current Kanpur neighborhood/street name (e.g., *Mall Road, Cantt* or *Nai Sadak, Parade*).
- As red zones pass by, dynamically calculate distance and trigger multi-stage alerts: visual pulsing at 500m, high alert banner at 300m, and audio chime entering/exiting.

### R2. 1-Tap "Escape to Nearest Police Station" Safe Route Navigator
- Add a prominent, high-visibility **"Safe Route to Nearest Thana"** action button.
- Upon activation, automatically detect the closest of Kanpur's 49 police stations, compute walking distance & estimated arrival time (ETA), and draw the live route line on the tactical map connecting the user directly to the station.
- Include a 1-tap **"Start Voice Navigation in Google Maps"** trigger (`https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=walking`) that seamlessly launches the native Google Maps app with turn-by-turn spoken directions.
- Display the station's SHO direct call button alongside the route for communication while en route.

### R3. Progressive Web App (PWA) & Home Screen Installation
- Complete W3C Web App Manifest (`manifest.json`) configuring `display: standalone` (no Chrome URL bar, no browser chrome), theme colors, orientation, and high-res vector/PNG app icons.
- Add an intuitive in-app install prompt banner encouraging mobile Chrome users to "Add to Home Screen", creating a standalone launcher icon alongside Maps and WhatsApp.

### R4. Service Worker & Offline Emergency Resilience
- Implement Service Worker (`sw.js`) pre-caching static assets, styles, Leaflet map engine, Kanpur 49 Thana database, certified red zone polygons, and emergency dialers.
- Guarantee that if mobile internet cuts out or is patchy at night, the app still launches in <0.5s, displays the cached map and thana directory, and retains click-to-dial for 112 and SHOs over cellular voice lines.

### R5. 24/7 Cloud Deployment Configuration
- Provide production-ready deployment descriptors (`Dockerfile`, `Procfile`, `render.yaml`) and environment variable bindings so the Node.js WebSocket backend can be deployed to Render, Railway, or any container host with zero laptop dependency.

## Acceptance Criteria

### Live Navigation & Follow Mode
- [ ] Toggleable "Follow Me / Navigation Mode" smoothly auto-pans map with moving GPS coordinates.
- [ ] Bearing/heading arrow rotates in direction of movement.
- [ ] Top HUD displays current Kanpur locality name and real-time distance to nearest red zone.
- [ ] Passing within 350m of a red zone triggers visual alert and audio chime; exiting resets alert.

### Safe Route to Nearest Thana
- [ ] Tapping "Safe Route to Nearest Thana" detects closest station and draws route line on map with distance & ETA.
- [ ] "Start Voice Navigation" button successfully triggers Google Maps URL scheme with walking destination.
- [ ] SHO direct dial button is visible and active on the route HUD.

### PWA & Offline
- [ ] `manifest.json` passes W3C validation; Chrome recognizes PWA installability.
- [ ] Opening from home screen icon runs full-screen in standalone mode without browser URL bar.
- [ ] Disconnecting network (offline mode) allows app to boot from cache and preserves 112 and SHO calling.

### Verification Suite
- [ ] Automated test suite (`test-navigation-pwa.js`) verifies route calculation, nearest Thana detection, manifest structure, and service worker registration.
