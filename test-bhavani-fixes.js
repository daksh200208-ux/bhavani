const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================');
console.log('🧪 BHAVANI - THREE CRITICAL USER FIXES VERIFICATION');
console.log('================================================================\n');

let pass = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    pass++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    process.exit(1);
  }
}

// 1. SIREN REMOVAL VERIFICATION
console.log('--- 1. Verification of Siren Complete Removal ---');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'css', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, 'js', 'app.js'), 'utf8');
const audioJs = fs.readFileSync(path.join(__dirname, 'js', 'audio.js'), 'utf8');

test('index.html has NO loud-siren-btn or sirenBtnText', () => {
  assert(!indexHtml.includes('loudSirenBtn'), 'loudSirenBtn found in HTML');
  assert(!indexHtml.includes('sirenBtnText'), 'sirenBtnText found in HTML');
});

test('css/styles.css has NO loud-siren-btn classes or strobe keyframes', () => {
  assert(!stylesCss.includes('.loud-siren-btn {'), '.loud-siren-btn found in CSS');
  assert(!stylesCss.includes('sirenActiveFlash'), 'sirenActiveFlash found in CSS');
  assert(!stylesCss.includes('body.siren-strobe-alert'), 'siren-strobe-alert found in CSS');
});

test('js/app.js has NO siren event listeners or sirenBtn handles', () => {
  assert(!appJs.includes('document.getElementById("loudSirenBtn")'), 'loudSirenBtn referenced in app.js');
  assert(!appJs.includes('handleSirenToggle'), 'handleSirenToggle found in app.js');
});

test('js/audio.js siren methods are safe no-ops returning false', () => {
  const { TacticalAudioEngine } = require('./js/audio.js');
  const audio = new TacticalAudioEngine();
  assert.strictEqual(audio.isSirenActive(), false, 'isSirenActive must return false');
  assert.strictEqual(audio.toggleSosAlarm(), false, 'toggleSosAlarm must return false');
});

// 2. MOBILE OVERLAY CLEANUP VERIFICATION
console.log('\n--- 2. Verification of Mobile Overlay & Clutter Elimination ---');
test('css/styles.css hides map-floating-controls on <=768px screens', () => {
  assert(stylesCss.includes('.map-floating-controls {\n    display: none !important;'), 'map-floating-controls not hidden in mobile media query');
});

test('css/styles.css styles gmaps-locate-fab as clean circular icon button', () => {
  assert(stylesCss.includes('.gmaps-locate-fab span {\n    display: none !important;'), 'locate text not hidden on mobile');
  assert(stylesCss.includes('.gmaps-locate-fab {\n    width: 44px !important;'), 'locate FAB width not 44px on mobile');
});

test('emergencyFloatingHub removed from dragSurfaces to ensure instant 1-tap clicks', () => {
  assert(!appJs.includes('document.getElementById("emergencyFloatingHub"),'), 'emergencyFloatingHub still in dragSurfaces!');
  assert(appJs.includes('const dragSurfaces = [grabber].filter(Boolean);'), 'dragSurfaces not strictly grabber');
});

// 3. WATCH OVER ME & CROSS-DEVICE TRACKING VERIFICATION
console.log('\n--- 3. Verification of Watch Over Me & Cross-Device Tracking ---');
const guardianJs = fs.readFileSync(path.join(__dirname, 'js', 'guardian.js'), 'utf8');
const mapJs = fs.readFileSync(path.join(__dirname, 'js', 'map.js'), 'utf8');

test('js/map.js skips locateUser when trip query param is present', () => {
  assert(mapJs.includes('this.isGuardianViewer = hasTripQuery;'), 'isGuardianViewer not set in map.js');
  assert(mapJs.includes('if (!hasTripQuery) {\n      this.locateUser(false);\n    }'), 'locateUser not guarded');
});

test('js/guardian.js activates high-accuracy watchPosition during trip', () => {
  assert(guardianJs.includes('navigator.geolocation.watchPosition'), 'watchPosition not in guardian.js');
  assert(guardianJs.includes('enableHighAccuracy: true'), 'enableHighAccuracy not set');
  assert(guardianJs.includes('handlePositionTelemetry'), 'handlePositionTelemetry missing');
});

test('js/guardian.js creates dedicated glowing Guardian Marker and breadcrumb trail', () => {
  assert(guardianJs.includes('guardian-target-beacon'), 'guardian-target-beacon missing');
  assert(guardianJs.includes('guardianTrail = L.polyline'), 'guardianTrail missing');
});

test('WhatsApp link properly formats URL with currentCoords fallback safety', () => {
  assert(guardianJs.includes('Array.isArray(trip.currentCoords)'), 'currentCoords array check missing in shareJourneyToWhatsApp');
  assert(guardianJs.includes('googleMapsUrl'), 'googleMapsUrl missing');
});

console.log(`\n================================================================`);
console.log(`🎉 ALL ${pass} CUSTOM VERIFICATIONS PASSED!`);
console.log('================================================================\n');
