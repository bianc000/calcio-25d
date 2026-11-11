// Inizializzazione Applicazione & Flusso UI
import { CHARACTERS, getCharacterById } from './characters.js?v=3.0';
import { FootballGame } from './game.js?v=3.0';
import { NetworkManager } from './network.js?v=3.0';
import { sounds } from './audio.js?v=3.0';

class App {
  constructor() {
    this.game = null;
    this.net = null;
    this.gameMode = 'cpu'; // 'cpu', 'online', 'local'
    this.isHost = true;
    this.team1Picked = [];
    this.team2Picked = [];
    this.currentDraftTeam = 1; // 1 o 2
    this.clientInputInterval = null;
    this._lastSentAxis = '';

    this.cacheDOMElements();
    this.bindEvents();
    
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

  showToast(msg) {
    if (!this.toastEl) return;
    this.toastEl.innerText = msg;
    this.toastEl.classList.add('show');
    setTimeout(() => this.toastEl.classList.remove('show'), 3000);
  }

  bindEvents() {
    // Menu
    document.getElementById('btn-play-cpu').onclick = () => {
      sounds.playBeep();
      this.gameMode = 'cpu';
      this.isHost = true;
      this.openDraft();
    };

    document.getElementById('btn-play-online').onclick = () => {
      sounds.playBeep();
      this.openOnlineModal();
    };

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
          if (this.game.userTeamHasBall()) {
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

  openOnlineModal() {
    this.resetOnlineLobbyUI();
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
        this.showToast("Stanza creata! Invia il link o codice all'amico");
      },
      onConnect: () => {
        this.showToast("Amico connesso! Inizia la selezione squadra");
        this.gameMode = 'online';
        this.isHost = true;
        this.resetOnlineLobbyUI();
        this.onlineScreen.classList.add('hidden');
        this.openDraft();
        if (this.net && this.net.connected) {
          this.net.send({
            type: 'draft_sync',
            team1: [...this.team1Picked],
            team2: [...this.team2Picked]
          });
        }
      },
      onData: (data) => this.handleNetworkData(data),
      onDisconnect: () => {
        this.resetOnlineLobbyUI();
        this.showToast("⚠️ Connessione con l'avversario interrotta.");
      },
      onError: (err) => {
        this.resetOnlineLobbyUI();
        this.showToast("Errore di rete: " + (err && err.message ? err.message : 'connessione fallita'));
      }
    });

    this.net.hostGame().catch(() => {
      this.resetOnlineLobbyUI();
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
      onConnect: () => {
        this.showToast("Connesso con successo alla stanza!");
        this.gameMode = 'online';
        this.isHost = false;
        this.resetOnlineLobbyUI();
        this.onlineScreen.classList.add('hidden');
        this.openDraft();
      },
      onData: (data) => this.handleNetworkData(data),
      onDisconnect: () => {
        this.resetOnlineLobbyUI();
        this.showToast("⚠️ Connessione con l'Host interrotta.");
      },
      onError: (err) => {
        this.resetOnlineLobbyUI();
        this.showToast("Impossibile connettersi: " + (err && err.message ? err.message : 'riprova'));
      }
    });

    this.net.joinGame(raw).catch(() => {
      this.resetOnlineLobbyUI();
    });
  }

