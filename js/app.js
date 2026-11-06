// Inizializzazione Applicazione & Flusso UI
import { CHARACTERS, getCharacterById } from './characters.js';
import { FootballGame } from './game.js';
import { NetworkManager } from './network.js';
import { sounds } from './audio.js';

class App {
  constructor() {
    this.game = null;
    this.net = null;
    this.gameMode = 'cpu'; // 'cpu', 'online', 'local'
    this.isHost = true;
    this.team1Picked = [];
    this.team2Picked = [];
    this.currentDraftTeam = 1; // 1 o 2

    this.cacheDOMElements();
    this.bindEvents();
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
    document.getElementById('btn-copy-link').onclick = () => this.copyRoomLink();
    document.getElementById('btn-back-menu').onclick = () => {
      sounds.playBeep();
      this.onlineScreen.classList.add('hidden');
      this.menuScreen.classList.remove('hidden');
    };

    // Draft
    document.getElementById('btn-start-match').onclick = () => this.startMatch();

    // Game Over
    document.getElementById('btn-rematch').onclick = () => {
      sounds.playBeep();
      this.gameOverScreen.classList.add('hidden');
      this.startMatch();
    };
    document.getElementById('btn-menu-exit').onclick = () => {
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
    const stickZone = document.getElementById('touch-stick');
    const stickKnob = document.getElementById('touch-knob');
    if (!stickZone || !stickKnob) return;

    let touchOrigin = null;
    const maxRadius = 38;

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

      this.game.input.moveX = knobX / maxRadius;
      this.game.input.moveZ = knobY / maxRadius;
    };

    const handleTouchEnd = () => {
      touchOrigin = null;
      stickKnob.style.transform = `translate(0px, 0px)`;
      if (this.game) {
        this.game.input.moveX = 0;
        this.game.input.moveZ = 0;
      }
    };

    stickZone.addEventListener('touchstart', (e) => {
      const touch = e.changedTouches[0];
      const rect = stickZone.getBoundingClientRect();
      touchOrigin = {
        id: touch.identifier,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      handleTouchMove(e);
      e.preventDefault();
    }, { passive: false });

    stickZone.addEventListener('touchmove', (e) => {
      handleTouchMove(e);
      e.preventDefault();
    }, { passive: false });

    stickZone.addEventListener('touchend', handleTouchEnd);
    stickZone.addEventListener('touchcancel', handleTouchEnd);

    // Pulsanti Touch Passaggio, Tiro, Switch
    const btnPass = document.getElementById('touch-pass');
    const btnShoot = document.getElementById('touch-shoot');
    const btnSwitch = document.getElementById('touch-switch');

    if (btnPass) {
      btnPass.addEventListener('touchstart', (e) => {
        if (this.game) this.game.input.passTrigger = true;
        sounds.playBeep(700, 0.04);
        e.preventDefault();
      }, { passive: false });
    }

    if (btnShoot) {
      btnShoot.addEventListener('touchstart', (e) => {
        if (this.game) {
          const myTeam = this.isHost ? this.game.playersTeam1 : this.game.playersTeam2;
          const activeIdx = this.isHost ? this.game.activePlayerIdx1 : this.game.activePlayerIdx2;
          if (this.game.ball.holder === myTeam[activeIdx]) {
            this.game.input.isChargingShot = true;
          } else {
            this.game.input.slideTrigger = true;
          }
        }
        e.preventDefault();
      }, { passive: false });

      btnShoot.addEventListener('touchend', (e) => {
        if (this.game && this.game.input.isChargingShot) {
          this.game.input.isChargingShot = false;
          this.game.input.shootTrigger = true;
        }
        e.preventDefault();
      }, { passive: false });
    }

    if (btnSwitch) {
      btnSwitch.addEventListener('touchstart', (e) => {
        if (this.game) this.game.input.switchTrigger = true;
        e.preventDefault();
      }, { passive: false });
    }
  }

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      this.gameMode = 'online';
      this.isHost = false;
      this.joinRoomInput.value = room.toUpperCase();
      this.openOnlineModal();
      this.showToast("Stanza rilevata dal link! Clicca 'Unisciti'");
    }
  }

  openOnlineModal() {
    this.menuScreen.classList.add('hidden');
    this.onlineScreen.classList.remove('hidden');
  }

  startHosting() {
    this.net = new NetworkManager({
      onHostReady: (roomId) => {
        const fullUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
        this.hostRoomCodeEl.innerText = roomId;
        this.roomShareUrl.innerText = fullUrl;
        document.getElementById('host-waiting-box').style.display = 'block';
        this.showToast("Stanza creata! Invia il link o codice all'amico");
      },
      onConnect: () => {
        this.showToast("Amico connesso! Inizia la selezione squadra");
        this.gameMode = 'online';
        this.isHost = true;
        this.onlineScreen.classList.add('hidden');
        this.openDraft();
      },
      onData: (data) => this.handleNetworkData(data),
      onError: (err) => this.showToast("Errore di rete: " + err.message)
    });

    this.net.hostGame();
  }

  joinRoom() {
    const code = this.joinRoomInput.value.trim().toUpperCase();
    if (!code) {
      alert("Inserisci un codice stanza valido!");
      return;
    }

    this.net = new NetworkManager({
      onConnect: () => {
        this.showToast("Connesso con successo alla stanza!");
        this.gameMode = 'online';
        this.isHost = false;
        this.onlineScreen.classList.add('hidden');
        this.openDraft();
      },
      onData: (data) => this.handleNetworkData(data),
      onError: (err) => this.showToast("Impossibile connettersi: " + err.message)
    });

    this.net.joinGame(code);
  }

  copyRoomLink() {
    const url = this.roomShareUrl.innerText;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast("Link partita copiato negli appunti!");
      });
    } else {
      prompt("Copia questo link e invialo al tuo amico:", url);
    }
  }

  handleNetworkData(data) {
    if (data.type === 'draft_update') {
      this.team1Picked = data.team1;
      this.team2Picked = data.team2;
      this.updateDraftSlots();
      if (data.readyToPlay) {
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
      card.id = `char-card-${char.id}`;

      card.innerHTML = `
        <div class="char-card-header">
          <span class="char-name">${char.name}</span>
          <span class="char-nick">${char.nickname}</span>
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
    this.draftScreen.classList.remove('hidden');

    // Default pre-selections
    if (this.gameMode === 'cpu') {
      this.team1Picked = ['ento', 'lindi', 'bubi'];
      this.team2Picked = ['pibe', 'matti', 'jelmo'];
    } else {
      if (this.isHost) {
        this.team1Picked = ['ento', 'lindi', 'bubi'];
        this.team2Picked = ['pibe', 'matti', 'jelmo'];
      }
    }

    this.updateDraftSlots();
  }

  handleCharacterClick(charId) {
    sounds.playBeep(650, 0.05);

    // Se giochiamo online da client, decidiamo la Squadra 2
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

    // Se online, sincronizza con l'altro peer
    if (this.net && this.net.connected) {
      this.net.send({
        type: 'draft_update',
        team1: this.team1Picked,
        team2: this.team2Picked,
        readyToPlay: false
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

  startMatch(notifyRemote = true) {
    if (this.team1Picked.length < 3 || this.team2Picked.length < 3) {
      alert("Seleziona 3 giocatori per entrambe le squadre prima di scendere in campo!");
      return;
    }

    if (notifyRemote && this.net && this.net.connected) {
      this.net.send({
        type: 'draft_update',
        team1: this.team1Picked,
        team2: this.team2Picked,
        readyToPlay: true
      });
    }

    sounds.playWhistle(false);
    this.draftScreen.classList.add('hidden');
    this.inGameHud.style.display = 'flex';

    // Rimuovi canvas precedente se presente
    this.canvasContainer.innerHTML = '';

    // Avvia Motore 2.5D
    this.game = new FootballGame(this.canvasContainer, {
      team1: this.team1Picked,
      team2: this.team2Picked,
      isSinglePlayer: (this.gameMode === 'cpu'),
      isHost: this.isHost,
      isClient: (this.gameMode === 'online' && !this.isHost),
      networkManager: this.net,
      onGoal: (team, score) => this.handleGoal(team, score),
      onMatchEnd: (score) => this.handleMatchEnd(score),
      onUpdateHUD: (hudData) => this.updateHUD(hudData)
    });

    this.game.resetKickoff(1);

    // Se siamo client online, trasmetti gli input con tick rate di 40 Hz
    if (this.gameMode === 'online' && !this.isHost && this.net) {
      setInterval(() => {
        if (this.game && this.net.connected) {
          this.net.send({
            type: 'remote_input',
            input: this.game.input
          });
        }
      }, 25);
    }
  }

  handleGoal(team, score) {
    const teamName = (team === 1) ? "SQUADRA ROSSA" : "SQUADRA BLU";
    this.goalBanner.innerText = `GOOOOL!\n${teamName}`;
    this.goalBanner.classList.add('show');
    setTimeout(() => {
      this.goalBanner.classList.remove('show');
    }, 3000);
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

  updateHUD(hudData) {
    this.score1El.innerText = hudData.score[0];
    this.score2El.innerText = hudData.score[1];

    const mins = Math.floor(hudData.matchTime / 60);
    const secs = (hudData.matchTime % 60).toString().padStart(2, '0');
    this.matchClockEl.innerText = `${mins}:${secs}`;

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
  new App();
});
