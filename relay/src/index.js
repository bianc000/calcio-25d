import { DurableObject } from "cloudflare:workers";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function normalizeRoomCode(raw) {
  const cleaned = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  if (cleaned.length < 3 || cleaned.length > 32) return "";
  return cleaned;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Endpoint HTTP per healthcheck e verifica stato
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      if (url.pathname === "/" || url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          service: "msoccer-relay",
          protocol: "cloudflare-do-ws-hibernation-v1",
        });
      }
      return new Response(
        "MSoccer WebSocket Relay attivo. Connettiti via WebSocket su /ws?room=MS-XXXX&role=host|guest",
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS },
        }
      );
    }

    const roomCode = normalizeRoomCode(url.searchParams.get("room"));
    if (!roomCode) {
      return new Response("Codice stanza non valido (?room=MS-XXXX).", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const role = (url.searchParams.get("role") || "guest").toLowerCase();
    if (role !== "host" && role !== "guest") {
      return new Response("Ruolo non valido (?role=host|guest).", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const id = env.ROOM_RELAY.idFromName(roomCode);
    const stub = env.ROOM_RELAY.get(id);
    return stub.fetch(request);
  },
};

export class RoomRelay extends DurableObject {
  _markClosedSet() {
    if (!this._closedSockets) {
      this._closedSockets = new WeakSet();
    }
    return this._closedSockets;
  }

  _getActiveSocketMeta(ws) {
    if (this._markClosedSet().has(ws)) return null;
    try {
      const meta = ws.deserializeAttachment();
      if (!meta || meta.closed || meta.role === "rejected") return null;
      return meta;
    } catch (_) {
      return null;
    }
  }

  _sendJson(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (_) {
      return false;
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const roomId = normalizeRoomCode(url.searchParams.get("room"));
    const role = (url.searchParams.get("role") || "guest").toLowerCase();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === "host") {
      const existingHosts = this.ctx
        .getWebSockets("role:host")
        .filter((ws) => this._getActiveSocketMeta(ws) !== null);

      if (existingHosts.length > 0) {
        this._markClosedSet().add(server);
        this.ctx.acceptWebSocket(server, ["role:rejected"]);
        server.serializeAttachment({ role: "rejected", closed: true });
        this._sendJson(server, {
          type: "relay_error",
          code: "room_taken",
          message: `Codice stanza "${roomId}" già in uso.`,
        });
        try { server.close(1000, "room_taken"); } catch (_) {}
        return new Response(null, { status: 101, webSocket: client });
      }

      // Chiudi eventuali socket guest orfani residui nella stanza
      for (const oldGuest of this.ctx.getWebSockets("role:guest")) {
        const gMeta = this._getActiveSocketMeta(oldGuest);
        if (gMeta) {
          this._markClosedSet().add(oldGuest);
          this._sendJson(oldGuest, { type: "relay_host_left" });
        }
        try { oldGuest.close(1001, "room_reset"); } catch (_) {}
      }

      this.ctx.acceptWebSocket(server, ["role:host"]);
      server.serializeAttachment({
        role: "host",
        peerId: "host",
        roomId,
        closed: false,
      });

      this._sendJson(server, {
        type: "relay_ready",
        roomId,
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // role === "guest"
    const hosts = this.ctx
      .getWebSockets("role:host")
      .filter((ws) => this._getActiveSocketMeta(ws) !== null);

    if (hosts.length === 0) {
      this._markClosedSet().add(server);
      this.ctx.acceptWebSocket(server, ["role:rejected"]);
      server.serializeAttachment({ role: "rejected", closed: true });
      this._sendJson(server, {
        type: "relay_error",
        code: "room_not_found",
        message: `Stanza "${roomId}" non trovata! Assicurati che l'Host abbia la stanza aperta.`,
      });
      try { server.close(1000, "room_not_found"); } catch (_) {}
      return new Response(null, { status: 101, webSocket: client });
    }

    const activeGuests = this.ctx
      .getWebSockets("role:guest")
      .filter((ws) => this._getActiveSocketMeta(ws) !== null);

    if (activeGuests.length >= 10) {
      this._markClosedSet().add(server);
      this.ctx.acceptWebSocket(server, ["role:rejected"]);
      server.serializeAttachment({ role: "rejected", closed: true });
      this._sendJson(server, {
        type: "relay_error",
        code: "room_full",
        message: `Stanza "${roomId}" già piena.`,
      });
      try { server.close(1000, "room_full"); } catch (_) {}
      return new Response(null, { status: 101, webSocket: client });
    }

    const peerId = `p_${crypto.randomUUID().slice(0, 8)}`;
    this.ctx.acceptWebSocket(server, ["role:guest", `peer:${peerId}`]);
    server.serializeAttachment({
      role: "guest",
      peerId,
      roomId,
      closed: false,
    });

    this._sendJson(server, {
      type: "relay_welcome",
      peerId,
      roomId,
    });

    for (const hostWs of hosts) {
      this._sendJson(hostWs, {
        type: "relay_peer_join",
        peerId,
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 262144) return;

    const meta = this._getActiveSocketMeta(ws);
    if (!meta) return;

    let pkt;
    try {
      pkt = JSON.parse(message);
    } catch (_) {
      return;
    }
    if (!pkt || typeof pkt !== "object") return;

    if (pkt.t === "ping") {
      this._sendJson(ws, { t: "pong", ts: pkt.ts || Date.now() });
      return;
    }

    if (meta.role === "host") {
      if (pkt.t === "b") {
        const encoded = JSON.stringify({ t: "d", from: "host", d: pkt.d });
        for (const guestWs of this.ctx.getWebSockets("role:guest")) {
          if (this._getActiveSocketMeta(guestWs)) {
            try { guestWs.send(encoded); } catch (_) {}
          }
        }
        return;
      }
      if (pkt.t === "d" && pkt.to) {
        const targetId = String(pkt.to);
        const encoded = JSON.stringify({ t: "d", from: "host", d: pkt.d });
        for (const targetWs of this.ctx.getWebSockets(`peer:${targetId}`)) {
          if (this._getActiveSocketMeta(targetWs)) {
            try { targetWs.send(encoded); } catch (_) {}
          }
        }
      }
      return;
    }

    if (meta.role === "guest" && pkt.t === "d") {
      const encoded = JSON.stringify({ t: "d", from: meta.peerId, d: pkt.d });
      for (const hostWs of this.ctx.getWebSockets("role:host")) {
        if (this._getActiveSocketMeta(hostWs)) {
          try { hostWs.send(encoded); } catch (_) {}
        }
      }
    }
  }

  async webSocketClose(ws) {
    this._handleDisconnect(ws);
  }

  async webSocketError(ws) {
    this._handleDisconnect(ws);
    try { ws.close(1011, "ws_error"); } catch (_) {}
  }

  _handleDisconnect(ws) {
    const closedSet = this._markClosedSet();
    if (closedSet.has(ws)) return;
    closedSet.add(ws);

    let meta = null;
    try {
      meta = ws.deserializeAttachment();
    } catch (_) {
      return;
    }
    if (!meta || meta.closed || meta.role === "rejected") return;

    try {
      ws.serializeAttachment({ ...meta, closed: true });
    } catch (_) {}

    if (meta.role === "guest") {
      for (const hostWs of this.ctx.getWebSockets("role:host")) {
        if (hostWs !== ws && this._getActiveSocketMeta(hostWs)) {
          this._sendJson(hostWs, {
            type: "relay_peer_leave",
            peerId: meta.peerId,
          });
        }
      }
      return;
    }

    if (meta.role === "host") {
      for (const guestWs of this.ctx.getWebSockets("role:guest")) {
        const gMeta = guestWs !== ws ? this._getActiveSocketMeta(guestWs) : null;
        if (gMeta) {
          closedSet.add(guestWs);
          this._sendJson(guestWs, { type: "relay_host_left" });
          try { guestWs.close(1000, "host_left"); } catch (_) {}
        }
      }
    }
  }
}
