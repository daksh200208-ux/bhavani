const net = require('net');
const crypto = require('crypto');
const { startServer, stopServer } = require('../../server');

async function test() {
  const server = await startServer(3399);

  const socket = net.createConnection({ port: 3399, host: '127.0.0.1' }, () => {
    console.log('Connected to server via TCP');
    const key = crypto.randomBytes(16).toString('base64');
    const request = 
      'GET /telemetry HTTP/1.1\r\n' +
      'Host: 127.0.0.1:3399\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${key}\r\n` +
      'Sec-WebSocket-Version: 13\r\n\r\n';
    socket.write(request);
  });

  socket.on('data', (chunk) => {
    console.log('Received raw chunk of length:', chunk.length);
    console.log('Hex dump:', chunk.toString('hex'));
    console.log('Ascii dump:', chunk.toString('utf8'));
  });

  socket.on('close', (hadError) => {
    console.log('Socket closed, hadError:', hadError);
    stopServer().then(() => process.exit(0));
  });

  socket.on('error', (err) => {
    console.log('Socket error:', err.message);
  });
}

test().catch(console.error);
