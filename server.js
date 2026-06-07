require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = process.env.PORT || 3001;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not set in .env');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const OPENAI_WS = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5';

const SYSTEM_PROMPT = `You are "Summit" — an AI assistant for the user's business and daily life. Personality: Calm, focused, efficient. Like J.A.R.V.I.S. from Iron Man. Keep responses concise. Never make up data about campaign performance. Keep responses under 30 seconds.`;

wss.on('connection', async (browserWs) => {
  console.log('🔌 Browser connected');

  try {
    const openaiWs = new WebSocket(OPENAI_WS, {
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}` }
    });

    let openaiReady = false;
    let messageQueue = [];

    openaiWs.on('open', () => {
      console.log('🔗 Connected to OpenAI Realtime API');
      openaiReady = true;
      // Flush queued messages
      for (const msg of messageQueue) {
        openaiWs.send(JSON.stringify(msg));
      }
      messageQueue = [];
    });

    openaiWs.on('message', (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.type === 'response.output_audio.delta') {
        browserWs.send(JSON.stringify({ type: 'audio', delta: data.delta }));
      } else if (data.type === 'response.output_audio.done') {
        browserWs.send(JSON.stringify({ type: 'audio_done' }));
      } else if (data.type === 'response.output_audio_transcript.delta') {
        browserWs.send(JSON.stringify({ type: 'text', delta: data.delta }));
      } else if (data.type === 'error') {
        console.error('OpenAI error:', data.error);
        browserWs.send(JSON.stringify({ type: 'error', message: data.error?.message || 'Unknown error' }));
      }
    });

    function sendToOpenAI(msg) {
      if (openaiReady && openaiWs.readyState === 1) {
        openaiWs.send(JSON.stringify(msg));
      } else {
        messageQueue.push(msg);
      }
    }

    browserWs.on('message', (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.type === 'audio') {
        sendToOpenAI({ type: 'input_audio_buffer.append', audio: data.delta });
      } else if (data.type === 'audio_done') {
        sendToOpenAI({ type: 'input_audio_buffer.commit' });
        sendToOpenAI({ type: 'response.create', response: { instructions: SYSTEM_PROMPT } });
      } else if (data.type === 'ping') {
        browserWs.send(JSON.stringify({ type: 'pong' }));
      }
    });

    browserWs.on('close', () => {
      console.log('🔌 Browser disconnected');
      openaiWs.close();
    });

    openaiWs.on('close', () => {
      console.log('🔗 OpenAI disconnected');
      browserWs.close();
    });

    openaiWs.on('error', (err) => {
      console.error('OpenAI WS error:', err.message);
      browserWs.send(JSON.stringify({ type: 'error', message: err.message }));
    });

  } catch (err) {
    console.error('Connection error:', err);
    browserWs.send(JSON.stringify({ type: 'error', message: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎙️  Summit J.A.R.V.I.S. Voice Assistant`);
  console.log(`   Server: http://0.0.0.0:${PORT}`);
  console.log(`   OpenAI: ${OPENAI_KEY ? '✅ Key set' : '❌ No key'}\n`);
});