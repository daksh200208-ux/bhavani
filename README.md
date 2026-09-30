# Kanpur Tactical GIS & Law Enforcement Safety Grid

A high-performance, mobile-first web-hosted GIS application built for designated law enforcement, escort, and security personnel operating in **Kanpur Nagar, Uttar Pradesh**.

---

## 🚔 Core Features

1. **Interactive Kanpur GIS Map**:
   - High-contrast **Tactical Dark Mode**, **Street View**, and **Satellite Imagery** base layers.
   - Built on Leaflet.js with zero server overhead.

2. **Certified High-Crime Hotspots (Red Zones)**:
   - Certified zones based on Kanpur Police Commissionerate analysis (*Operation Nirastikaran* and *Operation Trinetra*) plus NCRB crime monitoring.
   - Distinct hazard polygons with risk levels (**CRITICAL**, **HIGH**, **ELEVATED**) for sectors like *Parade/Nai Sadak/Beckanganj, Chamanganj/Sisamau, Babupurwa/Juhi, Chakeri/Ahirwan, Barra Bypass, Kakadeo Coaching Hub, Kalyanpur GT outer, and Transport Nagar*.
   - Proximity warning banner automatically appears if GPS location moves within 350m of a red zone.

3. **Kanpur Police Stations Directory (49 Thanas)**:
   - Complete directory of Kanpur Commissionerate police stations (*Kotwali, Swaroop Nagar, Kalyanpur, Kakadeo, Chakeri, Babupurwa, Barra, Govind Nagar, Cantt, Bithoor, etc.*).
   - Real SHO contacts, official CUG numbers, and jurisdictions.
   - **One-touch calling**: Click "Call Thana" to directly dial the Station Officer.
   - Real-time distance calculation to your live GPS coordinates.
   - **Nearest Thana HUD**: Dynamically highlights the closest police station at the top of the screen.

4. **Emergency 112 Instant Phone Dialing**:
   - Prominent, glowing floating **112 SOS Button**.
   - Direct `<a href="tel:112">` integration: Clicking immediately opens the smartphone's native phone dialer with `112` pre-filled so the user only has to hit dial.
   - **SOS Dispatch Toolkit**: Displays live GPS coordinates (latitude, longitude), 1-click coordinates copy, and a pre-formatted WhatsApp SOS broadcast payload for dispatch rooms.

5. **Wanted Criminals & History-Sheeters Dossier**:
   - Official UP Police / Kanpur Commissionerate Most Wanted records.
   - Photos, aliases, active bounties (₹25,000 to ₹1,00,000+), major charges, and Thana jurisdictions.
   - **Report Sighting** feature: Dispatches sighting notes with live GPS coordinates directly to WhatsApp / SMS dispatch.

6. **Restricted Personnel Access (PIN Gate)**:
   - Clean tactical badge PIN screen (Default PIN: `1120`).
   - "Quick Unlock" button for rapid evaluation.
   - "Lock Console" action in the header to re-secure the terminal.

7. **Field Incident Logger**:
   - Allows designated personnel to pin suspicious vehicles, roadblocks, or public order disturbances directly to the grid (persisted in `localStorage`).

---

## 🚀 Instant Deployment (1-Click & Free)

Because this app is designed with a lightweight, zero-dependency architecture (HTML5 + CSS3 + Modular ES6 + Leaflet CDN), it runs smoothly even under heavy traffic and requires no database server to maintain.

### Option 1: Vercel (Recommended)
1. Install Vercel CLI or open [vercel.com](https://vercel.com).
2. Deploy the `kanpur-safety-gis` folder:
   ```bash
   npx vercel
   ```
3. Your app will be live on an HTTPS link (e.g., `https://kanpur-tactical-gis.vercel.app`), which enables full mobile GPS geolocation.

### Option 2: Netlify
1. Go to [netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `kanpur-safety-gis` folder.
3. It goes live instantly with SSL.

### Option 3: GitHub Pages
1. Push this folder to a GitHub repository.
2. In Repository Settings > **Pages**, set source to `main` branch.
3. Access your live app at `https://<username>.github.io/<repo-name>/`.

---

## 📱 Local Preview on Mobile / Desktop

### On Desktop:
Simply double-click `index.html` in your browser.

### On Phone (Same Wi-Fi):
If you want to test the phone dialer and GPS on your physical mobile phone:
```bash
npx serve .
# Or using Python:
python -m http.server 8080
```
Open the displayed local IP address (e.g., `http://192.168.1.X:8080`) on your mobile browser.

---

## 🔒 Configuration & Customization
- **Change Default PIN**: Open `js/config.js` and modify `accessPin: "1120"`.
- **Add More Thanas**: Add objects into `KANPUR_POLICE_STATIONS` in `js/data/policeStations.js`.
- **Add More Red Zones**: Add polygon coordinates into `KANPUR_CRIME_HOTSPOTS` in `js/data/crimeHotspots.js`.
- **Update Wanted Criminals**: Modify `KANPUR_WANTED_CRIMINALS` in `js/data/wantedCriminals.js`.
