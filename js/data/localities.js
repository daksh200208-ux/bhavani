/**
 * Kanpur Locality Bounding Boxes & Offline Reverse-Geocoder
 * High-performance bounding box lookup covering major Kanpur sectors
 * for dynamic Locality HUD updates with zero server roundtrips.
 */

const KANPUR_LOCALITIES = [
  {
    name: "Nai Sadak, Parade & Beckanganj",
    shortName: "Nai Sadak & Parade",
    bounds: { minLat: 26.4610, maxLat: 26.4720, minLng: 80.3350, maxLng: 80.3470 },
    landmark: "Yateem Khana / Moolganj Market",
    zone: "Central Zone"
  },
  {
    name: "Mall Road & Cantt Perimeter",
    shortName: "Mall Road, Cantt",
    bounds: { minLat: 26.4520, maxLat: 26.4680, minLng: 80.3480, maxLng: 80.3700 },
    landmark: "Cantonment Board / Reserve Police Lines",
    zone: "East Zone"
  },
  {
    name: "Civil Lines & Bada Chauraha",
    shortName: "Civil Lines",
    bounds: { minLat: 26.4670, maxLat: 26.4780, minLng: 80.3380, maxLng: 80.3520 },
    landmark: "Phool Bagh / Sarsaiya Ghat",
    zone: "Central Zone"
  },
  {
    name: "Swaroop Nagar & Motijheel",
    shortName: "Swaroop Nagar",
    bounds: { minLat: 26.4760, maxLat: 26.4880, minLng: 80.3080, maxLng: 80.3250 },
    landmark: "GSVM Medical College / Motijheel Park",
    zone: "West Zone"
  },
  {
    name: "Kakadeo Coaching Hub & M-Block",
    shortName: "Kakadeo",
    bounds: { minLat: 26.4710, maxLat: 26.4850, minLng: 80.2880, maxLng: 80.3020 },
    landmark: "Naveen Market / Coaching Mandi",
    zone: "West Zone"
  },
  {
    name: "Kidwai Nagar & Babupurwa",
    shortName: "Kidwai Nagar",
    bounds: { minLat: 26.4300, maxLat: 26.4460, minLng: 80.3220, maxLng: 80.3400 },
    landmark: "Kidwai Nagar Chauraha / Bagahi",
    zone: "South Zone"
  },
  {
    name: "Panki Dham & Industrial Area",
    shortName: "Panki",
    bounds: { minLat: 26.4550, maxLat: 26.4800, minLng: 80.2350, maxLng: 80.2600 },
    landmark: "Panki Hanuman Mandir / Power House",
    zone: "West Zone"
  },
  {
    name: "Kalyanpur & IIT Perimeter",
    shortName: "Kalyanpur & IIT",
    bounds: { minLat: 26.4900, maxLat: 26.5200, minLng: 80.2300, maxLng: 80.2680 },
    landmark: "IIT Kanpur Gate / Kalyanpur Crossing",
    zone: "West Zone"
  },
  {
    name: "Barra Sector Grid (1 to 8)",
    shortName: "Barra",
    bounds: { minLat: 26.4150, maxLat: 26.4350, minLng: 80.2800, maxLng: 80.3050 },
    landmark: "Barra Bypass / Meharban Singh Ka Purwa",
    zone: "South Zone"
  },
  {
    name: "Govind Nagar & Dada Nagar",
    shortName: "Govind Nagar",
    bounds: { minLat: 26.4380, maxLat: 26.4550, minLng: 80.2980, maxLng: 80.3150 },
    landmark: "Block 7 / Fazalganj Industrial Area",
    zone: "South Zone"
  },
  {
    name: "Ghantaghar & Kanpur Central Station",
    shortName: "Ghantaghar",
    bounds: { minLat: 26.4520, maxLat: 26.4650, minLng: 80.3450, maxLng: 80.3600 },
    landmark: "Kanpur Central North Platform / Collectorganj",
    zone: "Central Zone"
  },
  {
    name: "Chakeri & Airport Highway Corridor",
    shortName: "Chakeri & Airport",
    bounds: { minLat: 26.4050, maxLat: 26.4300, minLng: 80.3850, maxLng: 80.4250 },
    landmark: "Ahirwan GT Road / Air Force Station",
    zone: "East Zone"
  },
  {
    name: "Jajmau Tannery & Old Ganga Bridge",
    shortName: "Jajmau",
    bounds: { minLat: 26.4250, maxLat: 26.4450, minLng: 80.3950, maxLng: 80.4250 },
    landmark: "Siddhnath Ghat / Jajmau Checkpost",
    zone: "East Zone"
  },
  {
    name: "Bithoor & Brahmavart Ghats",
    shortName: "Bithoor",
    bounds: { minLat: 26.6000, maxLat: 26.6300, minLng: 80.2600, maxLng: 80.2900 },
    landmark: "Brahmavart Ghat / Nana Rao Fort",
    zone: "West Zone"
  }
];

/**
 * Perform offline reverse-geocoding from latitude and longitude coordinates.
 * Returns the matching locality name, or "Kanpur Metropolitan Grid" if coordinates
 * are outside designated bounding boxes.
 */
function lookupKanpurLocality(lat, lng) {
  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);

  if (isNaN(numLat) || isNaN(numLng)) {
    return "Kanpur Metropolitan Grid";
  }

  for (const loc of KANPUR_LOCALITIES) {
    if (numLat >= loc.bounds.minLat && numLat <= loc.bounds.maxLat &&
        numLng >= loc.bounds.minLng && numLng <= loc.bounds.maxLng) {
      return loc.name;
    }
  }

  return "Kanpur Metropolitan Grid";
}

// Alias for interface contract compatibility
const getKanpurLocality = lookupKanpurLocality;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KANPUR_LOCALITIES,
    lookupKanpurLocality,
    getKanpurLocality
  };
}

if (typeof window !== 'undefined') {
  window.KANPUR_LOCALITIES = KANPUR_LOCALITIES;
  window.lookupKanpurLocality = lookupKanpurLocality;
  window.getKanpurLocality = getKanpurLocality;
}
