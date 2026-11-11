// Modulo di Rete Multiplayer (Cloudflare WebSocket Relay + PeerJS WebRTC P2P fallback)
const TURN_STORAGE_KEY = 'msoccer_turn_config';
const RELAY_STORAGE_KEY = 'msoccer_relay_url';

// URL pubblico del Cloudflare Workers Relay (es. 'wss://msoccer-relay.tuo-nome.workers.dev').
// Quando impostato, tutti i giocatori usano automaticamente il relay WebSocket senza configurazioni NAT/TURN.
export const DEFAULT_RELAY_URL = 'wss://msoccer-relay.biancoanthony2000.workers.dev';

export class NetworkManager {
  constructor(callbacks = {}) {
    this.peer = null;
    this.conn = null;         // Usato dal Client (connessione verso Host)
    this.conns = new Map();   // Usato dall'Host: peerId -> DataConnection / Relay shim
    this.relayPeers = new Set(); // Usato dall'Host in modalita WebSocket Relay
    this.ws = null;
    this.transport = 'peerjs'; // 'ws-relay' | 'peerjs'
    this.isHost = false;
    this.roomId = null;
    this.callbacks = callbacks;
    this.connected = false;
    this._disposed = false;
    this._connectTimeout = null;
    this._retryTimer = null;
    this._wsKeepaliveTimer = null;
    this._hasTurnActive = false;
    this._baseStunServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
  }

  static getDefaultRelayUrl() {
    return NetworkManager.normalizeRelayUrl(DEFAULT_RELAY_URL);
  }

  static normalizeRelayUrl(raw) {
    let val = String(raw || '').trim();
    if (!val) return '';
    if (/^https:\/\//i.test(val)) {
      val = 'wss://' + val.slice(8);
    } else if (/^http:\/\//i.test(val)) {
      val = 'ws://' + val.slice(7);
    } else if (!/^(wss?|https?):\/\//i.test(val)) {
      const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(val);
      val = (isLocal ? 'ws://' : 'wss://') + val;
    }
    try {
      const parsed = new URL(val);
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return '';
      let path = parsed.pathname.replace(/\/+$/, '');
      if (path === '/ws') path = '';
      return `${parsed.protocol}//${parsed.host}${path}`;
    } catch (_) {
      return '';
    }
  }

  static getStoredRelayUrl() {
    try {
      return NetworkManager.normalizeRelayUrl(localStorage.getItem(RELAY_STORAGE_KEY) || '');
    } catch (_) {
      return '';
    }
  }

  static getRelayUrl() {
    return NetworkManager.getStoredRelayUrl() || NetworkManager.getDefaultRelayUrl();
  }

  static hasRelayConfigured() {
    return Boolean(NetworkManager.getRelayUrl());
  }

  static saveRelayUrl(raw) {
    const trimmed = String(raw || '').trim();
    try {
      if (!trimmed) {
        localStorage.removeItem(RELAY_STORAGE_KEY);
        return '';
      }
      const normalized = NetworkManager.normalizeRelayUrl(trimmed);
      if (!normalized) return null;
      localStorage.setItem(RELAY_STORAGE_KEY, normalized);
      return normalized;
    } catch (_) {
      return null;
    }
  }

