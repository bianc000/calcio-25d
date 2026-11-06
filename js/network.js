// Modulo di Rete P2P WebRTC con PeerJS
export class NetworkManager {
  constructor(callbacks = {}) {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomId = null;
    this.callbacks = callbacks;
    this.connected = false;
  }

  // Genera un ID stanza corto e amichevole
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'CALCIO-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Inizializza come Host (Crea partita)
  hostGame(customCode = null) {
    return new Promise((resolve, reject) => {
      this.isHost = true;
      const code = (customCode || this.generateRoomCode()).toUpperCase().trim();
      this.roomId = code;

      try {
        // Usa i server cloud gratuiti PeerJS per la negoziazione WebRTC
        this.peer = new window.Peer(code, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });

        this.peer.on('open', (id) => {
          this.roomId = id;
          if (this.callbacks.onHostReady) this.callbacks.onHostReady(id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          this.conn = conn;
          this.setupConnection();
        });

        this.peer.on('error', (err) => {
          console.error("Peer error:", err);
          if (err.type === 'unavailable-id') {
            // Se ID già preso, prova un altro
            this.hostGame(this.generateRoomCode()).then(resolve).catch(reject);
          } else {
            if (this.callbacks.onError) this.callbacks.onError(err);
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Connettiti a una stanza esistente come Guest
  joinGame(roomCode) {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      const targetId = roomCode.toUpperCase().trim();
      this.roomId = targetId;

      try {
        this.peer = new window.Peer({
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });

        this.peer.on('open', () => {
          this.conn = this.peer.connect(targetId, { reliable: false });
          this.setupConnection();
          resolve(targetId);
        });

        this.peer.on('error', (err) => {
          console.error("Peer join error:", err);
          if (this.callbacks.onError) this.callbacks.onError(err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Configura i gestori di eventi per la connessione dati aperta
  setupConnection() {
    if (!this.conn) return;

    this.conn.on('open', () => {
      this.connected = true;
      if (this.callbacks.onConnect) this.callbacks.onConnect(this.isHost);
    });

    this.conn.on('data', (data) => {
      if (this.callbacks.onData) this.callbacks.onData(data);
    });

    this.conn.on('close', () => {
      this.connected = false;
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    });

    this.conn.on('error', (err) => {
      console.error("Connection error:", err);
      if (this.callbacks.onError) this.callbacks.onError(err);
    });
  }

  // Invia dati al peer collegato
  send(data) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(data);
      } catch (e) {
        console.warn("Invio pacchetto fallito:", e);
      }
    }
  }

  // Disconnetti e pulisci
  disconnect() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connected = false;
    this.isHost = false;
  }
}
