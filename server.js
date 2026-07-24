const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const trueconf = require('./trueconf');
const mailer = require('./mailer');
require('dotenv').config();

const app = express();

app.set('trust proxy', 1);

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST'],
};
app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;
const BOT_USER = process.env.BOT_USER;
const STAFF_USER = process.env.STAFF_USER;
const API_KEY = process.env.API_KEY;

// Serve landing page static files (root)
app.use(express.static(__dirname));

// Serve widget files from public/
app.use(express.static(path.join(__dirname, 'public')));

const authenticate = (req, res, next) => {
  if (API_KEY) {
    const origin = req.header('Origin') || req.header('Referer');
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [];

    const isAllowedOrigin = allowedOrigins.some(allowed => {
      if (origin) {
        return origin.startsWith(allowed) || origin.includes(allowed);
      }
      return false;
    });

    if (isAllowedOrigin) {
      log('info', `Skipping API key check for allowed origin: ${origin}`);
      return next();
    }

    const providedKey = req.header('X-API-Key');
    if (providedKey !== API_KEY) {
      log('warn', `Unauthorized access attempt from ${req.ip} (origin: ${origin})`);
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
    }
  }
  next();
};

const requiredEnv = ['TRUECONF_SERVER', 'CLIENT_ID', 'CLIENT_SECRET', 'BOT_USER', 'STAFF_USER'];
const missingEnv = requiredEnv.filter(env => !process.env[env]);

if (missingEnv.length > 0) {
  console.warn(`WARNING: Missing TrueConf env vars: ${missingEnv.join(', ')}. Chat will be disabled.`);
}

function log(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, Object.keys(metadata).length ? metadata : '');
}

const socketToChat = new Map();
const chatToSocket = new Map();
const clients = new Map();
const socketToMeta = new Map();

const contactLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests, please try again later.' }
});

const BLOCKED_EMAIL_DOMAINS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.vn',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'protonmail.com', 'proton.me', 'mail.ru', 'yandex.com', 'yandex.ru'
];

app.post('/api/contact', contactLimit, authenticate, async (req, res) => {
  const { name, position, email, subject, message } = req.body;

  if (!name || !position || !email || !message) {
    return res.status(400).json({ error: 'Name, position, email, and message are required.' });
  }

  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (emailDomain && BLOCKED_EMAIL_DOMAINS.includes(emailDomain)) {
    return res.status(400).json({ error: 'Vui lòng sử dụng email công việc (doanh nghiệp), không chấp nhận email cá nhân.' });
  }

  log('info', `Received contact form from ${name} (${email})`);

  try {
    const result = await mailer.sendContactEmail(req.body);
    if (result.success) {
      res.status(200).json({ message: 'Message sent successfully.' });
    } else {
      res.status(500).json({ error: 'Failed to send message.', details: result.error });
    }
  } catch (err) {
    log('error', 'Unexpected error in contact API', { error: err.message });
    res.status(500).json({ error: 'Internal server error.' });
  }
});

