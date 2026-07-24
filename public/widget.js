/* public/widget.js */
(function () {
    const CHAT_BACKEND = window.TRUECONF_CHAT_BACKEND || "wss://trueconf-webchat.onrender.com";
    const CONFIG = {
        serverUrl: CHAT_BACKEND,
        title: 'Hỗ trợ trực tuyến',
        subtitle: 'Đang trực tuyến',
        site: window.location.hostname || 'unknown-site'
    };

    function init() {
        const widgetHtml = `
            <div id="tc-chat-widget">
                <div id="tc-chat-header">
                    <div id="tc-chat-header-info">
                        <span id="tc-chat-header-title">${CONFIG.title}</span>
                        <span id="tc-chat-status">${CONFIG.subtitle}</span>
                    </div>
                    <span id="tc-chat-close">&times;</span>
                </div>
                <div id="tc-chat-messages"></div>
                <div id="tc-chat-form-container">
                    <p class="tc-form-instruction">Vui lòng nhập thông tin để bắt đầu trò chuyện.</p>
                    <input type="text" id="tc-chat-name" placeholder="Tên của bạn" required>
                    <input type="tel" id="tc-chat-phone" placeholder="Số điện thoại" required>
                    <button id="tc-chat-form-submit">Bắt đầu trò chuyện</button>
                </div>
                <div id="tc-chat-input-area" class="hidden">
                    <input type="text" id="tc-chat-input" placeholder="Nhập tin nhắn...">
                    <button id="tc-chat-send" title="Gửi tin nhắn">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div id="tc-chat-bubble">💬</div>
        `;

        const container = document.createElement('div');
        container.innerHTML = widgetHtml;
        document.body.appendChild(container);

        const widget = document.getElementById('tc-chat-widget');
        const bubble = document.getElementById('tc-chat-bubble');
        const closeBtn = document.getElementById('tc-chat-close');
        const statusText = document.getElementById('tc-chat-status');
        const input = document.getElementById('tc-chat-input');
        const sendBtn = document.getElementById('tc-chat-send');
        const messagesContainer = document.getElementById('tc-chat-messages');
        const formContainer = document.getElementById('tc-chat-form-container');
        const nameInput = document.getElementById('tc-chat-name');
        const phoneInput = document.getElementById('tc-chat-phone');
        const formSubmit = document.getElementById('tc-chat-form-submit');
        const inputArea = document.getElementById('tc-chat-input-area');

        let socket = null;
        let isConnected = false;

        function updateStatus(status, isOnline = true) {
            statusText.innerText = status;
            statusText.className = isOnline ? '' : 'offline';
            sendBtn.disabled = !isOnline;
        }

        function isValidPhone(phone) {
            // Basic regex for phone numbers: 10-15 digits, optional leading +
            const phoneRegex = /^[0-9+]{10,15}$/;
            return phoneRegex.test(phone);
        }

        function connect(name, phone) {
            updateStatus('Đang kết nối...', false);
            socket = new WebSocket(CONFIG.serverUrl);

            socket.onopen = () => {
                isConnected = true;
                updateStatus(CONFIG.subtitle, true);

                // Send initialization message with guest details
                socket.send(JSON.stringify({
                    type: 'init',
                    name: name,
                    phone: phone,
                    site: CONFIG.site
                }));

                // Switch UI from form to chat
                formContainer.classList.add('hidden');
                inputArea.classList.remove('hidden');
                addMessage('system', 'Đã kết nối với hỗ trợ');
            };

            socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'agent') {
                    addMessage('agent', data.text, data.sender);
                } else if (data.type === 'system') {
                    addMessage('system', data.text);
                } else if (data.type === 'error') {
                    addMessage('system', 'Error: ' + data.text);
                }
            };

            socket.onclose = () => {
                isConnected = false;
                updateStatus('Đã ngắt kết nối', false);
                addMessage('system', 'Mất kết nối. Đang kết nối lại...');
                setTimeout(connect, 5000);
            };

            socket.onerror = (err) => {
                console.error('WebSocket Error:', err);
                updateStatus('Lỗi kết nối', false);
            };
        }

        function addMessage(type, text, sender = null) {
            const msgDiv = document.createElement('div');
            msgDiv.className = `tc-message ${type}`;

            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let senderHtml = '';
            if (type === 'agent' && sender) {
                senderHtml = `<div class="tc-message-sender">${sender}</div>`;
            }

            msgDiv.innerHTML = `
                ${senderHtml}
                <div class="tc-message-text">${text}</div>
                <span class="tc-message-time">${time}</span>
            `;

            messagesContainer.appendChild(msgDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function sendMessage() {
            const text = input.value.trim();
            if (text && socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'chat', text: text }));
                addMessage('user', text);
                input.value = '';
            }
        }

        closeBtn.onclick = () => {
            widget.classList.remove('active');
            bubble.classList.remove('hidden');
        };

        bubble.onclick = () => {
            widget.classList.add('active');
            bubble.classList.add('hidden');
            if (formContainer.classList.contains('hidden')) {
                input.focus();
            } else {
                nameInput.focus();
            }
        };

        function handleFormSubmit() {
            const name = nameInput.value.trim();
            const phone = phoneInput.value.trim();

            if (!name || !phone) {
                alert('Vui lòng cung cấp cả tên và số điện thoại.');
                return;
            }

            if (!isValidPhone(phone)) {
                alert('Số điện thoại không hợp lệ. Vui lòng kiểm tra lại.');
                return;
            }

            connect(name, phone);
        }

        formSubmit.onclick = handleFormSubmit;
        nameInput.onkeypress = (e) => { if (e.key === 'Enter') handleFormSubmit(); };
        phoneInput.onkeypress = (e) => { if (e.key === 'Enter') handleFormSubmit(); };

        sendBtn.onclick = sendMessage;
        input.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
