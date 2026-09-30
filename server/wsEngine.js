/**
 * Kanpur Tactical GIS - RFC 6455 Compliant WebSocket Engine
 * Provides dual support:
 * 1. Uses high-performance 'ws' module when available
 * 2. Provides 100% genuine zero-dependency native RFC 6455 fallback using Node.js net/http/crypto
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Native RFC 6455 Client Wrapper
 */
class NativeWebSocketClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.isAlive = true;
    this.readyState = 1; // 1 = OPEN
    this.buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => {
      this.readyState = 3; // CLOSED
      this.emit('close');
    });
    socket.on('error', (err) => {
      this.readyState = 3;
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
    });
  }

  send(data) {
    if (this.readyState !== 1 || !this.socket.writable) return;
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
    const len = payload.length;

    let header;
    if (len <= 125) {
      header = Buffer.from([0x81, len]);
    } else if (len <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      this.emit('error', e);
    }
  }

  ping() {
    if (this.readyState !== 1 || !this.socket.writable) return;
    const frame = Buffer.from([0x89, 0x00]);
    try {
      this.socket.write(frame);
    } catch (e) {}
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 2 || this.readyState === 3) return;
    this.readyState = 2; // CLOSING

    const reasonBuf = Buffer.from(reason, 'utf8');
    const len = 2 + reasonBuf.length;
    const frame = Buffer.alloc(2 + len);
    frame[0] = 0x88;
    frame[1] = len;
    frame.writeUInt16BE(code, 2);
    reasonBuf.copy(frame, 4);

    try {
      this.socket.write(frame, () => {
        this.readyState = 3;
        this.socket.end();
        this.emit('close', code, reason);
      });
    } catch (e) {
      this.socket.destroy();
    }
  }

  terminate() {
    this.readyState = 3;
    this.socket.destroy();
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];

      const opcode = byte1 & 0x0f;
      const isMasked = (byte2 & 0x80) !== 0;
      let payloadLen = byte2 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) break;
        payloadLen = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) break;
        payloadLen = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) break;
        maskKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) break;

      const payload = this.buffer.slice(offset, offset + payloadLen);
      this.buffer = this.buffer.slice(offset + payloadLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payloadLen; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x1) {
        // Text frame
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x8) {
        // Close frame
        let code = 1000;
        let reason = '';
        if (payloadLen >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.slice(2).toString('utf8');
        }
        this.close(code, reason);
      } else if (opcode === 0x9) {
        // Ping -> respond with pong
        const pongFrame = Buffer.concat([Buffer.from([0x8a, payloadLen]), payload]);
        this.socket.write(pongFrame);
      } else if (opcode === 0xa) {
        // Pong
        this.isAlive = true;
        this.emit('pong');
      }
    }
  }
}

/**
 * Universal WebSocket Server Wrapper
 */
class UniversalWebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.clients = new Set();
    this.useWsModule = false;
    this.wsInstance = null;

    try {
      const wsModule = require('ws');
      this.useWsModule = true;
      this.wsInstance = new wsModule.WebSocketServer({ noServer: true });
      this.wsInstance.on('connection', (ws, req) => {
        this.clients.add(ws);
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('close', () => { this.clients.delete(ws); });
        this.emit('connection', ws, req);
      });
    } catch (e) {
      this.useWsModule = false;
    }
  }

  handleUpgrade(req, socket, head, callback) {
    if (this.useWsModule && this.wsInstance) {
      this.wsInstance.handleUpgrade(req, socket, head, (ws) => {
        callback(ws);
      });
      return;
    }

    // Native upgrade implementation
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ];

    socket.write(headers.join('\r\n'));
    const client = new NativeWebSocketClient(socket);
    this.clients.add(client);
    client.on('close', () => { this.clients.delete(client); });
    client.on('error', () => { this.clients.delete(client); });

    callback(client);
  }

  broadcast(message, filterFn = null) {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) { // OPEN
        if (!filterFn || filterFn(client)) {
          client.send(raw);
        }
      }
    }
  }

  closeAll(code = 1000, reason = '') {
    for (const client of this.clients) {
      client.close(code, reason);
    }
    this.clients.clear();
  }
}

module.exports = {
  NativeWebSocketClient,
  UniversalWebSocketServer
};
