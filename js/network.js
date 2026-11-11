// Modulo di Rete P2P WebRTC (Star Topology fino a 6 giocatori con PeerJS)
const TURN_STORAGE_KEY = 'msoccer_turn_config';

export class NetworkManager {
  constructor(callbacks = {}) {
    this.peer = null;
    this.conn = null;         // Usato dal Client (connessione verso Host)
    this.conns = new Map();   // Usato dall'Host: peerId -> DataConnection
    this.isHost = false;
    this.roomId = null;
    this.callbacks = callbacks;
    this.connected = false;
    this._connectTimeout = null;
    this._retryTimer = null;
    this._baseStunServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ];
  }

  static getTurnConfig() {
    try {
      const raw = localStorage.getItem(TURN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  static saveTurnConfig(cfg) {
    try {
      if (!cfg || !cfg.url) {
        localStorage.removeItem(TURN_STORAGE_KEY);
        return;
      }
      localStorage.setItem(TURN_STORAGE_KEY, JSON.stringify({
        url: String(cfg.url || '').trim(),
        user: String(cfg.user || '').trim(),
        pass: String(cfg.pass || '').trim()
      }));
    } catch (_) {}
  }

  // Genera un ID stanza corto e amichevole
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'MS-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Normalizza codice stanza o link completo incollato dall'utente
  normalizeRoomCode(rawInput) {
    let val = (rawInput || '').trim();
    if (!val) return '';

    const roomMatch = val.match(/[?&]room=([A-Za-z0-9_-]+)/i);
    if (roomMatch && roomMatch[1]) {
      val = roomMatch[1];
    }

    val = val.toUpperCase().replace(/\s+/g, '');
    if (/^[A-Z0-9]{4}$/.test(val)) {
      val = `MS-${val}`;
    }
    return val;
  }

  async _resolveIceServers() {
    const servers = [...this._baseStunServers];
    const cfg = NetworkManager.getTurnConfig();
    if (!cfg || !cfg.url) return servers;

    // Supporto opzionale API dinamica Metered.live
    if (cfg.url.includes('.metered.live') && cfg.pass) {
      try {
        const cleanDomain = cfg.url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3500);
        const resp = await fetch(
          `https://${cleanDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(cfg.pass)}`,
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (resp.ok) {
          const list = await resp.json();
          if (Array.isArray(list) && list.length > 0) {
            return [...servers, ...list];
          }
        }
      } catch (e) {
        console.warn('[Network] Impossibile recuperare credenziali Metered TURN, uso STUN:', e);
      }
      return servers;
    }

    // Configurazione manuale turn: / turns:
    let urls = cfg.url;
    if (!/^turns?:/i.test(urls) && !/^stuns?:/i.test(urls)) {
      urls = `turn:${urls}`;
    }
    const entry = { urls };
    if (cfg.user) entry.username = cfg.user;
    if (cfg.pass) entry.credential = cfg.pass;
    servers.push(entry);
    return servers;
  }

  _clearConnectTimeout() {
    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  getConnectedPeerCount() {
    if (this.isHost) {
      let count = 0;
      this.conns.forEach(c => {
        if (c && c.open) count++;
      });
      return count;
    }
    return (this.conn && this.conn.open) ? 1 : 0;
  }

  // Inizializza come Host (accetta fino a 5 ospiti contemporaneamente per 1v1, 2v2 o 3v3)
  async hostGame(customCode = null) {
    this.disconnect();
    if (!window.Peer) {
      const err = new Error('Libreria PeerJS non caricata. Ricarica la pagina.');
      if (this.callbacks.onError) this.callbacks.onError(err);
      throw err;
    }

    const iceServers = await this._resolveIceServers();

    return new Promise((resolve, reject) => {
      this.isHost = true;
      const code = this.normalizeRoomCode(customCode) || this.generateRoomCode();
      this.roomId = code;

      try {
        this.peer = new window.Peer(code, {
          debug: 1,
          config: {
            iceCandidatePoolSize: 10,
            iceServers
          }
        });

        this.peer.on('open', (id) => {
          this.roomId = id;
          if (this.callbacks.onHostReady) this.callbacks.onHostReady(id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          const prev = this.conns.get(conn.peer);
          if (prev && prev !== conn) {
            try { prev.close(); } catch (_) {}
          }
          this.conns.set(conn.peer, conn);
          this._setupPeerConnection(conn);
        });

        // Mantiene attiva la segnalazione PeerJS finché la stanza esiste (per far entrare gli altri amici)
        this.peer.on('disconnected', () => {
          if (this.peer && !this.peer.destroyed) {
            try { this.peer.reconnect(); } catch (_) {}
          }
        });

        this.peer.on('error', (err) => {
          console.error('Peer host error:', err);
          if (err.type === 'unavailable-id') {
            this.hostGame(this.generateRoomCode()).then(resolve).catch(reject);
          } else {
            if (this.callbacks.onError) this.callbacks.onError(err);
            reject(err);
          }
        });
      } catch (err) {
        if (this.callbacks.onError) this.callbacks.onError(err);
        reject(err);
      }
    });
  }

  // Connettiti a una stanza esistente come Guest
  async joinGame(roomCode) {
    this.disconnect();
    if (!window.Peer) {
      const err = new Error('Libreria PeerJS non caricata. Ricarica la pagina.');
      if (this.callbacks.onError) this.callbacks.onError(err);
      throw err;
    }

    const targetId = this.normalizeRoomCode(roomCode);
    if (!targetId) {
      const err = new Error('Codice stanza non valido.');
      if (this.callbacks.onError) this.callbacks.onError(err);
      throw err;
    }

    const iceServers = await this._resolveIceServers();

    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.roomId = targetId;

      try {
        this.peer = new window.Peer({
          debug: 1,
          config: {
            iceCandidatePoolSize: 10,
            iceServers
          }
        });

        let settled = false;

        this._connectTimeout = setTimeout(() => {
          if (!this.connected && !settled) {
            settled = true;
            const timeoutErr = new Error(
              `Impossibile raggiungere ${targetId}. Se siete su reti 4G/Wi-Fi bloccate, configura un relay TURN nelle impostazioni.`
            );
            if (this.callbacks.onError) this.callbacks.onError(timeoutErr);
            this.disconnect();
            reject(timeoutErr);
          }
        }, 18000);

        const attemptConnect = (attemptNum) => {
          if (!this.peer || this.peer.destroyed || settled || this.connected) return;
          if (this.conn && !this.conn.open) {
            const staleConn = this.conn;
            this.conn = null;
            try { staleConn.close(); } catch (_) {}
          }
          this.conn = this.peer.connect(targetId, {
            reliable: true,
            serialization: 'json'
          });
          this._setupPeerConnection(this.conn, () => {
            if (!settled) {
              settled = true;
              resolve(targetId);
            }
          });
          if (attemptNum === 1) {
            this._retryTimer = setTimeout(() => {
              if (!this.connected && !settled && this.peer && !this.peer.destroyed) {
                attemptConnect(2);
              }
            }, 6500);
          }
        };

        this.peer.on('open', () => {
          attemptConnect(1);
        });

        this.peer.on('error', (err) => {
          console.error('Peer join error:', err);
          this._clearConnectTimeout();
          let msg = err.message || 'Errore di connessione P2P';
          if (err.type === 'peer-unavailable') {
            msg = `Stanza "${targetId}" non trovata! Assicurati che l'Host abbia la stanza aperta.`;
          }
          const friendlyErr = new Error(msg);
          if (this.callbacks.onError) this.callbacks.onError(friendlyErr);
          if (!settled) {
            settled = true;
            reject(friendlyErr);
          }
        });
      } catch (err) {
        this._clearConnectTimeout();
        if (this.callbacks.onError) this.callbacks.onError(err);
        reject(err);
      }
    });
  }

  // Configura listener per singola DataConnection (Host multi-client e Client singolo)
  _setupPeerConnection(activeConn, onOpenExtra = null) {
    if (!activeConn) return;
    const remotePeerId = activeConn.peer;
    let opened = false;
    let iceRetried = false;

    const isCurrentConn = () => (this.isHost
      ? this.conns.get(remotePeerId) === activeConn
      : this.conn === activeConn);

    const handleOpen = () => {
      if (opened || !isCurrentConn()) return;
      opened = true;
      this._clearConnectTimeout();
      this.connected = true;
      if (onOpenExtra) onOpenExtra();
      if (this.isHost && this.callbacks.onPeerConnect) {
        this.callbacks.onPeerConnect(remotePeerId, activeConn);
      }
      if (this.callbacks.onConnect) {
        const reportedId = this.isHost
          ? remotePeerId
          : (this.peer && this.peer.id ? this.peer.id : remotePeerId);
        this.callbacks.onConnect(this.isHost, reportedId);
      }
    };

    activeConn.on('open', handleOpen);
    if (activeConn.open) {
      handleOpen();
    }

    activeConn.on('data', (data) => {
      if (!isCurrentConn()) return;
      if (this.callbacks.onData) this.callbacks.onData(data, remotePeerId);
    });

    activeConn.on('close', () => {
      if (this.isHost) {
        if (this.conns.get(remotePeerId) === activeConn) {
          this.conns.delete(remotePeerId);
        }
        const remaining = this.getConnectedPeerCount();
        this.connected = remaining > 0;
        if (opened && this.callbacks.onPeerDisconnect) {
          this.callbacks.onPeerDisconnect(remotePeerId);
        }
        if (remaining === 0 && opened && this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect(remotePeerId);
        }
      } else if (this.conn === activeConn) {
        const wasConnected = this.connected;
        this.connected = false;
        this._clearConnectTimeout();
        if (wasConnected && this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect(remotePeerId);
        }
      }
    });

    activeConn.on('error', (err) => {
      if (!isCurrentConn()) return;
      console.error('Connection error:', remotePeerId, err);
      this._clearConnectTimeout();
      if (this.callbacks.onError) this.callbacks.onError(err);
    });

    const attachIceMonitor = () => {
      const pc = activeConn.peerConnection;
      if (!pc || pc.__msIceMonitored) return;
      pc.__msIceMonitored = true;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (!isCurrentConn()) return;
        const state = pc.iceConnectionState;
        if (state === 'failed') {
          if (!iceRetried && typeof pc.restartIce === 'function') {
            iceRetried = true;
            try { pc.restartIce(); } catch (_) {}
            return;
          }
          if (!opened) {
            this._clearConnectTimeout();
            const iceErr = new Error(
              'Connessione diretta bloccata da NAT/4G. Configura un relay TURN nelle impostazioni di rete.'
            );
            if (this.callbacks.onError) this.callbacks.onError(iceErr);
          }
        }
      });
    };

    attachIceMonitor();
    activeConn.on('iceStateChanged', attachIceMonitor);
  }

  // Invia dati a uno specifico peer (solo Host)
  sendTo(peerId, data, isVolatile = false) {
    const target = this.conns.get(peerId);
    this._sendOverConn(target, data, isVolatile);
  }

  _sendOverConn(target, data, isVolatile) {
    if (!target || !target.open) return;
    if (isVolatile && target.dataChannel && target.dataChannel.bufferedAmount > 65536) {
      return;
    }
    try {
      target.send(data);
    } catch (e) {
      console.warn('Invio pacchetto fallito:', e);
    }
  }

  // Invia dati: Host fa broadcast a tutti gli amici connessi; Client invia all'Host
  send(data, isVolatile = false) {
    if (this.isHost) {
      this.conns.forEach((conn) => this._sendOverConn(conn, data, isVolatile));
    } else {
      this._sendOverConn(this.conn, data, isVolatile);
    }
  }

  // Disconnetti e pulisci
  disconnect() {
    this._clearConnectTimeout();
    this.conns.forEach((conn) => {
      try { conn.close(); } catch (_) {}
    });
    this.conns.clear();
    if (this.conn) {
      try { this.conn.close(); } catch (_) {}
      this.conn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
    this.connected = false;
    this.isHost = false;
  }
}
