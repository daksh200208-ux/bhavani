/**
 * Kanpur Tactical GIS - Tactical Audio Alert Engine
 * Zero-dependency Web Audio API synthesizer for 350m geofence proximity chirps,
 * multi-stage red zone proximity chimes, and high-priority alternating SOS sirens.
 */

class TacticalAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.isMuted = true; // Muted by default — user can enable via audio toggle button
    this.activeSirenOsc = null;
    this.activeSirenGain = null;
    this.sirenInterval = null;

    // Default strictly to muted unless explicitly toggled by user
    if (typeof sessionStorage !== 'undefined') {
      const savedMute = sessionStorage.getItem("kanpur_audio_muted");
      if (savedMute !== null) {
        this.isMuted = savedMute === "true";
      } else {
        this.isMuted = true;
        sessionStorage.setItem("kanpur_audio_muted", "true");
      }
    }
  }

  /**
   * Lazy-initialize AudioContext upon user gesture
   */
  initContext() {
    if (!this.audioCtx) {
      if (typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /**
   * Toggle audio mute state
   * @returns {boolean} Current isMuted state
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem("kanpur_audio_muted", this.isMuted ? "true" : "false");
    }
    if (this.isMuted) {
      this.stopSosAlarm();
    }
    return this.isMuted;
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem("kanpur_audio_muted", this.isMuted ? "true" : "false");
    }
    if (this.isMuted) {
      this.stopSosAlarm();
    }
  }

  /**
   * Play 350m / 300m Geofence Hazard Warning Chirp (Dual Tone 750Hz -> 600Hz)
   */
  playWarningChirp() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      const now = this.audioCtx.currentTime;

      // Frequency glide: 750Hz down to 600Hz over 0.25s
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.25);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {
      console.warn("Audio chirp playback error:", e);
    }
  }

  /**
   * Play Critical Breach Alarm (Urgent dual-staccato pulse)
   */
  playCriticalBreachSound() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      [0, 0.12].forEach((offset) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now + offset);
        osc.frequency.exponentialRampToValueAtTime(1760, now + offset + 0.09);

        gain.gain.setValueAtTime(0.2, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.09);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + offset);
        osc.stop(now + offset + 0.1);
      });
    } catch (e) {
      console.warn("Critical breach audio error:", e);
    }
  }

  /**
   * Play Resolution Chime when exiting 300m red zone boundary
   * Rising positive glide 520Hz -> 780Hz over 200ms
   */
  playResolutionChime() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      const now = this.audioCtx.currentTime;

      // Frequency glide: 520Hz up to 780Hz over 0.20s
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.20);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.21);
    } catch (e) {
      console.warn("Resolution chime playback error:", e);
    }
  }

  /**
   * Start alternating tactical emergency siren (900Hz <-> 450Hz)
   */
  startSosAlarm() {
    if (this.isMuted || this.sirenInterval) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      let highTone = true;
      const playTone = () => {
        if (this.isMuted || !this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'triangle';
        const freq = highTone ? 900 : 500;
        highTone = !highTone;

        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.36);
      };

      playTone();
      this.sirenInterval = setInterval(playTone, 400);

      // Automatically auto-silence after 15 seconds to avoid fatigue
      setTimeout(() => {
        this.stopSosAlarm();
      }, 15000);
    } catch (e) {
      console.warn("SOS siren audio error:", e);
    }
  }

  /**
   * Stop active emergency siren
   */
  stopSosAlarm() {
    if (this.sirenInterval) {
      clearInterval(this.sirenInterval);
      this.sirenInterval = null;
    }
  }
}

// Global instance in browser
if (typeof window !== 'undefined') {
  window.tacticalAudio = new TacticalAudioEngine();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TacticalAudioEngine };
}
