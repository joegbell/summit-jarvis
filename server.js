require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not set in .env');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });

app.use(express.static(path.join(__dirname, 'public')));

const OPENAI_WS = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5';
let agentWs = null; // Connected AI agent from sandbox

const SYSTEM_PROMPT = `You are the voice of Summit Commissions — an AI-powered affiliate marketing business. You speak as the team lead.

ABOUT THE USER: Jim. He runs Summit Commissions alongside you while working a driving job. Voice communication while on the road is critical.

WHAT YOU MANAGE: Wealth DNA Code campaign ($150 bootstrap, $20/day active). Ad sets: Manifestation & Spiritual. ClickBank affiliate summitcomm (75% WDC). GitHub: summit-commissions-ads-bot.

PERSONALITY: Calm, focused, efficient — like J.A.R.V.I.S. from Iron Man. Professional but warm. Brief responses under 20 seconds.

RULES: Never make up campaign data. If you don't know, say so. For business questions, you can reference that you have a direct connection to the AI agent who manages the backend systems.`;

wss.on('connection', (ws, req) => {
  const pathname = url.parse(req.url).pathname || '/';

  // === AGENT CONNECTION (from sandbox) ===
  if (pathname === '/agent') {
    console.log('🤖 AI Agent connected from sandbox');
    agentWs = ws;

    ws.on('message', async (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.type === 'agent_response') {
        console.log('💬 Agent response received');
      }
      if (data.type === 'agent_initiated') {
        console.log('🤖 Agent initiated:', data.text?.substring(0, 50));
        try {
          // Use OpenAI TTS with WAV format, strip header to get raw PCM16
          const ttsResp = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tts-1', input: data.text, voice: 'onyx', response_format: 'wav' })
          });
          if (ttsResp.ok) {
            const buf = Buffer.from(await ttsResp.arrayBuffer());
            const dataUrl = 'data:audio/wav;base64,' + buf.toString('base64');
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'text', delta: data.text }));
                client.send(JSON.stringify({ type: 'play_audio', url: dataUrl }));
              }
            });
            console.log('🔊 Spoken to browser via data URL');
          } else {
            const errText = await ttsResp.text();
            console.error('TTS API error:', errText.substring(0, 200));
          }
        } catch(e) { console.error('TTS error:', e.message); }
      }
    });

    ws.on('close', () => {
      console.log('🤖 AI Agent disconnected');
      agentWs = null;
    });

    ws.send(JSON.stringify({ type: 'agent_registered', status: 'connected' }));
    return;
  }

  // === BROWSER CONNECTION (Jim's phone) ===
  console.log('🔌 Browser connected');

  const openaiWs = new WebSocket(OPENAI_WS, {
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}` }
  });

  let openaiReady = false;
  let messageQueue = [];
  let userTranscript = '';

  openaiWs.on('open', () => {
    console.log('🔗 Connected to OpenAI Realtime API');
    openaiReady = true;
    for (const msg of messageQueue) openaiWs.send(JSON.stringify(msg));
    messageQueue = [];
  });

  openaiWs.on('message', (raw) => {
    const data = JSON.parse(raw.toString());

    if (data.type === 'session.created') {
      // Disable auto-response — agent bridge handles all speech
      sendToOpenAI({ type: 'session.update', session: { turn_detection: null } });
    }

    if (data.type === 'response.output_audio.delta') {
      ws.send(JSON.stringify({ type: 'audio', delta: data.delta }));
    } else if (data.type === 'response.output_audio.done') {
      ws.send(JSON.stringify({ type: 'audio_done' }));
    } else if (data.type === 'response.output_audio_transcript.delta') {
      ws.send(JSON.stringify({ type: 'text', delta: data.delta }));
    } else if (data.type === 'error') {
      console.error('OpenAI error:', data.error);
      ws.send(JSON.stringify({ type: 'error', message: data.error?.message || 'Error' }));
    }
  });

  function sendToOpenAI(msg) {
    if (openaiReady && openaiWs.readyState === 1) openaiWs.send(JSON.stringify(msg));
    else messageQueue.push(msg);
  }

  ws.on('message', (raw) => {
    const data = JSON.parse(raw.toString());

    if (data.type === 'audio') {
      sendToOpenAI({ type: 'input_audio_buffer.append', audio: data.delta });
    } else if (data.type === 'audio_done') {
      sendToOpenAI({ type: 'input_audio_buffer.commit' });

      // Forward transcript to connected agent
      if (agentWs && agentWs.readyState === 1) {
        // Cancel any OpenAI response — only agent should speak
        sendToOpenAI({ type: 'response.cancel' });
        agentWs.send(JSON.stringify({
          type: 'user_query',
          text: userTranscript || 'User finished speaking'
        }));
        userTranscript = '';
        // Agent is connected — DON'T let OpenAI respond, wait for agent
      } else {
        // No agent connected — use local AI
        sendToOpenAI({
          type: 'response.create',
          response: { instructions: SYSTEM_PROMPT }
        });
      }
    } else if (data.type === 'text') {
      userTranscript += data.delta || '';
    } else if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    console.log('🔌 Browser disconnected');
    openaiWs.close();
  });

  openaiWs.on('close', () => ws.close());
  openaiWs.on('error', (err) => {
    console.error('OpenAI WS error:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎙️  Summit J.A.R.V.I.S. (Agent Bridge Mode)`);
  console.log(`   Server: http://0.0.0.0:${PORT}`);
  console.log(`   Agent endpoint: ws://0.0.0.0:${PORT}/agent`);
  console.log(`   OpenAI: ${OPENAI_KEY ? '✅ Key set' : '❌ No key'}\n`);
});