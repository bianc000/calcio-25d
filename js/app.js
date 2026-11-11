// Inizializzazione Applicazione & Flusso UI
import { CHARACTERS, getCharacterById } from './characters.js?v=3.3';
import { FootballGame } from './game.js?v=3.3';
import { NetworkManager } from './network.js?v=3.3';
import { sounds } from './audio.js?v=3.3';

const MODE_HINTS = {
  '1v1': '<strong>Stanza 1v1 (2 giocatori):</strong> Ognuno comanda tutta la propria squadra (cambio giocatore con Q / Spazio).',
  '2v2': '<strong>Stanza 2v2 (fino a 4 giocatori):</strong> Ogni giocatore comanda 1 solo personaggio fisso (DIF o ATT). Il Portiere è sempre CPU.',
  '3v3': '<strong>Stanza 3v3 (fino a 6 giocatori):</strong> Ognuno comanda 1 singolo personaggio fisso (POR, DIF o ATT). I posti vuoti restano CPU.'
};

const SLOT_ROLES = [
  { key: 'gk', label: 'POR', icon: '🧤' },
  { key: 'def', label: 'DIF', icon: '🛡️' },
  { key: 'fwd', label: 'ATT', icon: '⚡' }
];

const MODE_MAX_HUMANS = { '1v1': 2, '2v2': 4, '3v3': 6 };

class App {
  constructor() {
    this.game = null;
    this.net = null;
    this.gameMode = 'cpu'; // 'cpu', 'online', 'local'
    this.controlMode = '1v1'; // '1v1', '2v2', '3v3'
    this.onlineControlMode = '1v1';
    this.isHost = true;
    this.myPeerId = 'host';
    this.localTeam = 1;
    this.localSlot = 2; // 0=POR, 1=DIF, 2=ATT
    this.seats = { t1: ['local', 'local', 'local'], t2: [null, null, null], t2Peer: null };
    this.team1Picked = [];
    this.team2Picked = [];
    this.currentDraftTeam = 1; // 1 o 2
    this.clientInputInterval = null;
    this._lastSentAxis = '';
    this._connectedPeersCount = 0;

    this.cacheDOMElements();
    this.bindEvents();
    this.loadTurnInputs();
    this._syncModePillsUI();
    
    // Rileva dispositivi touch / smartphone / tablet
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 1024);
    if (isTouch) {
      document.body.classList.add('touch-device');
    }

