/**
 * Kanpur Tactical GIS - Progressive Web App (PWA) Lifecycle Controller
 * Manages beforeinstallprompt lifecycle, custom glassmorphic install banner,
 * standalone mode detection, and offline/online network status indicators.
 */

class PwaInstallManager {
  constructor() {
    this.deferredPrompt = null;
    this.installBanner = null;
    this.installBtn = null;
    this.dismissBtn = null;
    this.isStandalone = false;
  }

  init() {
    if (typeof window === 'undefined') return this;

    this.installBanner = document.getElementById("pwaInstallBanner");
    this.installBtn = document.getElementById("pwaInstallBtn");
    this.dismissBtn = document.getElementById("pwaDismissBtn");

    // 1. Detect if running in standalone mode (no browser URL bar)
    this.isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                        window.navigator.standalone === true;

    if (this.isStandalone) {
      console.log("[PWA] Running in Standalone Window mode.");
      this.hideInstallBanner();
      this.applyStandaloneLayout();
      return this;
    }

    // 2. Intercept beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      console.log("[PWA] beforeinstallprompt event captured.");
      this.showInstallBanner();
    });

    // 3. Setup Install Button Trigger
    if (this.installBtn) {
      this.installBtn.addEventListener('click', async () => {
        if (!this.deferredPrompt) {
          // If iOS Safari, show prompt instructions
          if (this.isIos()) {
            alert("To install on iOS: Tap the Share button in Safari, then select 'Add to Home Screen'.");
          }
          return;
        }

        try {
          this.deferredPrompt.prompt();
          const choice = await this.deferredPrompt.userChoice;
          console.log(`[PWA] Install prompt outcome: ${choice.outcome}`);
          this.deferredPrompt = null;
          this.hideInstallBanner();
        } catch (err) {
          console.warn("[PWA] Prompt error:", err);
        }
      });
    }

    // 4. Setup Dismiss Button
    if (this.dismissBtn) {
      this.dismissBtn.addEventListener('click', () => {
        this.hideInstallBanner();
        try {
          sessionStorage.setItem("kanpur_pwa_dismissed", "true");
        } catch (e) {}
      });
    }

    // 5. Handle appinstalled event
    window.addEventListener('appinstalled', () => {
      console.log("[PWA] App successfully installed to home screen.");
      this.hideInstallBanner();
      this.deferredPrompt = null;
    });

    // 6. Monitor Online / Offline Status
    this.setupNetworkStatusMonitor();

    // 7. If iOS Safari and not dismissed, show iOS install guide banner
    if (this.isIos() && !sessionStorage.getItem("kanpur_pwa_dismissed")) {
      const iosGuide = document.getElementById("pwaIosGuide");
      if (iosGuide) iosGuide.style.display = "block";
    }

    return this;
  }

  isIos() {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  showInstallBanner() {
    try {
      if (sessionStorage.getItem("kanpur_pwa_dismissed") === "true") return;
    } catch (e) {}

    if (this.installBanner) {
      this.installBanner.style.display = "flex";
    }
  }

  hideInstallBanner() {
    if (this.installBanner) {
      this.installBanner.style.display = "none";
    }
  }

  applyStandaloneLayout() {
    document.body.classList.add("pwa-standalone");
  }

  setupNetworkStatusMonitor() {
    const updateNetworkStatus = () => {
      const isOnline = navigator.onLine;
      const offlineIndicator = document.getElementById("offlineIndicatorPill");
      if (offlineIndicator) {
        offlineIndicator.style.display = isOnline ? "none" : "flex";
      }

      const wsStatus = document.getElementById("wsStatusChip");
      if (!isOnline && wsStatus) {
        wsStatus.className = "ws-status-chip status-offline";
        const text = wsStatus.querySelector(".status-text");
        if (text) text.textContent = "OFFLINE (CELLULAR 112 ACTIVE)";
      }
    };

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PwaInstallManager };
}

if (typeof window !== 'undefined') {
  window.PwaInstallManager = PwaInstallManager;
}
