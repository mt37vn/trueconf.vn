const axios = require('axios');
const https = require('https');
const WebSocket = require('ws');
require('dotenv').config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

class TrueConfAPI {
    constructor() {
        this.server = process.env.TRUECONF_SERVER;
        this.clientId = process.env.CLIENT_ID;
        this.clientSecret = process.env.CLIENT_SECRET;
        this.botUser = process.env.BOT_USER;
        this.botPass = process.env.BOT_PASS;

        // For 5.5.2+, the path is usually /websocket/chat_bot/ with a trailing slash
        // We use port 443/wss if available, otherwise 4309/ws
        this.bridgeUrl = `wss://${this.server}/websocket/chat_bot/`;
        this.tokenUrl = `https://${this.server}/bridge/api/client/v1/oauth/token`;

        this.ws = null;
        this.accessToken = null;
        this.requestId = 1;
        this.callbacks = new Map();       // requestId → { resolve, reject } (for type 2 responses)
        this.eventQueue = new Map();       // methodName → [ { resolve, reject, timeout }, ... ] (queue for type 1 notifications)
        this.onMessageReceived = null;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 30000;
        this.isAuthorizing = false;
    }

    log(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [TRUECONF_${level.toUpperCase()}] ${message}`, Object.keys(metadata).length ? metadata : '');
    }

    async getAccessToken() {
        try {
            this.log('info', 'Requesting new access token (Bridge JWT)...');
            const response = await axios.post(this.tokenUrl, {
                client_id: 'chat_bot',
                grant_type: 'password',
                username: this.botUser,
                password: this.botPass
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                httpsAgent
            });
            this.accessToken = response.data.access_token;
            this.log('info', 'TrueConf Access Token obtained successfully.');
            return this.accessToken;
        } catch (error) {
            this.log('error', 'Error obtaining TrueConf access token', { error: error.response ? error.response.data : error.message });
            throw error;
        }
    }

    async login() {
        this.log('info', 'Sending login request...');
        return this.sendRequest('login', {
            login: this.botUser,
            password: this.botPass
        });
    }

    async connect() {
        if (!this.accessToken) {
            await this.getAccessToken();
        }

        return new Promise((resolve, reject) => {
            this.log('info', `Connecting to WebSocket: ${this.bridgeUrl}`);
            // Use 'json.v1' subprotocol as required by TrueConf 5.5
            this.ws = new WebSocket(this.bridgeUrl, 'json.v1', {
                rejectUnauthorized: false
            });

            this.ws.on('open', async () => {
                this.log('info', 'Connected to TrueConf Chat WebSocket.');
                this.reconnectAttempts = 0; // Reset reconnection backoff
                try {
                    await this.authorize();
                    resolve();
                } catch (err) {
                    this.log('error', 'Authentication failed during connect', { error: err.message });
                    reject(err);
                }
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    // Log ALL incoming messages for debugging
                    if (message.type === 2 && !this.callbacks.has(message.id)) {
                        this.log('warn', `UNHANDLED response (no callback) for ID ${message.id}`, { message });
                    }
                    if (message.type === 1 && message.method === 'sendMessage') {
                        this.log('info', 'RAW sendMessage notification arrived', { payload: message.payload });
                    }
                    this.handleIncomingMessage(message);
                } catch (err) {
                    this.log('error', 'Error parsing incoming message', { error: err.message, data: data.toString() });
                }
            });

            this.ws.on('error', (error) => {
                this.log('error', 'WebSocket Error', { error: error.message || error });
                reject(error);
            });

            this.ws.on('close', (code, reason) => {
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
                this.log('warn', `TrueConf connection closed (Code: ${code}, Reason: ${reason}). Reconnecting in ${delay / 1000}s...`);
                this.reconnectAttempts++;
                setTimeout(() => this.connect().catch(err => this.log('error', 'Scheduled reconnection failed', { error: err.message })), delay);
            });
        });
    }

    async authorize() {
        this.log('info', 'Sending authorization request...');
        return this.sendRequest('auth', {
            token: this.accessToken,
            tokenType: "JWT",
            receiveUnread: true
        });
    }

    sendRequest(method, payload = {}) {
        return new Promise((resolve, reject) => {
            const id = this.requestId++;
            const message = {
                type: 1, // REQUEST
                id: id,
                method: method,
                payload: payload
            };

            this.callbacks.set(id, { resolve, reject });
            this.log('debug', 'Sending message', { message });
            this.ws.send(JSON.stringify(message));

            // Timeout if no response
            setTimeout(() => {
                if (this.callbacks.has(id)) {
                    this.callbacks.get(id).reject(new Error(`Request ${method} timed out after 30s`));
                    this.callbacks.delete(id);
                }
            }, 30000);
        });
    }

    handleIncomingMessage(message) {
        this.log('debug', 'Received message', { message });
        if (message.payload) {
            this.log('debug', `Payload keys: ${Object.keys(message.payload).join(', ')}`, { payload: message.payload });
        }

        // Handle RESPONSE (type 2) — resolves by requestId
        if (message.type === 2) {
            const callback = this.callbacks.get(message.id);
            if (callback) {
                const payload = message.payload || {};
                if (payload.error || (payload.errorCode !== undefined && payload.errorCode !== 0)) {
                    const errorMsg = payload.error || `Error code: ${payload.errorCode}`;
                    this.log('error', `Response error for ID ${message.id}`, { error: errorMsg });
                    callback.reject(new Error(errorMsg));
                } else {
                    this.log('info', `Resolved response for ID ${message.id} — keys: [${Object.keys(payload).join(', ')}]`);
                    callback.resolve(payload);
                }
                this.callbacks.delete(message.id);
            }
            return;
        }

        // Handle NOTIFICATION (type 1)
        if (message.type !== 1) return;

        // Always acknowledge server notifications
        this.log('debug', `Acknowledging server notification ID ${message.id} (${message.method})`);
        this.ws.send(JSON.stringify({ type: 2, id: message.id }));

        const method = message.method;
        const payload = message.payload || {};

        // Check if a pending event callback is waiting for this notification
        if (this.eventQueue.has(method) && this.eventQueue.get(method).length > 0) {
            const queue = this.eventQueue.get(method);
            const cb = queue.shift();
            this.log('info', `Resolving event callback for ${method} — keys: [${Object.keys(payload).join(', ')}]`);
            clearTimeout(cb.timeout);
            cb.resolve(payload);
            if (queue.length === 0) this.eventQueue.delete(method);
        }

        // Route notifications to specific handlers
        switch (method) {
            case 'sendMessage':
                this.log('info', 'New chat message received');
                const author = payload.author;
                this.log('info', `sendMessage notification — author: ${author ? JSON.stringify(author) : 'null'}`);
                if (this.onChatMessage) {
                    this.onChatMessage(payload);
                }
                break;
            case 'createGroupChat':
                this.log('info', 'Group chat created via notification', { chatId: payload.chatId });
                break;
            case 'addChatParticipant':
                this.log('info', 'Chat participant added via notification');
                break;
            default:
                this.log('debug', `Other server notification: ${method}`, { message });
        }
    }

    /**
     * Send a command that resolves via notification (type 1) instead of response (type 2).
     * TrueConf Bridge broadcasts the outcome as a notification to all connected clients.
     * Uses a queue per method so multiple concurrent commands of the same type work.
     */
    sendEventCommand(method, payload = {}) {
        return new Promise((resolve, reject) => {
            const id = this.requestId++;
            const message = {
                type: 1,
                id: id,
                method: method,
                payload: payload
            };
            this.log('debug', `Sending event command: ${method}`, { message });
            this.ws.send(JSON.stringify(message));

            // Push to queue for this method
            if (!this.eventQueue.has(method)) {
                this.eventQueue.set(method, []);
            }
            const queue = this.eventQueue.get(method);

            const timeout = setTimeout(() => {
                // Find this entry in the queue by reference and remove it
                const idx = queue.findIndex(entry => entry.timeout === timeout);
                if (idx !== -1) {
                    queue[idx].reject(new Error(`Event ${method} timed out after 30s`));
                    queue.splice(idx, 1);
                    if (queue.length === 0) this.eventQueue.delete(method);
                }
            }, 30000);

            queue.push({ resolve, reject, timeout });
        });
    }

    async createGroupChat(name) {
        return this.sendRequest('createGroupChat', {
            title: name,
            type: 1 // GROUP_CHAT
        });
    }

    async addChatParticipant(chatId, userId) {
        return this.sendRequest('addChatParticipant', {
            chatId: chatId,
            userId: userId
        });
    }

    async sendMessage(chatId, text) {
        return this.sendRequest('sendMessage', {
            chatId: chatId,
            content: {
                text: text,
                parseMode: 'text'
            }
        });
    }

    async getChats() {
        return this.sendRequest('getChats', {
            count: 50,
            page: 1
        });
    }
}

module.exports = new TrueConfAPI();
