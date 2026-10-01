/**
 * Kanpur Tactical GIS - Watch Over Me (Live Guardian Tracking Engine)
 * Provides 1-tap live journey sharing via WhatsApp/SMS,
 * continuous real-time GPS telemetry, and a dedicated Guardian Viewer interface.
 */

class GuardianJourneyManager {
  constructor(mapEngine) {
    this.mapEngine = mapEngine;
    this.activeTrip = null;
    this.updateInterval = null;
    this.geoWatchId = null;
    this.isGuardianMode = false;
    this.guardianMarker = null;
    this.guardianTrail = null;
    this.destMarker = null;
  }

  init() {
    this.checkGuardianViewerMode();
    this.setupEventListeners();
    this.restoreActiveTrip();
    return this;
  }

  /**
   * Check if page was opened via a guardian tracking link (?trip=TRIP-XXX)
   */
  checkGuardianViewerMode() {
    const params = (typeof window !== 'undefined') ? new URLSearchParams(window.location.search) : null;
    const tripId = params ? params.get('trip') : null;

    if (tripId) {
      this.isGuardianMode = true;
      this.initGuardianViewer(tripId);
    }
  }

  /**
   * Setup UI Event Listeners for Watch Over Me
   */
  setupEventListeners() {
    const watchOverMeBtn = document.getElementById('watchOverMeBtn');
    if (watchOverMeBtn) {
      watchOverMeBtn.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        this.openJourneySetupModal();
      });
    }

    const startJourneyBtn = document.getElementById('startJourneyBtn');
    if (startJourneyBtn) {
      startJourneyBtn.addEventListener('click', () => {
        this.startJourneyFromModal();
      });
    }

    const closeJourneyModalBtn = document.getElementById('closeJourneyModalBtn');
    if (closeJourneyModalBtn) {
      closeJourneyModalBtn.addEventListener('click', () => {
        this.closeJourneySetupModal();
      });
    }

    const reachedSafelyBtn = document.getElementById('reachedSafelyBtn');
    if (reachedSafelyBtn) {
      reachedSafelyBtn.addEventListener('click', () => {
        this.completeJourney();
      });
    }

    // Quick destination chips in modal
    document.querySelectorAll('.dest-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.dest-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const input = document.getElementById('journeyDestinationInput');
        if (input) input.value = chip.getAttribute('data-dest') || chip.textContent.trim();
      });
    });
  }

  openJourneySetupModal() {
    const modal = document.getElementById('journeySetupModal');
    if (modal) modal.style.display = 'flex';
  }

  closeJourneySetupModal() {
    const modal = document.getElementById('journeySetupModal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * Start a Live Guardian Journey
   */
  async startJourneyFromModal() {
    const destInput = document.getElementById('journeyDestinationInput');
    const destination = (destInput && destInput.value.trim()) || 'Home';
    const guardianInput = document.getElementById('journeyGuardianPhoneInput');
    const guardianPhone = (guardianInput && guardianInput.value.trim()) || '';
    const nameInput = document.getElementById('journeyUserNameInput');
    const userName = (nameInput && nameInput.value.trim()) || 'Citizen';

    const coords = (this.mapEngine && this.mapEngine.userLatLng) || [26.4499, 80.3319];
    const locality = (this.mapEngine && this.mapEngine.currentLocality) || 'Kanpur Metropolitan Zone';

    let batteryPct = 100;
    try {
      if ('getBattery' in navigator) {
        const b = await navigator.getBattery();
        batteryPct = Math.round(b.level * 100);
      }
    } catch (e) {}

    const payload = {
      userName,
      destination,
      startLocality: locality,
      lat: coords[0],
      lng: coords[1],
      heading: (this.mapEngine && this.mapEngine.userHeading) || 0,
      batteryPct,
      guardianPhone
    };

    try {
      const resp = await fetch('/api/trip/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();

      if (data.success && data.trip) {
        this.activeTrip = data.trip;
      } else {
        throw new Error(data.error || 'Server error');
      }
    } catch (err) {
      console.warn('[Guardian] Offline fallback trip initiation:', err);
      const tripId = 'TRIP-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      this.activeTrip = {
        ...payload,
        tripId,
        currentCoords: [coords[0], coords[1]],
        breadcrumbs: [[coords[0], coords[1]]],
        startTime: Date.now(),
        status: 'ACTIVE'
      };
    }

    // Defensive check: ensure currentCoords is always an array
    if (!this.activeTrip.currentCoords) {
      this.activeTrip.currentCoords = [coords[0], coords[1]];
    }
    if (!this.activeTrip.breadcrumbs) {
      this.activeTrip.breadcrumbs = [[coords[0], coords[1]]];
    }

    localStorage.setItem('kanpur_active_trip', JSON.stringify(this.activeTrip));
    this.closeJourneySetupModal();
    this.showActiveJourneyHud(this.activeTrip);
    this.shareJourneyToWhatsApp(this.activeTrip);
    this.startLiveTelemetryTracking();
  }

  /**
   * Continuous real-time GPS tracking using navigator.geolocation.watchPosition
   * Automatically streams live coordinates whenever the user moves
   */
  startLiveTelemetryTracking() {
    this.stopLiveTelemetryTracking();

    // 1. High Accuracy Geolocation Watcher
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      this.geoWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy || 10;
          const heading = pos.coords.heading || 0;
          const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
          this.handlePositionTelemetry(lat, lng, accuracy, heading, speedKmh);
        },
        (err) => console.warn('[Guardian] Live GPS error:', err.message),
        {
          enableHighAccuracy: true,
          maximumAge: 1500,
          timeout: 10000
        }
      );
    }

    // 2. Regular Heartbeat / Battery Poller (every 4 seconds)
    this.updateInterval = setInterval(async () => {
      if (!this.activeTrip || this.activeTrip.status !== 'ACTIVE') {
        this.stopLiveTelemetryTracking();
        return;
      }

      const coords = this.activeTrip.currentCoords || (this.mapEngine && this.mapEngine.userLatLng) || [26.4499, 80.3319];
      let batteryPct = this.activeTrip.batteryPct;
      try {
        if ('getBattery' in navigator) {
          const b = await navigator.getBattery();
          batteryPct = Math.round(b.level * 100);
          this.activeTrip.batteryPct = batteryPct;
        }
      } catch (e) {}

      this.sendTripUpdateToServer(coords[0], coords[1], (this.mapEngine && this.mapEngine.userHeading) || 0, 0, batteryPct);
    }, 4000);
  }

  stopLiveTelemetryTracking() {
    if (this.geoWatchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Process and transmit new coordinates from GPS
   */
  handlePositionTelemetry(lat, lng, accuracy, heading, speedKmh) {
    if (!this.activeTrip || this.activeTrip.status !== 'ACTIVE') return;

    // Update local map position
    if (this.mapEngine && this.mapEngine.setUserLocation) {
      this.mapEngine.setUserLocation(lat, lng, accuracy, heading, false);
    }

    // Update active trip state
    this.activeTrip.currentCoords = [lat, lng];
    if (!this.activeTrip.breadcrumbs) this.activeTrip.breadcrumbs = [];
    
    // Add breadcrumb if moved > 5m
    const bc = this.activeTrip.breadcrumbs;
    if (bc.length === 0 || this.getDistanceMeters(bc[bc.length - 1][0], bc[bc.length - 1][1], lat, lng) > 5) {
      bc.push([lat, lng]);
      if (bc.length > 200) bc.shift();
    }

    localStorage.setItem('kanpur_active_trip', JSON.stringify(this.activeTrip));
    this.sendTripUpdateToServer(lat, lng, heading, speedKmh, this.activeTrip.batteryPct);
  }

  async sendTripUpdateToServer(lat, lng, heading, speedKmh, batteryPct) {
    if (!this.activeTrip || !this.activeTrip.tripId) return;

    const payload = {
      tripId: this.activeTrip.tripId,
      userName: this.activeTrip.userName || 'Citizen',
      destination: this.activeTrip.destination || 'Home',
      currentCoords: [lat, lng],
      breadcrumbs: this.activeTrip.breadcrumbs || [[lat, lng]],
      nearestThana: this.activeTrip.nearestThana || 'Kanpur Police',
      status: this.activeTrip.status || 'ACTIVE',
      lat,
      lng,
      heading,
      speedKmh,
      batteryPct
    };

    // 1. Send to local backend if reachable
    try {
      fetch('/api/trip/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {}

    // 2. Transmit to public cloud relay (ntfy.sh) so tracking works 100% free from laptop
    try {
      const topic = 'bhavani-trip-' + this.activeTrip.tripId.toLowerCase().replace(/[^a-z0-9]/g, '');
      fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: { 'Title': 'Bhavani Live GPS', 'Priority': 'low' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {}
  }

  getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Format & open WhatsApp with Live Guardian Link
   */
  shareJourneyToWhatsApp(trip) {
    const isLocalhost = (typeof window !== 'undefined') && (
      window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1' || 
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'file:'
    );
    const origin = (typeof window !== 'undefined' && !isLocalhost && window.location.origin.startsWith('http')) 
      ? window.location.origin 
      : 'https://daksh200208-ux.github.io/bhavani';
    const lat = Array.isArray(trip.currentCoords) ? trip.currentCoords[0] : (Number(trip.lat) || 26.4499);
    const lng = Array.isArray(trip.currentCoords) ? trip.currentCoords[1] : (Number(trip.lng) || 80.3319);
    const trackingUrl = `${origin}/?trip=${encodeURIComponent(trip.tripId)}&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&dest=${encodeURIComponent(trip.destination || 'Home')}&name=${encodeURIComponent(trip.userName || 'Citizen')}&bat=${trip.batteryPct || 100}`;
    const googleMapsUrl = `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`;

    const text = 
`🛡️ *BHAVANI — LIVE GUARDIAN TRACKING*
I am traveling to *${trip.destination}* from *${trip.startLocality || 'Kanpur'}*.

Please watch over me and track my live movement until I reach home:
🗺️ *Live Grid Tracking*: ${trackingUrl}
📍 *Google Maps Pin*: ${googleMapsUrl}
🏢 *Nearest Police Station*: ${trip.nearestThana || 'Kanpur Police'}
🔋 *Phone Battery*: ${trip.batteryPct || 100}%

_Tap the Live Grid link above to see my live moving dot and safety zone in real time._`;

    const encoded = encodeURIComponent(text);
    const waUrl = trip.guardianPhone 
      ? `https://api.whatsapp.com/send?phone=${trip.guardianPhone.replace(/\D/g, '')}&text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;

    if (typeof window !== 'undefined') {
      window.open(waUrl, '_blank');
    }
  }

  /**
   * Display top HUD during an active journey
   */
  showActiveJourneyHud(trip) {
    const hud = document.getElementById('activeJourneyHud');
    const textEl = document.getElementById('activeJourneyText');
    if (hud && textEl) {
      textEl.innerHTML = `🛡️ <strong>Live Journey Active:</strong> Heading to <strong>${trip.destination}</strong>`;
      hud.style.display = 'flex';
    }
  }

  /**
   * End Journey Safely
   */
  async completeJourney() {
    if (!this.activeTrip) return;

    const tripId = this.activeTrip.tripId;
    const dest = this.activeTrip.destination;
    const guardianPhone = this.activeTrip.guardianPhone;

    try {
      await fetch('/api/trip/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId })
      });
    } catch (e) {}

    // Transmit complete event to cloud relay for zero-laptop live tracking
    try {
      const topic = 'bhavani-trip-' + tripId.toLowerCase().replace(/[^a-z0-9]/g, '');
      fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: { 'Title': 'Bhavani Live GPS Reached Safely' },
        body: JSON.stringify({ tripId, status: 'COMPLETED', destination: dest, userName: (this.activeTrip && this.activeTrip.userName) || 'Citizen' })
      }).catch(() => {});
    } catch (e) {}

    // Clear tracking
    this.stopLiveTelemetryTracking();
    localStorage.removeItem('kanpur_active_trip');
    this.activeTrip = null;

    const hud = document.getElementById('activeJourneyHud');
    if (hud) hud.style.display = 'none';

    // Notify guardian via WhatsApp
    const safeMsg = encodeURIComponent(`✅ *REACHED SAFELY*\nI have reached *${dest}* safely. Thank you for watching over me!`);
    const waUrl = guardianPhone 
      ? `https://api.whatsapp.com/send?phone=${guardianPhone.replace(/\D/g, '')}&text=${safeMsg}`
      : `https://api.whatsapp.com/send?text=${safeMsg}`;

    if (confirm(`🎉 Journey ended! Would you like to notify your guardian on WhatsApp that you reached ${dest} safely?`)) {
      window.open(waUrl, '_blank');
    }

    if (this.mapEngine && this.mapEngine.showToast) {
      this.mapEngine.showToast(`✅ You have reached ${dest} safely!`, 4000);
    }
  }

  restoreActiveTrip() {
    try {
      const saved = localStorage.getItem('kanpur_active_trip');
      if (saved) {
        this.activeTrip = JSON.parse(saved);
        if (this.activeTrip && this.activeTrip.status === 'ACTIVE') {
          this.showActiveJourneyHud(this.activeTrip);
          this.startLiveTelemetryTracking();
        }
      }
    } catch (e) {}
  }

  /**
   * Guardian Mode View (for the family member opening the link)
   */
  async initGuardianViewer(tripId) {
    console.log(`[GuardianViewer] Initializing guardian view for trip ${tripId}`);

    // 1. Hide auth gate modal in guardian view
    const pinModal = document.getElementById('pinGateModal');
    if (pinModal) pinModal.style.display = 'none';

    // 2. Collapse bottom sheet to minimized so viewer has full map view
    setTimeout(() => {
      if (window.gisApp && window.gisApp.setDrawerState) {
        window.gisApp.setDrawerState('minimized');
      }
    }, 200);

    // 3. Show Guardian Top Bar
    const guardianBar = document.getElementById('guardianViewerBar');
    if (guardianBar) guardianBar.style.display = 'flex';

    // Setup dedicated layers on Leaflet map
    let guardianLayerGroup = null;
    if (this.mapEngine && this.mapEngine.map) {
      guardianLayerGroup = L.layerGroup().addTo(this.mapEngine.map);
    }

    let hasCenteredInitial = false;

    const renderGuardianData = (trip) => {
      if (!trip || !trip.currentCoords) return;

      const lat = trip.currentCoords[0];
      const lng = trip.currentCoords[1];

      // Update top status bar
      const statusText = document.getElementById('guardianTripStatusText');
      if (statusText) {
        if (trip.status === 'COMPLETED') {
          statusText.innerHTML = `✅ <strong>${trip.userName}</strong> has reached <strong>${trip.destination}</strong> safely!`;
          guardianBar.style.background = 'linear-gradient(90deg, #065F46, #047857)';
          guardianBar.style.borderBottomColor = '#10B981';
        } else {
          statusText.innerHTML = `👁️ Watching <strong>${trip.userName}</strong> &bull; Battery: <strong>${trip.batteryPct}%</strong> &bull; Near: <strong>${trip.nearestThana || 'Kanpur Police'}</strong>`;
        }
      }

      if (!this.mapEngine || !this.mapEngine.map || !guardianLayerGroup) return;

      // Render or update custom Glowing Guardian Marker
      const guardianIcon = L.divIcon({
        className: 'guardian-marker-container',
        html: `
          <div class="guardian-target-beacon">
            <div class="beacon-pulse"></div>
            <div class="beacon-dot"></div>
            <div class="beacon-label">📍 ${trip.userName} (LIVE)</div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      if (this.guardianMarker) {
        this.guardianMarker.setLatLng([lat, lng]);
      } else {
        this.guardianMarker = L.marker([lat, lng], {
          icon: guardianIcon,
          zIndexOffset: 2000
        }).addTo(guardianLayerGroup);

        this.guardianMarker.bindPopup(`
          <div style="font-size: 13px; color: #FFF; font-weight: 700;">
            🛡️ <strong>${trip.userName}'s Live Location</strong><br>
            <span style="font-size: 11px; color: #94A3B8;">Destination: ${trip.destination}</span><br>
            <span style="font-size: 11px; color: #10B981;">Battery: ${trip.batteryPct}%</span><br>
            <span style="font-size: 11px; color: #38BDF8;">Nearest Police: ${trip.nearestThana || 'Kanpur Police'}</span>
          </div>
        `);
      }

      // Render or update breadcrumb trail
      if (trip.breadcrumbs && trip.breadcrumbs.length > 0) {
        if (this.guardianTrail) {
          this.guardianTrail.setLatLngs(trip.breadcrumbs);
        } else {
          this.guardianTrail = L.polyline(trip.breadcrumbs, {
            color: '#10B981',
            weight: 4,
            opacity: 0.85,
            dashArray: '6, 8',
            lineJoin: 'round'
          }).addTo(guardianLayerGroup);
        }
      }

      // Center map initially or pan smoothly
      if (!hasCenteredInitial) {
        this.mapEngine.map.setView([lat, lng], 16);
        hasCenteredInitial = true;
      } else {
        this.mapEngine.map.panTo([lat, lng], { animate: true, duration: 1 });
      }
    };

    // Immediate fallback rendering from URL query parameters (instant zero-server display)
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlLat = parseFloat(urlParams.get('lat'));
      const urlLng = parseFloat(urlParams.get('lng'));
      if (!isNaN(urlLat) && !isNaN(urlLng)) {
        renderGuardianData({
          tripId,
          userName: urlParams.get('name') || 'Citizen',
          destination: urlParams.get('dest') || 'Destination',
          batteryPct: parseInt(urlParams.get('bat') || '100', 10),
          currentCoords: [urlLat, urlLng],
          breadcrumbs: [[urlLat, urlLng]],
          status: 'ACTIVE'
        });
      }
    }

    // Subscribe to cloud relay (ntfy.sh) SSE for real-time tracking free from laptop
    const cleanTopic = 'bhavani-trip-' + tripId.toLowerCase().replace(/[^a-z0-9]/g, '');
    try {
      if (typeof EventSource !== 'undefined') {
        const sse = new EventSource(`https://ntfy.sh/${cleanTopic}/sse`);
        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && data.message) {
              const tripUpdate = JSON.parse(data.message);
              if (tripUpdate && (tripUpdate.tripId === tripId || tripUpdate.currentCoords)) {
                renderGuardianData(tripUpdate);
              }
            }
          } catch (e) {}
        };
      }
    } catch (e) {
      console.warn('[GuardianViewer] SSE relay error:', e);
    }

    // Poll live trip coordinates every 3 seconds from local server (if available)
    const pollTrip = async () => {
      try {
        const resp = await fetch(`/api/trip/status?tripId=${tripId}`);
        const data = await resp.json();

        if (data.success && data.trip) {
          renderGuardianData(data.trip);
        }
      } catch (e) {
        // Silently handled: cloud relay handles live tracking when local laptop is offline
      }
    };

    // Immediate first fetch
    pollTrip();
    setInterval(pollTrip, 3000);

    // Also listen for WebSocket event if available
    if (typeof window !== 'undefined') {
      window.addEventListener('guardianTripUpdate', (e) => {
        if (e.detail && (e.detail.tripId === tripId || !e.detail.tripId)) {
          renderGuardianData(e.detail);
        }
      });
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GuardianJourneyManager };
}
