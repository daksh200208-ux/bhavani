/**
 * Kanpur Tactical GIS - Emergency 112 & Patrol Dispatch Module
 * Ensures direct native telephone dialer trigger for 112,
 * safe haven escape route activation, plus emergency dispatch
 * payload generator with live GPS coordinates.
 */

class EmergencyManager {
  constructor(mapEngine) {
    this.mapEngine = mapEngine;
    this.modalBackdrop = null;
    this.activeCoords = null;
  }

  init() {
    this.modalBackdrop = document.getElementById("emergencyModal");
    this.setupListeners();
    return this;
  }

  setupListeners() {
    // 1. Primary 112 Floating Button
    const directDialBtn = document.getElementById("main112DialBtn");
    if (directDialBtn) {
      directDialBtn.addEventListener("click", (e) => {
        console.log("[112 Dial] Emergency 112 triggered at", new Date().toISOString());
      });
    }

    // 2. Open SOS Dispatch Toolkit Modal
    const openToolkitBtn = document.getElementById("openSosToolkitBtn");
    if (openToolkitBtn) {
      openToolkitBtn.addEventListener("click", () => {
        this.openEmergencyModal();
      });
    }

    // 3. Modal Close button
    const closeBtn = document.getElementById("closeSosModalBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        this.closeEmergencyModal();
      });
    }

    // 4. Copy GPS Coordinates Button
    const copyGpsBtn = document.getElementById("copyGpsBtn");
    if (copyGpsBtn) {
      copyGpsBtn.addEventListener("click", () => {
        this.copyCurrentLocation();
      });
    }

    // 5. WhatsApp SOS Dispatch Button
    const whatsappSosBtn = document.getElementById("whatsappSosBtn");
    if (whatsappSosBtn) {
      whatsappSosBtn.addEventListener("click", () => {
        this.broadcastSosOverWs();
        this.dispatchWhatsAppAlert();
      });
    }

    // 6. SMS SOS Dispatch Button
    const smsSosBtn = document.getElementById("smsSosBtn");
    if (smsSosBtn) {
      smsSosBtn.addEventListener("click", () => {
        this.broadcastSosOverWs();
        this.dispatchSmsAlert();
      });
    }

    // 7. Safe Route To Nearest Thana Buttons
    const safeRouteBtn = document.getElementById("safeRouteBtn");
    if (safeRouteBtn) {
      safeRouteBtn.addEventListener("click", () => {
        this.triggerSafeRoute();
      });
    }

    const cancelSafeRouteBtn = document.getElementById("cancelSafeRouteBtn");
    if (cancelSafeRouteBtn) {
      cancelSafeRouteBtn.addEventListener("click", () => {
        if (this.mapEngine && typeof this.mapEngine.clearSafeRoute === 'function') {
          this.mapEngine.clearSafeRoute();
        }
      });
    }

    // 8. Listen for incoming remote SOS alerts from other field units
    if (typeof window !== 'undefined') {
      window.addEventListener("sosDistressReceived", (e) => {
        this.handleIncomingSosDistress(e.detail);
      });
    }
  }

  triggerSafeRoute() {
    if (this.mapEngine && typeof this.mapEngine.activateSafeRouteToNearestThana === 'function') {
      return this.mapEngine.activateSafeRouteToNearestThana();
    }
    return null;
  }

  broadcastSosOverWs() {
    const latLng = this.activeCoords || APP_CONFIG.defaultCenter;
    const nearest = this.mapEngine.nearestStation || KANPUR_POLICE_STATIONS[0];
    const locality = nearest ? `${nearest.name} Jurisdiction` : "Kanpur Grid";

    if (typeof window !== 'undefined' && window.realtimeManager && window.realtimeManager.triggerSos) {
      window.realtimeManager.triggerSos(latLng[0], latLng[1], locality, "Tactical 112 SOS Dispatch");
    }
  }

  handleIncomingSosDistress(distress) {
    if (!this.modalBackdrop) return;
    this.openEmergencyModal();

    const titleEl = this.modalBackdrop.querySelector(".modal-title");
    if (titleEl) {
      titleEl.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        🚨 INCOMING DISTRESS: ${distress.unitName || distress.unitId}
      `;
    }

    const latEl = document.getElementById("sosLatVal");
    const lngEl = document.getElementById("sosLngVal");
    if (latEl && lngEl && distress.coords) {
      latEl.textContent = distress.coords[0].toFixed(5);
      lngEl.textContent = distress.coords[1].toFixed(5);
    }

    const nearestThanaNameEl = document.getElementById("sosNearestThanaName");
    if (nearestThanaNameEl && distress.nearestThana) {
      nearestThanaNameEl.textContent = `${distress.nearestThana.name} (${distress.nearestThana.distKm || distress.nearestThana.distanceKm || '0.5'} km away)`;
    }
  }

  _resetModalTitle() {
    if (!this.modalBackdrop) return;
    const titleEl = this.modalBackdrop.querySelector(".modal-title");
    if (titleEl) {
      titleEl.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        Emergency 112 Dispatch
      `;
    }
  }

  openEmergencyModal() {
    if (!this.modalBackdrop) return;
    this._resetModalTitle();
    this.updateModalInfo();
    this.modalBackdrop.classList.add("active");
  }

  closeEmergencyModal() {
    if (!this.modalBackdrop) return;
    this.modalBackdrop.classList.remove("active");
    this._resetModalTitle();
    if (typeof window !== 'undefined' && window.tacticalAudio) {
      window.tacticalAudio.stopSosAlarm();
    }
  }

  updateModalInfo() {
    const latLng = (this.mapEngine && this.mapEngine.userLatLng) ? this.mapEngine.userLatLng : APP_CONFIG.defaultCenter;
    this.activeCoords = latLng;

    const latEl = document.getElementById("sosLatVal");
    const lngEl = document.getElementById("sosLngVal");
    const nearestThanaNameEl = document.getElementById("sosNearestThanaName");
    const nearestThanaCallEl = document.getElementById("sosNearestThanaCall");

    if (latEl && lngEl) {
      latEl.textContent = latLng[0].toFixed(5);
      lngEl.textContent = latLng[1].toFixed(5);
    }

    const nearest = (this.mapEngine && this.mapEngine.nearestStation) ? this.mapEngine.nearestStation : KANPUR_POLICE_STATIONS[0];
    if (nearestThanaNameEl) {
      nearestThanaNameEl.textContent = `${nearest.name} (${nearest.currentDistanceKm || '1.2'} km away)`;
    }

    if (nearestThanaCallEl) {
      nearestThanaCallEl.setAttribute("href", `tel:${nearest.phone || nearest.cug}`);
      nearestThanaCallEl.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
        Call SHO (${nearest.cug})
      `;
    }
  }

  copyCurrentLocation() {
    const latLng = this.activeCoords || APP_CONFIG.defaultCenter;
    const text = `LAT: ${latLng[0].toFixed(5)}, LNG: ${latLng[1].toFixed(5)} (Google Maps: https://maps.google.com/?q=${latLng[0]},${latLng[1]})`;
    
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        const copyBtn = document.getElementById("copyGpsBtn");
        if (copyBtn) {
          const originalText = copyBtn.innerHTML;
          copyBtn.innerHTML = `✓ Copied Coordinates`;
          setTimeout(() => {
            copyBtn.innerHTML = originalText;
          }, 2000);
        }
      }).catch(err => {
        console.warn("Clipboard copy failed, using prompt:", err);
        prompt("Copy coordinates:", text);
      });
    } else {
      prompt("Copy coordinates:", text);
    }
  }

  dispatchWhatsAppAlert() {
    const latLng = this.activeCoords || APP_CONFIG.defaultCenter;
    const nearest = (this.mapEngine && this.mapEngine.nearestStation) ? this.mapEngine.nearestStation : KANPUR_POLICE_STATIONS[0];
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const message = encodeURIComponent(
      `🚨 *EMERGENCY SOS - KANPUR TACTICAL GRID*\n` +
      `Time: ${time}\n` +
      `Designated Field Unit requires immediate assistance!\n\n` +
      `📍 *Coordinates:* ${latLng[0].toFixed(5)}, ${latLng[1].toFixed(5)}\n` +
      `🗺️ *Live Map:* https://maps.google.com/?q=${latLng[0]},${latLng[1]}\n` +
      `🏢 *Nearest Thana:* ${nearest.name} (${nearest.currentDistanceKm || '1.2'} km)\n` +
      `📞 *SHO Contact:* ${nearest.phone} (CUG: ${nearest.cug})\n` +
      `⚡ *Action Requested:* Immediate PRV / QRT Dispatch to location.`
    );

    if (typeof window !== 'undefined') {
      window.open(`https://api.whatsapp.com/send?text=${message}`, '_blank');
    }
  }

  dispatchSmsAlert() {
    const latLng = this.activeCoords || APP_CONFIG.defaultCenter;
    const nearest = (this.mapEngine && this.mapEngine.nearestStation) ? this.mapEngine.nearestStation : KANPUR_POLICE_STATIONS[0];

    const body = encodeURIComponent(
      `EMERGENCY SOS: Kanpur Grid Unit needs backup at ${latLng[0].toFixed(5)}, ${latLng[1].toFixed(5)}. Nearest Thana: ${nearest.name}. SHO CUG: ${nearest.cug}. Live: https://maps.google.com/?q=${latLng[0]},${latLng[1]}`
    );

    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const smsUrl = isIOS ? `sms:112&body=${body}` : `sms:112?body=${body}`;
    if (typeof window !== 'undefined') {
      window.location.href = smsUrl;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EmergencyManager };
}
