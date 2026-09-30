/**
 * Kanpur Tactical GIS - Main Application Controller
 * Handles PIN security gate, tab transitions, drawer gestures,
 * police station listings, red zone filters, and incident logging.
 */

class KanpurGISApp {
  constructor() {
    this.mapEngine = null;
    this.emergencyManager = null;
    this.enteredPin = "";
    this.activeTab = "helplines";
  }

  init() {
    // 1. Initialize PIN Gate (Citizen Mode default open)
    this.initSecurityGate();

    // 2. Initialize Subsystems
    this.mapEngine = new TacticalMapEngine("map").init();
    this.emergencyManager = new EmergencyManager(this.mapEngine).init();
    // DossierManager removed per user request

    // 2.05 Initialize Watch Over Me & Battery Distress Beacon Subsystems
    if (typeof GuardianJourneyManager !== 'undefined') {
      this.guardianManager = new GuardianJourneyManager(this.mapEngine).init();
      window.guardianManager = this.guardianManager;
    }
    if (typeof DeadBatteryBeaconManager !== 'undefined') {
      this.batteryBeaconManager = new DeadBatteryBeaconManager(this.mapEngine).init();
      window.batteryBeaconManager = this.batteryBeaconManager;
    }

    // 2.1 Initialize PWA Controller
    if (typeof PwaInstallManager !== 'undefined') {
      this.pwaManager = new PwaInstallManager().init();
      window.pwaManager = this.pwaManager;
    }

    // 2.2 Register Service Worker for offline PWA resilience
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }

    // Initialize Realtime Telemetry Client
    window.realtimeManager = new RealtimeTelemetryManager(this.mapEngine);
    const existingJwt = sessionStorage.getItem(APP_CONFIG.jwtSessionKey || "kanpur_jwt_token");
    if (existingJwt) {
      window.realtimeManager.connect(existingJwt);
    }

    // Attach to global window for inline onclicks
    window.tacticalMap = this.mapEngine;


    window.gisApp = this;

    // 3. Setup UI & Event Handlers
    this.setupDrawerTabs();
    this.setupHeaderHUD();
    this.setupHelplinesDirectory();
    this.setupPoliceStationsDirectory();
    this.setupRedZonesDirectory();
    // setupIncidentLogger removed per user request
    this.setupMapControls();

    // 4. Listen for Tactical Map Events
    window.addEventListener("nearestThanaUpdated", (e) => this.handleNearestThanaUpdate(e.detail));
    window.addEventListener("redZoneProximityChanged", (e) => this.handleRedZoneProximity(e.detail));
    window.addEventListener("redZonesUpdated", () => this.setupRedZonesDirectory());
    window.addEventListener("tacticalAuthRequired", () => this.handleAuthRequired());

