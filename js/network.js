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
    this._hasTurnActive = false;
    this._baseStunServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
  }

  static hasTurnConfigured() {
    const cfg = NetworkManager.getTurnConfig();
    return Boolean(cfg && cfg.url);
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

  static async resolveCustomTurnServers(cfg) {
    if (!cfg || !cfg.url) return { servers: [], error: null };
    const rawUrl = String(cfg.url || '').trim();
    const user = String(cfg.user || '').trim();
    const pass = String(cfg.pass || '').trim();

    // 1. JSON array di iceServers (incollato direttamente dalla dashboard TURN)
    if (rawUrl.startsWith('[')) {
      try {
        const parsed = JSON.parse(rawUrl);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter(s => s && s.urls);
          if (valid.length > 0) return { servers: valid, error: null };
        }
      } catch (e) {
        return { servers: [], error: 'JSON server TURN non valido.' };
      }
      return { servers: [], error: 'Array iceServers vuoto o non valido.' };
    }

    // 2. Endpoint Metered.live (supporta URL completo con apiKey o solo dominio + password)
    if (rawUrl.includes('.metered.live')) {
      try {
        let fetchUrl = rawUrl;
        if (!/^https?:\/\//i.test(fetchUrl)) {
          fetchUrl = `https://${fetchUrl}`;
        }
        const parsedUrl = new URL(fetchUrl);
        if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
          parsedUrl.pathname = '/api/v1/turn/credentials';
        }
        if (!parsedUrl.searchParams.get('apiKey') && pass) {
          parsedUrl.searchParams.set('apiKey', pass);
        }
        if (!parsedUrl.searchParams.get('apiKey')) {
          return { servers: [], error: 'Inserisci la API Key Metered nel campo Password/API Key.' };
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const resp = await fetch(parsedUrl.toString(), { signal: ctrl.signal });
        clearTimeout(timer);
        if (!resp.ok) {
          return { servers: [], error: `Metered API ha risposto HTTP ${resp.status}. Controlla API Key.` };
        }
        const list = await resp.json();
        if (Array.isArray(list) && list.length > 0) {
          return { servers: list, error: null };
        }
        return { servers: [], error: 'Risposta Metered vuota.' };
      } catch (e) {
        return { servers: [], error: 'Impossibile contattare il server Metered TURN.' };
      }
    }

    // 3. URL turn:/turns:/stun: (anche multipli separati da virgola) o host:porta
    if (/^https?:\/\//i.test(rawUrl)) {
      return { servers: [], error: 'URL TURN deve iniziare con turn:, turns: o essere un dominio .metered.live' };
    }
    const entries = rawUrl
      .split(/[\s,]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => ((/^(turns?|stuns?):/i.test(part)) ? part : `turn:${part}`));

    if (entries.length === 0) {
      return { servers: [], error: 'URL TURN non valido.' };
    }
    const entry = { urls: entries.length === 1 ? entries[0] : entries };
    if (user) entry.username = user;
    if (pass) entry.credential = pass;
    return { servers: [entry], error: null };
  }

  async _resolveIceServers() {
    const servers = [...this._baseStunServers];
    this._hasTurnActive = false;
    const cfg = NetworkManager.getTurnConfig();
    if (!cfg || !cfg.url) return servers;

    const { servers: customServers, error } = await NetworkManager.resolveCustomTurnServers(cfg);
    if (error) {
      console.warn('[Network] Configurazione TURN ignorata:', error);
      return servers;
    }
    if (customServers.length > 0) {
      this._hasTurnActive = customServers.some(s => {
        const u = Array.isArray(s.urls) ? s.urls.join(',') : String(s.urls || '');
        return /^turns?:/i.test(u) || u.includes('turn:');
      });
      return [...servers, ...customServers];
    }
    return servers;
  }

  _buildNegotiationError(isHostSide = false) {
    if (this._hasTurnActive) {
      return new Error(
        isHostSide
          ? 'Un amico non riesce a connettersi anche con il relay TURN. Verifica le credenziali TURN o rigenera la stanza.'
          : 'Connessione fallita anche tramite relay TURN. Verifica le credenziali TURN salvate o chiedi all\'Host un nuovo codice.'
      );
    }
    return new Error(
      isHostSide
        ? 'Un amico è bloccato dal NAT/Wi-Fi/4G (connessione P2P diretta fallita). Se siete su Wi-Fi diversi o 4G, configura il relay TURN gratuito qui sotto.'
        : 'Connessione P2P diretta bloccata tra queste due reti (Wi-Fi/4G diversi o rete bloccata). Configura il relay TURN gratuito nelle impostazioni qui sotto.'
    );
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
            iceCandidatePoolSize: 2,
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
            prev.__msSuperseded = true;
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
            const friendlyErr = (err && err.type === 'network')
              ? new Error('Server di segnalazione temporaneamente irraggiungibile. Riprova tra poco.')
              : err;
            if (this.callbacks.onError) this.callbacks.onError(friendlyErr);
            reject(friendlyErr);
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
            iceCandidatePoolSize: 2,
            iceServers
          }
        });

        let settled = false;
        let currentAttempt = 0;

        const failAndAbort = (err) => {
          if (settled) return;
          settled = true;
          this._clearConnectTimeout();
          if (this.callbacks.onError) this.callbacks.onError(err);
          this.disconnect();
          reject(err);
        };

        this._connectTimeout = setTimeout(() => {
          if (!this.connected && !settled) {
            failAndAbort(this._buildNegotiationError(false));
          }
        }, 22000);

        const attemptConnect = (attemptNum) => {
          if (!this.peer || this.peer.destroyed || settled || this.connected) return;
          currentAttempt = attemptNum;
          if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
          }
          if (this.conn && !this.conn.open) {
            const staleConn = this.conn;
            staleConn.__msSuperseded = true;
            this.conn = null;
            try { staleConn.close(); } catch (_) {}
          }
          const nextConn = this.peer.connect(targetId, {
            reliable: true,
            serialization: 'json'
          });
          this.conn = nextConn;
          this._setupPeerConnection(
            nextConn,
            () => {
              if (!settled) {
                settled = true;
                resolve(targetId);
              }
            },
            (connErr) => {
              if (settled || this.connected || nextConn.__msSuperseded) return;
              if (attemptNum === 1 && !this.peer.destroyed) {
                nextConn.__msSuperseded = true;
                if (this.conn === nextConn) this.conn = null;
                try { nextConn.close(); } catch (_) {}
                this._retryTimer = setTimeout(() => {
                  attemptConnect(2);
                }, 400);
              } else {
                const finalErr = (connErr && connErr.type === 'negotiation-failed')
                  ? this._buildNegotiationError(false)
                  : (connErr instanceof Error ? connErr : this._buildNegotiationError(false));
                failAndAbort(finalErr);
              }
            }
          );
          if (attemptNum === 1) {
            this._retryTimer = setTimeout(() => {
              if (!this.connected && !settled && currentAttempt === 1 && this.peer && !this.peer.destroyed) {
                attemptConnect(2);
              }
            }, 9500);
          }
        };

        this.peer.on('open', () => {
          attemptConnect(1);
        });

        this.peer.on('error', (err) => {
          console.error('Peer join error:', err);
          if (err && err.type === 'peer-unavailable') {
            failAndAbort(new Error(`Stanza "${targetId}" non trovata! Assicurati che l'Host abbia la stanza aperta.`));
            return;
          }
          if (err && err.type === 'webrtc' && currentAttempt === 1 && !settled && !this.connected) {
            if (this._retryTimer) {
              clearTimeout(this._retryTimer);
            }
            this._retryTimer = setTimeout(() => {
              attemptConnect(2);
            }, 400);
            return;
          }
          const msg = (err && err.type === 'webrtc')
            ? this._buildNegotiationError(false).message
            : ((err && err.message) || 'Errore di connessione P2P');
          failAndAbort(new Error(msg));
        });
      } catch (err) {
        this._clearConnectTimeout();
        if (this.callbacks.onError) this.callbacks.onError(err);
        reject(err);
      }
    });
  }

  // Configura listener per singola DataConnection (Host multi-client e Client singolo)
  _setupPeerConnection(activeConn, onOpenExtra = null, onAttemptFail = null) {
    if (!activeConn) return;
    const remotePeerId = activeConn.peer;
    let opened = false;

    const isCurrentConn = () => !activeConn.__msSuperseded && (this.isHost
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
      if (activeConn.__msSuperseded) return;
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
        if (wasConnected) {
          this._clearConnectTimeout();
          if (this.callbacks.onDisconnect) {
            this.callbacks.onDisconnect(remotePeerId);
          }
        } else if (!opened && onAttemptFail) {
          onAttemptFail(new Error('negotiation-failed'));
        }
      }
    });

    activeConn.on('error', (err) => {
      if (!isCurrentConn()) return;
      console.error('Connection error:', remotePeerId, err);

      if (err && err.type === 'connection-closed') {
        return;
      }

      const isNegotiationFailed = err && err.type === 'negotiation-failed';
      if (this.isHost) {
        if (this.conns.get(remotePeerId) === activeConn) {
          this.conns.delete(remotePeerId);
        }
        this.connected = this.getConnectedPeerCount() > 0;
        if (isNegotiationFailed) {
          const friendly = this._buildNegotiationError(true);
          if (this.callbacks.onPeerNegotiationFailed) {
            this.callbacks.onPeerNegotiationFailed(remotePeerId, friendly);
          } else if (this.callbacks.onError && !this.connected) {
            this.callbacks.onError(friendly);
          }
          return;
        }
        if (this.callbacks.onError) this.callbacks.onError(err);
        return;
      }

      if (onAttemptFail && !opened) {
        onAttemptFail(err);
        return;
      }
      this._clearConnectTimeout();
      const friendlyErr = isNegotiationFailed ? this._buildNegotiationError(false) : err;
      if (this.callbacks.onError) this.callbacks.onError(friendlyErr);
    });

    const attachIceMonitor = () => {
      const pc = activeConn.peerConnection;
      if (!pc || pc.__msIceMonitored) return;
      pc.__msIceMonitored = true;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (!isCurrentConn()) return;
        if (pc.iceConnectionState === 'failed' && !opened) {
          if (this.isHost) {
            if (this.conns.get(remotePeerId) === activeConn) {
              this.conns.delete(remotePeerId);
            }
            this.connected = this.getConnectedPeerCount() > 0;
            if (this.callbacks.onPeerNegotiationFailed) {
              this.callbacks.onPeerNegotiationFailed(remotePeerId, this._buildNegotiationError(true));
            }
          } else if (onAttemptFail) {
            const failErr = new Error('negotiation-failed');
            failErr.type = 'negotiation-failed';
            onAttemptFail(failErr);
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
      conn.__msSuperseded = true;
      try { conn.close(); } catch (_) {}
    });
    this.conns.clear();
    if (this.conn) {
      this.conn.__msSuperseded = true;
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
