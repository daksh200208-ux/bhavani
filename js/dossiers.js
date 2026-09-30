/**
 * Kanpur Tactical GIS - Criminal Dossiers & Most Wanted Module
 * Handles wanted criminal records, photos, bounties, thana filtering, and sighting reports.
 */

class DossierManager {
  constructor(mapEngine) {
    this.mapEngine = mapEngine;
    this.container = null;
    this.searchInput = null;
    this.thanaFilter = null;
    this.selectedCriminal = null;
  }

  init() {
    this.container = document.getElementById("criminalsListContainer");
    this.searchInput = document.getElementById("criminalSearchInput");
    this.thanaFilter = document.getElementById("criminalThanaFilter");

    this.populateThanaDropdown();
    this.renderCriminals(KANPUR_WANTED_CRIMINALS);
    this.setupListeners();
    return this;
  }

  populateThanaDropdown() {
    if (!this.thanaFilter) return;
    
    // Extract unique thana names
    const thanas = [...new Set(KANPUR_WANTED_CRIMINALS.map(c => c.thanaName))];
    
    let optionsHtml = `<option value="ALL">All Kanpur Thana Jurisdictions</option>`;
    thanas.forEach(t => {
      optionsHtml += `<option value="${t}">${t}</option>`;
    });
    this.thanaFilter.innerHTML = optionsHtml;
  }

  setupListeners() {
    if (this.searchInput) {
      this.searchInput.addEventListener("input", () => this.filterRecords());
    }

    if (this.thanaFilter) {
      this.thanaFilter.addEventListener("change", () => this.filterRecords());
    }

    // Sighting report modal close
    const closeSightingBtn = document.getElementById("closeSightingModalBtn");
    if (closeSightingBtn) {
      closeSightingBtn.addEventListener("click", () => {
        document.getElementById("sightingModal").classList.remove("active");
      });
    }

    // Submit sighting report
    const submitSightingBtn = document.getElementById("submitSightingBtn");
    if (submitSightingBtn) {
      submitSightingBtn.addEventListener("click", () => {
        this.submitSighting();
      });
    }
  }

  filterRecords() {
    const query = this.searchInput ? this.searchInput.value.toLowerCase().trim() : "";
    const selectedThana = this.thanaFilter ? this.thanaFilter.value : "ALL";

    const filtered = KANPUR_WANTED_CRIMINALS.filter(crm => {
      const matchesQuery = !query || 
        crm.name.toLowerCase().includes(query) ||
        crm.alias.toLowerCase().includes(query) ||
        crm.hindiName.toLowerCase().includes(query) ||
        crm.historySheetNo.toLowerCase().includes(query);

      const matchesThana = selectedThana === "ALL" || crm.thanaName === selectedThana;

      return matchesQuery && matchesThana;
    });

    this.renderCriminals(filtered);
  }

  renderCriminals(list) {
    if (!this.container) return;

    if (list.length === 0) {
      this.container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: #64748B;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px;">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <div style="font-size: 13px; font-weight: 600;">No criminal dossiers found</div>
          <div style="font-size: 11px;">Try searching by different alias or Thana.</div>
        </div>
      `;
      return;
    }

    let html = "";
    list.forEach(crm => {
      const isCritical = crm.statusLevel === "CRITICAL";

      html += `
        <div class="criminal-card" id="card-${crm.id}">
          <div class="criminal-photo-wrap">
            <img src="${crm.photoUrl}" alt="${crm.name}" class="criminal-photo" onerror="this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80'">
            <div class="bounty-pill">${crm.bountyFormatted} INAAM</div>
          </div>

          <div class="criminal-meta">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div class="criminal-name">${crm.name}</div>
                <div class="criminal-alias">Aka: ${crm.alias}</div>
              </div>
              <span class="card-tag ${isCritical ? 'tag-critical' : 'tag-high'}">${crm.status}</span>
            </div>

            <div style="font-size: 10px; color: #94A3B8; margin-top: 2px;">
              <strong>${crm.thanaName}</strong> &bull; <span style="font-family: monospace;">${crm.historySheetNo}</span>
            </div>

            <div class="charges-list">
              <strong>Key Charges:</strong> ${crm.majorCharges.slice(0, 2).join(", ")}
            </div>

            <div style="font-size: 10px; color: #CBD5E1; margin-bottom: 8px;">
              <strong>Physical ID:</strong> ${crm.physicalMarks}
            </div>

            <div class="card-action-bar" style="margin-top: auto;">
              <button class="action-btn" onclick="window.dossierManager.openSightingModal('${crm.id}')" style="background: rgba(220,38,38,0.25); border-color: rgba(239,68,68,0.5); color: #FCA5A5;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
                Report Sighting
              </button>
              <button class="action-btn" onclick="window.dossierManager.focusThana('${crm.thanaId}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/><path d="m12 8 4 4-4 4M8 12h8"/>
                </svg>
                Locate Thana
              </button>
            </div>
          </div>
        </div>
      `;
    });

    this.container.innerHTML = html;
  }

  focusThana(thanaId) {
    const station = KANPUR_POLICE_STATIONS.find(s => s.id === thanaId);
    if (station && this.mapEngine) {
      this.mapEngine.focusOnLocation(station.lat, station.lng, 16);
      
      // Auto-collapse mobile drawer so map is fully visible
      const drawer = document.getElementById("tacticalDrawer");
      if (drawer && window.innerWidth < 900) {
        drawer.classList.add("collapsed");
      }
    }
  }

  openSightingModal(crmId) {
    const crm = KANPUR_WANTED_CRIMINALS.find(c => c.id === crmId);
    if (!crm) return;
    this.selectedCriminal = crm;

    const modal = document.getElementById("sightingModal");
    const nameEl = document.getElementById("sightingModalCrmName");
    const aliasEl = document.getElementById("sightingModalCrmAlias");
    const coordsEl = document.getElementById("sightingModalCoords");

    if (nameEl) nameEl.textContent = `${crm.name} (${crm.bountyFormatted} Bounty)`;
    if (aliasEl) aliasEl.textContent = `Thana: ${crm.thanaName} | HS: ${crm.historySheetNo}`;

    const latLng = this.mapEngine.userLatLng || APP_CONFIG.defaultCenter;
    if (coordsEl) coordsEl.textContent = `${latLng[0].toFixed(5)}, ${latLng[1].toFixed(5)}`;

    if (modal) modal.classList.add("active");
  }

  submitSighting() {
    if (!this.selectedCriminal) return;
    const noteEl = document.getElementById("sightingNoteInput");
    const note = noteEl ? noteEl.value.trim() : "";
    const latLng = this.mapEngine.userLatLng || APP_CONFIG.defaultCenter;

    const message = encodeURIComponent(
      `🚨 *CRIMINAL SIGHTING ALERT - KANPUR TACTICAL*\n` +
      `Subject: ${this.selectedCriminal.name} (Aka: ${this.selectedCriminal.alias})\n` +
      `Bounty: ${this.selectedCriminal.bountyFormatted}\n` +
      `Thana: ${this.selectedCriminal.thanaName}\n` +
      `📍 Sighting GPS: https://maps.google.com/?q=${latLng[0]},${latLng[1]}\n` +
      `📝 Field Notes: ${note || "Immediate verification requested by designated unit."}\n` +
      `Time: ${new Date().toLocaleString('en-IN')}`
    );

    // Close modal
    document.getElementById("sightingModal").classList.remove("active");
    if (noteEl) noteEl.value = "";

    // Open WhatsApp Dispatch
    window.open(`https://api.whatsapp.com/send?text=${message}`, '_blank');
  }
}