wss.on('connection', async (ws) => {
  const socketId = `user_${Math.random().toString(36).substr(2, 9)}`;
  log('info', `New browser client connected: ${socketId}`);

  clients.set(socketId, ws);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'init') {
        const { name, phone, site, apiKey } = message;

        if (API_KEY) {
          const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [];

          const isAllowedSite = allowedOrigins.some(allowed => {
            return site && (site.includes(allowed.replace(/^https?:\/\//, '').replace(/^www\./, '')) ||
              allowed.includes(site));
          });

          if (!isAllowedSite && apiKey !== API_KEY) {
            log('warn', `Unauthorized WebSocket init attempt for ${socketId} from site: ${site}`);
            ws.send(JSON.stringify({ type: 'error', text: 'Unauthorized: Invalid API Key' }));
            return;
          }

          if (isAllowedSite) {
            log('info', `Skipping API key check for allowed site: ${site}`);
          }
        }

        log('info', `Initializing session for ${socketId} (${name}, ${phone}, ${site})`);

        try {
          const chatTitle = `${name} - ${phone}`;
          log('info', `Creating TrueConf group chat: ${chatTitle}`);

          const chatData = await trueconf.createGroupChat(chatTitle);
          const chatId = chatData.chatId;

          if (!chatId) throw new Error('No chatId returned');

          socketToChat.set(socketId, chatId);
          chatToSocket.set(chatId, socketId);
          socketToMeta.set(socketId, { name, phone, site });

          // Add the bot as participant (non-blocking — bot is usually already a member as creator)
          trueconf.addChatParticipant(chatId, BOT_USER).catch(e => {
            log('warn', `Bot add-participant skipped (expected): ${e.message}`);
          });

          // Invite staff
          const staffList = STAFF_USER.split(',').map(id => id.trim()).filter(id => id);
          for (const staffId of staffList) {
            try {
              await trueconf.addChatParticipant(chatId, staffId);
            } catch (e) {
              log('warn', `Failed to invite ${staffId}`);
            }
          }

          const introMessage = `🔔 *New Support Request*\n\n👤 *Name:* ${name}\n📞 *Phone:* ${phone}\n🌐 *Website:* ${site}`;
          log('info', `Sending intro message to chat ${chatId}`);
          await trueconf.sendMessage(chatId, introMessage);

          ws.send(JSON.stringify({ type: 'system', text: `Welcome ${name}! Private session started.` }));
          log('info', `Session initialized for ${socketId} -> ${chatId}`);
        } catch (err) {
          log('error', `Failed to init chat for ${socketId}`, { error: err.message });
          ws.send(JSON.stringify({ type: 'error', text: 'Failed to start session. Please try again.' }));
        }
      } else if (message.type === 'chat') {
        const chatId = socketToChat.get(socketId);
        if (!chatId) {
          log('error', `No chatId found for socket ${socketId}`);
          return;
        }

        log('info', `Message from ${socketId} to chat ${chatId}`, { text: message.text });

        try {
          const meta = socketToMeta.get(socketId);
          const prefix = meta ? `${meta.name}: ` : '';
          await trueconf.sendMessage(chatId, prefix + message.text);
        } catch (err) {
          log('error', `Failed to send message to TrueConf chat ${chatId}`, { error: err.message });
          ws.send(JSON.stringify({ type: 'error', text: 'Failed to send message' }));
        }
      }
    } catch (err) {
      log('error', `Error processing browser message from ${socketId}`, { error: err.message });
    }
  });

  ws.on('close', () => {
    const chatId = socketToChat.get(socketId);
    log('info', `Browser client disconnected: ${socketId} (Chat: ${chatId})`);

    if (chatId) {
      chatToSocket.delete(chatId);
    }
    socketToChat.delete(socketId);
    clients.delete(socketId);
    socketToMeta.delete(socketId);
  });
});

trueconf.onChatMessage = (payload) => {
  const chatId = payload.chatId;
  const senderId = payload.author ? payload.author.id : null;
  const textMessage = payload.content ? payload.content.text : null;

  // Normalize sender comparison: TrueConf may report ID as "bot" or "bot@domain"
  const senderName = senderId ? senderId.split('@')[0] : null;
  if (!textMessage || senderName === BOT_USER || senderId === BOT_USER) return;

  const targetSocketId = chatToSocket.get(chatId);

  if (targetSocketId) {
    const client = clients.get(targetSocketId);
    if (client) {
      log('info', `Routing message from TrueConf chat ${chatId} to browser client ${targetSocketId}`);

      const friendlyName = senderId ? senderId.split('@')[0] : 'Support';

      client.send(JSON.stringify({
        type: 'agent',
        text: textMessage,
        sender: friendlyName
      }));
    } else {
      log('warn', `Client ${targetSocketId} connection not found for chat ${chatId}`);
      chatToSocket.delete(chatId);
    }
  } else {
    log('debug', `Ignoring message for unmapped chat ${chatId} (likely not a web-guest chat)`);
  }
};

async function connectTrueConfWithRetry() {
  if (missingEnv.length > 0) {
    log('warn', 'Skipping TrueConf connection due to missing env vars.');
    return;
  }
  const maxDelay = 30000;
  let attempt = 0;
  const tryConnect = async () => {
    attempt++;
    try {
      await trueconf.connect();
      log('info', 'TrueConf API connected successfully');
    } catch (err) {
      const delay = Math.min(1000 * Math.pow(2, attempt), maxDelay);
      log('warn', `TrueConf connection failed (attempt ${attempt}), retrying in ${delay / 1000}s`, { error: err.message });
      setTimeout(tryConnect, delay);
    }
  };
  tryConnect();
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Widget available at http://localhost:${PORT}/widget.js`);
});

connectTrueConfWithRetry();
