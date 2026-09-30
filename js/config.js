/**
 * Kanpur Tactical GIS - System Configuration & Presets
 */
const APP_CONFIG = {
  appName: "Kanpur Tactical GIS & Safety Grid",
  appVersion: "2.4.0-PRO",
  defaultCenter: [26.4499, 80.3319], // Kanpur Nagar City Center
  defaultZoom: 13,
  minZoom: 10,
  maxZoom: 18,
  
  // Restricted Access PIN (Default for designated personnel)
  accessPin: "1120",
  sessionKey: "kanpur_gis_auth_token",
  
  // Emergency Line Presets
  emergencyDialNumber: "112",
  controlRoomLandline: "0512-2310534",
  controlRoomCug: "9454400262",
  trafficHelpline: "1090",
  
  // Map Tile Providers (Direct Google Maps Global Synchronization)
  tileLayers: {
    streetView: {
      name: "Google Maps",
      url: "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; <a href="https://maps.google.com" target="_blank">Google Maps</a>',
      maxZoom: 20
    },
    tacticalDark: {
      name: "Tactical Dark",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 18
    },
    satellite: {
      name: "Google Satellite",
      url: "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; <a href="https://maps.google.com" target="_blank">Google Maps Satellite</a>',
      maxZoom: 20
    }
  },

  // Proximity warning threshold (in meters)
  redZoneWarningRadiusMeters: 350,

  // REST API and WebSocket Endpoints
  apiBaseUrl: "/api",
  wsPath: "/telemetry",
  jwtSessionKey: "kanpur_jwt_token",

  // Kanpur Metropolitan Geographic Bounding Box
  bounds: {
    minLat: 26.2000,
    maxLat: 26.7000,
    minLng: 80.1000,
    maxLng: 80.6000
  },

  // 4 Live Patrol Personas Metadata
  personas: {
    "unit-cantt-eagle1": {
      name: "Insp. Vikramaditya Rai",
      callSign: "EAGLE-1 (Cantt QRT)",
      sector: "Cantt",
      color: "#38BDF8",
      baseThana: "Cantt Police Station"
    },
    "unit-panki-rhino3": {
      name: "SI Amit Tomar",
      callSign: "RHINO-3 (Panki QRT)",
      sector: "Panki",
      color: "#F59E0B",
      baseThana: "Panki Police Station"
    },
    "unit-kidwai-panther2": {
      name: "Insp. Arun Mishra",
      callSign: "PANTHER-2 (Kidwai Nagar Interceptor)",
      sector: "Kidwai Nagar",
      color: "#EF4444",
      baseThana: "Babupurwa Police Station"
    },
    "unit-kotwali-chetak1": {
      name: "Inspector R. K. Singh",
      callSign: "CHETAK-1 (Bada Chauraha Beat)",
      sector: "Bada Chauraha",
      color: "#10B981",
      baseThana: "Kotwali Police Station"
    }
  }
};

