require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const url = require('url');
const fs = require('fs');

const PORT = process.env.PORT || 3001;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) { console.error('❌ No API key'); process.exit(1); }

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });

app.use(express.static(path.join(__dirname, 'public')));

let agentWs = null; // Connected AI agent from sandbox

wss.on('connection', (ws, req) => {
  const pathname = url.parse(req.url).pathname || '/';

  // === AGENT CONNECTION (from sandbox) ===
  if (pathname === '/agent') {
    console.log('🤖 Agent connected');
    agentWs = ws;
    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'agent_initiated') {
          console.log('🤖 Agent says:', data.text?.substring(0, 50));
          // Generate TTS and send to all browsers
          const resp = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tts-1', input: data.text, voice: 'onyx', response_format: 'wav' })
          });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            const filename = 'speech-' + Date.now() + '.wav';
            fs.writeFileSync(path.join(__dirname, 'public', filename), buf);
            wss.clients.forEach(c => {
              if (c !== ws && c.readyState === WebSocket.OPEN) {
                c.send(JSON.stringify({ type: 'agent_text', text: data.text }));
                c.send(JSON.stringify({ type: 'play_audio', url: '/' + filename }));
              }
            });
          }
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
        // User sent text from speech recognition
        console.log('🎙️ User:', data.text?.substring(0, 50));
        // Forward to agent if connected
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
  console.log(`\n🎙️ Summit J.A.R.V.I.S. (Simplified Bridge)`);
  console.log(`   http://0.0.0.0:${PORT}`);
  console.log(`   Agent: ws://0.0.0.0:${PORT}/agent\n`);
});