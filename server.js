require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });

app.use(express.static(path.join(__dirname, 'public')));

let agentWs = null;

wss.on('connection', (ws, req) => {
  const pathname = url.parse(req.url).pathname || '/';

  // === AGENT CONNECTION (from sandbox) ===
  if (pathname === '/agent') {
    console.log('🤖 Agent connected');
    agentWs = ws;
    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        // Relay agent_response to all browser clients
        if (data.type === 'agent_response') {
          wss.clients.forEach(c => {
            if (c !== ws && c.readyState === WebSocket.OPEN) {
              c.send(JSON.stringify(data));
            }
          });
        }
      } catch(e) { console.error('Agent msg error:', e.message); }
    });
    ws.on('close', () => { agentWs = null; console.log('🤖 Agent disconnected'); });
    ws.send(JSON.stringify({ type: 'agent_registered' }));
    return;
  }

  // === BROWSER CONNECTION ===
  console.log('🔌 Browser connected');

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'user_text') {
        console.log('🎙️ User:', data.text?.substring(0, 50));
        if (agentWs && agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({ type: 'user_query', text: data.text }));
        }
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch(e) {}
  });

  ws.on('close', () => console.log('🔌 Browser disconnected'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎙️ Summit J.A.R.V.I.S. (Edge-Neural Bridge)`);
  console.log(`   http://0.0.0.0:${PORT}`);
  console.log(`   Agent: ws://0.0.0.0:${PORT}/agent\n`);
});