    this.setupTouchControls();
    this.renderCharacterGrid();
    this.checkUrlParams();
  }

  cacheDOMElements() {
    this.canvasContainer = document.getElementById('game-canvas-container');
    this.menuScreen = document.getElementById('main-menu');
    this.onlineScreen = document.getElementById('online-modal');
    this.draftScreen = document.getElementById('draft-screen');
    this.gameOverScreen = document.getElementById('game-over-modal');
    this.rulesScreen = document.getElementById('rules-modal');
    this.inGameHud = document.getElementById('in-game-hud');

    this.hostRoomCodeEl = document.getElementById('host-room-code');
    this.joinRoomInput = document.getElementById('join-room-input');
    this.roomShareUrl = document.getElementById('room-share-url');

    this.score1El = document.getElementById('score-t1');
    this.score2El = document.getElementById('score-t2');
    this.matchClockEl = document.getElementById('match-clock');
    this.shotPowerBar = document.getElementById('shot-power-bar');
    this.shotPowerContainer = document.getElementById('shot-power-container');
    this.goalBanner = document.getElementById('goal-banner');
    this.radarCanvas = document.getElementById('radar-canvas');
    this.radarCtx = this.radarCanvas ? this.radarCanvas.getContext('2d') : null;

    this.pauseModal = document.getElementById('pause-modal');
    this.pauseScore1 = document.getElementById('pause-score-t1');
    this.pauseScore2 = document.getElementById('pause-score-t2');
    this.pauseClock = document.getElementById('pause-clock');

    this.toastEl = document.getElementById('toast');
    this.soundToggleBtn = document.getElementById('sound-toggle');
  }

  showToast(msg, durationMs) {
    if (!this.toastEl) return;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this.toastEl.innerText = msg;
    this.toastEl.classList.add('show');
    const ms = durationMs ?? (String(msg || '').length > 70 ? 6000 : 3200);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  bindEvents() {
    // Menu: contro CPU si comandano sempre tutti i giocatori della propria squadra
    document.getElementById('btn-play-cpu').onclick = () => {
      sounds.playBeep();
      this.gameMode = 'cpu';
      this.controlMode = '1v1';
      this.isHost = true;
      this.myPeerId = 'local';
      this.assignDefaultSeats(false);
      this.openDraft(true);
    };

    document.getElementById('btn-play-online').onclick = () => {
      sounds.playBeep();
      this.openOnlineModal();
    };

    // Selettori formato stanza online (1v1 / 2v2 / 3v3) su Modale Online e Draft Host
    document.querySelectorAll('.mode-pill[data-mode]').forEach(btn => {
      btn.onclick = () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        if (this.gameMode === 'online' && !this.isHost && btn.closest('#draft-mode-selector')) {
          this.showToast("Solo l'Host della stanza può cambiare il formato!");
          return;
        }
        sounds.playBeep(720, 0.04);
        this.onlineControlMode = mode;
        this.setControlMode(mode, true);
      };
    });

    // Click sugli slot squadra nel Draft (scelta ruolo POR/DIF/ATT in 2v2 e 3v3)
    for (let team = 1; team <= 2; team++) {
      for (let slot = 0; slot < 3; slot++) {
        const slotEl = document.getElementById(`slot-t${team}-${slot}`);
        if (slotEl) {
          slotEl.onclick = () => this.handleSlotClick(team, slot);
        }
      }
    }

    const btnDraftCopyLink = document.getElementById('btn-draft-copy-link');
    if (btnDraftCopyLink) btnDraftCopyLink.onclick = () => this.copyRoomLink();

    // Impostazioni opzionali Relay TURN (4G / Reti restrittive)
    const btnSaveTurn = document.getElementById('btn-save-turn');
    if (btnSaveTurn) {
      btnSaveTurn.onclick = async () => {
        const url = (document.getElementById('turn-url-input')?.value || '').trim();
        const user = (document.getElementById('turn-user-input')?.value || '').trim();
        const pass = (document.getElementById('turn-pass-input')?.value || '').trim();
        if (!url) {
          this.showToast("Inserisci almeno l'URL del server TURN o link Metered.");
          return;
        }
        const candidateCfg = { url, user, pass };
        btnSaveTurn.disabled = true;
        btnSaveTurn.innerText = '⏳ Verifica TURN...';
        try {
          const { servers, error } = await NetworkManager.resolveCustomTurnServers(candidateCfg);
          if (error) {
            sounds.playBeep(260, 0.08);
            this.showToast(`⚠️ ${error}`);
            return;
          }
          NetworkManager.saveTurnConfig(candidateCfg);
          this.refreshTurnStatusUI();
          sounds.playBeep(820, 0.05);
          this.showToast(`✅ Relay TURN attivo (${servers.length} server)! Ora rigenera la stanza o unisciti.`);
        } finally {
          btnSaveTurn.disabled = false;
          btnSaveTurn.innerText = '💾 Salva & Verifica TURN';
        }
      };
    }

    const btnClearTurn = document.getElementById('btn-clear-turn');
    if (btnClearTurn) {
      btnClearTurn.onclick = () => {
        NetworkManager.saveTurnConfig(null);
        this.loadTurnInputs();
        sounds.playBeep(480, 0.05);
        this.showToast("Configurazione TURN rimossa.");
      };
    }

    document.getElementById('btn-rules').onclick = () => {
      sounds.playBeep();
      this.rulesScreen.classList.remove('hidden');
    };

    document.getElementById('btn-close-rules').onclick = () => {
      sounds.playBeep();
      this.rulesScreen.classList.add('hidden');
    };

    // Online
    document.getElementById('btn-create-room').onclick = () => this.startHosting();
    document.getElementById('btn-join-room').onclick = () => this.joinRoom();
    if (this.joinRoomInput) {
      this.joinRoomInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.joinRoom();
        }
      });
    }
    document.getElementById('btn-copy-link').onclick = () => this.copyRoomLink();
    document.getElementById('btn-back-menu').onclick = () => {
      sounds.playBeep();
      if (this.net) {
        this.net.disconnect();
        this.net = null;
      }
      this.resetOnlineLobbyUI();
      this.onlineScreen.classList.add('hidden');
      this.menuScreen.classList.remove('hidden');
    };

    // Draft
    document.getElementById('btn-start-match').onclick = () => this.requestStartMatch();

    // Game Over
    document.getElementById('btn-rematch').onclick = () => {
      sounds.playBeep();
      this.gameOverScreen.classList.add('hidden');
      this.requestStartMatch();
    };
    document.getElementById('btn-menu-exit').onclick = () => {
      sounds.playBeep();
      location.reload();
    };

    // Pausa
    const btnPauseToggle = document.getElementById('btn-pause-toggle');
    if (btnPauseToggle) btnPauseToggle.onclick = () => this.togglePause();

    const btnResume = document.getElementById('btn-resume-game');
    if (btnResume) btnResume.onclick = () => this.togglePause();

    const btnRestart = document.getElementById('btn-restart-game');
    if (btnRestart) btnRestart.onclick = () => {
      sounds.playBeep();
      if (this.pauseModal) this.pauseModal.classList.add('hidden');
      this.requestStartMatch();
    };

    const btnPauseMenu = document.getElementById('btn-pause-menu');
    if (btnPauseMenu) btnPauseMenu.onclick = () => {
      sounds.playBeep();
      location.reload();
    };

    // Suono toggle
    this.soundToggleBtn.onclick = () => {
      const isMuted = sounds.toggleMute();
      this.soundToggleBtn.innerText = isMuted ? '🔇 Audio Spento' : '🔊 Audio Attivo';
    };

    // Quick emotes
    document.querySelectorAll('.emote-btn').forEach(btn => {
      btn.onclick = () => {
        sounds.playBeep(880, 0.05);
        this.showToast(btn.innerText);
        if (this.net && this.net.connected) {
          this.net.send({ type: 'emote', text: btn.innerText });
        }
      };
    });
  }

  setupTouchControls() {
    const stickArea = document.getElementById('touch-stick-area') || document.getElementById('touch-stick');
    const stickZone = document.getElementById('touch-stick');
    const stickKnob = document.getElementById('touch-knob');
    if (!stickZone || !stickKnob) return;

    let touchOrigin = null;
    const maxRadius = 46;

    const handleTouchStart = (e) => {
      if (touchOrigin) return; // Supporta multi-touch senza interferire con la mano destra
      const touch = e.changedTouches[0];
      const areaRect = (stickArea && stickArea !== stickZone) 
        ? stickArea.getBoundingClientRect() 
        : stickZone.parentElement.getBoundingClientRect();

      // Posiziona la base del joystick esattamente sotto il pollice del giocatore
      const localX = touch.clientX - areaRect.left;
      const localY = touch.clientY - areaRect.top;

      stickZone.style.left = `${Math.max(15, localX - 60)}px`;
      stickZone.style.top = `${Math.max(15, localY - 60)}px`;
      stickZone.style.bottom = 'auto';
      stickZone.classList.add('active');

      touchOrigin = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY
      };
      stickKnob.style.transform = `translate(0px, 0px)`;
      if (this.game) {
        this.game.isKeyboardActive = false;
      }
      e.preventDefault();
    };

    const handleTouchMove = (e) => {
      if (!touchOrigin || !this.game) return;
      const touch = Array.from(e.touches).find(t => t.identifier === touchOrigin.id);
      if (!touch) return;

      const dx = touch.clientX - touchOrigin.x;
      const dy = touch.clientY - touchOrigin.y;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      const clampedDist = Math.min(dist, maxRadius);
      const knobX = Math.cos(angle) * clampedDist;
      const knobY = Math.sin(angle) * clampedDist;

      stickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

      // Normalizzazione vettori movimento
      this.game.isKeyboardActive = false;
      this.game.input.moveX = knobX / maxRadius;
      this.game.input.moveZ = knobY / maxRadius;

      // Sprint automatico se il joystick viene spinto a fondo (sensibilità analogica naturale)
      this.game.input.sprint = (clampedDist > maxRadius * 0.82);

      e.preventDefault();
    };

    const handleTouchEnd = (e) => {
      if (!touchOrigin) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === touchOrigin.id);
      if (touch) {
        touchOrigin = null;
        stickKnob.style.transform = `translate(0px, 0px)`;
        stickZone.classList.remove('active');
        if (this.game) {
          this.game.input.moveX = 0;
          this.game.input.moveZ = 0;
          this.game.input.sprint = false;
        }
      }
    };

    const targetArea = stickArea || stickZone;
    targetArea.addEventListener('touchstart', handleTouchStart, { passive: false });
    targetArea.addEventListener('touchmove', handleTouchMove, { passive: false });
    targetArea.addEventListener('touchend', handleTouchEnd);
    targetArea.addEventListener('touchcancel', handleTouchEnd);

    // Pulsanti Touch Passaggio, Tiro, Switch con feedback visivo e sonoro
    const btnPass = document.getElementById('touch-pass');
    const btnShoot = document.getElementById('touch-shoot');
    const btnSwitch = document.getElementById('touch-switch');

    if (btnPass) {
      btnPass.addEventListener('touchstart', (e) => {
        btnPass.classList.add('active');
        if (this.game) {
          if (this.game.controlMode !== '1v1' || this.game.userTeamHasBall()) {
            this.game.triggerInputPass();
          } else {
            this.game.triggerInputSwitch();
          }
        }
        sounds.playBeep(700, 0.04);
        e.preventDefault();
      }, { passive: false });
      btnPass.addEventListener('touchend', () => btnPass.classList.remove('active'));
      btnPass.addEventListener('touchcancel', () => btnPass.classList.remove('active'));
    }

    if (btnShoot) {
      btnShoot.addEventListener('touchstart', (e) => {
        btnShoot.classList.add('active');
        if (this.game) {
          this.game.startInputShotCharge();
        }
        sounds.playBeep(520, 0.04);
        e.preventDefault();
      }, { passive: false });

      const handleShootRelease = (e) => {
        btnShoot.classList.remove('active');
        if (this.game) {
          this.game.releaseInputShot();
        }
        if (e && e.cancelable) e.preventDefault();
      };

      btnShoot.addEventListener('touchend', handleShootRelease, { passive: false });
      btnShoot.addEventListener('touchcancel', handleShootRelease, { passive: false });
    }

    if (btnSwitch) {
      btnSwitch.addEventListener('touchstart', (e) => {
        btnSwitch.classList.add('active');
        if (this.game) {
          this.game.triggerInputSwitch();
        }
        sounds.playBeep(620, 0.03);
        e.preventDefault();
      }, { passive: false });
      btnSwitch.addEventListener('touchend', () => btnSwitch.classList.remove('active'));
      btnSwitch.addEventListener('touchcancel', () => btnSwitch.classList.remove('active'));
    }

    // Pulsante Touch Super Special Mario Strikers
    const btnSpecial = document.getElementById('touch-special');
    if (btnSpecial) {
      btnSpecial.addEventListener('touchstart', (e) => {
        btnSpecial.classList.add('active');
        if (this.game) {
          this.game.triggerInputSpecial();
        }
        sounds.playBeep(880, 0.05);
        e.preventDefault();
      }, { passive: false });
      btnSpecial.addEventListener('touchend', () => btnSpecial.classList.remove('active'));
      btnSpecial.addEventListener('touchcancel', () => btnSpecial.classList.remove('active'));
    }
  }

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      this.gameMode = 'online';
      this.isHost = false;
      this.joinRoomInput.value = room.trim().toUpperCase();
      this.openOnlineModal();
      this.showToast("Stanza rilevata dal link! Clicca 'Unisciti'");
    }
  }

  loadTurnInputs() {
    const cfg = NetworkManager.getTurnConfig();
    const urlEl = document.getElementById('turn-url-input');
    const userEl = document.getElementById('turn-user-input');
    const passEl = document.getElementById('turn-pass-input');
    if (urlEl) urlEl.value = (cfg && cfg.url) ? cfg.url : '';
    if (userEl) userEl.value = (cfg && cfg.user) ? cfg.user : '';
    if (passEl) passEl.value = (cfg && cfg.pass) ? cfg.pass : '';
    this.refreshTurnStatusUI();
  }

  refreshTurnStatusUI() {
    const summaryEl = document.getElementById('turn-summary-text');
    if (!summaryEl) return;
    if (NetworkManager.hasTurnConfigured()) {
      summaryEl.innerText = '⚙️ Relay TURN attivo ✅ (Wi-Fi diversi / 4G abilitato)';
    } else {
      summaryEl.innerText = '⚙️ Su 4G o Wi-Fi diversi bloccati? Configura relay TURN (opzionale)';
    }
  }

  _openTurnSettingsIfUnconfigured() {
    if (NetworkManager.hasTurnConfigured()) return;
    const details = document.getElementById('turn-settings-details');
    if (details) details.open = true;
  }

  _syncModePillsUI() {
    const activeOnlineMode = (this.gameMode === 'online') ? this.controlMode : this.onlineControlMode;
    document.querySelectorAll('.mode-pill[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === activeOnlineMode);
      if (this.gameMode === 'online' && !this.isHost && btn.closest('#draft-mode-selector')) {
        btn.disabled = true;
      } else {
        btn.disabled = false;
      }
    });
    const hintEl = document.getElementById('online-mode-hint');
    if (hintEl && MODE_HINTS[activeOnlineMode]) {
      hintEl.innerHTML = MODE_HINTS[activeOnlineMode];
    }
    const hostModeLabel = document.getElementById('host-room-mode-label');
    if (hostModeLabel) {
      hostModeLabel.innerText = activeOnlineMode;
    }
    this.updateOnlineBadges();
  }

  _cloneSeats() {
    return {
      t1: [...(this.seats.t1 || [null, null, null])],
      t2: [...(this.seats.t2 || [null, null, null])],
      t2Peer: this.seats.t2Peer || null
    };
  }

  _removePeerFromSeats(peerId) {
    if (!peerId || !this.seats) return;
    if (this.seats.t2Peer === peerId) this.seats.t2Peer = null;
    for (let s = 0; s < 3; s++) {
      if (this.seats.t1[s] === peerId) this.seats.t1[s] = null;
      if (this.seats.t2[s] === peerId) this.seats.t2[s] = null;
    }
  }

  _findSeatForPeer(peerId) {
    if (!peerId || !this.seats) return null;
    if (this.controlMode === '1v1') {
      if (peerId === 'host' || peerId === 'local') return { team: 1, slot: 2 };
      if (this.seats.t2Peer === peerId) return { team: 2, slot: 2 };
      return null;
    }
    for (let s = 0; s < 3; s++) {
      if (this.controlMode === '2v2' && s === 0) continue;
      if (this.seats.t1[s] === peerId) return { team: 1, slot: s };
      if (this.seats.t2[s] === peerId) return { team: 2, slot: s };
    }
    return null;
  }

  _syncMySeatFromSeats() {
    const mine = this._findSeatForPeer(this.myPeerId);
    if (mine) {
      this.localTeam = mine.team;
      this.localSlot = mine.slot;
    } else if (this.gameMode === 'online' && !this.isHost) {
      this.localTeam = 2;
      this.localSlot = 2;
    } else {
      this.localTeam = 1;
      this.localSlot = 2;
    }
  }

  assignDefaultSeats(preserveConnectedPeers = false) {
    const existingPeers = (preserveConnectedPeers && this.gameMode === 'online' && this.isHost && this.net && this.net.conns)
      ? Array.from(this.net.conns.keys())
      : [];

    if (this.gameMode === 'cpu') {
      this.controlMode = '1v1';
      this.localTeam = 1;
      this.localSlot = 2;
      this.seats = { t1: ['local', 'local', 'local'], t2: [null, null, null], t2Peer: null };
      return;
    }

    // Modalità Online (Host)
    this.seats = { t1: [null, null, null], t2: [null, null, null], t2Peer: null };
    if (this.controlMode === '1v1') {
      this.seats.t1 = ['host', 'host', 'host'];
      this.localTeam = 1;
      this.localSlot = 2;
      existingPeers.forEach((pid, idx) => {
        if (idx === 0) {
          this.seats.t2Peer = pid;
          this.seats.t2 = [pid, pid, pid];
        } else if (this.net) {
          this.net.sendTo(pid, { type: 'room_full', controlMode: '1v1', maxHumans: 2 });
        }
      });
    } else {
      this.seats.t1[2] = 'host';
      this.localTeam = 1;
      this.localSlot = 2;
      existingPeers.forEach(pid => {
        const assigned = this._autoAssignPeer(pid);
        if (!assigned && this.net) {
          this.net.sendTo(pid, {
            type: 'room_full',
            controlMode: this.controlMode,
            maxHumans: MODE_MAX_HUMANS[this.controlMode] || 4
          });
        }
      });
    }
  }

  _autoAssignPeer(peerId) {
    const existing = this._findSeatForPeer(peerId);
    if (existing) return existing;

    if (this.controlMode === '1v1') {
      if (this.seats.t2Peer && this.seats.t2Peer !== peerId) return null;
      this.seats.t2Peer = peerId;
      this.seats.t2 = [peerId, peerId, peerId];
      return { team: 2, slot: 2 };
    }

    const order = (this.controlMode === '2v2')
      ? [[2, 2], [1, 1], [2, 1], [1, 2]]
      : [[2, 2], [1, 1], [2, 1], [1, 0], [2, 0], [1, 2]];

    for (const [team, slot] of order) {
      const arr = (team === 1) ? this.seats.t1 : this.seats.t2;
      if (!arr[slot]) {
        arr[slot] = peerId;
        return { team, slot };
      }
    }
    return null;
  }

  _tryClaimSeat(peerId, team, slot) {
    if (this.controlMode === '1v1') {
      return { ok: false, reason: 'In 1v1 ogni giocatore comanda tutta la propria squadra.' };
    }
    if (this.controlMode === '2v2' && slot === 0) {
      return { ok: false, reason: '🧤 In 2v2 il Portiere è sempre controllato dalla CPU!' };
    }
    if ((team !== 1 && team !== 2) || slot < 0 || slot > 2) {
      return { ok: false, reason: 'Posto non valido.' };
    }
    const targetArr = (team === 1) ? this.seats.t1 : this.seats.t2;
    if (targetArr[slot] === peerId) return { ok: true };
    if (targetArr[slot]) {
      return { ok: false, reason: 'Questo ruolo è già occupato da un altro giocatore!' };
    }
    this._removePeerFromSeats(peerId);
    targetArr[slot] = peerId;
    if (peerId === this.myPeerId) {
      this.localTeam = team;
      this.localSlot = slot;
    }
    return { ok: true };
  }

  _getHumanCount() {
    if (this.gameMode === 'cpu') return 1;
    if (this.controlMode === '1v1') return this.seats.t2Peer ? 2 : 1;
    const unique = new Set();
    [...this.seats.t1, ...this.seats.t2].forEach(v => { if (v) unique.add(v); });
    return Math.max(1, unique.size);
  }

  updateOnlineBadges() {
    const maxHumans = MODE_MAX_HUMANS[this.controlMode] || 2;
    const count = this._getHumanCount();
    const badge = document.getElementById('online-players-badge');
    if (badge) {
      badge.innerText = `👥 Giocatori: ${count}/${maxHumans} (${this.controlMode})`;
    }
    const waitStatus = document.getElementById('host-waiting-status');
    if (waitStatus) {
      waitStatus.innerText = count <= 1
        ? `⏳ In attesa che il tuo amico si unisca (${count}/${maxHumans})...`
        : `✅ ${count}/${maxHumans} giocatori in stanza!`;
    }
  }

  setControlMode(mode, notify = true) {
    if (!MODE_HINTS[mode]) return;
    this.onlineControlMode = mode;
    this.controlMode = mode;
    if (this.gameMode === 'online' && this.isHost) {
      this.assignDefaultSeats(true);
    }
    this._syncModePillsUI();
    this.updateDraftSubtitle();
    this.updateDraftSlots();
    if (notify && this.gameMode === 'online' && this.isHost && this.net && this.net.connected) {
      this.broadcastLobbyState();
    }
  }

  broadcastLobbyState() {
    if (!this.isHost || !this.net || !this.net.connected) return;
    this.net.send({
      type: 'lobby_state',
      controlMode: this.controlMode,
      team1: [...this.team1Picked],
      team2: [...this.team2Picked],
      seats: this._cloneSeats()
    });
  }

  openOnlineModal() {
    this.controlMode = this.onlineControlMode;
    this.resetOnlineLobbyUI();
    this._syncModePillsUI();
    const waitBox = document.getElementById('host-waiting-box');
    if (waitBox) waitBox.style.display = 'none';
    this.menuScreen.classList.add('hidden');
    this.onlineScreen.classList.remove('hidden');
  }

  resetOnlineLobbyUI() {
    const createBtn = document.getElementById('btn-create-room');
    const joinBtn = document.getElementById('btn-join-room');
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.innerText = '➕ Crea Stanza Online';
    }
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.innerText = '🔗 Unisciti';
    }
  }

  startHosting() {
    const createBtn = document.getElementById('btn-create-room');
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.innerText = '⏳ Creazione stanza...';
    }
    if (this.net) {
      this.net.disconnect();
      this.net = null;
    }

    this.gameMode = 'online';
    this.controlMode = this.onlineControlMode || '1v1';
    this.isHost = true;
    this.myPeerId = 'host';
    if (this.team1Picked.length !== 3) this.team1Picked = ['ento', 'lindi', 'bubi'];
    if (this.team2Picked.length !== 3) this.team2Picked = ['pibe', 'matti', 'jelmo'];
    this.assignDefaultSeats(false);

    this.net = new NetworkManager({
      onHostReady: (roomId) => {
        const fullUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
        this.hostRoomCodeEl.innerText = roomId;
        this.roomShareUrl.innerText = fullUrl;
        document.getElementById('host-waiting-box').style.display = 'block';
        if (createBtn) {
          createBtn.disabled = false;
          createBtn.innerText = '🔄 Rigenera Codice';
        }
        this._syncModePillsUI();
        this.updateOnlineBadges();
        this.showToast(`Stanza ${this.controlMode} creata! Invia il link o codice agli amici`);
      },
      onPeerConnect: (peerId) => {
        const seat = this._autoAssignPeer(peerId);
        if (!seat) {
          this.net.sendTo(peerId, {
            type: 'room_full',
            controlMode: this.controlMode,
            maxHumans: MODE_MAX_HUMANS[this.controlMode] || 2
          });
          this.showToast(`Accesso rifiutato: stanza ${this.controlMode} già al completo.`);
          return;
        }

        const matchActive = Boolean(
          this.game &&
          !this.game.isDestroyed &&
          this.draftScreen.classList.contains('hidden')
        );

        this.net.sendTo(peerId, {
          type: 'welcome',
          peerId,
          controlMode: this.controlMode,
          team1: [...this.team1Picked],
          team2: [...this.team2Picked],
          seats: this._cloneSeats(),
          matchActive
        });

        if (matchActive) {
          this.game.seats = this._cloneSeats();
          this.game.sendNetworkState();
        } else if (this.draftScreen.classList.contains('hidden')) {
          this.resetOnlineLobbyUI();
          this.onlineScreen.classList.add('hidden');
          this.openDraft(false);
        }

        this.broadcastLobbyState();
        this.updateOnlineBadges();
        this.updateDraftSlots();

        const roleMeta = SLOT_ROLES[seat.slot] || SLOT_ROLES[2];
        const teamName = seat.team === 1 ? 'Rossi' : 'Blu';
        const msg = (this.controlMode === '1v1')
          ? 'Amico connesso! Inizia la selezione squadra'
          : `Amico connesso (${teamName} · ${roleMeta.icon} ${roleMeta.label})!`;
        this.showToast(msg);
      },
      onPeerDisconnect: (peerId) => {
        this._removePeerFromSeats(peerId);
        if (this.game && !this.game.isDestroyed) {
          this.game.releasePeer(peerId);
          this.game.seats = this._cloneSeats();
        }
        this.broadcastLobbyState();
        this.updateOnlineBadges();
        this.updateDraftSlots();
        this.showToast("⚠️ Un giocatore si è disconnesso (passato alla CPU).");
      },
      onPeerNegotiationFailed: (peerId, err) => {
        const msg = err && err.message ? err.message : 'Connessione P2P diretta fallita con un amico.';
        this._openTurnSettingsIfUnconfigured();
        this.showToast(`⚠️ ${msg}`);
      },
      onData: (data, peerId) => this.handleNetworkData(data, peerId),
      onDisconnect: () => {
        this.resetOnlineLobbyUI();
        this.showToast("⚠️ Connessione persa.");
      },
      onError: (err) => {
        this.resetOnlineLobbyUI();
        const waitBox = document.getElementById('host-waiting-box');
        if (waitBox && !this.net?.connected) waitBox.style.display = 'none';
        const msg = err && err.message ? err.message : 'connessione fallita';
        if (msg.includes('TURN') || msg.includes('NAT')) {
          this._openTurnSettingsIfUnconfigured();
        }
        this.showToast("Errore di rete: " + msg);
      }
    });

    this.net.hostGame().catch(() => {
      this.resetOnlineLobbyUI();
      const waitBox = document.getElementById('host-waiting-box');
      if (waitBox) waitBox.style.display = 'none';
    });
  }

  joinRoom() {
    const raw = this.joinRoomInput ? this.joinRoomInput.value.trim() : '';
    if (!raw) {
      this.showToast("Inserisci un codice stanza valido (es. MS-AB12) o il link!");
      return;
    }

    const joinBtn = document.getElementById('btn-join-room');
    if (joinBtn) {
      joinBtn.disabled = true;
      joinBtn.innerText = '⏳ Connessione...';
    }
    if (this.net) {
      this.net.disconnect();
      this.net = null;
    }

    this.net = new NetworkManager({
      onConnect: (isHost, myId) => {
        this.gameMode = 'online';
        this.isHost = false;
        this.myPeerId = myId || 'guest';
        this.showToast("Connesso! Sincronizzazione stanza...");
      },
      onData: (data, peerId) => this.handleNetworkData(data, peerId),
      onDisconnect: () => {
        this.resetOnlineLobbyUI();
        this.showToast("⚠️ Connessione con l'Host interrotta.");
      },
      onError: (err) => {
        this.resetOnlineLobbyUI();
        const msg = err && err.message ? err.message : 'riprova';
        if (msg.includes('TURN') || msg.includes('NAT')) {
          this._openTurnSettingsIfUnconfigured();
        }
        this.showToast("Impossibile connettersi: " + msg);
      }
    });

    this.net.joinGame(raw).catch(() => {
      this.resetOnlineLobbyUI();
    });
  }

  copyRoomLink() {
    const url = this.roomShareUrl ? this.roomShareUrl.innerText : '';
    if (!url || url.includes('Generazione')) {
      this.showToast("Crea prima una stanza per ottenere il link!");
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast("Link partita copiato negli appunti!");
      }).catch(() => {
        prompt("Copia questo link e invialo al tuo amico:", url);
      });
    } else {
      prompt("Copia questo link e invialo al tuo amico:", url);
    }
  }

  handleNetworkData(data, peerId = 'guest') {
    if (!data || !data.type) return;

    if (data.type === 'welcome') {
      this.myPeerId = data.peerId || this.myPeerId;
      if (data.controlMode) {
        this.controlMode = data.controlMode;
        this.onlineControlMode = data.controlMode;
      }
      if (Array.isArray(data.team1) && data.team1.length === 3) this.team1Picked = [...data.team1];
      if (Array.isArray(data.team2) && data.team2.length === 3) this.team2Picked = [...data.team2];
      if (data.seats) this.seats = data.seats;
      this._syncMySeatFromSeats();
      this._syncModePillsUI();
      this.resetOnlineLobbyUI();
      this.onlineScreen.classList.add('hidden');
      if (data.matchActive) {
        this.startMatch(false);
        this.showToast("Sei entrato nella partita in corso!");
      } else {
        this.openDraft(false);
      }
    } else if (data.type === 'room_full') {
      this.resetOnlineLobbyUI();
      if (this.net) {
        this.net.disconnect();
        this.net = null;
      }
      this.showToast(`Stanza piena (${data.controlMode || ''} · max ${data.maxHumans || 2} giocatori).`);
    } else if (data.type === 'lobby_state') {
      if (data.controlMode) {
        this.controlMode = data.controlMode;
        this.onlineControlMode = data.controlMode;
      }
      if (Array.isArray(data.team1) && data.team1.length === 3) this.team1Picked = [...data.team1];
      if (Array.isArray(data.team2) && data.team2.length === 3) this.team2Picked = [...data.team2];
      if (data.seats) this.seats = data.seats;
      this._syncMySeatFromSeats();
      this._syncModePillsUI();
      this.updateDraftSubtitle();
      this.updateDraftSlots();
      if (this.game && !this.game.isDestroyed && !this.isHost) {
        this.game.controlMode = this.controlMode;
        this.game.localTeam = this.localTeam;
        this.game.localSlot = this.localSlot;
        this.game.seats = this._cloneSeats();
      }
    } else if (data.type === 'claim_seat') {
      if (this.isHost) {
        const res = this._tryClaimSeat(peerId, data.team, data.slot);
        if (!res.ok) {
          this.net.sendTo(peerId, { type: 'seat_denied', reason: res.reason });
          return;
        }
        this.updateDraftSlots();
        this.updateOnlineBadges();
        this.broadcastLobbyState();
      }
    } else if (data.type === 'seat_denied') {
      this.showToast(data.reason || "Posto non disponibile!");
    } else if (data.type === 'pick_char') {
      if (this.isHost && getCharacterById(data.charId)) {
        const seat = this._findSeatForPeer(peerId);
        if (seat && this.controlMode !== '1v1') {
          this._assignCharToTeamSlot(seat.team, seat.slot, data.charId);
          this.updateDraftSlots();
          this.broadcastLobbyState();
        }
      }
    } else if (data.type === 'draft_sync') {
      if (Array.isArray(data.team1)) this.team1Picked = [...data.team1];
      if (Array.isArray(data.team2)) this.team2Picked = [...data.team2];
      this.updateDraftSlots();
    } else if (data.type === 'draft_team') {
      if (data.team === 1 && Array.isArray(data.picks)) {
        this.team1Picked = [...data.picks];
      } else if (data.team === 2 && Array.isArray(data.picks)) {
        this.team2Picked = [...data.picks];
      }
      this.updateDraftSlots();
    } else if (data.type === 'client_start_request') {
      if (this.isHost) {
        if (this.controlMode === '1v1' && Array.isArray(data.team2) && data.team2.length === 3) {
          this.team2Picked = [...data.team2];
        }
        this.startMatch(true);
      }
    } else if (data.type === 'start_match') {
      if (!this.isHost) {
        if (data.controlMode) {
          this.controlMode = data.controlMode;
          this.onlineControlMode = data.controlMode;
        }
        if (Array.isArray(data.team1) && data.team1.length === 3) this.team1Picked = [...data.team1];
        if (Array.isArray(data.team2) && data.team2.length === 3) this.team2Picked = [...data.team2];
        if (data.seats) this.seats = data.seats;
        this._syncMySeatFromSeats();
        this._syncModePillsUI();
        this.startMatch(false);
      }
    } else if (data.type === 'state') {
      if (this.game && !this.isHost) {
        this.game.applyNetworkState(data);
      }
    } else if (data.type === 'remote_input') {
      if (this.game && this.isHost) {
        this.game.setRemoteInput(data.input, peerId);
      }
    } else if (data.type === 'remote_action') {
      if (this.game && this.isHost) {
        this.game.handleRemoteAction(data, peerId);
      }
    } else if (data.type === 'game_event') {
      if (this.game && !this.isHost) {
        this.game.applyNetworkEvent(data);
      }
    } else if (data.type === 'pause_sync') {
      if (this.game && !this.isHost) {
        this.game.isPaused = !!data.paused;
        this._syncPauseOverlay(this.game.isPaused);
      }
    } else if (data.type === 'emote') {
      this.showToast("Amico: " + data.text);
      sounds.playBeep(900, 0.05);
    }
  }

  // Visualizzazione Griglia 12 Personaggi
  renderCharacterGrid() {
    const grid = document.getElementById('characters-grid');
    grid.innerHTML = '';

    CHARACTERS.forEach(char => {
      const card = document.createElement('div');
      card.className = 'char-card';
      if (char.id === 'ara') {
        card.classList.add('char-card-ara');
      }
      card.id = `char-card-${char.id}`;

      card.innerHTML = `
        <div class="char-top-row">
          ${char.avatar ? `<img src="${char.avatar}" class="char-card-avatar" alt="${char.name}">` : ''}
          <div style="flex: 1; min-width: 0;">
            <div class="char-card-header">
              <span class="char-name">${char.name}</span>
              <span class="char-nick">${char.nickname}</span>
            </div>
            <div class="char-special-badge" style="color: ${char.specialColor || '#ffd700'}; border-color: ${char.specialColor || '#ffd700'};">
              <span>${char.specialIcon || '⚡'}</span>
              <span>${char.special}</span>
            </div>
          </div>
        </div>
        <div class="char-desc">${char.desc}</div>
        <div class="stat-bars">
          <div class="stat-row">
            <span class="stat-label">VEL</span>
            <div class="stat-track"><div class="stat-fill" style="width: ${char.speed}%"></div></div>
            <span class="stat-val">${char.speed}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">TIRO</span>
            <div class="stat-track"><div class="stat-fill" style="width: ${char.shot}%; background: linear-gradient(90deg, #ff9900, #ff0055)"></div></div>
            <span class="stat-val">${char.shot}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">DIF</span>
            <div class="stat-track"><div class="stat-fill" style="width: ${char.tackle}%; background: linear-gradient(90deg, #00ffaa, #0088cc)"></div></div>
            <span class="stat-val">${char.tackle}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">PASS</span>
            <div class="stat-track"><div class="stat-fill" style="width: ${char.pass}%; background: linear-gradient(90deg, #ffee00, #ff8800)"></div></div>
            <span class="stat-val">${char.pass}</span>
          </div>
        </div>
      `;

      card.onclick = () => this.handleCharacterClick(char.id);
      grid.appendChild(card);
    });
  }

  openDraft(resetPicks = true) {
    this.menuScreen.classList.add('hidden');
    this.onlineScreen.classList.add('hidden');
    this.draftScreen.classList.remove('hidden');

    if (this.gameMode === 'cpu') {
      this.controlMode = '1v1';
    }

    // Default pre-selections (entrambe le parti hanno una base valida fin da subito)
    if (resetPicks) {
      if (this.gameMode === 'cpu' || this.isHost) {
        this.team1Picked = ['ento', 'lindi', 'bubi'];
        this.team2Picked = ['pibe', 'matti', 'jelmo'];
        this.assignDefaultSeats(true);
      }
    }
    if (this.team1Picked.length !== 3) this.team1Picked = ['ento', 'lindi', 'bubi'];
    if (this.team2Picked.length !== 3) this.team2Picked = ['pibe', 'matti', 'jelmo'];

    const draftRoomCtrl = document.getElementById('draft-room-controls');
    if (draftRoomCtrl) {
      draftRoomCtrl.classList.toggle('hidden', this.gameMode !== 'online');
    }

    this._syncModePillsUI();
    this.updateDraftSubtitle();
    this.updateDraftSlots();
  }

  updateDraftSubtitle() {
    const subtitleEl = document.getElementById('draft-role-subtitle');
    if (!subtitleEl) return;

    const roleMeta = SLOT_ROLES[this.localSlot] || SLOT_ROLES[2];
    const teamLabel = (this.localTeam === 1) ? 'SQUADRA 1 (ROSSI)' : 'SQUADRA 2 (BLU)';

    if (this.gameMode === 'online') {
      if (this.controlMode === '1v1') {
        subtitleEl.innerText = this.isHost
          ? '1v1 · SEI SQUADRA 1 (ROSSI — HOST)! Scegli i tuoi 3 giocatori e premi Scendi in Campo'
          : '1v1 · SEI SQUADRA 2 (BLU — OSPITE)! Scegli i tuoi 3 giocatori e premi Scendi in Campo';
      } else {
        subtitleEl.innerText = `${this.controlMode} · Sei ${teamLabel} (${roleMeta.icon} ${roleMeta.label}). Clicca un ruolo libero o scegli il tuo personaggio!`;
      }
    } else {
      subtitleEl.innerText = 'PARTITA vs CPU · Scegli i 3 giocatori della tua Squadra 1 (comandi tutta la squadra)';
    }
  }

  handleSlotClick(team, slot) {
    if (this.controlMode === '1v1') {
      if (this.gameMode === 'cpu' && team === 2) {
        this.showToast("In 1v1 comandi tutta la Squadra 1 (Rossi).");
      }
      return;
    }
    if (this.controlMode === '2v2' && slot === 0) {
      this.showToast("🧤 In 2v2 il Portiere è sempre controllato dalla CPU!");
      return;
    }

    sounds.playBeep(700, 0.04);
    if (this.gameMode === 'cpu') {
      if (team !== 1) {
        this.showToast("Contro la CPU scegli il tuo ruolo nella Squadra 1 (Rossi).");
        return;
      }
      this.localTeam = 1;
      this.localSlot = slot;
      this.seats = { t1: [null, null, null], t2: [null, null, null], t2Peer: null };
      this.seats.t1[slot] = 'local';
      this.updateDraftSubtitle();
      this.updateDraftSlots();
      return;
    }

    if (this.isHost) {
      const res = this._tryClaimSeat('host', team, slot);
      if (!res.ok) {
        this.showToast(res.reason);
        return;
      }
      this.updateDraftSubtitle();
      this.updateDraftSlots();
      this.updateOnlineBadges();
      this.broadcastLobbyState();
    } else if (this.net && this.net.connected) {
      this.net.send({ type: 'claim_seat', team, slot });
    }
  }

  _assignCharToTeamSlot(team, slot, charId) {
    const teamArray = (team === 1) ? this.team1Picked : this.team2Picked;
    while (teamArray.length < 3) {
      teamArray.push(CHARACTERS[teamArray.length].id);
    }
    const existingIdx = teamArray.indexOf(charId);
    if (existingIdx !== -1 && existingIdx !== slot) {
      teamArray[existingIdx] = teamArray[slot];
    }
    teamArray[slot] = charId;
  }

  handleCharacterClick(charId) {
    sounds.playBeep(650, 0.05);

    if (this.controlMode !== '1v1') {
      this._assignCharToTeamSlot(this.localTeam, this.localSlot, charId);
      this.updateDraftSlots();
      if (this.gameMode === 'online' && this.net && this.net.connected) {
        if (this.isHost) {
          this.broadcastLobbyState();
        } else {
          this.net.send({
            type: 'pick_char',
            team: this.localTeam,
            slot: this.localSlot,
            charId
          });
        }
      }
      return;
    }

    // Modalità 1v1: Online Client controlla Squadra 2; Host e CPU controllano Squadra 1
    const targetTeam = (this.gameMode === 'online' && !this.isHost) ? 2 : 1;
    const teamArray = (targetTeam === 1) ? this.team1Picked : this.team2Picked;

    const existingIdx = teamArray.indexOf(charId);
    if (existingIdx !== -1) {
      teamArray.splice(existingIdx, 1);
    } else {
      if (teamArray.length < 3) {
        teamArray.push(charId);
      } else {
        teamArray[2] = charId;
      }
    }

    this.updateDraftSlots();

    if (this.gameMode === 'online' && this.net && this.net.connected) {
      this.net.send({
        type: 'draft_team',
        team: targetTeam,
        picks: [...teamArray]
      });
    }
  }

  updateDraftSlots() {
    const renderTeamSlots = (teamNum, pickedArr, seatArr) => {
      for (let i = 0; i < 3; i++) {
        const slotEl = document.getElementById(`slot-t${teamNum}-${i}`);
        if (!slotEl) continue;

        const id = pickedArr[i];
        const char = id ? getCharacterById(id) : null;
        const roleMeta = SLOT_ROLES[i];
        const charName = char ? char.name : `Giocatore ${i + 1}`;

        if (this.controlMode === '1v1') {
          const isMyTeam = (this.gameMode === 'cpu') ? (teamNum === 1) : ((this.isHost && teamNum === 1) || (!this.isHost && teamNum === 2));
          const metaText = `${roleMeta.icon} ${roleMeta.label}${isMyTeam ? ' · TU' : (this.gameMode === 'cpu' ? ' · 🤖 CPU' : ' · 👤 AMICO')}`;
          slotEl.innerHTML = `<span class="slot-char-name">${charName}</span><span class="slot-meta">${metaText}</span>`;
          slotEl.className = `slot-item${char ? ' filled' : ''}${isMyTeam ? ' mine' : ''}`;
          continue;
        }

        if (this.controlMode === '2v2' && i === 0) {
          slotEl.innerHTML = `<span class="slot-char-name">${charName}</span><span class="slot-meta">🧤 POR · 🤖 CPU FISSA</span>`;
          slotEl.className = 'slot-item filled cpu-locked';
          continue;
        }

        const owner = Array.isArray(seatArr) ? seatArr[i] : null;
        const isMine = (this.gameMode === 'cpu')
          ? (teamNum === 1 && i === this.localSlot)
          : Boolean(owner && owner === this.myPeerId);
        const isOtherHuman = Boolean(owner) && !isMine;
        const canClick = (this.gameMode === 'online') ? (!owner && !isMine) : (teamNum === 1 && i !== this.localSlot);

        let metaText = `${roleMeta.icon} ${roleMeta.label}`;
        if (isMine) metaText += ' · 👑 TU';
        else if (isOtherHuman) metaText += ' · 👤 AMICO';
        else if (canClick) metaText += ' · 🤖 CPU (clicca)';
        else metaText += ' · 🤖 CPU';

        const classes = ['slot-item'];
        if (char) classes.push('filled');
        if (isMine) classes.push('mine');
        else if (isOtherHuman) classes.push('human-other');
        if (canClick) classes.push('clickable');

        slotEl.innerHTML = `<span class="slot-char-name">${charName}</span><span class="slot-meta">${metaText}</span>`;
        slotEl.className = classes.join(' ');
      }
    };

    renderTeamSlots(1, this.team1Picked, this.seats ? this.seats.t1 : null);
    renderTeamSlots(2, this.team2Picked, this.seats ? this.seats.t2 : null);

    // Aggiorna evidenziazione card
    CHARACTERS.forEach(char => {
      const card = document.getElementById(`char-card-${char.id}`);
      if (!card) return;
      card.classList.remove('selected-t1', 'selected-t2');
      if (this.team1Picked.includes(char.id)) card.classList.add('selected-t1');
      if (this.team2Picked.includes(char.id)) card.classList.add('selected-t2');
    });

    const isReady = (this.team1Picked.length === 3 && this.team2Picked.length === 3);
    const startBtn = document.getElementById('btn-start-match');
    startBtn.disabled = !isReady;
    startBtn.style.opacity = isReady ? '1' : '0.5';
  }

  requestStartMatch() {
    if (this.team1Picked.length < 3 || this.team2Picked.length < 3) {
      this.showToast("Seleziona 3 giocatori per entrambe le squadre prima di iniziare!");
      return;
    }

    if (this.gameMode === 'online' && !this.isHost) {
      if (this.net && this.net.connected) {
        this.net.send({
          type: 'client_start_request',
          team2: [...this.team2Picked]
        });
        this.showToast("Richiesta avvio inviata all'Host...");
      } else {
        this.showToast("Connessione con l'Host persa.");
      }
      return;
    }

    this.startMatch(true);
  }

  startMatch(notifyRemote = true) {
    if (this.team1Picked.length < 3 || this.team2Picked.length < 3) {
      this.showToast("Seleziona 3 giocatori per entrambe le squadre prima di iniziare!");
      return;
    }

    if (notifyRemote && this.gameMode === 'online' && this.isHost && this.net && this.net.connected) {
      this.net.send({
        type: 'start_match',
        controlMode: this.controlMode,
        team1: [...this.team1Picked],
        team2: [...this.team2Picked],
        seats: this._cloneSeats()
      });
    }

    // Pulizia ciclo e istanza precedente per rematch/restart puliti senza leak
    if (this.clientInputInterval) {
      clearInterval(this.clientInputInterval);
      this.clientInputInterval = null;
    }
    if (this.game && this.game.destroy) {
      this.game.destroy();
      this.game = null;
    }
    this._lastSentAxis = '';

    sounds.playWhistle(false);
    this.draftScreen.classList.add('hidden');
    if (this.gameOverScreen) this.gameOverScreen.classList.add('hidden');
    if (this.pauseModal) this.pauseModal.classList.add('hidden');
    if (this.goalBanner) this.goalBanner.classList.remove('active');
    this.inGameHud.style.display = 'flex';

    // Rimuovi canvas precedente se presente
    this.canvasContainer.innerHTML = '';

    // Avvia Motore 2.5D con modalità di controllo (1v1 / 2v2 / 3v3) e seggi
    this.game = new FootballGame(this.canvasContainer, {
      team1: this.team1Picked,
      team2: this.team2Picked,
      controlMode: this.controlMode,
      localTeam: this.localTeam,
      localSlot: this.localSlot,
      seats: this._cloneSeats(),
      isSinglePlayer: (this.gameMode === 'cpu'),
      isHost: (this.gameMode === 'online' && this.isHost),
      isClient: (this.gameMode === 'online' && !this.isHost),
      networkManager: this.net,
      onTogglePause: () => this.togglePause(),
      onSpecialTrigger: (data) => this.showSpecialCutin(data.charData),
      onToast: (msg) => this.showToast(msg),
      onGoal: (team, score, scorer, isSpecial) => this.handleGoal(team, score, scorer, isSpecial),
      onMatchEnd: (score) => this.handleMatchEnd(score),
      onUpdateHUD: (hudData) => this.updateHUD(hudData),
      onClientAction: (actionPayload) => {
        if (this.net && this.net.connected) {
          this.net.send({ type: 'remote_action', ...actionPayload });
        }
      },
      onGameEvent: (eventPayload) => {
        if (this.net && this.net.connected) {
          this.net.send({ type: 'game_event', ...eventPayload });
        }
      }
    });

    if (this.gameMode !== 'online' || this.isHost) {
      this.game.resetKickoff(1);
      if (this.gameMode === 'online' && this.isHost && this.net && this.net.connected) {
        this.game.sendNetworkState();
      }
    }

    // Se siamo client online, trasmetti movimento continuo (volatile 30Hz); le azioni partono via onClientAction
    if (this.gameMode === 'online' && !this.isHost && this.net) {
      this.clientInputInterval = setInterval(() => {
        if (!this.game || this.game.isDestroyed || !this.net || !this.net.connected) return;
        const inp = this.game.input;
        const moveX = Number((inp.moveX || 0).toFixed(2));
        const moveZ = Number((inp.moveZ || 0).toFixed(2));
        const sprint = !!inp.sprint;
        const sig = `${moveX}|${moveZ}|${sprint ? 1 : 0}`;
        if (sig !== this._lastSentAxis || moveX !== 0 || moveZ !== 0 || sprint) {
          this._lastSentAxis = sig;
          this.net.send({
            type: 'remote_input',
            input: { moveX, moveZ, sprint }
          }, true);
        }
      }, 33);
    }
  }

  // Mostra il Banner compatto Mario Strikers per la Super Abilità (non copre il campo)
  showSpecialCutin(charData) {
    const cutinEl = document.getElementById('special-cutin');
    if (!cutinEl || !charData) return;

    const avatarEl = document.getElementById('cutin-avatar');
    const nameEl = document.getElementById('cutin-char-name');
    const specialEl = document.getElementById('cutin-special-name');

    if (avatarEl) {
      avatarEl.src = charData.avatar || `assets/${charData.id}_avatar.png?v=3.3`;
    }
    if (nameEl) {
      nameEl.innerText = charData.name.toUpperCase();
    }
    if (specialEl) {
      const icon = charData.specialIcon || '⚡';
      specialEl.innerText = `${icon} ${charData.special.toUpperCase()}`;
      if (charData.specialColor) {
        specialEl.style.color = charData.specialColor;
      }
    }

    if (this._specialCutinTimeout) {
      clearTimeout(this._specialCutinTimeout);
    }

    cutinEl.classList.add('active');
    this._specialCutinTimeout = setTimeout(() => {
      cutinEl.classList.remove('active');
      this._specialCutinTimeout = null;
    }, 1400);
  }

  handleGoal(team, score, scorer, isSpecial) {
    const scorerName = scorer ? scorer.name.toUpperCase() : (team === 1 ? 'ROSSI' : 'BLU');
    const teamLabel = (team === 1) ? 'SQUADRA 1 (ROSSI)' : 'SQUADRA 2 (BLU)';

    const scorerNameEl = document.getElementById('goal-scorer-name');
    const scorerTeamEl = document.getElementById('goal-scorer-team');
    const scorerImgEl = document.getElementById('goal-scorer-img');
    const specialTagEl = document.getElementById('goal-special-tag');

    if (scorerNameEl) scorerNameEl.innerText = `${scorerName}!`;
    if (scorerTeamEl) scorerTeamEl.innerText = teamLabel;

    if (scorerImgEl) {
      const avatarUrl = (scorer && scorer.charData && scorer.charData.avatar) ? scorer.charData.avatar : (scorer && scorer.id === 'ara' ? 'assets/ara_avatar.png' : null);
      if (avatarUrl) {
        scorerImgEl.src = avatarUrl;
        scorerImgEl.style.display = 'block';
      } else {
        scorerImgEl.style.display = 'none';
      }
    }

    if (specialTagEl) {
      if (isSpecial && scorer && scorer.charData && scorer.charData.special) {
        specialTagEl.innerText = `⚡ SPECIAL: ${scorer.charData.special.toUpperCase()} ⚡`;
        specialTagEl.style.display = 'inline-block';
      } else {
        specialTagEl.style.display = 'none';
      }
    }

    this.goalBanner.classList.add('show');
    setTimeout(() => {
      this.goalBanner.classList.remove('show');
    }, 3200);
  }

  handleMatchEnd(score) {
    this.gameOverScreen.classList.remove('hidden');
    const resultTitle = document.getElementById('game-over-title');
    const finalScoreEl = document.getElementById('final-score');
    finalScoreEl.innerText = `${score[0]} - ${score[1]}`;

    if (score[0] > score[1]) {
      resultTitle.innerText = "VITTORIA SQUADRA ROSSA!";
      resultTitle.style.color = "#e74c3c";
    } else if (score[1] > score[0]) {
      resultTitle.innerText = "VITTORIA SQUADRA BLU!";
      resultTitle.style.color = "#2980b9";
    } else {
      resultTitle.innerText = "PAREGGIO COMBATTUTO!";
      resultTitle.style.color = "#ffd700";
    }
  }

  _syncPauseOverlay(isPaused) {
    if (!this.game) return;
    if (isPaused) {
      sounds.playBeep(480, 0.08);
      if (this.pauseScore1) this.pauseScore1.innerText = this.game.score[0];
      if (this.pauseScore2) this.pauseScore2.innerText = this.game.score[1];
      const t = Math.ceil(this.game.matchTime || 0);
      const mins = Math.floor(t / 60);
      const secs = (t % 60).toString().padStart(2, '0');
      if (this.pauseClock) this.pauseClock.innerText = `${mins}:${secs}`;
      if (this.pauseModal) this.pauseModal.classList.remove('hidden');
    } else {
      sounds.playBeep(650, 0.06);
      if (this.pauseModal) this.pauseModal.classList.add('hidden');
    }
  }

  togglePause() {
    if (!this.game) return;
    if (this.gameMode === 'online' && !this.isHost) {
      // Lato Client il pannello permette di uscire/riprendere senza bloccare la simulazione Host
      const currentlyHidden = this.pauseModal ? this.pauseModal.classList.contains('hidden') : true;
      this._syncPauseOverlay(currentlyHidden);
      return;
    }

    const isPaused = this.game.togglePause();
    this._syncPauseOverlay(isPaused);
    if (this.gameMode === 'online' && this.isHost && this.net && this.net.connected) {
      this.net.send({ type: 'pause_sync', paused: isPaused });
    }
  }

  updateHUD(hudData) {
    this.score1El.innerText = hudData.score[0];
    this.score2El.innerText = hudData.score[1];

    const mins = Math.floor(hudData.matchTime / 60);
    const secs = (hudData.matchTime % 60).toString().padStart(2, '0');
    this.matchClockEl.innerText = `${mins}:${secs}`;

    // Super Gauge HUD (segue la squadra effettiva dell'utente anche se co-op su Squadra 1)
    const myTeam = hudData.localTeam || this.localTeam || 1;
    const myTeamMeter = (myTeam === 2) ? hudData.specialMeter2 : hudData.specialMeter1;
    const specialFill = document.getElementById('special-fill');
    const specialVal = document.getElementById('special-val');
    const specialContainer = document.getElementById('special-meter-container');
    const touchSpecialBtn = document.getElementById('touch-special');

    if (specialFill && myTeamMeter !== undefined) {
      specialFill.style.width = `${myTeamMeter}%`;
    }
    if (specialVal && myTeamMeter !== undefined) {
      specialVal.innerText = `${myTeamMeter}%`;
    }
    if (specialContainer) {
      specialContainer.classList.toggle('ready', myTeamMeter >= 100);
    }
    if (touchSpecialBtn) {
      touchSpecialBtn.classList.toggle('ready', myTeamMeter >= 100);
    }

    // Nascondi Cambio Giocatore in 2v2 / 3v3 (giocatore fisso!)
    const touchSwitchBtn = document.getElementById('touch-switch');
    if (touchSwitchBtn) {
      touchSwitchBtn.style.display = (hudData.controlMode && hudData.controlMode !== '1v1') ? 'none' : '';
    }

    // Aggiorna etichette dinamiche pulsanti touch Mario Strikers
    const isFixedMode = Boolean(hudData.controlMode && hudData.controlMode !== '1v1');
    const iHaveBall = isFixedMode ? Boolean(hudData.iHaveBall) : Boolean(hudData.hasBall);

    const touchPassBtn = document.getElementById('touch-pass');
    if (touchPassBtn) {
      const icon = touchPassBtn.querySelector('.btn-icon');
      const label = touchPassBtn.querySelector('.btn-label');
      if (icon && label) {
        if (iHaveBall) {
          icon.innerText = '👟';
          label.innerText = 'PASSA';
        } else if (isFixedMode && hudData.hasBall) {
          icon.innerText = '📣';
          label.innerText = 'CHIAMA';
        } else if (isFixedMode) {
          icon.innerText = '👟';
          label.innerText = 'PASSA';
        } else {
          icon.innerText = '🔄';
          label.innerText = 'CAMBIA';
        }
      }
    }

    const touchShootBtn = document.getElementById('touch-shoot');
    if (touchShootBtn) {
      const icon = touchShootBtn.querySelector('.btn-icon');
      const label = touchShootBtn.querySelector('.btn-label');
      if (icon && label) {
        if (iHaveBall) {
          icon.innerText = '⚽';
          label.innerText = 'TIRA';
        } else if (hudData.localRole === 'gk') {
          icon.innerText = '🧤';
          label.innerText = 'TUFFO';
        } else {
          icon.innerText = '⚡';
          label.innerText = 'SCIVOLA';
        }
      }
    }

    // Barra di caricamento tiro
    if (hudData.shotPower > 0.05) {
      this.shotPowerContainer.style.display = 'block';
      this.shotPowerBar.style.width = `${Math.min(100, hudData.shotPower * 100)}%`;
    } else {
      this.shotPowerContainer.style.display = 'none';
    }

    // Disegna radar minimappa
    this.drawRadar(hudData);
  }

  drawRadar(hudData) {
    if (!this.radarCtx) return;
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Campo
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.beginPath();
    ctx.moveTo(w / 2, 4);
    ctx.lineTo(w / 2, h - 4);
    ctx.stroke();

    // Mappatura coordinate 3D campo (-38..+38, -23..+23) a canvas 2D
    const toCanvasX = (fieldX) => ((fieldX + 38) / 76) * (w - 12) + 6;
    const toCanvasY = (fieldZ) => ((fieldZ + 23) / 46) * (h - 12) + 6;

    // Giocatori Team 1 (Rossi)
    ctx.fillStyle = '#e74c3c';
    hudData.p1.forEach(p => {
      ctx.beginPath();
      ctx.arc(toCanvasX(p.x), toCanvasY(p.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Giocatori Team 2 (Blu)
    ctx.fillStyle = '#2980b9';
    hudData.p2.forEach(p => {
      ctx.beginPath();
      ctx.arc(toCanvasX(p.x), toCanvasY(p.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Palla (Giallo brillante)
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(toCanvasX(hudData.ball.x), toCanvasY(hudData.ball.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Avvio automatico quando il DOM è pronto
window.addEventListener('DOMContentLoaded', () => {
  window.__msoccerApp = new App();
});
