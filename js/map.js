/**
 * Kanpur Tactical GIS - Leaflet Map Engine
 * Handles base tiles, layer groups, polygon zones, station markers, GPS tracking,
 * Google Maps-style continuous "Follow Me" navigation, forward azimuth heading,
 * directional radar beacon, smooth panTo auto-centering, Locality HUD reverse-geocoding,
 * 3-stage red zone proximity alerts, and 1-tap Safe Route polyline navigation.
 */

/**
 * Forward Azimuth (initial bearing) calculation between two WGS84 points
 * Returns normalized angle 0 <= theta < 360 degrees
 */
function calculateBearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (theta * toDeg + 360) % 360;
}

/**
 * Geodesic displacement distance in meters
 */
function calculateDisplacementMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Hardware Magnetometer & Compass Heading Sensor
 * Seamless fallback when stationary (< 2.5m displacement)
 */
class CompassHeadingSensor {
  constructor(onHeadingChange) {
    this.currentHeading = 0;
    this.onHeadingChange = onHeadingChange;
    this.boundHandler = this.handleOrientation.bind(this);
    this.isActive = false;
  }

  start() {
    if (typeof window === 'undefined' || !window.DeviceOrientationEvent) return;
    if (this.isActive) return;

    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(state => {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', this.boundHandler, true);
            this.isActive = true;
          }
        }).catch(err => console.warn("[Compass] Permission error:", err));
      } else {
        if ('ondeviceorientationabsolute' in window) {
          window.addEventListener('deviceorientationabsolute', this.boundHandler, true);
        } else {
          window.addEventListener('deviceorientation', this.boundHandler, true);
        }
        this.isActive = true;
      }
    } catch (e) {
      console.warn("[Compass] DeviceOrientation initialization failed:", e);
    }
  }

  handleOrientation(event) {
    let heading = null;

    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
      // iOS Safari native compass heading
      heading = event.webkitCompassHeading;
    } else if (event.alpha !== null && !isNaN(event.alpha)) {
      // Android / Standard W3C
      const screenOrientation = (typeof window !== 'undefined' && window.orientation) ? window.orientation : 0;
      heading = (360 - event.alpha + screenOrientation) % 360;
    }

    if (heading !== null && !isNaN(heading)) {
      const diff = Math.abs(heading - this.currentHeading);
      if (diff > 2 && diff < 358) {
        this.currentHeading = Math.round(heading);
        if (this.onHeadingChange) {
          this.onHeadingChange(this.currentHeading);
        }
      }
    }
  }

  stop() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('deviceorientation', this.boundHandler);
    window.removeEventListener('deviceorientationabsolute', this.boundHandler);
    this.isActive = false;
  }
}

class TacticalMapEngine {
  constructor(containerId = "map") {
    this.containerId = containerId;
    this.map = null;
    this.currentTileLayer = null;
    this.baseLayers = {};
    
    // Feature Layer Groups
    this.policeLayerGroup = L.layerGroup();
    this.redZonesLayerGroup = L.layerGroup();
    this.unitsLayerGroup = L.layerGroup();
    this.sosLayerGroup = L.layerGroup();
    this.safeRouteLayerGroup = L.layerGroup();

    // Field Units Cache (Live 4-persona tracking)
    this.fieldUnits = new Map();

    // Active Red Zones (Allows dynamic hot-reloading)
    this.activeRedZones = (typeof KANPUR_CRIME_HOTSPOTS !== 'undefined') ? [...KANPUR_CRIME_HOTSPOTS] : [];

    // User GPS & Navigation State
    this.userLatLng = null;
    this.userLocationMarker = null;
    this.userAccuracyCircle = null;
    this.nearestStation = null;
    this.activeWatchId = null;

    // Follow Me / Turn-by-Turn Navigation Engine State
    this.isNavigating = false;
    this.isPausedFollow = false;
    this.followWatchId = null;
    this.userHeading = 0;
    this.lastUserPosition = null;
    this.compassSensor = null;
    this.currentLocality = "Kanpur Metropolitan Grid";
    this.currentRedZoneStage = "CLEAR"; // CLEAR, CAUTION_500M, HAZARD_300M, BREACH
    this.activeProximityZone = null;
    this.lastRedZoneAlertTime = 0;
    this.activeSafeRoute = null;

    // Layer state toggles
    this.layersVisible = {
      police: true,
      redZones: true,
      incidents: true,
      units: true
    };
  }

  init() {
    // 1. Initialize Leaflet Map centered on Kanpur
    this.map = L.map(this.containerId, {
      center: APP_CONFIG.defaultCenter,
      zoom: APP_CONFIG.defaultZoom,
      minZoom: APP_CONFIG.minZoom,
      maxZoom: APP_CONFIG.maxZoom,
      zoomControl: false, // Custom controls positioned cleanly
      preferCanvas: true, // Hardware-accelerated canvas rendering for polygons, circles & route lines on mobile
      zoomAnimation: true,
      fadeAnimation: true,
      inertia: true,
      inertiaDeceleration: 3000
    });

    // 2. Setup Base Tile Layers (Direct Google Maps Global Synchronization)
    this.baseLayers.streetView = L.tileLayer(APP_CONFIG.tileLayers.streetView.url, {
      subdomains: APP_CONFIG.tileLayers.streetView.subdomains || ['0', '1', '2', '3'],
      attribution: APP_CONFIG.tileLayers.streetView.attribution,
      maxZoom: APP_CONFIG.tileLayers.streetView.maxZoom || 20
    });

    const darkBase = L.tileLayer(APP_CONFIG.tileLayers.tacticalDark.url, {
      attribution: APP_CONFIG.tileLayers.tacticalDark.attribution,
      maxZoom: APP_CONFIG.tileLayers.tacticalDark.maxZoom || 18
    });
    const darkLabels = L.tileLayer(APP_CONFIG.tileLayers.tacticalDark.labelsUrl, {
      maxZoom: APP_CONFIG.tileLayers.tacticalDark.maxZoom || 18
    });
    this.baseLayers.tacticalDark = L.layerGroup([darkBase, darkLabels]);

    this.baseLayers.satellite = L.tileLayer(APP_CONFIG.tileLayers.satellite.url, {
      subdomains: APP_CONFIG.tileLayers.satellite.subdomains || ['0', '1', '2', '3'],
      attribution: APP_CONFIG.tileLayers.satellite.attribution,
      maxZoom: APP_CONFIG.tileLayers.satellite.maxZoom || 20
    });

    // Default to Official Google Maps Roadmap
    this.baseLayers.streetView.addTo(this.map);
    this.currentTileLayer = "streetView";

    // 3. Add Layer Groups to Map
    this.policeLayerGroup.addTo(this.map);
    this.redZonesLayerGroup.addTo(this.map);
    this.unitsLayerGroup.addTo(this.map);
    this.sosLayerGroup.addTo(this.map);
    this.safeRouteLayerGroup.addTo(this.map);

    // 4. Render Initial Feature Sets
    this.renderPoliceStations();
    this.renderCrimeHotspots();

    // 5. Setup Compass & Map Interaction Listeners
    this.initCompassSensor();
    this.setupFollowMeInteraction();

    // 6. Setup Map Click for Pin Spot Relocation Mode
    this.map.on("click", (e) => {
      if (this.pinSpotMode) {
        this.setUserLocation(e.latlng.lat, e.latlng.lng, 10, null, true);
        this.togglePinSpotMode(false);
        this.showToast("✅ Position updated to clicked location!", 2500);
      }
    });

    // 7. Initial User Location (Skip if in Guardian Viewer Mode so viewer's phone never overrides tracked citizen)
    const hasTripQuery = (typeof window !== 'undefined') && (new URLSearchParams(window.location.search).has('trip'));
    this.isGuardianViewer = hasTripQuery;
    if (!hasTripQuery) {
      this.locateUser(false);
    }

    return this;
  }

