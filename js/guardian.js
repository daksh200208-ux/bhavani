/**
 * Kanpur Tactical GIS - Watch Over Me (Live Guardian Tracking Engine)
 * Provides 1-tap live journey sharing via WhatsApp/SMS,
 * real-time breadcrumb telemetry, and a dedicated Guardian Viewer interface.
 */

class GuardianJourneyManager {
  constructor(mapEngine) {
    this.mapEngine = mapEngine;
    this.activeTrip = null;
    this.updateInterval = null;
    this.isGuardianMode = false;
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
    const params = new URLSearchParams(window.location.search);
    const tripId = params.get('trip');

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
      watchOverMeBtn.addEventListener('click', () => {
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
        localStorage.setItem('kanpur_active_trip', JSON.stringify(this.activeTrip));
        this.closeJourneySetupModal();
        this.showActiveJourneyHud(this.activeTrip);
        this.shareJourneyToWhatsApp(this.activeTrip);
        this.startHeartbeatUpdates();
      } else {
        alert('Could not initiate journey: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      console.error('Failed to start trip:', err);
      // Offline fallback: generate client-side trip
      const tripId = 'TRIP-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      this.activeTrip = { ...payload, tripId, startTime: Date.now(), status: 'ACTIVE' };
      localStorage.setItem('kanpur_active_trip', JSON.stringify(this.activeTrip));
      this.closeJourneySetupModal();
      this.showActiveJourneyHud(this.activeTrip);
      this.shareJourneyToWhatsApp(this.activeTrip);
      this.startHeartbeatUpdates();
    }
  }

  /**
   * Format & open WhatsApp with Live Guardian Link
   */
  shareJourneyToWhatsApp(trip) {
    const origin = window.location.origin;
    const trackingUrl = `${origin}/?trip=${trip.tripId}`;
    const googleMapsUrl = `https://maps.google.com/?q=${trip.currentCoords[0].toFixed(5)},${trip.currentCoords[1].toFixed(5)}`;

    const text = 
`🛡️ *WATCH OVER ME — LIVE JOURNEY TRACKING*
I am traveling to *${trip.destination}* from *${trip.startLocality}*.

Please watch over me and track my live movement until I reach home:
🗺️ *Live Grid Tracking*: ${trackingUrl}
📍 *Google Maps Pin*: ${googleMapsUrl}
🏢 *Nearest Police Station*: ${trip.nearestThana || 'Kanpur Police'}
🔋 *Phone Battery*: ${trip.batteryPct}%

_Tap the Live Grid link above to see my live moving dot and safety zone in real time._`;

    const encoded = encodeURIComponent(text);
    const waUrl = trip.guardianPhone 
      ? `https://api.whatsapp.com/send?phone=${trip.guardianPhone.replace(/\D/g, '')}&text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;

    window.open(waUrl, '_blank');
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
   * Periodically send live GPS coordinates to update trip
   */
  startHeartbeatUpdates() {
    clearInterval(this.updateInterval);
    this.updateInterval = setInterval(async () => {
      if (!this.activeTrip || this.activeTrip.status !== 'ACTIVE') {
        clearInterval(this.updateInterval);
        return;
      }

      const coords = (this.mapEngine && this.mapEngine.userLatLng) || this.activeTrip.currentCoords;
      let batteryPct = this.activeTrip.batteryPct;
      try {
        if ('getBattery' in navigator) {
          const b = await navigator.getBattery();
          batteryPct = Math.round(b.level * 100);
        }
      } catch (e) {}

      const updatePayload = {
        tripId: this.activeTrip.tripId,
        lat: coords[0],
        lng: coords[1],
        heading: (this.mapEngine && this.mapEngine.userHeading) || 0,
        batteryPct
      };

      try {
        await fetch('/api/trip/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload)
        });
      } catch (e) {}
    }, 5000);
  }

  /**
   * End Journey Safely
   */
  async completeJourney() {
    if (!this.activeTrip) return;

    try {
      await fetch('/api/trip/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId: this.activeTrip.tripId })
      });
    } catch (e) {}

    const dest = this.activeTrip.destination;
    const guardianPhone = this.activeTrip.guardianPhone;

    // Clear state
    localStorage.removeItem('kanpur_active_trip');
    clearInterval(this.updateInterval);
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
          this.startHeartbeatUpdates();
        }
      }
    } catch (e) {}
  }

  /**
   * Guardian Mode View (for the family member opening the link)
   */
  async initGuardianViewer(tripId) {
    console.log(`[GuardianViewer] Initializing guardian view for trip ${tripId}`);

    // Hide auth gate modal in guardian view
    const pinModal = document.getElementById('pinGateModal');
    if (pinModal) pinModal.style.display = 'none';

    // Show Guardian Top Bar
    const guardianBar = document.getElementById('guardianViewerBar');
    if (guardianBar) guardianBar.style.display = 'flex';

    // Poll live trip coordinates
    const pollTrip = async () => {
      try {
        const resp = await fetch(`/api/trip/status?tripId=${tripId}`);
        const data = await resp.json();

        if (data.success && data.trip) {
          const trip = data.trip;
          const statusText = document.getElementById('guardianTripStatusText');
          if (statusText) {
            statusText.innerHTML = trip.status === 'COMPLETED'
              ? `✅ <strong>${trip.userName}</strong> has reached <strong>${trip.destination}</strong> safely!`
              : `👁️ Watching over <strong>${trip.userName}</strong> &bull; Heading to <strong>${trip.destination}</strong> (Battery: <strong>${trip.batteryPct}%</strong>)`;
          }

          if (this.mapEngine && trip.currentCoords) {
            this.mapEngine.updateUserMarker(trip.currentCoords[0], trip.currentCoords[1], 10, trip.heading);
            this.mapEngine.map.setView([trip.currentCoords[0], trip.currentCoords[1]], 16);
          }
        }
      } catch (e) {
        console.warn('[GuardianViewer] Poll failed:', e);
      }
    };

    pollTrip();
    setInterval(pollTrip, 4000);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GuardianJourneyManager };
}
