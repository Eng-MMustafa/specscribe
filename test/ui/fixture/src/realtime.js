const { WebSocketServer } = require('./mini-ws');

function setupRealtime(server) {
  const io = new WebSocketServer({ server });
  io.on('connection', (socket) => {
    // Answer a ping with a pong.
    socket.on('ping', (payload, callback) => {
      callback({ pong: true, echo: payload });
    });
  });
}

module.exports = { setupRealtime };
