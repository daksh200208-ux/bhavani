/**
 * Kanpur Tactical GIS - Dead-Battery Distress Beacon
 * Automatically monitors device battery levels via the Hardware Battery API.
 * When battery drops to <= 5% without charging, it locks the last known GPS coordinates,
 * broadcasts a distress packet over WebSockets, and prepares pre-composed SMS & WhatsApp emergency dispatches.
 */

class DeadBatteryBeaconManager {
  constructor(mapEngine) {
    this.mapEngine = mapEngine;
    this.battery = null;
    this.hasTriggeredThisSession = false;
    this.lastKnownState = null;
    this.guardianContact = "";
  }

  init() {
    this.loadSettings();
    this.setupBatteryMonitoring();
    this.setupUI();
    return this;
  }

  loadSettings() {
    try {
      this.guardianContact = localStorage.getItem('kanpur_guardian_phone') || '';
      const saved = localStorage.getItem('kanpur_last_known_battery_beacon');
      if (saved) {
        this.lastKnownState = JSON.parse(saved);
      }
    } catch (e) {}
  }

  /**
   * Monitor hardware battery status via W3C Battery Status API
   */
  async setupBatteryMonitoring() {
    if ('getBattery' in navigator) {
      try {
        this.battery = await navigator.getBattery();
        this.checkBatteryLevel();

        this.battery.addEventListener('levelchange', () => this.checkBatteryLevel());
        this.battery.addEventListener('chargingchange', () => this.checkBatteryLevel());
      } catch (err) {
        console.warn('[BatteryBeacon] Battery API access not available:', err);
      }
    } else {
      console.log('[BatteryBeacon] Battery API not supported by browser (test mode available)');
    }
  }

  /**
   * Check battery percentage against critical threshold (<= 5%)
   */
  checkBatteryLevel() {
    if (!this.battery) return;

    const levelPct = Math.round(this.battery.level * 100);
    const isCharging = this.battery.charging;

    // Update battery indicator in HUD if present
    const battPill = document.getElementById('deviceBatteryPill');
    if (battPill) {
      battPill.textContent = `${levelPct}% 🔋${isCharging ? '⚡' : ''}`;
      battPill.className = levelPct <= 15 ? 'battery-pill critical' : 'battery-pill normal';
    }

    // Trigger beacon if <= 5% and not charging
    if (levelPct <= 5 && !isCharging && !this.hasTriggeredThisSession) {
      console.warn(`[BatteryBeacon] CRITICAL LOW BATTERY DETECTED: ${levelPct}%. Triggering distress beacon.`);
      this.triggerDeadBatteryDistress(levelPct, false);
    }
  }

  /**
   * Trigger the Dead-Battery Distress Beacon
   */
  async triggerDeadBatteryDistress(batteryPct = 4, isManualTest = false) {
    this.hasTriggeredThisSession = true;

    const coords = (this.mapEngine && this.mapEngine.userLatLng) || [26.4499, 80.3319];
    const locality = (this.mapEngine && this.mapEngine.currentLocality) || 'Kanpur Metropolitan Zone';
    const nearestThana = (this.mapEngine && this.mapEngine.nearestStation) 
      ? this.mapEngine.nearestStation 
      : { name: 'Kanpur Police Station', phone: '112' };

    const beaconData = {
      lat: coords[0],
      lng: coords[1],
      batteryPct,
      locality,
      nearestThana: nearestThana.name,
      shoPhone: nearestThana.phone,
      isTest: isManualTest,
      timestamp: Date.now()
    };

    this.lastKnownState = beaconData;
    localStorage.setItem('kanpur_last_known_battery_beacon', JSON.stringify(beaconData));

    // 1. Send to server via REST
    try {
      await fetch('/api/emergency/battery-distress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(beaconData)
      });
    } catch (e) {
      console.warn('[BatteryBeacon] Server distress broadcast failed:', e);
    }

    // 2. Display Onscreen Banner
    this.showCriticalBatteryBanner(beaconData);

    // 3. Format Emergency SMS & WhatsApp
    const emergencyText = 
`⚠️ *CRITICAL LOW BATTERY BEACON* ${isManualTest ? '(SIMULATION TEST)' : '(DEVICE SHUTTING DOWN)'}
My phone battery is at *${batteryPct}%* and shutting down soon!
📍 *Last Known Location*: https://maps.google.com/?q=${coords[0].toFixed(5)},${coords[1].toFixed(5)}
🏢 *Nearest Police Station*: ${nearestThana.name} (SHO CUG: ${nearestThana.phone})
Sector: ${locality}
Time: ${new Date().toLocaleTimeString('en-IN')}`;

    // Prompt user to send emergency alert to guardian
    const contact = this.guardianContact || localStorage.getItem('kanpur_guardian_phone') || '';
    const waUrl = contact
      ? `https://api.whatsapp.com/send?phone=${contact.replace(/\D/g, '')}&text=${encodeURIComponent(emergencyText)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(emergencyText)}`;

    const smsUrl = `sms:${contact}?body=${encodeURIComponent(emergencyText)}`;

    // Update modal action buttons
    const waBtn = document.getElementById('batteryBeaconWaBtn');
    if (waBtn) waBtn.onclick = () => window.open(waUrl, '_blank');

    const smsBtn = document.getElementById('batteryBeaconSmsBtn');
    if (smsBtn) smsBtn.onclick = () => window.location.href = smsUrl;

    if (this.mapEngine && this.mapEngine.showToast) {
      this.mapEngine.showToast(`🪫 Critical Battery Distress Beacon Dispatched (${batteryPct}%)`, 5000);
    }
  }

  showCriticalBatteryBanner(beaconData) {
    const banner = document.getElementById('batteryDistressModal');
    if (banner) {
      const text = document.getElementById('batteryDistressDetails');
      if (text) {
        text.innerHTML = `
          <strong>Last Coordinates:</strong> ${beaconData.lat.toFixed(5)}, ${beaconData.lng.toFixed(5)}<br>
          <strong>Sector:</strong> ${beaconData.locality}<br>
          <strong>Nearest Thana:</strong> ${beaconData.nearestThana} (${beaconData.shoPhone})<br>
          <strong>Battery Level:</strong> ${beaconData.batteryPct}% (Low Power State)
        `;
      }
      banner.style.display = 'flex';
    }
  }

  setupUI() {
    const testBtn = document.getElementById('testBatteryBeaconBtn');
    if (testBtn) {
      testBtn.addEventListener('click', () => {
        this.triggerDeadBatteryDistress(4, true);
      });
    }

    const closeBtn = document.getElementById('closeBatteryModalBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        const modal = document.getElementById('batteryDistressModal');
        if (modal) modal.style.display = 'none';
      });
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DeadBatteryBeaconManager };
}
