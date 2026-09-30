const http = require('http');
const crypto = require('crypto');
const url = require('url');
const EventEmitter = require('events');
const { startServer, stopServer } = require('../../server');

class BetterNativeClient extends EventEmitter {
  constructor(wsUrl) {
    super();
    this.url = wsUrl;
    this.buffer = Buffer.alloc(0);
    this.readyState = 0;
    this._connect();
  }

  _connect() {
    const parsed = url.parse(this.url);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: parsed.hostname || '127.0.0.1',
      port: parsed.port || 80,
      path: parsed.path,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });

    req.on('upgrade', (res, socket, head) => {
      this.socket = socket;
      this.readyState = 1;
      this.emit('open');

      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', () => {
        if (this.readyState !== 3) {
          this.readyState = 3;
          this.emit('close', 1006, 'Socket closed without clean frame');
        }
      });
      socket.on('error', (e) => this.emit('error', e));

      // Process head if data arrived with headers
      if (head && head.length > 0) {
        this._onData(head);
      }
    });

    req.on('error', (e) => {
      this.readyState = 3;
      this.emit('error', e);
    });

    req.end();
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];
      const opcode = byte1 & 0x0f;
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

      if (this.buffer.length < offset + payloadLen) break;
      const payload = this.buffer.slice(offset, offset + payloadLen);
      this.buffer = this.buffer.slice(offset + payloadLen);

      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x8) {
        let code = 1000;
        let reason = '';
        if (payloadLen >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.slice(2).toString('utf8');
        }
        this.readyState = 3;
        this.emit('close', code, reason);
      }
    }
  }
}

async function run() {
  await startServer(3398);
  const client = new BetterNativeClient('ws://127.0.0.1:3398/telemetry'); // no token
  client.on('close', (code, reason) => {
    console.log(`Received close frame: code=${code}, reason="${reason}"`);
    stopServer().then(() => process.exit(0));
  });
}

run();
