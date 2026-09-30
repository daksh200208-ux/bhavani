/**
 * Kanpur Commissionerate Wanted Criminals & History-Sheeters Directory
 * Derived from official UP Police Gangster Act notices, ADG Crime gazette, and Commissionerate wanted lists.
 */
const KANPUR_WANTED_CRIMINALS = [
  {
    id: "crm-001",
    name: "Mohammad Aslam",
    alias: "Ganja / Aslam Bihari",
    hindiName: "मोहम्मद असलम उर्फ गंजा",
    photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80",
    bounty: 50000,
    bountyFormatted: "₹50,000",
    status: "WANTED / ABSCONDING",
    statusLevel: "CRITICAL",
    thanaId: "thana-beckanganj",
    thanaName: "Thana Beckanganj / Parade",
    historySheetNo: "HS-44A / 2021",
    gangName: "Nai Sadak Syndicate",
    age: 38,
    physicalMarks: "Cut scar above left eyebrow, tattoo on right forearm",
    majorCharges: [
      "Section 3(1) UP Gangster Act",
      "BNS 109 / IPC 307 (Attempt to Murder)",
      "BNS 309 / IPC 392 (Extortion & Armed Robbery)",
      "Section 25 Arms Act"
    ],
    lastKnownLocation: "Seen near Yateem Khana crossing / Chamanganj alleys",
    advisory: "Armed and dangerous. Known to carry illegal countrymade firearms (.315 bore)."
  },
  {
    id: "crm-002",
    name: "Suraj Yadav",
    alias: "Fauji / Shooter",
    hindiName: "सूरज यादव उर्फ फौजी",
    photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80",
    bounty: 50000,
    bountyFormatted: "₹50,000",
    status: "WANTED / ABSCONDING",
    statusLevel: "CRITICAL",
    thanaId: "thana-barra",
    thanaName: "Thana Barra",
    historySheetNo: "HS-112B / 2020",
    gangName: "Bypass Auto-Lifting Gang",
    age: 32,
    physicalMarks: "Limp in right leg, burn mark on neck",
    majorCharges: [
      "UP Gangster & Anti-Social Activities Act",
      "BNS 303(2) / IPC 379 (Organized Interstate Vehicle Theft)",
      "BNS 310 / IPC 395 (Highway Dacoity)",
      "BNS 317 / IPC 411 (Receiving Stolen Property)"
    ],
    lastKnownLocation: "Meharban Singh Ka Purwa & Hamirpur border hideouts",
    advisory: "Expert in disabling GPS trackers in commercial vehicles."
  },
  {
    id: "crm-003",
    name: "Raju Sonkar",
    alias: "Haddi / Kabadi",
    hindiName: "राजू सोनकर उर्फ हड्डी",
    photoUrl: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300&auto=format&fit=crop&q=80",
    bounty: 25000,
    bountyFormatted: "₹25,000",
    status: "WANTED",
    statusLevel: "HIGH",
    thanaId: "thana-babupurwa",
    thanaName: "Thana Babupurwa",
    historySheetNo: "HS-89 / 2019",
    gangName: "Juhi Track Syndicate",
    age: 41,
    physicalMarks: "Deep scar on chin, thin build (height 5'6\")",
    majorCharges: [
      "UP Gangster Act",
      "Section 60/63 UP Excise Act (Hooch Racket)",
      "IPC 326 (Grievous Hurt by Dangerous Weapon)",
      "IPC 506 (Criminal Intimidation)"
    ],
    lastKnownLocation: "Juhi Param Purwa railway shanty clusters",
    advisory: "Controls bootlegging network along the railway siding tracks."
  },
  {
    id: "crm-004",
    name: "Vikas Shukla",
    alias: "Pandit Ji",
    hindiName: "विकास शुक्ला उर्फ पंडित जी",
    photoUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=300&auto=format&fit=crop&q=80",
    bounty: 100000,
    bountyFormatted: "₹1,00,000",
    status: "MOST WANTED / ACTIVE REWARD",
    statusLevel: "CRITICAL",
    thanaId: "thana-chakeri",
    thanaName: "Thana Chakeri",
    historySheetNo: "HS-01A / 2018",
    gangName: "GT Road Cargo Looters",
    age: 45,
    physicalMarks: "Grey streak in hair, gold ring in right ear",
    majorCharges: [
      "BNS 103 / IPC 302 (Homicide during robbery)",
      "UP Gangster Act (Interstate Mafia Kingpin)",
      "IPC 397 (Robbery with Attempt to Cause Death)",
      "Section 3/25 Arms Act"
    ],
    lastKnownLocation: "Transit movements between Ahirwan bypass and Fatehpur highway",
    advisory: "High-level mafia operative with lookouts across highway dhabas."
  },
  {
    id: "crm-005",
    name: "Tariq Mansoori",
    alias: "Tariq Shooter",
    hindiName: "तारिक मंसूरी उर्फ शूटर",
    photoUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=300&auto=format&fit=crop&q=80",
    bounty: 25000,
    bountyFormatted: "₹25,000",
    status: "WANTED",
    statusLevel: "HIGH",
    thanaId: "thana-chamanganj",
    thanaName: "Thana Chamanganj",
    historySheetNo: "HS-73C / 2022",
    gangName: "Sisamau Turf Group",
    age: 29,
    physicalMarks: "Mole on right cheek, medium height (5'8\")",
    majorCharges: [
      "IPC 386 (Extortion by putting person in fear of death)",
      "IPC 307 (Firing at patrol personnel)",
      "NDPS Act Section 21 (Commercial Quantity Narcotics)"
    ],
    lastKnownLocation: "Halim College back road / Prem Nagar pockets",
    advisory: "Uses encrypted messaging apps to coordinate street drug peddlers."
  },
  {
    id: "crm-006",
    name: "Abhishek Sachan",
    alias: "Monu Kakadeo",
    hindiName: "अभिषेक सचान उर्फ मोनू काकादेव",
    photoUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300&auto=format&fit=crop&q=80",
    bounty: 25000,
    bountyFormatted: "₹25,000",
    status: "WANTED",
    statusLevel: "ELEVATED",
    thanaId: "thana-kakadeo",
    thanaName: "Thana Kakadeo",
    historySheetNo: "HS-35 / 2023",
    gangName: "Hostel Extortion Gang",
    age: 26,
    physicalMarks: "Muscular athletic build, scar on left hand",
    majorCharges: [
      "IPC 384 (Extortion from student hostels & coaching centers)",
      "IPC 354D (Stalking & Harassment)",
      "IPC 324 (Voluntarily Causing Hurt with Sharp Weapon)"
    ],
    lastKnownLocation: "Deo Nagar / M-Block Kakadeo coaching alleys",
    advisory: "Operates an informal collection racket targeting student mess owners."
  },
  {
    id: "crm-007",
    name: "Dharmendra Nishad",
    alias: "Dharmu Mallah",
    hindiName: "धर्मेंद्र निषाद उर्फ धर्मू मल्लाह",
    photoUrl: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300&auto=format&fit=crop&q=80",
    bounty: 50000,
    bountyFormatted: "₹50,000",
    status: "WANTED / ABSCONDING",
    statusLevel: "CRITICAL",
    thanaId: "thana-bithoor",
    thanaName: "Thana Bithoor / Chaubepur",
    historySheetNo: "HS-14 / 2017",
    gangName: "Ganga Sand Mining Mafia",
    age: 49,
    physicalMarks: "Stocky build, missing index finger on left hand",
    majorCharges: [
      "UP Gangster Act",
      "Mines and Minerals Act Section 21 (Illegal Sand Extortion)",
      "IPC 307 (Assault on Mining Enforcement Officers)",
      "IPC 147/148 (Rioting Armed with Deadly Weapons)"
    ],
    lastKnownLocation: "Brahmavart Ghat & Unnao border sandbars across Ganga",
    advisory: "Utilizes motorized boats for rapid transit across Kanpur-Unnao river boundary."
  }
];