  /**
   * Switch between Dark, Street, and Satellite tile maps
   */
  setBaseLayer(layerKey) {
    if (!this.baseLayers[layerKey] || this.currentTileLayer === layerKey) return;
    this.map.removeLayer(this.baseLayers[this.currentTileLayer]);
    this.baseLayers[layerKey].addTo(this.map);
    this.currentTileLayer = layerKey;
  }

  /**
   * Render Kanpur Police Stations with custom tactical blue shield badges
   */
  renderPoliceStations() {
    this.policeLayerGroup.clearLayers();

    const createPoliceIcon = (isHQ = false) => {
      return L.divIcon({
        className: "custom-police-pin",
        html: `
          <div style="
            width: 32px;
            height: 32px;
            background: ${isHQ ? 'linear-gradient(135deg, #1E3A8A, #3B82F6)' : 'linear-gradient(135deg, #1E293B, #2563EB)'};
            border: 2px solid ${isHQ ? '#F59E0B' : '#60A5FA'};
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5), 0 0 10px rgba(37,99,235,0.4);
            color: #FFF;
          ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
      });
    };

    KANPUR_POLICE_STATIONS.forEach(station => {
      const isHQ = station.id === "hq-commissionerate";
      const marker = L.marker([station.lat, station.lng], {
        icon: createPoliceIcon(isHQ),
        title: station.name
      });

      const popupHtml = `
        <div style="min-width: 230px; font-family: -apple-system, sans-serif;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div style="font-weight: 800; font-size: 14px; color: #F8FAFC;">${station.name}</div>
            <span style="font-size: 9px; font-weight: 700; background: rgba(37,99,235,0.3); color: #60A5FA; padding: 2px 6px; border-radius: 10px;">${station.zone.split(' ')[0]}</span>
          </div>
          <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">${station.hindiName}</div>
          <div style="font-size: 11px; color: #CBD5E1; line-height: 1.4; margin-bottom: 10px;">
            <strong>SHO:</strong> ${station.sho}<br>
            <strong>CUG:</strong> ${station.cug}<br>
            <strong>Jurisdiction:</strong> ${station.jurisdiction}
          </div>
          <div style="display: flex; gap: 6px;">
            <a href="tel:${station.phone}" style="flex: 1; background: #2563EB; color: white; text-decoration: none; text-align: center; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: 700;">
              Call SHO
            </a>
            <a href="${typeof getGoogleMapsWalkingUrl === 'function' ? getGoogleMapsWalkingUrl(station.lat, station.lng) : 'https://www.google.com/maps/dir/?api=1&destination=' + station.lat + ',' + station.lng + '&travelmode=walking'}" target="_blank" rel="noopener noreferrer" style="flex: 1; background: #059669; color: white; text-decoration: none; text-align: center; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: 700;">
              Walking Nav
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      this.policeLayerGroup.addLayer(marker);
    });
  }

  /**
   * Render Certified Crime Red Zones (Polygons or Buffers)
   */
  renderCrimeHotspots() {
    this.redZonesLayerGroup.clearLayers();

    const zones = (this.activeRedZones && this.activeRedZones.length) ? this.activeRedZones : KANPUR_CRIME_HOTSPOTS;

    zones.forEach(zone => {
      const isCritical = zone.riskLevel === "CRITICAL";
      const zoneColor = isCritical ? "#DC2626" : "#EF4444";

      let layer;

      if (zone.polygon && zone.polygon.length >= 3) {
        layer = L.polygon(zone.polygon, {
          color: zoneColor,
          weight: 2.5,
          opacity: 0.9,
          fillColor: zoneColor,
          fillOpacity: 0.28,
          dashArray: isCritical ? "4, 6" : null
        });
      } else if (zone.center) {
        layer = L.circle(zone.center, {
          radius: zone.radiusMeters || 400,
          color: zoneColor,
          weight: 2,
          opacity: 0.85,
          fillColor: zoneColor,
          fillOpacity: 0.25
        });
      }

      if (layer) {
        const popupContent = `
          <div style="min-width: 220px; font-family: -apple-system, sans-serif;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-weight: 800; font-size: 13px; color: #FCA5A5;">${zone.name}</span>
              <span style="font-size: 9px; font-weight: 800; background: ${isCritical ? '#991B1B' : '#7F1D1D'}; color: #FFF; padding: 2px 6px; border-radius: 4px;">
                ${zone.riskLevel}
              </span>
            </div>
            <div style="font-size: 11px; color: #94A3B8; margin-bottom: 6px;">${zone.hindiName || ""}</div>
            <div style="font-size: 11px; color: #CBD5E1; margin-bottom: 8px;">
              <strong>Key Crimes:</strong> ${(zone.primaryCrimes || [zone.category || "Tactical Hotspot"]).join(', ')}
            </div>
            <div style="font-size: 10px; color: #FBBF24; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 4px;">
              <strong>Advisory:</strong> ${zone.officerAdvisory || "Maintain high vigilance."}
            </div>
          </div>
        `;
        layer.bindPopup(popupContent);
        this.redZonesLayerGroup.addLayer(layer);
      }
    });
  }



  /**
   * Initialize Compass Heading Sensor (stationary magnetometer fallback)
   */
  initCompassSensor() {
    this.compassSensor = new CompassHeadingSensor((heading) => {
      // If user is stationary or moving very slowly (< 2.5m displacement), use compass heading
      if (!this.lastUserPosition || (this.userLatLng && calculateDisplacementMeters(this.lastUserPosition[0], this.lastUserPosition[1], this.userLatLng[0], this.userLatLng[1]) < 2.5)) {
        this.userHeading = heading;
        this.updateBeaconRotation(heading);
      }
    });
    this.compassSensor.start();
  }

  /**
   * Setup Follow Me Interaction (Detect manual user drag to pause auto-panning)
   */
  setupFollowMeInteraction() {
    const handleUserDrag = (e) => {
      if (this.isNavigating && e.originalEvent) {
        this.pauseFollow();
      }
    };

    this.map.on('dragstart', handleUserDrag);
    this.map.on('movestart', handleUserDrag);
  }

  /**
   * Toggle Follow Me / Navigation Mode
   */
  toggleNavigationMode(enabled) {
    if (enabled === undefined) {
      this.isNavigating = !this.isNavigating;
    } else {
      this.isNavigating = !!enabled;
    }

    const followBtn = document.getElementById("followMeBtn");
    const resumePill = document.getElementById("resumeFollowPill");

    if (this.isNavigating) {
      if (followBtn) followBtn.classList.add("active");
      this.isPausedFollow = false;
      if (resumePill) resumePill.style.display = "none";

      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        if (this.followWatchId !== null) {
          navigator.geolocation.clearWatch(this.followWatchId);
        }
        this.followWatchId = navigator.geolocation.watchPosition(
          (pos) => this.handleNavPositionUpdate(pos),
          (err) => {
            console.warn("[Navigation] watchPosition error:", err.message);
            const hud = document.getElementById("localityHudText");
            if (hud) hud.textContent = "Acquiring GPS fix...";
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }
    } else {
      if (followBtn) followBtn.classList.remove("active");
      if (resumePill) resumePill.style.display = "none";
      this.isPausedFollow = false;

      if (this.followWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(this.followWatchId);
        this.followWatchId = null;
      }
    }

    return this.isNavigating;
  }

  /**
   * Pause auto-centering when user manually drags map canvas
   */
  pauseFollow() {
    if (!this.isNavigating) return;
    this.isPausedFollow = true;
    const resumePill = document.getElementById("resumeFollowPill");
    if (resumePill) resumePill.style.display = "flex";
  }

  /**
   * Resume auto-centering and re-lock camera to moving user beacon
   */
  resumeFollow() {
    this.isPausedFollow = false;
    const resumePill = document.getElementById("resumeFollowPill");
    if (resumePill) resumePill.style.display = "none";

    if (this.userLatLng) {
      this.map.panTo(this.userLatLng, { animate: true, duration: 0.85, easeLinearity: 0.25 });
    }
  }

  /**
   * Handle Continuous Navigation Position Update from watchPosition
   */
  handleNavPositionUpdate(pos) {
    if (!pos || !pos.coords) return;
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 10;
    const newCoords = [lat, lng];

    // 1. Calculate Forward Azimuth Bearing if moving >= 2.5 meters
    if (this.lastUserPosition) {
      const displacement = calculateDisplacementMeters(
        this.lastUserPosition[0], this.lastUserPosition[1],
        lat, lng
      );
      if (displacement >= 2.5) {
        this.userHeading = Math.round(calculateBearingDegrees(
          this.lastUserPosition[0], this.lastUserPosition[1],
          lat, lng
        ));
        this.lastUserPosition = newCoords;
      }
    } else {
      this.lastUserPosition = newCoords;
      if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
        this.userHeading = Math.round(pos.coords.heading);
      }
    }

    this.userLatLng = newCoords;

    // 2. Update Directional Beacon Marker
    this.updateUserMarker(lat, lng, accuracy, this.userHeading);

    // 3. Smooth Auto-Panning (0.85s duration, easeLinearity 0.25)
    if (this.isNavigating && !this.isPausedFollow) {
      this.map.panTo([lat, lng], {
        animate: true,
        duration: 0.85,
        easeLinearity: 0.25
      });
    }

    // 4. Locality HUD Offline Reverse-Geocoding Lookup
    if (typeof lookupKanpurLocality === 'function') {
      const locality = lookupKanpurLocality(lat, lng);
      this.currentLocality = locality;
      this.updateLocalityHud(locality);
    }

    // 5. 3-Stage Red Zone Proximity Engine Evaluation
    this.evaluateRedZoneProximity(lat, lng);

    // 6. Nearest Thana Evaluation
    this.checkNearestThana(lat, lng);
  }

  /**
   * Update Locality HUD UI banner
   */
  updateLocalityHud(localityName) {
    const textEl = document.getElementById("localityHudText");
    const chipEl = document.getElementById("localityHudChip");
    if (textEl) {
      textEl.textContent = localityName;
    }
    if (chipEl) {
      chipEl.title = `Current Sector: ${localityName}`;
    }
  }

  /**
   * Update Beacon Rotation in DOM
   */
  updateBeaconRotation(heading) {
    if (this.userLocationMarker) {
      const el = this.userLocationMarker.getElement();
      if (el) {
        const arrow = el.querySelector(".beacon-arrow");
        if (arrow) {
          arrow.style.transform = `rotate(${heading}deg)`;
        }
      }
    }
  }

  /**
   * Render or update Directional Radar Beacon with Rotating Heading Arrow
   */
  updateUserMarker(lat, lng, accuracy, heading = 0) {
    const beaconIcon = L.divIcon({
      className: "custom-user-radar user-nav-beacon",
      html: `
        <div class="user-beacon-wrapper">
          <div class="beacon-pulse"></div>
          <div class="beacon-arrow" style="transform: rotate(${heading}deg);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1.8">
              <path d="M12 2L4 21l8-4 8 4L12 2z"/>
            </svg>
          </div>
          <div class="beacon-center-dot"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20]
    });

    if (this.userLocationMarker) {
      this.userLocationMarker.setLatLng([lat, lng]);
      this.updateBeaconRotation(heading);
    } else {
      this.userLocationMarker = L.marker([lat, lng], {
        icon: beaconIcon,
        zIndexOffset: 1000
      }).addTo(this.map);

      this.userLocationMarker.bindPopup(`
        <div style="font-size: 12px; color: #FFF; font-weight: 600;">
          📍 Your Current Field Position<br>
          <span style="font-size: 10px; color: #94A3B8;">GPS Accuracy: ±${Math.round(accuracy)}m</span><br>
          <span style="font-size: 10px; color: #38BDF8;">Sector: ${this.currentLocality}</span>
        </div>
      `);
    }

    if (this.userAccuracyCircle) {
      this.userAccuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
    } else {
      this.userAccuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: "#38BDF8",
        weight: 1,
        fillColor: "#38BDF8",
        fillOpacity: 0.1
      }).addTo(this.map);
    }
  }

  /**
   * 3-Stage Red Zone Proximity Engine with 15m Hysteresis and Dynamic Audio Chimes
   * - Stage 1 (Caution Pulse: 300m < D <= 500m)
   * - Stage 2 (High Alert Banner: 0m < D <= 300m)
   * - Stage 3 (Critical Breach: D = 0m)
   * - Exit Resolution (D > 315m post-alert): Resolution Chime
   */
  evaluateRedZoneProximity(lat, lng) {
    let nearestZone = null;
    let minDistance = Infinity;
    let isInsideAny = false;

    const zones = (this.activeRedZones && this.activeRedZones.length) ? this.activeRedZones : KANPUR_CRIME_HOTSPOTS;

    for (const zone of zones) {
      if (zone.polygon && zone.polygon.length >= 3) {
        if (typeof isPointInPolygon === 'function' && isPointInPolygon([lat, lng], zone.polygon)) {
          isInsideAny = true;
          nearestZone = zone;
          minDistance = 0;
          break;
        }
        const dist = this.calculateDistancePointToPolygonMeters(lat, lng, zone.polygon);
        if (dist < minDistance) {
          minDistance = dist;
          nearestZone = zone;
        }
      } else if (zone.center) {
        const distToCenter = calculateDistanceKm(lat, lng, zone.center[0], zone.center[1]) * 1000;
        const boundaryDist = Math.max(0, distToCenter - (zone.radiusMeters || 350));
        if (boundaryDist === 0) {
          isInsideAny = true;
          nearestZone = zone;
          minDistance = 0;
          break;
        }
        if (boundaryDist < minDistance) {
          minDistance = boundaryDist;
          nearestZone = zone;
        }
      }
    }

    const prevStage = this.currentRedZoneStage;
    let nextStage = "CLEAR";
    const roundedDist = Math.round(minDistance);

    if (isInsideAny || minDistance === 0) {
      nextStage = "BREACH";
    } else if (minDistance <= 300) {
      nextStage = "HAZARD_300M";
    } else if (minDistance <= 500) {
      // 15m hysteresis: If previously in HAZARD_300M and minDistance <= 315, stay in HAZARD_300M
      if ((prevStage === "HAZARD_300M" || prevStage === "BREACH") && minDistance <= 315) {
        nextStage = "HAZARD_300M";
      } else {
        nextStage = "CAUTION_500M";
      }
    } else {
      nextStage = "CLEAR";
    }

    this.currentRedZoneStage = nextStage;
    this.activeProximityZone = nearestZone;

    // Trigger state transitions & audio
    this.handleProximityStateTransition(prevStage, nextStage, nearestZone, roundedDist);

    return {
      stage: nextStage,
      distanceMeters: roundedDist,
      zone: nearestZone
    };
  }

  /**
   * Handle Audio Chimes and Visual Alerts for Red Zone Stage Transitions
   */
  handleProximityStateTransition(prevStage, nextStage, zone, dist) {
    const hazardBanner = document.getElementById("hazardAlertBanner");
    const hazardText = document.getElementById("hazardAlertText");
    const now = Date.now();

    if (nextStage === "BREACH") {
      if (hazardBanner) {
        hazardBanner.style.display = "flex";
        hazardBanner.style.background = "linear-gradient(90deg, #7F1D1D, #991B1B)";
        hazardBanner.classList.add("alert-breach-strobe");
      }
      if (hazardText) {
        hazardText.innerHTML = `🚨 CRITICAL BREACH: Inside Red Zone (${zone ? zone.name : 'Restricted Hotspot'})!`;
      }
      if (typeof window !== 'undefined' && window.tacticalAudio && now - this.lastRedZoneAlertTime > 2500) {
        window.tacticalAudio.playCriticalBreachSound();
        this.lastRedZoneAlertTime = now;
      }
    } else if (nextStage === "HAZARD_300M") {
      if (hazardBanner) {
        hazardBanner.style.display = "flex";
        hazardBanner.style.background = "linear-gradient(90deg, #991B1B, #7F1D1D)";
        hazardBanner.classList.remove("alert-breach-strobe");
      }
      if (hazardText) {
        hazardText.innerHTML = `⚠️ PROXIMITY WARNING: ${zone ? zone.name : 'Red Zone'} is ${dist}m away! Exercise tactical vigilance.`;
      }
      if (typeof window !== 'undefined' && window.tacticalAudio && prevStage !== "HAZARD_300M" && prevStage !== "BREACH" && now - this.lastRedZoneAlertTime > 2500) {
        window.tacticalAudio.playWarningChirp();
        this.lastRedZoneAlertTime = now;
      }
    } else if (nextStage === "CAUTION_500M") {
      if (hazardBanner) {
        hazardBanner.style.display = "none";
      }
      // Check if exiting from HAZARD_300M or BREACH
      if (prevStage === "HAZARD_300M" || prevStage === "BREACH") {
        if (typeof window !== 'undefined' && window.tacticalAudio) {
          window.tacticalAudio.playResolutionChime();
        }
      }
    } else if (nextStage === "CLEAR") {
      if (hazardBanner) {
        hazardBanner.style.display = "none";
      }
      // Check if exiting from HAZARD_300M or BREACH
      if (prevStage === "HAZARD_300M" || prevStage === "BREACH") {
        if (typeof window !== 'undefined' && window.tacticalAudio) {
          window.tacticalAudio.playResolutionChime();
        }
      }
    }

    // Update Top Red Zone Distance tag in header if present
    const rzChip = document.getElementById("nearestRedZoneChip");
    if (rzChip) {
      if (nextStage === "CLEAR") {
        rzChip.textContent = `Red Zone: ${dist > 1000 ? (dist/1000).toFixed(1) + 'km' : dist + 'm'}`;
        rzChip.className = "nearest-hud-chip rz-safe";
      } else if (nextStage === "CAUTION_500M") {
        rzChip.textContent = `⚠️ ${dist}m (${zone ? zone.name.split(' ')[0] : 'Red Zone'})`;
        rzChip.className = "nearest-hud-chip rz-caution-pulse";
      } else {
        rzChip.textContent = `🚨 ${dist}m (${zone ? zone.name.split(' ')[0] : 'Red Zone'})`;
        rzChip.className = "nearest-hud-chip rz-hazard-flash";
      }
    }

    const event = new CustomEvent("redZoneStageChanged", {
      detail: { stage: nextStage, zone, distanceMeters: dist, prevStage }
    });
    window.dispatchEvent(event);
  }

  /**
   * Find Closest Police Station to Coordinates
   */
  findNearestPoliceStation(userCoords) {
    const coords = userCoords || this.userLatLng || APP_CONFIG.defaultCenter;
    if (typeof computeNearestThanaAndEta === 'function') {
      return computeNearestThanaAndEta(coords[0], coords[1]);
    }
    // Fallback haversine evaluation
    let closest = null;
    let minDistance = Infinity;
    KANPUR_POLICE_STATIONS.forEach(station => {
      const dist = calculateDistanceKm(coords[0], coords[1], station.lat, station.lng);
      if (dist < minDistance) {
        minDistance = dist;
        closest = station;
      }
    });
    const directKm = parseFloat(minDistance.toFixed(2));
    const streetKm = parseFloat((minDistance * 1.30).toFixed(2));
    const etaMins = Math.max(1, Math.ceil(minDistance * 1.30 * 12));
    return {
      station: closest,
      distanceKm: directKm,
      streetDistanceKm: streetKm,
      etaMinutes: etaMins,
      etaString: `${etaMins} mins`,
      googleMapsUrl: closest ? `https://www.google.com/maps/dir/?api=1&destination=${closest.lat},${closest.lng}&travelmode=walking` : ''
    };
  }

  /**
   * 1-Tap "Safe Route to Nearest Thana" Navigator
   * Renders emerald green dashed polyline (#10B981), safe haven target pin,
   * auto-fits bounds, and presents floating Safe Haven Route card.
   */
  activateSafeRouteToNearestThana() {
    const userCoords = this.userLatLng || APP_CONFIG.defaultCenter;
    const calc = this.findNearestPoliceStation(userCoords);
    const station = calc.station;
    if (!station) return null;

    this.activeSafeRoute = calc;

    // 1. Clear previous safe route
    this.safeRouteLayerGroup.clearLayers();

    // 2. Render emerald green dashed polyline (#10B981)
    const routeLine = L.polyline([[userCoords[0], userCoords[1]], [station.lat, station.lng]], {
      color: '#10B981',
      weight: 5,
      opacity: 0.85,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.safeRouteLayerGroup);

    // 3. Safe Haven Target Marker
    const safeHavenIcon = L.divIcon({
      className: 'safe-haven-marker-pin',
      html: `
        <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 40px; height: 40px; border-radius: 50%; background: rgba(16,185,129,0.3); animation: unitRadarPulse 1.5s infinite;"></div>
          <div style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background: #10B981; border: 2px solid #FFF; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 16px #10B981;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#FFF">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    L.marker([station.lat, station.lng], { icon: safeHavenIcon })
      .bindPopup(`<strong>Safe Haven:</strong> ${station.name}<br>SHO: ${station.sho}<br>CUG: ${station.cug}`)
      .addTo(this.safeRouteLayerGroup);

    // 4. Auto-fit camera viewport to include both user and station
    this.map.fitBounds(routeLine.getBounds(), {
      padding: [60, 60],
      maxZoom: 16,
      animate: true
    });

    // 5. Populate and show floating Safe Haven Route card
    this.renderSafeHavenRouteCard(calc);

    return calc;
  }

  /**
   * Render Floating Safe Haven Route Card
   */
  renderSafeHavenRouteCard(calc) {
    const card = document.getElementById("safeHavenCard");
    if (!card) return;

    const station = calc.station;
    const nameEl = document.getElementById("safeRouteThanaName");
    const metaEl = document.getElementById("safeRouteThanaMeta");
    const distEl = document.getElementById("safeRouteDistance");
    const etaEl = document.getElementById("safeRouteEta");
    const gmapsLink = document.getElementById("safeRouteGmapsLink");
    const shoCallBtn = document.getElementById("safeRouteShoCallBtn");

    if (nameEl) nameEl.textContent = station.name;
    if (metaEl) metaEl.textContent = `${station.hindiName} • ${station.zone}`;
    if (distEl) distEl.textContent = `${calc.streetDistanceKm} km walk (${calc.distanceKm} km direct)`;
    if (etaEl) etaEl.textContent = `~${calc.etaString || calc.etaMinutes + ' mins'} ETA`;

    const navUrl = calc.googleMapsUrl || (typeof getGoogleMapsWalkingUrl === 'function' ? getGoogleMapsWalkingUrl(station.lat, station.lng) : `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=walking`);
    if (gmapsLink) {
      gmapsLink.href = navUrl;
    }

    if (shoCallBtn) {
      shoCallBtn.href = `tel:${station.cug || station.phone}`;
      shoCallBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
        Call SHO (${station.cug || station.phone})
      `;
    }

    card.style.display = "block";
  }

  /**
   * Cancel and clear safe route overlay
   */
  clearSafeRoute() {
    this.safeRouteLayerGroup.clearLayers();
    this.activeSafeRoute = null;
    const card = document.getElementById("safeHavenCard");
    if (card) card.style.display = "none";
  }

  /**
   * Display floating tactical toast notification
   */
  showToast(message, durationMs = 3500) {
    const toast = document.getElementById("tacticalToast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.style.display = "none";
    }, durationMs);
  }

  /**
   * Set user field position, update all spatial metrics & re-center
   */
  setUserLocation(lat, lng, accuracy = 10, sectorName = null, panTo = true) {
    this.userLatLng = [lat, lng];
    this.updateUserMarker(lat, lng, accuracy, this.userHeading);
    this.checkNearestThana(lat, lng);
    this.evaluateRedZoneProximity(lat, lng);

    const locality = sectorName || (typeof lookupKanpurLocality === 'function' ? lookupKanpurLocality(lat, lng) : 'Kanpur Grid');
    this.currentLocality = locality;
    this.updateLocalityHud(locality);

    if (panTo) {
      this.map.flyTo([lat, lng], 16, { duration: 1.0 });
    }

    // Direct Google Maps sync uplink
    const gmapsBtn = document.getElementById("openInGoogleMapsBtn");
    if (gmapsBtn) {
      gmapsBtn.href = `https://www.google.com/maps/@${lat.toFixed(5)},${lng.toFixed(5)},16z`;
    }

    this.flashUserBeacon();
  }

  /**
   * Flash user beacon with expanding blue radar halo and popup
   */
  flashUserBeacon() {
    if (!this.userLocationMarker) return;
    this.userLocationMarker.openPopup();

    if (!this.userLatLng) return;
    const ripple = L.circle(this.userLatLng, {
      radius: 30,
      color: '#38BDF8',
      fillColor: '#38BDF8',
      fillOpacity: 0.45,
      weight: 2
    }).addTo(this.map);

    let r = 30;
    const rippleTimer = setInterval(() => {
      r += 25;
      ripple.setRadius(r);
      const op = Math.max(0, 0.45 - (r / 350));
      ripple.setStyle({ fillOpacity: op, opacity: op * 2 });
      if (r >= 350) {
        clearInterval(rippleTimer);
        this.map.removeLayer(ripple);
      }
    }, 35);
  }

  /**
   * Toggle Pin Spot mode (click on map to drop user position)
   */
  togglePinSpotMode(forceState = null) {
    this.pinSpotMode = forceState !== null ? forceState : !this.pinSpotMode;
    const btn = document.getElementById("adjustLocationFab");
    const textEl = document.getElementById("adjustLocationText");
    const mapContainer = this.map.getContainer();

    if (this.pinSpotMode) {
      if (btn) btn.classList.add("active");
      if (textEl) textEl.textContent = "CANCEL PIN";
      mapContainer.style.cursor = "crosshair";
      this.showToast("📍 Click anywhere on the map to drop your position", 5000);
    } else {
      if (btn) btn.classList.remove("active");
      if (textEl) textEl.textContent = "PIN SPOT";
      mapContainer.style.cursor = "";
    }
  }

  /**
   * Track / Locate User's Geolocation (Google Maps style)
   */
  locateUser(panTo = true) {
    const locateBtns = [
      document.getElementById("locateMeMapBtn"),
      document.getElementById("gmapsLocateFab")
    ].filter(Boolean);

    locateBtns.forEach(b => b.classList.add("acquiring"));

    if (!navigator.geolocation) {
      locateBtns.forEach(b => b.classList.remove("acquiring"));
      this.showToast("⚠️ Geolocation not supported on this device. Tap a Sector chip to set your location.", 5000);
      return;
    }

    this.showToast("📡 Acquiring GPS position...", 3000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtns.forEach(b => b.classList.remove("acquiring"));
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy || 10;

        // Check if coordinates fall within Kanpur bounds
        const isWithinKanpur = lat >= APP_CONFIG.bounds.minLat && lat <= APP_CONFIG.bounds.maxLat &&
                               lng >= APP_CONFIG.bounds.minLng && lng <= APP_CONFIG.bounds.maxLng;

        this.setUserLocation(lat, lng, accuracy, null, panTo);

        if (!isWithinKanpur || accuracy > 1000) {
          // Laptop IP geolocation often resolves to telecom ISP nodes (±5-50km)
          this.showToast(
            `💻 Laptop IP Location (±${Math.round(accuracy > 1000 ? accuracy/1000 : accuracy)}${accuracy > 1000 ? 'km' : 'm'}). Tap any Sector chip or 'PIN SPOT' to fine-tune your street.`,
            6000
          );
        } else {
          this.showToast(`🎯 Position Locked (Accuracy: ±${Math.round(accuracy)}m)`, 3000);
        }
      },
      (err) => {
        locateBtns.forEach(b => b.classList.remove("acquiring"));
        console.warn("Location permission not granted or timeout:", err.message);

        // Fallback to Kanpur City Center if no coordinates yet
        if (!this.userLatLng) {
          this.setUserLocation(APP_CONFIG.defaultCenter[0], APP_CONFIG.defaultCenter[1], 50, "Civil Lines & Bada Chauraha", panTo);
        }
        this.showToast("⚠️ GPS access unavailable on laptop. Tap any Sector chip or 'PIN SPOT' to place yourself.", 5000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  /**
   * Find closest Thana to a given coordinate (updates UI HUD chip)
   */
  checkNearestThana(lat, lng) {
    let closest = null;
    let minDistance = Infinity;

    KANPUR_POLICE_STATIONS.forEach(station => {
      const dist = calculateDistanceKm(lat, lng, station.lat, station.lng);
      station.currentDistanceKm = dist;
      if (dist < minDistance) {
        minDistance = dist;
        closest = station;
      }
    });

    this.nearestStation = closest;

    const event = new CustomEvent("nearestThanaUpdated", { detail: closest });
    window.dispatchEvent(event);
  }

  /**
   * Calculate distance in meters from point to polygon boundary
   */
  calculateDistancePointToPolygonMeters(lat, lng, polygon) {
    if (!polygon || polygon.length < 3) return Infinity;
    const R = 6371000;
    const toRad = Math.PI / 180;
    let minDistance = Infinity;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const p1 = polygon[j];
      const p2 = polygon[i];

      const latA = p1[0], lngA = p1[1];
      const latB = p2[0], lngB = p2[1];

      const midLat = ((latA + latB) / 2) * toRad;
      const cosMidLat = Math.cos(midLat);

      const dx = (lngB - lngA) * toRad * R * cosMidLat;
      const dy = (latB - latA) * toRad * R;
      const px = (lng - lngA) * toRad * R * cosMidLat;
      const py = (lat - latA) * toRad * R;

      const segLenSq = dx * dx + dy * dy;
      let t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / segLenSq));

      const nearX = t * dx;
      const nearY = t * dy;
      const dist = Math.sqrt((px - nearX) * (px - nearX) + (py - nearY) * (py - nearY));

      if (dist < minDistance) {
        minDistance = dist;
      }
    }
    return minDistance;
  }

  /**
   * Backward-compatible checkRedZoneProximity
   */
  checkRedZoneProximity(lat, lng) {
    const result = this.evaluateRedZoneProximity(lat, lng);
    const event = new CustomEvent("redZoneProximityChanged", { detail: result.zone });
    window.dispatchEvent(event);
    return result.zone;
  }

  /**
   * Create SVG Directional Radar Pin with Bearing Indicator for Field Units
   */
  createUnitIcon(unit, heading = 0, isSos = false) {
    const color = unit.color || "#38BDF8";
    const code = unit.callSign ? unit.callSign.split(' ')[0] : (unit.id ? unit.id.split('-')[1] : "UNIT");

    return L.divIcon({
      className: `field-unit-radar-pin unit-${unit.id} ${isSos ? 'sos-distress-active' : ''}`,
      html: `
        <div class="unit-marker-wrapper" style="--marker-color: ${color};">
          <div class="unit-pulse-circle"></div>
          <div class="unit-bearing-pointer" style="transform: rotate(${heading}deg);">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="${color}" stroke="#080C15" stroke-width="1.5">
              <path d="M12 2L4 21l8-4 8 4L12 2z"/>
            </svg>
          </div>
          <div class="unit-badge-tag">${code}</div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -22]
    });
  }

  /**
   * Build Tactical Popup HTML for a Field Unit
   */
  buildUnitPopupHtml(unit) {
    const color = unit.color || "#38BDF8";
    const speed = unit.speedKmH !== undefined ? unit.speedKmH.toFixed(1) : "0.0";
    const battery = unit.batteryPct !== undefined ? unit.batteryPct : 85;
    const thanaName = unit.nearestThana ? unit.nearestThana.name : "Locating...";
    const thanaDist = unit.nearestThana ? (unit.nearestThana.distKm || unit.nearestThana.distanceKm || "0.5") : "--";
    const thanaPhone = unit.nearestThana ? (unit.nearestThana.phone || unit.nearestThana.cug || "112") : "112";

    const redZoneStatus = unit.redZoneStatus;
    let redZoneBadge = `<span style="font-size: 10px; color: #10B981; font-weight: 700;">NORMAL SECTOR</span>`;
    if (redZoneStatus && redZoneStatus.status === 'BREACH') {
      redZoneBadge = `<span style="font-size: 10px; color: #EF4444; font-weight: 800; background: rgba(239,68,68,0.2); padding: 2px 6px; border-radius: 4px;">⚠️ INSIDE RED ZONE</span>`;
    } else if (redZoneStatus && redZoneStatus.status === 'PROXIMITY_350M') {
      redZoneBadge = `<span style="font-size: 10px; color: #F59E0B; font-weight: 800; background: rgba(245,158,11,0.2); padding: 2px 6px; border-radius: 4px;">⚠️ ${redZoneStatus.distanceMeters}m TO RED ZONE</span>`;
    }

    return `
      <div style="min-width: 230px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="font-weight: 800; font-size: 14px; color: #F8FAFC;">${unit.callSign || unit.name}</div>
          <span style="font-size: 9px; font-weight: 700; background: rgba(56,189,248,0.2); color: ${color}; padding: 2px 6px; border-radius: 4px;">
            ${unit.sector || 'Kanpur'}
          </span>
        </div>
        <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">Officer: <strong>${unit.name || 'Field Officer'}</strong></div>

        <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 6px; margin-bottom: 8px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Speed: <strong style="color: #38BDF8;">${speed} km/h</strong></span>
            <span>Bearing: <strong style="color: #F8FAFC;">${unit.heading || 0}&deg;</strong></span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Battery: <strong style="color: ${battery < 20 ? '#EF4444' : '#10B981'};">${battery}%</strong></span>
            <span>${redZoneBadge}</span>
          </div>
        </div>

        <div style="font-size: 11px; color: #CBD5E1; margin-bottom: 8px;">
          <strong>Nearest Thana:</strong> ${thanaName} (${thanaDist} km)
        </div>

        <div style="display: flex; gap: 6px;">
          <a href="tel:${thanaPhone}" style="flex: 1; background: #2563EB; color: white; text-decoration: none; text-align: center; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: 700;">
            Call Thana
          </a>
          <button onclick="window.tacticalMap.focusOnLocation(${unit.lat}, ${unit.lng}, 16)" style="flex: 1; background: #334155; color: white; border: none; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
            Center View
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Smoothly interpolate marker movement between coordinates
   */
  animateMarker(marker, fromLatLng, toLatLng, duration = 850) {
    const startTime = performance.now();
    const latDelta = toLatLng[0] - fromLatLng[0];
    const lngDelta = toLatLng[1] - fromLatLng[1];

    if (Math.abs(latDelta) < 0.000001 && Math.abs(lngDelta) < 0.000001) {
      marker.setLatLng(toLatLng);
      return;
    }

    const step = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      const ease = 1 - Math.pow(1 - progress, 3);

      const curLat = fromLatLng[0] + latDelta * ease;
      const curLng = fromLatLng[1] + lngDelta * ease;
      marker.setLatLng([curLat, curLng]);

      if (progress < 1.0) {
        requestAnimationFrame(step);
      } else {
        marker.setLatLng(toLatLng);
      }
    };

    requestAnimationFrame(step);
  }

  /**
   * Ingest and render live telemetry update for a field unit
   */
  updateFieldUnit(unitData) {
    // Disabled: Simulated officer personas removed to guarantee zero misleading mock data
    return;
    const id = unitData.id;
    const targetCoords = [unitData.lat, unitData.lng];

    let entry = this.fieldUnits.get(id);

    if (!entry) {
      const icon = this.createUnitIcon(unitData, unitData.heading || 0);
      const marker = L.marker(targetCoords, { icon }).addTo(this.unitsLayerGroup);
      marker.bindPopup(this.buildUnitPopupHtml(unitData));

      const polyline = L.polyline([targetCoords], {
        color: unitData.color || "#38BDF8",
        weight: 3,
        opacity: 0.55,
        dashArray: "3, 6",
        smoothFactor: 1.0
      }).addTo(this.unitsLayerGroup);

      entry = {
        id,
        marker,
        polyline,
        history: [targetCoords],
        currentCoords: targetCoords,
        data: unitData
      };
      this.fieldUnits.set(id, entry);
    } else {
      const prevCoords = entry.currentCoords;
      this.animateMarker(entry.marker, prevCoords, targetCoords, 850);
      entry.currentCoords = targetCoords;
      entry.data = unitData;

      entry.marker.setIcon(this.createUnitIcon(unitData, unitData.heading || 0));
      entry.marker.setPopupContent(this.buildUnitPopupHtml(unitData));

      entry.history.push(targetCoords);
      if (entry.history.length > 25) {
        entry.history.shift();
      }
      entry.polyline.setLatLngs(entry.history);
    }
  }

  removeFieldUnit(unitId) {
    const entry = this.fieldUnits.get(unitId);
    if (entry) {
      this.unitsLayerGroup.removeLayer(entry.marker);
      this.unitsLayerGroup.removeLayer(entry.polyline);
      this.fieldUnits.delete(unitId);
    }
  }

  focusOnUnit(unitId) {
    const entry = this.fieldUnits.get(unitId);
    if (entry && entry.currentCoords) {
      this.map.flyTo(entry.currentCoords, 16, { duration: 1.0 });
      entry.marker.openPopup();
    }
  }

  clearFieldUnits() {
    this.unitsLayerGroup.clearLayers();
    this.fieldUnits.clear();
  }

  setRedZones(newZones) {
    if (!newZones || !Array.isArray(newZones)) return;
    this.activeRedZones = newZones;
    this.renderCrimeHotspots();
  }

  handleServerRedZonePush(zone, action = "UPDATE") {
    if (!zone || !zone.id) return;
    if (action === "ADD") {
      this.activeRedZones.unshift(zone);
    } else if (action === "DELETE") {
      this.activeRedZones = this.activeRedZones.filter(z => z.id !== zone.id);
    } else {
      const idx = this.activeRedZones.findIndex(z => z.id === zone.id);
      if (idx >= 0) {
        this.activeRedZones[idx] = zone;
      } else {
        this.activeRedZones.unshift(zone);
      }
    }
    this.renderCrimeHotspots();
  }

  renderSosBeacon(distress) {
    if (!distress || !distress.coords) return;
    this.sosLayerGroup.clearLayers();

    const sosIcon = L.divIcon({
      className: "sos-emergency-beacon-pin",
      html: `
        <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(239,68,68,0.4); animation: unitRadarPulse 1s infinite;"></div>
          <div style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background: #EF4444; border: 2px solid #FFF; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px #EF4444;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#FFF">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    const marker = L.marker(distress.coords, { icon: sosIcon }).addTo(this.sosLayerGroup);
    const popupHtml = `
      <div style="min-width: 220px; font-family: sans-serif; text-align: center;">
        <div style="font-size: 13px; font-weight: 800; color: #EF4444;">🚨 EMERGENCY SOS DISTRESS</div>
        <div style="font-size: 12px; font-weight: 700; color: #FFF; margin: 4px 0;">${distress.unitName || distress.unitId}</div>
        <div style="font-size: 11px; color: #94A3B8;">${distress.locality || 'Kanpur Grid'}</div>
        <div style="font-size: 11px; color: #CBD5E1; margin: 6px 0;">
          Nearest Thana: <strong>${distress.nearestThana ? distress.nearestThana.name : 'Kotwali'}</strong>
        </div>
        <a href="tel:112" style="display: block; background: #EF4444; color: white; text-decoration: none; padding: 6px; border-radius: 6px; font-weight: 700; font-size: 12px;">
          Call 112 Dispatch
        </a>
      </div>
    `;
    marker.bindPopup(popupHtml).openPopup();
  }

  focusOnLocation(lat, lng, zoom = 16) {
    this.map.flyTo([lat, lng], zoom, { duration: 1.0 });
  }

  flyTo(coords, zoom = 16) {
    this.map.flyTo(coords, zoom, { duration: 1.2 });
  }

  toggleLayer(name, isVisible) {
    this.layersVisible[name] = isVisible;
    if (name === "police") {
      isVisible ? this.map.addLayer(this.policeLayerGroup) : this.map.removeLayer(this.policeLayerGroup);
    } else if (name === "redZones") {
      isVisible ? this.map.addLayer(this.redZonesLayerGroup) : this.map.removeLayer(this.redZonesLayerGroup);
    } else if (name === "units") {
      isVisible ? this.map.addLayer(this.unitsLayerGroup) : this.map.removeLayer(this.unitsLayerGroup);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TacticalMapEngine,
    calculateBearingDegrees,
    calculateDisplacementMeters,
    CompassHeadingSensor
  };
}
