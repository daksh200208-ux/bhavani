/**
 * Kanpur Tactical GIS - Real-Time Telemetry & WebSocket Client
 * Manages authenticated bidirectional streaming, reconnection lifecycle,
 * 4-persona live tracking ingestion, dynamic red zone sync, and SOS broadcasts.
 */

class RealtimeTelemetryManager {
  constructor(mapEngine) {
    this.mapEngine = mapEngine;
    this.ws = null;
    this.token = null;
    this.status = "OFFLINE"; // OFFLINE | CONNECTING | CONNECTED | UNAUTHORIZED
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 10000;
    this.reconnectTimer = null;
    this.pingInterval = null;

    // Tracked units cache
    this.trackedUnits = new Map();
  }

  /**
   * Initialize and connect if token exists in session
   */
  init(token = null) {
    this.token = token || sessionStorage.getItem(APP_CONFIG.jwtSessionKey || "kanpur_jwt_token");
    if (this.token) {
      this.connect();
    } else {
      this.updateStatus("OFFLINE");
    }
    return this;
  }

  /**
   * Determine WebSocket URL based on current page host
   */
  getWsUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host || "localhost:3000";
    return `${protocol}//${host}/telemetry?token=${encodeURIComponent(this.token || "")}`;
  }

  /**
   * Establish authenticated WebSocket connection
   */
  connect(token = null) {
    if (token) {
      this.token = token;
      sessionStorage.setItem(APP_CONFIG.jwtSessionKey || "kanpur_jwt_token", token);
    }

    if (!this.token) {
      console.warn("[Realtime] No JWT token available. Cannot connect WebSocket.");
      this.updateStatus("UNAUTHORIZED");
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.updateStatus("CONNECTING");

    try {
      const wsUrl = this.getWsUrl();
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[Realtime] WebSocket connected successfully to tactical grid.");
        this.reconnectAttempts = 0;
        this.updateStatus("CONNECTED");
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.warn("[Realtime] WebSocket error:", err);
      };

      this.ws.onclose = (event) => {
        console.log(`[Realtime] WebSocket closed with code ${event.code}: ${event.reason}`);
        this.stopHeartbeat();

        if (event.code === 4401 || event.code === 4403) {
          // Strict Unauthorized termination: Wipe telemetry and force re-auth
          this.updateStatus("UNAUTHORIZED");
          this.clearTelemetry();
          window.dispatchEvent(new CustomEvent("tacticalAuthRequired", { detail: { reason: "SESSION_EXPIRED" } }));
        } else {
          this.updateStatus("OFFLINE");
          this.scheduleReconnect();
        }
      };
    } catch (e) {
      console.error("[Realtime] Failed to initialize WebSocket:", e);
      this.updateStatus("OFFLINE");
      this.scheduleReconnect();
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, "User manual disconnect");
      this.ws = null;
    }
    this.updateStatus("OFFLINE");
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;
    console.log(`[Realtime] Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token) {
        this.connect();
      }
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "PING", timestamp: Date.now() }));
      }
    }, 15000);
  }

  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  updateStatus(status) {
    this.status = status;
    const chip = document.getElementById("wsStatusChip");
    if (chip) {
      chip.className = `ws-status-chip status-${status.toLowerCase()}`;
      const textSpan = chip.querySelector(".status-text");
      if (textSpan) {
        if (status === "CONNECTED") textSpan.textContent = "GRID ONLINE (1Hz)";
        else if (status === "CONNECTING") textSpan.textContent = "CONNECTING...";
        else if (status === "UNAUTHORIZED") textSpan.textContent = "AUTH REQUIRED";
        else textSpan.textContent = "GRID OFFLINE";
      }
    }
    window.dispatchEvent(new CustomEvent("wsStatusChanged", { detail: { status } }));
  }

  clearTelemetry() {
    this.trackedUnits.clear();
    if (this.mapEngine && this.mapEngine.clearFieldUnits) {
      this.mapEngine.clearFieldUnits();
    }
  }

  /**
   * Process incoming WebSocket message frames
   */
  handleMessage(rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch (e) {
      console.warn("[Realtime] Invalid JSON message received:", rawData);
      return;
    }

    const type = msg.type;
    const payload = msg.payload || msg;

    switch (type) {
      case "INIT_STATE":
        this.handleInitState(payload);
        break;

      case "TELEMETRY_UPDATE":
        this.handleTelemetryUpdate(msg.unit || payload.unit || payload);
        break;

      case "TELEMETRY_BROADCAST":
        if (payload.users && Array.isArray(payload.users)) {
          payload.users.forEach((unit) => this.handleTelemetryUpdate(unit));
        }
        break;

      case "RED_ZONE_PUSH":
      case "RED_ZONE_SYNC":
        this.handleRedZoneSync(msg.zone || payload.zone, msg.action || payload.action);
        break;

      case "GEOFENCE_ALERT":
        this.handleGeofenceAlert(payload);
        break;

      case "SOS_EMERGENCY":
      case "SOS_BROADCAST":
        this.handleSosEmergency(msg.distress || payload);
        break;

      case "GUARDIAN_TRIP_UPDATE":
      case "GUARDIAN_TRIP_STARTED":
      case "GUARDIAN_TRIP_COMPLETED":
        window.dispatchEvent(new CustomEvent("guardianTripUpdate", { detail: msg.trip || payload }));
        break;

      case "PONG":
        // Heartbeat confirmed
        break;

      case "VALIDATION_ERROR":
        console.warn("[Realtime] Server validation warning:", payload.error);
        break;

      default:
        // Handle generic or unrecognized event
        break;
    }
  }

  handleInitState(payload) {
    console.log("[Realtime] Received INIT_STATE snapshot.");
    if (payload.trackedUsers && Array.isArray(payload.trackedUsers)) {
      payload.trackedUsers.forEach((unit) => {
        this.trackedUnits.set(unit.id, unit);
        if (this.mapEngine && this.mapEngine.updateFieldUnit) {
          this.mapEngine.updateFieldUnit(unit);
        }
      });
      window.dispatchEvent(new CustomEvent("fieldUnitsUpdated", { detail: Array.from(this.trackedUnits.values()) }));
    }

    if (payload.activeRedZones && Array.isArray(payload.activeRedZones)) {
      if (this.mapEngine && this.mapEngine.setRedZones) {
        this.mapEngine.setRedZones(payload.activeRedZones);
      }
    }
  }

  handleTelemetryUpdate(unit) {
    if (!unit || !unit.id) return;
    this.trackedUnits.set(unit.id, unit);

    if (this.mapEngine && this.mapEngine.updateFieldUnit) {
      this.mapEngine.updateFieldUnit(unit);
    }

    window.dispatchEvent(new CustomEvent("fieldUnitsUpdated", { detail: Array.from(this.trackedUnits.values()) }));
  }

  handleRedZoneSync(zone, action = "UPDATE") {
    console.log(`[Realtime] Dynamic Red Zone Push received: ${action}`, zone);
    if (!zone || !zone.id) return;

    if (this.mapEngine && this.mapEngine.handleServerRedZonePush) {
      this.mapEngine.handleServerRedZonePush(zone, action);
    }

    window.dispatchEvent(new CustomEvent("redZonesUpdated", { detail: { zone, action } }));
  }

  handleGeofenceAlert(alert) {
    console.warn(`[Realtime] GEOFENCE HAZARD: ${alert.message}`);

    // Update Banner
    const banner = document.getElementById("hazardAlertBanner");
    const textEl = document.getElementById("hazardAlertText");
    if (banner && textEl) {
      textEl.innerHTML = `⚠️ <strong>${alert.status === 'BREACH' ? 'CRITICAL BREACH' : 'PROXIMITY WARNING'}:</strong> Unit <strong>${alert.callSign || alert.unitId}</strong> is within <strong>${alert.distanceMeters}m</strong> of <strong>${alert.zoneName}</strong>!`;
      banner.style.display = "flex";
    }

    // Note: Background patrol unit proximity alerts update the visual banner silently without intrusive repetitive audio clicks

    window.dispatchEvent(new CustomEvent("geofenceAlertReceived", { detail: alert }));
  }

  handleSosEmergency(distress) {
    console.error("[Realtime] EMERGENCY SOS DISTRESS BROADCAST RECEIVED:", distress);



    // Center map on distress location
    if (this.mapEngine && distress.coords) {
      this.mapEngine.flyTo(distress.coords, 16);
      this.mapEngine.renderSosBeacon(distress);
    }

    // Show visual notification modal
    window.dispatchEvent(new CustomEvent("sosDistressReceived", { detail: distress }));
  }

  /**
   * Broadcast Client Location Update to Tactical Grid
   */
  sendLocationUpdate(lat, lng, heading = 0, speedKmH = 0, batteryPct = 85) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = {
      type: "CLIENT_LOCATION_UPDATE",
      payload: {
        lat,
        lng,
        heading,
        speedKmH,
        batteryPct,
        timestamp: Date.now()
      }
    };
    this.ws.send(JSON.stringify(packet));
  }

  /**
   * Trigger SOS Distress across the entire Tactical Grid
   */
  triggerSos(lat, lng, locality = "Kanpur Grid", reason = "Officer Emergency") {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = {
      type: "CLIENT_SOS_TRIGGER",
      payload: {
        lat,
        lng,
        locality,
        reason,
        timestamp: Date.now()
      }
    };
    this.ws.send(JSON.stringify(packet));
  }

  /**
   * Publish or update a dynamic red zone hotspot
   */
  publishRedZone(zone) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = {
      type: "ADMIN_CREATE_REDZONE",
      payload: {
        zone,
        timestamp: Date.now()
      }
    };
    this.ws.send(JSON.stringify(packet));
  }
}

// Global instance
window.realtimeManager = null;
