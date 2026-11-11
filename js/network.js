// Modulo di Rete P2P WebRTC con PeerJS
export class NetworkManager {
  constructor(callbacks = {}) {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomId = null;
    this.callbacks = callbacks;
    this.connected = false;
    this._connectTimeout = null;
    this._iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ];
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

    // Se l'utente ha incollato l'intero link (?room=MS-XXXX)
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

  _clearConnectTimeout() {
    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
    }
  }

  // Inizializza come Host (Crea partita)
  hostGame(customCode = null) {
    this.disconnect();
    return new Promise((resolve, reject) => {
      if (!window.Peer) {
        const err = new Error('Libreria PeerJS non caricata. Ricarica la pagina.');
        if (this.callbacks.onError) this.callbacks.onError(err);
        reject(err);
        return;
      }

      this.isHost = true;
      const code = this.normalizeRoomCode(customCode) || this.generateRoomCode();
      this.roomId = code;

      try {
        // Usa i server cloud PeerJS per la negoziazione WebRTC
        this.peer = new window.Peer(code, {
          debug: 1,
          config: {
            iceCandidatePoolSize: 10,
            iceServers: this._iceServers
          }
        });

        this.peer.on('open', (id) => {
          this.roomId = id;
          if (this.callbacks.onHostReady) this.callbacks.onHostReady(id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          if (this.conn && this.conn !== conn && this.conn.open) {
            // Sostituisce vecchia connessione solo se l'amico si riconnette
            try { this.conn.close(); } catch (_) {}
          }
          this.conn = conn;
          this.setupConnection();
        });

        this.peer.on('disconnected', () => {
          if (this.peer && !this.peer.destroyed && !this.connected) {
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
  joinGame(roomCode) {
    this.disconnect();
    return new Promise((resolve, reject) => {
      if (!window.Peer) {
        const err = new Error('Libreria PeerJS non caricata. Ricarica la pagina.');
        if (this.callbacks.onError) this.callbacks.onError(err);
        reject(err);
        return;
      }

      this.isHost = false;
      const targetId = this.normalizeRoomCode(roomCode);
      if (!targetId) {
        const err = new Error('Codice stanza non valido.');
        if (this.callbacks.onError) this.callbacks.onError(err);
        reject(err);
        return;
      }
      this.roomId = targetId;

      try {
        this.peer = new window.Peer({
          debug: 1,
          config: {
            iceCandidatePoolSize: 10,
            iceServers: this._iceServers
          }
        });

        let settled = false;

        this._connectTimeout = setTimeout(() => {
          if (!this.connected && !settled) {
            settled = true;
            const timeoutErr = new Error(`Impossibile raggiungere la stanza ${targetId}. Verifica il codice o la connessione dell'Host.`);
            if (this.callbacks.onError) this.callbacks.onError(timeoutErr);
            this.disconnect();
            reject(timeoutErr);
          }
        }, 15000);

        this.peer.on('open', () => {
          // Connessione WebRTC affidabile in formato JSON (niente bug BinaryPack o drop pacchetti critici)
          this.conn = this.peer.connect(targetId, {
            reliable: true,
            serialization: 'json'
          });
          this.setupConnection(() => {
            if (!settled) {
              settled = true;
              resolve(targetId);
            }
          });
        });

        this.peer.on('error', (err) => {
          console.error('Peer join error:', err);
          this._clearConnectTimeout();
          let msg = err.message || 'Errore di connessione P2P';
          if (err.type === 'peer-unavailable') {
            msg = `Stanza "${targetId}" non trovata! Assicurati che il tuo amico abbia aperto la stanza.`;
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

  // Configura i gestori di eventi per la connessione dati aperta
  setupConnection(onOpenExtra = null) {
    if (!this.conn) return;
    const activeConn = this.conn;
    let opened = false;

    const handleOpen = () => {
      if (opened) return;
      opened = true;
      this._clearConnectTimeout();
      this.connected = true;
      if (onOpenExtra) onOpenExtra();
      if (this.callbacks.onConnect) this.callbacks.onConnect(this.isHost);
    };

    activeConn.on('open', handleOpen);

    // Gestione caso race-condition se già aperto sincronamente
    if (activeConn.open) {
      handleOpen();
    }

    activeConn.on('data', (data) => {
      if (this.callbacks.onData) this.callbacks.onData(data);
    });

    activeConn.on('close', () => {
      if (this.conn === activeConn) {
        const wasConnected = this.connected;
        this.connected = false;
        this._clearConnectTimeout();
        if (wasConnected && this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect();
        }
      }
    });

    activeConn.on('error', (err) => {
      console.error('Connection error:', err);
      this._clearConnectTimeout();
      if (this.callbacks.onError) this.callbacks.onError(err);
    });

    if (activeConn.peerConnection) {
      activeConn.peerConnection.oniceconnectionstatechange = () => {
        const state = activeConn.peerConnection && activeConn.peerConnection.iceConnectionState;
        if (state === 'failed') {
          this._clearConnectTimeout();
          const iceErr = new Error('Connessione diretta bloccata dalla rete (NAT/Firewall). Riprova o usa la stessa rete/Wi-Fi.');
          if (this.callbacks.onError) this.callbacks.onError(iceErr);
        }
      };
    }
  }

  // Invia dati al peer collegato
  send(data, isVolatile = false) {
    if (this.conn && this.conn.open) {
      if (isVolatile && this.conn.dataChannel && this.conn.dataChannel.bufferedAmount > 65536) {
        // Evita congestione del canale dati su pacchetti ad alta frequenza
        return;
      }
      try {
        this.conn.send(data);
      } catch (e) {
        console.warn('Invio pacchetto fallito:', e);
      }
    }
  }

  // Disconnetti e pulisci
  disconnect() {
    this._clearConnectTimeout();
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
