/**
 * Certified Kanpur Crime Hotspots & Red Zones
 * Compiled based on Kanpur Police Commissionerate analysis (Operation Nirastikaran & Operation Trinetra)
 * and NCRB metropolitan crime surveillance patterns.
 */
const KANPUR_CRIME_HOTSPOTS = [
  {
    id: "zone-parade-beckanganj",
    name: "Parade - Nai Sadak - Beckanganj Sector",
    hindiName: "परेड - नई सड़क - बेकनगंज सेक्टर",
    riskLevel: "CRITICAL",
    category: "High Sensitivity & Flashpoint",
    color: "#EF4444",
    center: [26.4665, 80.3412],
    radiusMeters: 750,
    polygon: [
      [26.4710, 80.3370],
      [26.4725, 80.3450],
      [26.4650, 80.3475],
      [26.4610, 80.3410],
      [26.4635, 80.3350]
    ],
    primaryCrimes: [
      "Communal Sensitivity & Law-and-Order Incidents",
      "Dense Crowd Pickpocketing & Cash Snatching",
      "Illegal Hawking Turf Disputes",
      "History-Sheeter Activity"
    ],
    surveillance: "Covered by Operation Trinetra (32 High-Def PTZ Cameras)",
    primaryThanaId: "thana-beckanganj",
    thanaName: "Beckanganj / Kotwali",
    patrolFrequency: "24x7 Armed PRV Patrol",
    officerAdvisory: "High crowd density. Single-officer movement discouraged after 20:00 hrs. Monitor narrow alleyways connecting Nai Sadak and Yateem Khana."
  },
  {
    id: "zone-chamanganj-sisamau",
    name: "Chamanganj - Sisamau Market Corridor",
    hindiName: "चमनगंज - सीसामऊ बाजार कॉरिडोर",
    riskLevel: "HIGH",
    category: "Violent Snatching & Narcotics Pockets",
    color: "#DC2626",
    center: [26.4632, 80.3308],
    radiusMeters: 650,
    polygon: [
      [26.4670, 80.3270],
      [26.4685, 80.3355],
      [26.4610, 80.3360],
      [26.4580, 80.3280]
    ],
    primaryCrimes: [
      "Armed Robbery & Mobile Snatching",
      "Illicit Drug Peddling & Small Arms Trafficking",
      "Property Dispute Clashes",
      "Gambling Rackets"
    ],
    surveillance: "CCTV Active at Gandhi Nagar & Sisamau Chauraha",
    primaryThanaId: "thana-chamanganj",
    thanaName: "Chamanganj",
    patrolFrequency: "Intensive Night Cheetah Bikes Patrol",
    officerAdvisory: "Maintain high vigilance around Halim Muslim College road during evening hours. Check suspicious double-riding bikes."
  },
  {
    id: "zone-babupurwa-juhi",
    name: "Babupurwa - Juhi Gada - Bagahi Belt",
    hindiName: "बाबूपुरवा - जूही गढ़ा - बगाही बेल्ट",
    riskLevel: "CRITICAL",
    category: "Organized Gangs & Bootlegging",
    color: "#B91C1C",
    center: [26.4420, 80.3280],
    radiusMeters: 850,
    polygon: [
      [26.4480, 80.3210],
      [26.4495, 80.3360],
      [26.4350, 80.3390],
      [26.4320, 80.3230]
    ],
    primaryCrimes: [
      "History-Sheeter Gang Rivalries",
      "Illicit Liquor / Spurious Hooch Hubs",
      "Railway Track Cargo Theft & Mugging",
      "Chain & Mobile Snatching"
    ],
    surveillance: "Static Police Pickets at Juhi Depot & Kidwai Nagar Cut",
    primaryThanaId: "thana-babupurwa",
    thanaName: "Babupurwa / Juhi",
    patrolFrequency: "Continuous Dial 112 QRT Deployment",
    officerAdvisory: "Isolated railway yards near Juhi require tactical caution. Suspects frequently use tracks as escape routes."
  },
  {
    id: "zone-chakeri-ahirwan-highway",
    name: "Chakeri - Ahirwan - GT Road Bypass",
    hindiName: "चकेरी - अहिरवां - जीटी रोड बाईपास",
    riskLevel: "HIGH",
    category: "Highway Heists & Auto-Lifting",
    color: "#EA580C",
    center: [26.4182, 80.4012],
    radiusMeters: 1100,
    polygon: [
      [26.4280, 80.3880],
      [26.4310, 80.4150],
      [26.4090, 80.4200],
      [26.4050, 80.3920]
    ],
    primaryCrimes: [
      "Highway Truck Looter Gangs",
      "Auto Lifting & Fake Number Plate Rackets",
      "Late Night Highway Robbery",
      "Warehouse Break-ins"
    ],
    surveillance: "Highway ANPR Speed & Number-Plate Cameras",
    primaryThanaId: "thana-chakeri",
    thanaName: "Chakeri",
    patrolFrequency: "Highway Patrol Vehicle (HPV) 24x7",
    officerAdvisory: "Enforce barricades on empty stretches towards Sanigawan after 23:00 hrs. High frequency of stolen vehicles transiting towards Prayagraj."
  },
  {
    id: "zone-barra-bypass",
    name: "Barra Bypass - Meharban Singh Ka Purwa",
    hindiName: "बर्रा बाईपास - मेहरबान सिंह का पुरवा",
    riskLevel: "HIGH",
    category: "Armed Extortion & Vehicle Theft",
    color: "#EA580C",
    center: [26.4230, 80.2890],
    radiusMeters: 800,
    polygon: [
      [26.4320, 80.2810],
      [26.4340, 80.2980],
      [26.4160, 80.3010],
      [26.4120, 80.2830]
    ],
    primaryCrimes: [
      "Vehicle Lifting (2-wheelers & commercial pick-ups)",
      "Armed Robbery at unlit service lanes",
      "Liquor shop evening brawls & assaults",
      "Residential burglary in outer sectors"
    ],
    surveillance: "Checkpost with CCTV at Barra Bypass Cut",
    primaryThanaId: "thana-barra",
    thanaName: "Barra",
    patrolFrequency: "Motorcycle Cheetah Patrol 18:00 - 04:00",
    officerAdvisory: "Service lane lighting is intermittent. Verify drivers on unnumbered motorcycles."
  },
  {
    id: "zone-kakadeo-coaching-hub",
    name: "Kakadeo Coaching Hub & M-Block Zone",
    hindiName: "काकादेव कोचिंग मंडी एवं एम-ब्लॉक जोन",
    riskLevel: "ELEVATED",
    category: "Eve-Teasing, Cyber Fraud & Clashes",
    color: "#F59E0B",
    center: [26.4776, 80.2942],
    radiusMeters: 600,
    polygon: [
      [26.4820, 80.2890],
      [26.4835, 80.2995],
      [26.4730, 80.3010],
      [26.4710, 80.2910]
    ],
    primaryCrimes: [
      "Eve-Teasing & Student Stalking Incidents",
      "Hostel Group Rivalries & Violent Brawls",
      "Cyber Cafe Exam Fraud Rackets",
      "Bicycle / Scooty Thefts"
    ],
    surveillance: "Anti-Romeo Squad active + 24 CCTV nodes",
    primaryThanaId: "thana-kakadeo",
    thanaName: "Kakadeo",
    patrolFrequency: "Anti-Romeo Mobile Units & Foot Patrols",
    officerAdvisory: "Peak risk occurs between 16:30 - 20:30 hrs when coaching batches disperse. High presence of plainclothes officers."
  },
  {
    id: "zone-kalyanpur-gt-outer",
    name: "Kalyanpur GT Road - Panki Border Corridor",
    hindiName: "कल्याणपुर जीटी रोड - पनकी बॉर्डर कॉरिडोर",
    riskLevel: "ELEVATED",
    category: "Burglary & Highway Transit Crimes",
    color: "#F59E0B",
    center: [26.4957, 80.2584],
    radiusMeters: 750,
    polygon: [
      [26.5020, 80.2510],
      [26.5040, 80.2670],
      [26.4890, 80.2690],
      [26.4870, 80.2520]
    ],
    primaryCrimes: [
      "Night House Break-ins (Locked houses)",
      "Unregistered cab passenger robbery",
      "Auto snatching towards Chaubepur border",
      "Pedestrian purse snatching near crossing"
    ],
    surveillance: "Kalyanpur Crossing Roundabout Cameras",
    primaryThanaId: "thana-kalyanpur",
    thanaName: "Kalyanpur",
    patrolFrequency: "Night PRV Stoppage at Railway Crossing",
    officerAdvisory: "Check commercial vehicles entering from Kannauj/Bilhaur highway late night."
  },
  {
    id: "zone-transport-nagar-fazalganj",
    name: "Transport Nagar - Cooperganj Freight Yard",
    hindiName: "ट्रांसपोर्ट नगर - कूपरगंज माल गोदाम",
    riskLevel: "HIGH",
    category: "Cargo Theft & Narcotics Transit",
    color: "#EA580C",
    center: [26.4560, 80.3120],
    radiusMeters: 700,
    polygon: [
      [26.4620, 80.3040],
      [26.4640, 80.3180],
      [26.4510, 80.3200],
      [26.4480, 80.3070]
    ],
    primaryCrimes: [
      "Interstate Cargo Pilferage & Thefts",
      "Narcotics & Ganja Consolidation Rackets",
      "Diesel Siphoning Mafia",
      "Unorganized labour union extortions"
    ],
    surveillance: "Industrial Cluster ANPR checkpoints",
    primaryThanaId: "thana-fazalganj",
    thanaName: "Fazalganj",
    patrolFrequency: "QRT Night Inspection at Truck Depots",
    officerAdvisory: "Isolated godown areas require spotlight patrols. Verify e-way bills of suspicious late night container trucks."
  }
];

// Helper to check if a point is within a polygon (Ray Casting algorithm)
function isPointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KANPUR_CRIME_HOTSPOTS,
    isPointInPolygon
  };
}
