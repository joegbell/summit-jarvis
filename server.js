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

const OPENAI_WS = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `You are "Summit" — an AI assistant for the user's business and daily life.

PERSONALITY: Calm, focused, efficient. Like J.A.R.V.I.S. from Iron Man. Professional but warm. Keep responses concise.

CAPABILITIES:
- You can help with the affiliate marketing business: check campaign status, suggest improvements
- You can answer questions, have conversations, provide information
- You're aware you're connected to the Summit Commissions business systems

RULES:
- Never make up data about campaign performance — say "I don't have that data right now"
- Keep responses under 30 seconds for safety
- If asked something you can't do, say so clearly
- Use natural conversational English`;

wss.on('connection', async (browserWs) => {
  console.log('🔌 Browser connected');

  try {
    const openaiWs = new WebSocket(OPENAI_WS, {
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    openaiWs.on('open', () => {
      console.log('🔗 Connected to OpenAI Realtime API');
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions: SYSTEM_PROMPT,
          modalities: ['text', 'audio'],
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 700
          }
        }
      }));
    });

    let openaiReady = false;
    let messageQueue = [];

    openaiWs.on('message', (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.type === 'response.audio.delta') {
        browserWs.send(JSON.stringify({ type: 'audio', delta: data.delta }));
      } else if (data.type === 'response.audio_buffer.done') {
        browserWs.send(JSON.stringify({ type: 'audio_done' }));
      } else if (data.type === 'response.text.delta') {
        browserWs.send(JSON.stringify({ type: 'text', delta: data.delta }));
      } else if (data.type === 'response.done') {
        /* response complete */
      } else if (data.type === 'error') {
        console.error('OpenAI error:', data);
        browserWs.send(JSON.stringify({ type: 'error', message: data.error?.message || 'Unknown error' }));
      }
    });

    openaiWs.on('open', () => {
      openaiReady = true;
      // Flush queued messages
      for (const msg of messageQueue) {
        openaiWs.send(JSON.stringify(msg));
      }
      messageQueue = [];
    });

    function sendToOpenAI(type, payload) {
      const msg = { type, ...payload };
      if (openaiReady && openaiWs.readyState === 1) {
        openaiWs.send(JSON.stringify(msg));
      } else {
        messageQueue.push(msg);
      }
    }

    browserWs.on('message', (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.type === 'audio') {
        sendToOpenAI('input_audio_buffer.append', { audio: data.delta });
      } else if (data.type === 'audio_done') {
        sendToOpenAI('input_audio_buffer.commit', {});
        sendToOpenAI('response.create', { response: { modalities: ['text', 'audio'] } });
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