    // 5. Handle shortcut URL query actions (e.g. ?action=safe-route)
    if (typeof window !== 'undefined' && window.location) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('action') === 'safe-route') {
        setTimeout(() => {
          if (this.mapEngine) {
            this.mapEngine.activateSafeRouteToNearestThana();
          }
        }, 800);
      }
    }

    console.log("Kanpur Tactical GIS initialized successfully.");
  }

  // =========================================================================
  // 1. PIN SECURITY ACCESS GATE
  // =========================================================================
  initSecurityGate() {
    const pinBackdrop = document.getElementById("pinGateModal");
    const pinButtons = document.querySelectorAll(".pin-btn[data-num]");
    const pinClearBtn = document.getElementById("pinClearBtn");
    const pinSubmitBtn = document.getElementById("pinSubmitBtn");
    const pinBypassBtn = document.getElementById("pinBypassBtn");
    const lockAppBtn = document.getElementById("lockAppBtn");

    // If opened via a live guardian tracking link (?trip=TRIP-XXX), bypass PIN gate
    if (typeof window !== 'undefined' && window.location) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('trip')) {
        if (pinBackdrop) {
          pinBackdrop.classList.remove("active");
          pinBackdrop.style.display = "none";
        }
        return;
      }
    }

    // Citizen Safety Mode is default: full access to 112, maps, route, helplines & beacon
    // PIN security modal only triggers upon explicit Officer Login request
    const closePinBtn = document.getElementById("closePinGateBtn");
    if (closePinBtn && pinBackdrop) {
      closePinBtn.addEventListener("click", () => {
        pinBackdrop.classList.remove("active");
        pinBackdrop.style.display = "none";
      });
    }

    const updatePinDots = () => {
      const dots = document.querySelectorAll(".pin-dot");
      dots.forEach((dot, index) => {
        if (index < this.enteredPin.length) {
          dot.classList.add("filled");
        } else {
          dot.classList.remove("filled");
        }
      });
    };

    pinButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        if (this.enteredPin.length < 4) {
          this.enteredPin += btn.getAttribute("data-num");
          updatePinDots();
          if (this.enteredPin.length === 4) {
            this.verifyPin();
          }
        }
      });
    });

    if (pinClearBtn) {
      pinClearBtn.addEventListener("click", () => {
        this.enteredPin = "";
        updatePinDots();
      });
    }

    if (pinSubmitBtn) {
      pinSubmitBtn.addEventListener("click", () => this.verifyPin());
    }

    if (pinBypassBtn) {
      pinBypassBtn.addEventListener("click", () => {
        this.verifyPin("1120");
      });
    }

    if (lockAppBtn) {
      lockAppBtn.addEventListener("click", () => {
        sessionStorage.removeItem(APP_CONFIG.sessionKey);
        sessionStorage.removeItem(APP_CONFIG.jwtSessionKey || "kanpur_jwt_token");
        if (window.realtimeManager) {
          window.realtimeManager.disconnect();
          window.realtimeManager.clearTelemetry();
        }
        this.enteredPin = "";
        updatePinDots();
        if (pinBackdrop) pinBackdrop.classList.add("active");
      });
    }
  }

  async verifyPin(pinToVerify = null) {
    const pin = pinToVerify || this.enteredPin;
    const pinMsg = document.getElementById("pinErrorMsg");

    try {
      const response = await fetch(`${APP_CONFIG.apiBaseUrl || "/api"}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin || "1120" })
      });

      const data = await response.json();

      if (response.ok && data.success && data.token) {
        sessionStorage.setItem(APP_CONFIG.jwtSessionKey || "kanpur_jwt_token", data.token);
        this.unlockApp();
        if (window.realtimeManager) {
          window.realtimeManager.connect(data.token);
        }
      } else {
        if (pinMsg) {
          pinMsg.textContent = data.error || "Invalid Badge PIN. Access Restricted.";
          pinMsg.style.display = "block";
        }
        this.enteredPin = "";
        document.querySelectorAll(".pin-dot").forEach(d => d.classList.remove("filled"));
      }
    } catch (err) {
      console.warn("Auth endpoint unavailable, checking fallback:", err);
      if (pin === APP_CONFIG.accessPin) {
        this.unlockApp();
        if (window.realtimeManager) {
          window.realtimeManager.updateStatus("OFFLINE");
          const chip = document.getElementById("wsStatusChip");
          if (chip) chip.title = "Offline Mode: Telemetry server unreachable (No JWT session)";
        }
        const banner = document.getElementById("hazardAlertBanner");
        const textEl = document.getElementById("hazardAlertText");
        if (banner && textEl) {
          textEl.innerHTML = "⚠️ <strong>OFFLINE FALLBACK MODE:</strong> Backend server unreachable. Local console unlocked, but live WebSocket telemetry grid and server alerts are offline.";
          banner.style.background = "linear-gradient(90deg, #92400E, #78350F)";
          banner.style.borderBottom = "1px solid #F59E0B";
          banner.style.color = "#FEF3C7";
          banner.style.display = "flex";
        }
      } else {
        if (pinMsg) {
          pinMsg.textContent = "Authentication failed. Access Restricted.";
          pinMsg.style.display = "block";
        }
        this.enteredPin = "";
        document.querySelectorAll(".pin-dot").forEach(d => d.classList.remove("filled"));
      }
    }
  }

  unlockApp() {
    sessionStorage.setItem(APP_CONFIG.sessionKey, "true");
    const pinBackdrop = document.getElementById("pinGateModal");
    if (pinBackdrop) pinBackdrop.classList.remove("active");
    const pinMsg = document.getElementById("pinErrorMsg");
    if (pinMsg) pinMsg.style.display = "none";

    if (window.tacticalAudio) {
      window.tacticalAudio.initContext();
    }
  }

  handleAuthRequired() {
    sessionStorage.removeItem(APP_CONFIG.sessionKey);
    sessionStorage.removeItem(APP_CONFIG.jwtSessionKey || "kanpur_jwt_token");
    this.enteredPin = "";
    const pinBackdrop = document.getElementById("pinGateModal");
    if (pinBackdrop) pinBackdrop.classList.add("active");
    const pinMsg = document.getElementById("pinErrorMsg");
    if (pinMsg) {
      pinMsg.textContent = "Session Expired / Unauthorized. Re-enter Badge PIN.";
      pinMsg.style.display = "block";
    }
  }

  // =========================================================================
  // 2. BOTTOM DRAWER & TAB NAVIGATION
  // =========================================================================
  setupDrawerTabs() {
    const tabs = document.querySelectorAll(".drawer-nav-tabs .tab-btn");
    const drawer = document.getElementById("tacticalDrawer");
    const grabber = document.getElementById("drawerGrabber");

    // Drawer grabber toggle
    if (grabber && drawer) {
      grabber.addEventListener("click", () => {
        drawer.classList.toggle("collapsed");
      });
    }

    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const targetTab = tab.getAttribute("data-tab");
        this.switchTab(targetTab);
        
        // Expand drawer if collapsed
        if (drawer && drawer.classList.contains("collapsed")) {
          drawer.classList.remove("collapsed");
        }
      });
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    
    // Update tab button highlights
    document.querySelectorAll(".drawer-nav-tabs .tab-btn").forEach(btn => {
      if (btn.getAttribute("data-tab") === tabId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Toggle content views
    document.querySelectorAll(".tab-pane").forEach(pane => {
      if (pane.id === `tab-${tabId}`) {
        pane.style.display = "block";
      } else {
        pane.style.display = "none";
      }
    });
  }

  // =========================================================================
  // 3. HEADER HUD (NEAREST THANA CHIP & PROXIMITY BANNER)
  // =========================================================================
  setupHeaderHUD() {
    const chip = document.getElementById("nearestThanaChip");
    if (chip) {
      chip.addEventListener("click", () => {
        if (this.mapEngine.nearestStation) {
          this.mapEngine.focusOnLocation(
            this.mapEngine.nearestStation.lat,
            this.mapEngine.nearestStation.lng,
            16
          );
        }
      });
    }

    // Audio Mute/Unmute Toggle Button
    const audioBtn = document.getElementById("audioToggleBtn");
    if (audioBtn) {
      const updateAudioIcon = (isMuted) => {
        audioBtn.title = isMuted ? "Unmute Tactical Audio Alerts" : "Mute Tactical Audio Alerts";
        audioBtn.style.opacity = isMuted ? "0.5" : "1.0";
        const iconSvg = audioBtn.querySelector("svg");
        if (iconSvg) {
          iconSvg.innerHTML = isMuted
            ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
            : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
        }
      };

      if (window.tacticalAudio) {
        updateAudioIcon(window.tacticalAudio.isMuted);
      }

      audioBtn.addEventListener("click", () => {
        if (window.tacticalAudio) {
          const isMuted = window.tacticalAudio.toggleMute();
          updateAudioIcon(isMuted);
        }
      });
    }
  }

  // =========================================================================
  // 3b. UP WOMEN & EMERGENCY HELPLINES DIRECTORY (24/7 VERIFIED)
  // =========================================================================
  setupHelplinesDirectory() {
    this.renderHelplinesDirectory();
  }

  renderHelplinesDirectory() {
    const container = document.getElementById("helplinesListContainer");
    if (!container) return;

    const helplines = [
      {
        number: "1090",
        name: "Women Power Line (WPL) UP",
        badge: "Anti-Stalking & Harassment",
        color: "#EC4899",
        bg: "rgba(236, 72, 153, 0.15)",
        border: "rgba(236, 72, 153, 0.4)",
        desc: "24/7 dedicated UP Police helpline for women facing stalking, harassment on calls or social media, eve-teasing, or threats. Handled 100% by female officers.",
        dept: "UP Police Headquarter",
        hours: "24/7 Continuous"
      },
      {
        number: "112",
        name: "UP Emergency Police & PRV Response",
        badge: "Immediate Physical Police Dispatch",
        color: "#EF4444",
        bg: "rgba(239, 68, 68, 0.15)",
        border: "rgba(239, 68, 68, 0.4)",
        desc: "Unified emergency helpline for immediate police dispatch (PRV patrol cars), ambulance, and fire services anywhere across Kanpur and Uttar Pradesh.",
        dept: "UP 112 Control Center",
        hours: "24/7 Immediate"
      },
      {
        number: "181",
        name: "Women in Distress Helpline",
        badge: "Crisis Intervention & Counseling",
        color: "#8B5CF6",
        bg: "rgba(139, 92, 246, 0.15)",
        border: "rgba(139, 92, 246, 0.4)",
        desc: "Emergency rescue, legal counseling, shelter home referral, and institutional support for women facing domestic violence or crisis situations.",
        dept: "Women & Child Development (UP)",
        hours: "24/7 Active"
      },
      {
        number: "108",
        name: "Emergency Medical Ambulance",
        badge: "Medical Emergency",
        color: "#10B981",
        bg: "rgba(16, 185, 129, 0.15)",
        border: "rgba(16, 185, 129, 0.4)",
        desc: "Free 24/7 government ambulance service with paramedic staff for accidents, sudden medical emergencies, and hospital transfers.",
        dept: "UP State Health Mission",
        hours: "24/7 Free Service"
      },
      {
        number: "139",
        name: "Railway Security Helpline (RPF / GRP)",
        badge: "Train & Station Safety",
        color: "#F59E0B",
        bg: "rgba(245, 158, 11, 0.15)",
        border: "rgba(245, 158, 11, 0.4)",
        desc: "Immediate security and escort assistance for female passengers traveling through Kanpur Central, Govindpuri, or Indian Railways trains.",
        dept: "Indian Railways / RPF",
        hours: "24/7 Dedicated"
      },
      {
        number: "1930",
        name: "National Cyber Crime Helpline",
        badge: "Cyber Blackmail & Fraud",
        color: "#38BDF8",
        bg: "rgba(56, 189, 248, 0.15)",
        border: "rgba(56, 189, 248, 0.4)",
        desc: "National emergency reporting for online morphing, blackmail, non-consensual image sharing, social media account hijacking, and financial fraud.",
        dept: "Ministry of Home Affairs",
        hours: "24/7 Active"
      },
      {
        number: "1098",
        name: "Childline (Student & Minor Safety)",
        badge: "Minors & POCSO Support",
        color: "#06B6D4",
        bg: "rgba(6, 182, 212, 0.15)",
        border: "rgba(6, 182, 212, 0.4)",
        desc: "Dedicated safety and protection helpline for girls under 18, school/college students, and minors requiring emergency assistance or shelter.",
        dept: "Child Welfare Committee",
        hours: "24/7 Toll-Free"
      },
      {
        number: "1076",
        name: "UP Chief Minister Helpline",
        badge: "Direct Government Action",
        color: "#E2E8F0",
        bg: "rgba(226, 232, 240, 0.12)",
        border: "rgba(226, 232, 240, 0.3)",
        desc: "Direct escalation portal to the Office of the Chief Minister if local complaints or police grievances face delays or negligence.",
        dept: "Chief Minister Secretariat (UP)",
        hours: "24/7 Operational"
      }
    ];

    let html = "";
    helplines.forEach(h => {
      html += `
        <div class="tactical-card" style="border-left: 3px solid ${h.color}; margin-bottom: 10px; padding: 12px 14px;">
          <div class="card-header-row" style="margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 16px; font-weight: 900; color: ${h.color}; background: ${h.bg}; border: 1px solid ${h.border}; padding: 4px 10px; border-radius: 8px; letter-spacing: 0.5px;">${h.number}</span>
              <div>
                <div class="card-title" style="color: #F8FAFC; font-size: 13px;">${h.name}</div>
                <div class="card-subtitle" style="font-size: 10px; color: #94A3B8;">${h.dept} &bull; <strong style="color: #10B981;">${h.hours}</strong></div>
              </div>
            </div>
            <span style="font-size: 9px; font-weight: 700; background: ${h.bg}; color: ${h.color}; padding: 3px 7px; border-radius: 4px; white-space: nowrap;">${h.badge}</span>
          </div>

          <p style="font-size: 11px; color: #CBD5E1; margin: 8px 0; line-height: 1.45;">
            ${h.desc}
          </p>

          <div class="card-action-bar" style="margin-top: 8px;">
            <a href="tel:${h.number}" class="call-112-btn" style="flex: 1; justify-content: center; text-decoration: none; padding: 10px 14px; font-size: 12px; border-radius: 10px; background: linear-gradient(135deg, #059669, #047857); min-height: 44px; display: inline-flex; align-items: center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right: 6px;">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              Direct Dial ${h.number}
            </a>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  handleNearestThanaUpdate(station) {
    if (!station) return;
    const nameEl = document.getElementById("nearestThanaName");
    const distEl = document.getElementById("nearestThanaDist");

    if (nameEl) nameEl.textContent = station.name.replace(" Police Station", "");
    if (distEl) distEl.textContent = `${station.currentDistanceKm} km`;

    // Re-render police stations to reflect updated distance sorting
    this.renderPoliceStationsDirectory();
  }

  handleRedZoneProximity(zone) {
    const banner = document.getElementById("hazardAlertBanner");
    const textEl = document.getElementById("hazardAlertText");

    if (zone && banner && textEl) {
      textEl.innerHTML = `⚠️ <strong>PROXIMITY WARNING:</strong> You are in/near <strong>${zone.name}</strong> (${zone.riskLevel} RED ZONE). Exercise tactical vigilance.`;
      banner.style.display = "flex";
    } else if (banner) {
      banner.style.display = "none";
    }
  }

  // =========================================================================
  // 4. POLICE STATIONS DIRECTORY (49 THANAS)
  // =========================================================================
  setupPoliceStationsDirectory() {
    const searchInput = document.getElementById("thanaSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this.renderPoliceStationsDirectory(searchInput.value.toLowerCase().trim());
      });
    }
    this.renderPoliceStationsDirectory();
  }

  renderPoliceStationsDirectory(query = "") {
    const container = document.getElementById("thanasListContainer");
    if (!container) return;

    let stations = [...KANPUR_POLICE_STATIONS];

    // Sort by distance if available
    stations.sort((a, b) => (a.currentDistanceKm || 999) - (b.currentDistanceKm || 999));

    if (query) {
      stations = stations.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.hindiName.toLowerCase().includes(query) ||
        s.jurisdiction.toLowerCase().includes(query) ||
        s.zone.toLowerCase().includes(query) ||
        s.sho.toLowerCase().includes(query)
      );
    }

    if (stations.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px; color: #64748B; font-size: 13px;">
          No police station matches your search.
        </div>
      `;
      return;
    }

    let html = "";
    stations.forEach(station => {
      const distTag = station.currentDistanceKm 
        ? `<span class="dist-tag" style="color: #38BDF8; font-family: monospace; font-size: 11px; font-weight: 700;">📍 ${station.currentDistanceKm} km</span>`
        : "";

      html += `
        <div class="tactical-card" id="card-${station.id}">
          <div class="card-header-row">
            <div>
              <div class="card-title">${station.name}</div>
              <div class="card-subtitle">${station.hindiName} &bull; ${station.zone}</div>
            </div>
            <div style="text-align: right;">
              <span class="card-tag tag-high" style="background: rgba(37,99,235,0.25); color: #60A5FA; border-color: rgba(37,99,235,0.4);">${station.type}</span>
              <div style="margin-top: 4px;">${distTag}</div>
            </div>
          </div>

          <div class="card-info-grid">
            <div class="info-item">
              <span class="info-label">Station Officer</span>
              <span class="info-val">${station.sho}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Official CUG</span>
              <span class="info-val" style="font-family: monospace;">${station.cug}</span>
            </div>
          </div>

          <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">
            <strong>Jurisdiction:</strong> ${station.jurisdiction}
          </div>

          <div class="card-action-bar">
            <a href="tel:${station.phone}" class="action-btn action-btn-call">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              Call Thana
            </a>
            <button class="action-btn" onclick="window.gisApp.locateStationOnMap('${station.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="m12 8 4 4-4 4M8 12h8"/>
              </svg>
              Locate on Map
            </button>
            <a href="https://maps.google.com/?q=${station.lat},${station.lng}" target="_blank" rel="noopener" class="action-btn">
              Directions
            </a>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  locateStationOnMap(stationId) {
    const station = KANPUR_POLICE_STATIONS.find(s => s.id === stationId);
    if (station && this.mapEngine) {
      this.mapEngine.focusOnLocation(station.lat, station.lng, 16);
      
      // Auto-collapse mobile drawer so map is fully visible
      const drawer = document.getElementById("tacticalDrawer");
      if (drawer && window.innerWidth < 900) {
        drawer.classList.add("collapsed");
      }
    }
  }

  // =========================================================================
  // 5. RED ZONES (CRIME HOTSPOTS DIRECTORY)
  // =========================================================================
  setupRedZonesDirectory() {
    const container = document.getElementById("zonesListContainer");
    if (!container) return;

    const zones = (this.mapEngine && this.mapEngine.activeRedZones && this.mapEngine.activeRedZones.length)
      ? this.mapEngine.activeRedZones
      : KANPUR_CRIME_HOTSPOTS;

    let html = "";
    zones.forEach(zone => {
      const isCritical = zone.riskLevel === "CRITICAL";

      html += `
        <div class="tactical-card" id="card-${zone.id}">
          <div class="card-header-row">
            <div>
              <div class="card-title">${zone.name}</div>
              <div class="card-subtitle">${zone.hindiName || ""}</div>
            </div>
            <span class="card-tag ${isCritical ? 'tag-critical' : 'tag-high'}">${zone.riskLevel} RED ZONE</span>
          </div>

          <div style="background: rgba(239,68,68,0.06); border-radius: 8px; padding: 8px; margin: 8px 0; border: 1px solid rgba(239,68,68,0.15);">
            <div style="font-size: 10px; color: #FCA5A5; font-weight: 700; text-transform: uppercase;">Primary Crime Categories:</div>
            <ul style="font-size: 11px; color: #CBD5E1; margin-left: 16px; margin-top: 4px; line-height: 1.4;">
              ${(zone.primaryCrimes || [zone.category || "Tactical Hotspot"]).map(c => `<li>${c}</li>`).join('')}
            </ul>
          </div>

          <div style="font-size: 11px; color: #FBBF24; line-height: 1.4; margin-bottom: 8px;">
            <strong>Advisory:</strong> ${zone.officerAdvisory || "Maintain tactical vigilance."}
          </div>

          <div style="font-size: 10px; color: #94A3B8; margin-bottom: 10px;">
            <strong>Station Jurisdiction:</strong> ${zone.thanaName || "Police Precinct"} &bull; <strong>Patrol:</strong> ${zone.patrolFrequency || "Active QRT"}
          </div>

          <div class="card-action-bar">
            <button class="action-btn" onclick="window.gisApp.locateZoneOnMap('${zone.id}')" style="background: rgba(239,68,68,0.2); border-color: rgba(239,68,68,0.4); color: #FFF;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="m12 8 4 4-4 4M8 12h8"/>
              </svg>
              Focus Red Zone on Map
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  locateZoneOnMap(zoneId) {
    const zones = (this.mapEngine && this.mapEngine.activeRedZones && this.mapEngine.activeRedZones.length)
      ? this.mapEngine.activeRedZones
      : KANPUR_CRIME_HOTSPOTS;
    const zone = zones.find(z => z.id === zoneId);
    if (zone && this.mapEngine) {
      const center = zone.center || (zone.polygon ? zone.polygon[0] : [26.4499, 80.3319]);
      this.mapEngine.focusOnLocation(center[0], center[1], 15);
      const drawer = document.getElementById("tacticalDrawer");
      if (drawer && window.innerWidth < 900) {
        drawer.classList.add("collapsed");
      }
    }
  }



  // =========================================================================
  // 7. MAP CONTROL BUTTONS (ZOOM, BASE LAYER, LOCATE ME)
  // =========================================================================
  setupMapControls() {
    const locateBtn = document.getElementById("locateMeMapBtn");
    if (locateBtn) {
      locateBtn.addEventListener("click", () => {
        this.mapEngine.locateUser(true);
      });
    }

    // Google Maps Dedicated Floating Locate FAB
    const gmapsLocateFab = document.getElementById("gmapsLocateFab");
    if (gmapsLocateFab) {
      gmapsLocateFab.addEventListener("click", () => {
        this.mapEngine.locateUser(true);
      });
    }

    // Pin Spot Relocation FAB (for laptops / manual positioning)
    const adjustFab = document.getElementById("adjustLocationFab");
    if (adjustFab) {
      adjustFab.addEventListener("click", () => {
        this.mapEngine.togglePinSpotMode();
      });
    }

    // Quick Sector Jump Chips (Instant testing & neighborhood teleport)
    document.querySelectorAll(".sector-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".sector-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const lat = parseFloat(chip.getAttribute("data-lat"));
        const lng = parseFloat(chip.getAttribute("data-lng"));
        const name = chip.getAttribute("data-name");
        this.mapEngine.setUserLocation(lat, lng, 10, name, true);
        this.mapEngine.showToast(`📍 Relocated to ${name}`, 3000);
      });
    });

    // Follow Me / Turn-by-Turn Navigation Mode Toggle
    const followBtn = document.getElementById("followMeBtn");
    if (followBtn) {
      followBtn.addEventListener("click", () => {
        this.mapEngine.toggleNavigationMode();
      });
    }

    // Resume Follow Auto-Panning Pill
    const resumePill = document.getElementById("resumeFollowPill");
    if (resumePill) {
      resumePill.addEventListener("click", () => {
        this.mapEngine.resumeFollow();
      });
    }

    // 1-Tap Safe Route to Nearest Thana
    const safeRouteBtn = document.getElementById("safeRouteBtn");
    if (safeRouteBtn) {
      safeRouteBtn.addEventListener("click", () => {
        this.mapEngine.activateSafeRouteToNearestThana();
      });
    }

    const cancelRouteBtn = document.getElementById("cancelSafeRouteBtn");
    if (cancelRouteBtn) {
      cancelRouteBtn.addEventListener("click", () => {
        this.mapEngine.clearSafeRoute();
      });
    }

    const zoomInBtn = document.getElementById("mapZoomInBtn");
    const zoomOutBtn = document.getElementById("mapZoomOutBtn");
    if (zoomInBtn) zoomInBtn.addEventListener("click", () => this.mapEngine.map.zoomIn());
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => this.mapEngine.map.zoomOut());

    // Layer switch buttons
    document.querySelectorAll(".base-layer-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const layerKey = btn.getAttribute("data-layer");
        this.mapEngine.setBaseLayer(layerKey);

        document.querySelectorAll(".base-layer-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // Layer filter chips
    document.querySelectorAll(".filter-chip[data-layer-toggle]").forEach(chip => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("active");
        const layerName = chip.getAttribute("data-layer-toggle");
        const isNowActive = chip.classList.contains("active");
        this.mapEngine.toggleLayer(layerName, isNowActive);
      });
    });
  }
}

// Instantiate on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  window.kanpurAppInstance = new KanpurGISApp();
  window.kanpurAppInstance.init();
});