  static extractInviteParams(rawInput) {
    const raw = String(rawInput || '').trim();
    let relayUrl = '';
    if (raw) {
      const relayMatch = raw.match(/[?&]relay=([^&#\s]+)/i);
      if (relayMatch && relayMatch[1]) {
        try {
          relayUrl = NetworkManager.normalizeRelayUrl(decodeURIComponent(relayMatch[1]));
        } catch (_) {
          relayUrl = '';
        }
      }
    }
    let val = raw;
    if (val) {
      const roomMatch = val.match(/[?&]room=([A-Za-z0-9_-]+)/i);
      if (roomMatch && roomMatch[1]) {
        val = roomMatch[1];
      }
      val = val.toUpperCase().replace(/\s+/g, '');
      if (/^[A-Z0-9]{4}$/.test(val)) {
        val = `MS-${val}`;
      }
    }
    return { roomCode: val, relayUrl };
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
    return NetworkManager.extractInviteParams(rawInput).roomCode;
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

  getConnectedPeerIds() {
    if (!this.isHost) {
      return this.connected ? ['host'] : [];
    }
    if (this.transport === 'ws-relay') {
      return (this.ws && this.ws.readyState === WebSocket.OPEN)
        ? Array.from(this.relayPeers)
        : [];
    }
    const ids = [];
    this.conns.forEach((c, pid) => {
      if (c && c.open) ids.push(pid);
    });
    return ids;
  }

  getConnectedPeerCount() {
    if (this.transport === 'ws-relay') {
      if (this.isHost) {
        return (this.ws && this.ws.readyState === WebSocket.OPEN) ? this.relayPeers.size : 0;
      }
      return (this.ws && this.ws.readyState === WebSocket.OPEN && this.connected) ? 1 : 0;
    }
    if (this.isHost) {
      let count = 0;
      this.conns.forEach(c => {
        if (c && c.open) count++;
      });
      return count;
    }
    return (this.conn && this.conn.open) ? 1 : 0;
  }

  _clearWsKeepalive() {
    if (this._wsKeepaliveTimer) {
      clearInterval(this._wsKeepaliveTimer);
      this._wsKeepaliveTimer = null;
    }
  }

  _startWsKeepalive(ws) {
    this._clearWsKeepalive();
    this._wsKeepaliveTimer = setInterval(() => {
      if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
        } catch (_) {}
      } else {
        this._clearWsKeepalive();
      }
    }, 25000);
  }

  _syncHostConnShim(peerId, present) {
    if (present) {
      this.conns.set(peerId, { peer: peerId, open: true, _wsRelay: true, close() {} });
    } else {
      this.conns.delete(peerId);
    }
  }

  _closeActiveWs() {
    this._clearWsKeepalive();
    if (this.ws) {
      this.ws.__msSuperseded = true;
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.relayPeers.clear();
  }

  // Inizializza come Host (accetta fino a 5 ospiti contemporaneamente per 1v1, 2v2 o 3v3)
  async hostGame(customCode = null, options = {}) {
    this.disconnect();
    this._disposed = false;

    const customNormalized = this.normalizeRoomCode(customCode);
    const fixedCode = customNormalized || null;
    const relayUrl = NetworkManager.normalizeRelayUrl(options.relayUrl) || NetworkManager.getRelayUrl();

    if (relayUrl) {
      try {
        return await this._hostViaRelay(relayUrl, fixedCode);
      } catch (relayErr) {
        if (this._disposed) throw relayErr;
        console.warn('[Network] Relay WebSocket non disponibile, passo a PeerJS P2P:', relayErr?.message || relayErr);
        this._closeActiveWs();
        this.conns.clear();
      }
    }

    return this._hostViaPeerJs(fixedCode);
  }

  async _hostViaRelay(relayUrl, fixedCode = null, attempt = 0) {
    if (this._disposed) {
      throw new Error('Connessione annullata.');
    }

    const code = fixedCode || this.generateRoomCode();
    return new Promise((resolve, reject) => {
      this.isHost = true;
      this.transport = 'ws-relay';
      this.roomId = code;
      this.connected = false;
      this.relayPeers.clear();
      this.conns.clear();

      let settled = false;
      let handshakeTimer = null;
      let ws = null;

      const clearHandshake = () => {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
      };

      const failHandshake = (err) => {
        if (settled) return;
        settled = true;
        clearHandshake();
        if (ws) ws.__msSuperseded = true;
        this._closeActiveWs();
        reject(err instanceof Error ? err : new Error(String(err || 'Relay host error')));
      };

      try {
        ws = new WebSocket(`${relayUrl}/ws?room=${encodeURIComponent(code)}&role=host`);
        this.ws = ws;
      } catch (err) {
        failHandshake(err);
        return;
      }

      handshakeTimer = setTimeout(() => {
        failHandshake(new Error('Timeout connessione al relay WebSocket.'));
      }, 4500);

      ws.addEventListener('message', (ev) => {
        if (ws.__msSuperseded || this._disposed) return;
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'relay_ready') {
          if (!settled) {
            settled = true;
            clearHandshake();
            this.roomId = msg.roomId || code;
            this._startWsKeepalive(ws);
            if (this.callbacks.onHostReady) this.callbacks.onHostReady(this.roomId);
            resolve(this.roomId);
          }
          return;
        }

        if (msg.type === 'relay_error') {
          if (msg.code === 'room_taken' && !fixedCode && attempt < 3) {
            settled = true;
            clearHandshake();
            ws.__msSuperseded = true;
            try { ws.close(); } catch (_) {}
            this._hostViaRelay(relayUrl, null, attempt + 1).then(resolve).catch(reject);
            return;
          }
          const err = new Error(msg.message || 'Errore relay WebSocket.');
          err.code = msg.code;
          if (!settled) {
            failHandshake(err);
          } else if (this.callbacks.onError) {
            this.callbacks.onError(err);
          }
          return;
        }

        if (msg.type === 'relay_peer_join' && msg.peerId) {
          this.relayPeers.add(msg.peerId);
          this._syncHostConnShim(msg.peerId, true);
          this.connected = this.relayPeers.size > 0;
          if (this.callbacks.onPeerConnect) this.callbacks.onPeerConnect(msg.peerId);
          return;
        }

        if (msg.type === 'relay_peer_leave' && msg.peerId) {
          const hadPeer = this.relayPeers.delete(msg.peerId);
          this._syncHostConnShim(msg.peerId, false);
          this.connected = this.relayPeers.size > 0;
          if (hadPeer && this.callbacks.onPeerDisconnect) {
            this.callbacks.onPeerDisconnect(msg.peerId);
          }
          return;
        }

        if (msg.t === 'd' && msg.d !== undefined) {
          if (this.callbacks.onData) this.callbacks.onData(msg.d, msg.from || 'guest');
        }
      });

      ws.addEventListener('error', () => {
        if (ws.__msSuperseded) return;
        if (!settled) {
          failHandshake(new Error('Impossibile contattare il relay WebSocket.'));
        }
      });

      ws.addEventListener('close', () => {
        if (ws.__msSuperseded || ws.__msCloseHandled) return;
        ws.__msCloseHandled = true;
        clearHandshake();
        this._clearWsKeepalive();
        if (!settled) {
          failHandshake(new Error('Connessione relay chiusa prima dell\'avvio.'));
          return;
        }
        this.relayPeers.clear();
        this.conns.clear();
        this.connected = false;
        if (this.ws === ws) this.ws = null;
        if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
      });
    });
  }

  async _hostViaPeerJs(customCode = null) {
    if (!window.Peer) {
      const err = new Error('Libreria PeerJS non caricata. Ricarica la pagina.');
      if (this.callbacks.onError) this.callbacks.onError(err);
      throw err;
    }

    const iceServers = await this._resolveIceServers();

    return new Promise((resolve, reject) => {
      this.isHost = true;
      this.transport = 'peerjs';
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
            this._hostViaPeerJs(this.generateRoomCode()).then(resolve).catch(reject);
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
  async joinGame(roomCode, options = {}) {
    this.disconnect();
    this._disposed = false;

    const parsed = NetworkManager.extractInviteParams(roomCode);
    const targetId = parsed.roomCode;
    if (!targetId) {
      const err = new Error('Codice stanza non valido.');
      if (this.callbacks.onError) this.callbacks.onError(err);
      throw err;
    }

    const relayUrl = parsed.relayUrl
      || NetworkManager.normalizeRelayUrl(options.relayUrl)
      || NetworkManager.getRelayUrl();

    if (relayUrl) {
      try {
        return await this._joinViaRelay(relayUrl, targetId);
      } catch (relayErr) {
        if (this._disposed) throw relayErr;
        if (relayErr && relayErr.isRelayLogical) {
          if (this.callbacks.onError) this.callbacks.onError(relayErr);
          throw relayErr;
        }
        console.warn('[Network] Relay WebSocket non raggiungibile, provo PeerJS P2P:', relayErr?.message || relayErr);
        this._closeActiveWs();
      }
    }

    return this._joinViaPeerJs(targetId);
  }

  async _joinViaRelay(relayUrl, targetId) {
    if (this._disposed) {
      throw new Error('Connessione annullata.');
    }

    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.transport = 'ws-relay';
      this.roomId = targetId;
      this.connected = false;

      let settled = false;
      let handshakeTimer = null;
      let ws = null;

      const clearHandshake = () => {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
      };

      const failHandshake = (err, isLogical = false) => {
        if (settled) return;
        settled = true;
        clearHandshake();
        if (ws) ws.__msSuperseded = true;
        this._closeActiveWs();
        const errObj = err instanceof Error ? err : new Error(String(err || 'Connessione relay fallita.'));
        if (isLogical) errObj.isRelayLogical = true;
        reject(errObj);
      };

      try {
        ws = new WebSocket(`${relayUrl}/ws?room=${encodeURIComponent(targetId)}&role=guest`);
        this.ws = ws;
      } catch (err) {
        failHandshake(err);
        return;
      }

      handshakeTimer = setTimeout(() => {
        failHandshake(new Error('Timeout connessione al relay WebSocket.'));
      }, 4500);

      ws.addEventListener('message', (ev) => {
        if (ws.__msSuperseded || this._disposed) return;
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'relay_welcome') {
          if (!settled) {
            settled = true;
            clearHandshake();
            this.connected = true;
            this.roomId = msg.roomId || targetId;
            this._startWsKeepalive(ws);
            if (this.callbacks.onConnect) this.callbacks.onConnect(false, msg.peerId || 'guest');
            resolve(this.roomId);
          }
          return;
        }

        if (msg.type === 'relay_error') {
          const isLogical = msg.code === 'room_not_found' || msg.code === 'room_full';
          const err = new Error(
            msg.message || `Stanza "${targetId}" non trovata! Assicurati che l'Host abbia la stanza aperta.`
          );
          err.code = msg.code;
          if (!settled) {
            failHandshake(err, isLogical);
          } else if (this.callbacks.onError) {
            this.callbacks.onError(err);
          }
          return;
        }

        if (msg.type === 'relay_host_left') {
          if (ws.__msCloseHandled) return;
          ws.__msCloseHandled = true;
          ws.__msSuperseded = true;
          this._clearWsKeepalive();
          this.connected = false;
          if (this.ws === ws) this.ws = null;
          try { ws.close(); } catch (_) {}
          if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
          return;
        }

        if (msg.t === 'd' && msg.d !== undefined) {
          if (this.callbacks.onData) this.callbacks.onData(msg.d, msg.from || 'host');
        }
      });

      ws.addEventListener('error', () => {
        if (ws.__msSuperseded) return;
        if (!settled) {
          failHandshake(new Error('Impossibile contattare il relay WebSocket.'));
        }
      });

      ws.addEventListener('close', () => {
        if (ws.__msSuperseded || ws.__msCloseHandled) return;
        ws.__msCloseHandled = true;
        clearHandshake();
        this._clearWsKeepalive();
        if (!settled) {
          failHandshake(new Error('Connessione relay chiusa prima del welcome.'));
          return;
        }
        this.connected = false;
        if (this.ws === ws) this.ws = null;
        if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
      });
    });
  }

  async _joinViaPeerJs(targetId) {
    if (!window.Peer) {
      const err = new Error('Libreria PeerJS non caricata. Ricarica la pagina.');
      if (this.callbacks.onError) this.callbacks.onError(err);
      throw err;
    }

    const iceServers = await this._resolveIceServers();

    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.transport = 'peerjs';
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
    if (this.transport === 'ws-relay') {
      if (!this.isHost || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (isVolatile && this.ws.bufferedAmount > 65536) return;
      try {
        this.ws.send(JSON.stringify({ t: 'd', to: peerId, d: data }));
      } catch (e) {
        console.warn('Invio relay unicast fallito:', e);
      }
      return;
    }
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
    if (this.transport === 'ws-relay') {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (isVolatile && this.ws.bufferedAmount > 65536) return;
      try {
        if (this.isHost) {
          if (this.relayPeers.size === 0) return;
          this.ws.send(JSON.stringify({ t: 'b', d: data }));
        } else {
          this.ws.send(JSON.stringify({ t: 'd', d: data }));
        }
      } catch (e) {
        console.warn('Invio relay fallito:', e);
      }
      return;
    }
    if (this.isHost) {
      this.conns.forEach((conn) => this._sendOverConn(conn, data, isVolatile));
    } else {
      this._sendOverConn(this.conn, data, isVolatile);
    }
  }

  // Disconnetti e pulisci
  disconnect() {
    this._disposed = true;
    this._clearConnectTimeout();
    this._closeActiveWs();
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
    this.transport = 'peerjs';
  }
}