  copyRoomLink() {
    const url = this.roomShareUrl.innerText;
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

  handleNetworkData(data) {
    if (!data || !data.type) return;

    if (data.type === 'draft_sync') {
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
    } else if (data.type === 'draft_update') {
      if (Array.isArray(data.team1) && data.team1.length > 0) this.team1Picked = [...data.team1];
      if (Array.isArray(data.team2) && data.team2.length > 0) this.team2Picked = [...data.team2];
      this.updateDraftSlots();
      if (data.readyToPlay) {
        this.startMatch(false);
      }
    } else if (data.type === 'client_start_request') {
      if (this.isHost) {
        if (Array.isArray(data.team2) && data.team2.length === 3) {
          this.team2Picked = [...data.team2];
        }
        this.startMatch(true);
      }
    } else if (data.type === 'start_match') {
      if (!this.isHost) {
        if (Array.isArray(data.team1) && data.team1.length === 3) this.team1Picked = [...data.team1];
        if (Array.isArray(data.team2) && data.team2.length === 3) this.team2Picked = [...data.team2];
        this.startMatch(false);
      }
    } else if (data.type === 'state') {
      if (this.game && !this.isHost) {
        this.game.applyNetworkState(data);
      }
    } else if (data.type === 'remote_input') {
      if (this.game && this.isHost) {
        this.game.setRemoteInput(data.input);
      }
    } else if (data.type === 'remote_action') {
      if (this.game && this.isHost) {
        this.game.handleRemoteAction(data);
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

  openDraft() {
    this.menuScreen.classList.add('hidden');
    this.onlineScreen.classList.add('hidden');
    this.draftScreen.classList.remove('hidden');

    // Default pre-selections (entrambe le parti hanno una base valida fin da subito)
    if (this.gameMode === 'cpu' || this.isHost) {
      this.team1Picked = ['ento', 'lindi', 'bubi'];
      this.team2Picked = ['pibe', 'matti', 'jelmo'];
    } else {
      if (this.team1Picked.length === 0) this.team1Picked = ['ento', 'lindi', 'bubi'];
      if (this.team2Picked.length === 0) this.team2Picked = ['pibe', 'matti', 'jelmo'];
    }

    const subtitleEl = document.getElementById('draft-role-subtitle');
    if (subtitleEl) {
      if (this.gameMode === 'online') {
        subtitleEl.innerText = this.isHost
          ? 'SEI SQUADRA 1 (ROSSI — HOST)! Scegli i tuoi 3 giocatori e premi Scendi in Campo'
          : 'SEI SQUADRA 2 (BLU — OSPITE)! Scegli i tuoi 3 giocatori e premi Scendi in Campo';
      } else {
        subtitleEl.innerText = 'Seleziona 3 compagni per la tua Squadra 1 e 3 avversari per la Squadra 2 (3 vs 3)';
      }
    }

    this.updateDraftSlots();
  }

  handleCharacterClick(charId) {
    sounds.playBeep(650, 0.05);

    // Online Client controlla Squadra 2; Host e CPU controllano Squadra 1
    const targetTeam = (this.gameMode === 'online' && !this.isHost) ? 2 : 1;
    const teamArray = (targetTeam === 1) ? this.team1Picked : this.team2Picked;

    const existingIdx = teamArray.indexOf(charId);
    if (existingIdx !== -1) {
      // Deseleziona
      teamArray.splice(existingIdx, 1);
    } else {
      if (teamArray.length < 3) {
        teamArray.push(charId);
      } else {
        // Sostituisce l'ultimo
        teamArray[2] = charId;
      }
    }

    this.updateDraftSlots();

    // Online: invia solo la squadra di competenza per evitare sovrascritture incrociate
    if (this.gameMode === 'online' && this.net && this.net.connected) {
      this.net.send({
        type: 'draft_team',
        team: targetTeam,
        picks: [...teamArray]
      });
    }
  }

  updateDraftSlots() {
    // Aggiorna slot Team 1
    for (let i = 0; i < 3; i++) {
      const slotEl = document.getElementById(`slot-t1-${i}`);
      const id = this.team1Picked[i];
      if (id) {
        const char = getCharacterById(id);
        slotEl.innerText = char.name;
        slotEl.className = 'slot-item filled';
      } else {
        slotEl.innerText = `Giocatore ${i + 1}`;
        slotEl.className = 'slot-item';
      }
    }

    // Aggiorna slot Team 2
    for (let i = 0; i < 3; i++) {
      const slotEl = document.getElementById(`slot-t2-${i}`);
      const id = this.team2Picked[i];
      if (id) {
        const char = getCharacterById(id);
        slotEl.innerText = char.name;
        slotEl.className = 'slot-item filled';
      } else {
        slotEl.innerText = `Giocatore ${i + 1}`;
        slotEl.className = 'slot-item';
      }
    }

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
        team1: [...this.team1Picked],
        team2: [...this.team2Picked]
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

    // Avvia Motore 2.5D
    this.game = new FootballGame(this.canvasContainer, {
      team1: this.team1Picked,
      team2: this.team2Picked,
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
      avatarEl.src = charData.avatar || `assets/${charData.id}_avatar.png?v=3.0`;
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

    // Super Gauge HUD
    const myTeamMeter = (this.gameMode === 'online' && !this.isHost) ? hudData.specialMeter2 : hudData.specialMeter1;
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

    // Aggiorna etichette dinamiche pulsanti touch Mario Strikers
    const touchPassBtn = document.getElementById('touch-pass');
    if (touchPassBtn) {
      const icon = touchPassBtn.querySelector('.btn-icon');
      const label = touchPassBtn.querySelector('.btn-label');
      if (icon && label) {
        if (hudData.hasBall) {
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
        if (hudData.hasBall) {
          icon.innerText = '⚽';
          label.innerText = 'TIRA';
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
