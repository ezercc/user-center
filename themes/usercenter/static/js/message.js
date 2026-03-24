document.addEventListener('DOMContentLoaded', async () => {
    if (typeof client === 'undefined') return;

    // 1. 验证登录
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) {
        window.location.href = getLoginUrl('/message/');
        return;
    }
    const myId = session.user.id;

    const SYSTEM_BOT = {
        id: 'system_notification_bot',
        email: window.messageI18n ? window.messageI18n.system_notifications : '站内通知',
        isSystem: true
    };

    // 状态管理
    let activeChatUser = null;
    let contactsMap = new Map();
    // 新增：用于存储每个联系人的未读数
    let unreadCounts = new Map();

    // DOM 元素
    const contactListEl = document.getElementById('contact-list');
    const messagesArea = document.getElementById('messages-area');
    const msgInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('btn-send-message');
    const chatContainer = document.querySelector('.chat-container');
    const chatEmpty = document.getElementById('chat-empty');
    const chatContent = document.getElementById('chat-content');
    const chatPane = document.getElementById('chat-pane');
    const searchContainer = document.getElementById('new-chat-search');

    // ============================================================
    // 辅助函数
    // ============================================================
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function scrollToBottom() {
        if (messagesArea) {
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }
    }

    // ============================================================
    // 2. 加载联系人列表 (修复红点显示)
    // ============================================================
    async function loadContacts() {
        contactListEl.innerHTML = '<div class="loading-spinner" style="margin:20px auto"></div>';

        try {
            // A. 获取系统通知 (预览 + 未读数)
            const { data: sysNotifs } = await client
                .from('notifications')
                .select('*')
                .eq('user_id', myId)
                .order('created_at', { ascending: false });

            const lastSysMsg = sysNotifs && sysNotifs.length > 0 ? sysNotifs[0] : null;

            // 统计系统通知未读数
            const sysUnreadCount = sysNotifs ? sysNotifs.filter(n => !n.is_read).length : 0;
            unreadCounts.set(SYSTEM_BOT.id, sysUnreadCount);

            // B. 获取私信列表
            const { data: messages, error } = await client
                .from('private_messages')
                .select('sender_id, receiver_id, created_at, content, is_read')
                .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // 提取联系人 & 统计私信未读数
            const contactIds = new Set();

            messages.forEach(msg => {
                // 收集 ID
                if (msg.sender_id !== myId) contactIds.add(msg.sender_id);
                if (msg.receiver_id !== myId) contactIds.add(msg.receiver_id);

                // >>> 修复核心：统计未读数 <<<
                // 如果我是接收者，且消息未读
                if (msg.receiver_id === myId && !msg.is_read) {
                    const sender = msg.sender_id;
                    const current = unreadCounts.get(sender) || 0;
                    unreadCounts.set(sender, current + 1);
                }
            });

            // 获取私信用户信息
            let profiles = [];
            if (contactIds.size > 0) {
                const { data: pros, error: profileError } = await client
                    .from('profiles')
                    .select('id, email')
                    .in('id', Array.from(contactIds));

                if (profileError) throw profileError;
                profiles = pros;
            }

            // 渲染列表
            contactListEl.innerHTML = '';
            contactsMap.clear();

            // --- 1. 渲染【站内通知】 ---
            renderContactItem(SYSTEM_BOT, lastSysMsg ? lastSysMsg.title || lastSysMsg.content : (window.messageI18n ? window.messageI18n.no_system_messages : '暂无系统通知'));

            // --- 2. 渲染【私信联系人】 ---
            profiles.forEach(profile => {
                contactsMap.set(profile.id, profile);
                const lastMsg = messages.find(m => m.sender_id === profile.id || m.receiver_id === profile.id);
                renderContactItem(profile, lastMsg ? lastMsg.content : '');
            });

        } catch (err) {
            console.error(err);
            contactListEl.innerHTML = '<p style="color:red;text-align:center">加载失败: ' + err.message + '</p>';
        }
    }

    // 渲染单个联系人条目 (修复红点 HTML)
    function renderContactItem(user, previewText) {
        const div = document.createElement('div');
        div.className = 'contact-item';
        div.dataset.uid = user.id;

        if (user.isSystem) {
            div.classList.add('system-item');
        }

        div.onclick = () => selectChat(user);

        const rawName = user.email || 'Unknown';
        const displayName = user.isSystem ? rawName : rawName.split('@')[0];

        const initial = user.isSystem ?
            '<span class="material-icons-round" style="font-size:20px">campaign</span>' :
            (rawName[0].toUpperCase());

        // >>> 修复：获取未读数并生成 HTML <<<
        const count = unreadCounts.get(user.id) || 0;
        const badgeHtml = count > 0
            ? `<div class="unread-badge show">${count > 99 ? '99+' : count}</div>`
            : `<div class="unread-badge"></div>`;

        div.innerHTML = `
            <div class="avatar-placeholder">${initial}</div>
            <div class="contact-info">
                <div class="contact-name">${displayName}</div>
                <div class="contact-preview">${escapeHtml(previewText)}</div>
            </div>
            ${badgeHtml}
        `;
        contactListEl.appendChild(div);
    }

    // ============================================================
    // 3. 搜索新用户
    // ============================================================
    document.getElementById('btn-new-chat').addEventListener('click', () => {
        searchContainer.classList.toggle('hidden');
        document.getElementById('search-email-input').focus();
    });

    document.getElementById('btn-search-confirm').addEventListener('click', async () => {
        const email = document.getElementById('search-email-input').value.trim();
        if (!email) return;

        try {
            const { data, error } = await client
                .from('profiles')
                .select('id, email')
                .eq('email', email)
                .single();

            if (error || !data) {
                Notifications.show('未找到该用户，请检查邮箱', 'warning');
                return;
            }

            if (data.id === myId) {
                Notifications.show('不能给自己发消息', 'warning');
                return;
            }

            searchContainer.classList.add('hidden');
            document.getElementById('search-email-input').value = '';

            if (!contactsMap.has(data.id)) {
                contactsMap.set(data.id, data);
            }
            selectChat(data);

        } catch (err) {
            Notifications.show('查找失败', 'error');
        }
    });

    // ============================================================
    // 4. 选择聊天对象 (清除红点)
    // ============================================================
    async function selectChat(userProfile) {
        activeChatUser = userProfile;

        // UI 高亮 & 清除该项红点
        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
        const activeEl = document.querySelector(`.contact-item[data-uid="${userProfile.id}"]`);
        if (activeEl) {
            activeEl.classList.add('active');
            const badge = activeEl.querySelector('.unread-badge');
            if (badge) badge.classList.remove('show');
        }

        // 本地计数清零
        unreadCounts.set(userProfile.id, 0);

        chatEmpty.classList.add('hidden');
        chatContent.classList.remove('hidden');
        chatContainer.classList.add('active-chat');

        const rawName = userProfile.email || 'Unknown';
        document.getElementById('current-chat-name').textContent = userProfile.isSystem ? rawName : rawName.split('@')[0];

        messagesArea.innerHTML = '<div class="loading-spinner" style="margin:20px auto"></div>';

        // ----------------------------------------------------
        // 分支 A: 系统通知
        // ----------------------------------------------------
        if (userProfile.isSystem) {
            chatPane.classList.add('read-only');

            try {
                const { data: notifs, error } = await client
                    .from('notifications')
                    .select('*')
                    .eq('user_id', myId)
                    .order('created_at', { ascending: true });

                if (error) throw error;
                renderSystemMessages(notifs);

                // 标记已读
                await client.from('notifications').update({ is_read: true }).eq('user_id', myId).eq('is_read', false);
                // 更新全局侧边栏红点
                if (window.UnreadBadge) window.UnreadBadge.check();

            } catch (err) {
                console.error(err);
                messagesArea.innerHTML = `<p style="text-align:center">${window.messageI18n ? window.messageI18n.load_notifications_failed : '加载通知失败'}</p>`;
            }
        }
        // ----------------------------------------------------
        // 分支 B: 私信
        // ----------------------------------------------------
        else {
            chatPane.classList.remove('read-only');
            sendBtn.disabled = false;

            try {
                const { data: messages, error } = await client
                    .from('private_messages')
                    .select('*')
                    .or(`and(sender_id.eq.${myId},receiver_id.eq.${userProfile.id}),and(sender_id.eq.${userProfile.id},receiver_id.eq.${myId})`)
                    .order('created_at', { ascending: true });

                if (error) throw error;
                renderPrivateMessages(messages);

                // 标记已读
                await client.from('private_messages')
                    .update({ is_read: true })
                    .eq('receiver_id', myId)
                    .eq('sender_id', userProfile.id)
                    .eq('is_read', false);

                // 更新全局侧边栏红点
                if (window.UnreadBadge) window.UnreadBadge.check();

            } catch (err) {
                console.error(err);
                messagesArea.innerHTML = `<p style="text-align:center">${window.messageI18n ? window.messageI18n.load_messages_failed : '消息加载失败'}</p>`;
            }
        }
    }

    function renderSystemMessages(notifications) {
        messagesArea.innerHTML = '';
        if (!notifications || notifications.length === 0) {
            messagesArea.innerHTML = `<p style="text-align:center;color:#ccc;margin-top:20px">${window.messageI18n ? window.messageI18n.no_system_messages : '暂无系统通知'}</p>`;
            return;
        }

        notifications.forEach(note => {
            const div = document.createElement('div');
            div.className = 'message-bubble system-msg';

            let html = '';
            if (note.title) {
                html += `<div class="system-msg-title">${escapeHtml(note.title)}</div>`;
            }
            html += escapeHtml(note.content);
            html += `<div class="message-time">${new Date(note.created_at).toLocaleString()}</div>`;

            div.innerHTML = html;
            messagesArea.appendChild(div);
        });
        scrollToBottom();
    }

    function renderPrivateMessages(messages) {
        messagesArea.innerHTML = '';
        if (!messages || messages.length === 0) {
            messagesArea.innerHTML = `<p style="text-align:center;color:#ccc;margin-top:20px">${window.messageI18n ? window.messageI18n.no_messages_yet : '暂无消息，打个招呼吧！'}</p>`;
            return;
        }
        messages.forEach(msg => appendMessageUI(msg));
        scrollToBottom();
    }

    function appendMessageUI(msg) {
        const isMine = msg.sender_id === myId;
        const div = document.createElement('div');
        div.className = `message-bubble ${isMine ? 'sent' : 'received'}`;
        div.innerHTML = `
            ${escapeHtml(msg.content)}
            <div class="message-time">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        `;
        messagesArea.appendChild(div);
        scrollToBottom();
    }

    // ============================================================
    // 5. 发送私信
    // ============================================================
    async function sendMessage() {
        const text = msgInput.value.trim();
        if (!text || !activeChatUser || activeChatUser.isSystem) return;

        const tempMsg = {
            sender_id: myId,
            content: text,
            created_at: new Date().toISOString()
        };
        appendMessageUI(tempMsg);
        msgInput.value = '';

        try {
            const { error } = await client
                .from('private_messages')
                .insert({
                    sender_id: myId,
                    receiver_id: activeChatUser.id,
                    content: text,
                    is_read: false
                });

            if (error) throw error;
        } catch (err) {
            console.error(err);
            Notifications.show('发送失败', 'error');
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    msgInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // ============================================================
    // 6. 实时监听 (增加更新具体联系人红点逻辑)
    // ============================================================

    // 监听私信
    client.channel('public:private_messages')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'private_messages',
            filter: `receiver_id=eq.${myId}`
        }, async (payload) => {
            const newMsg = payload.new;

            // 如果正在和此人聊天 -> 上屏并已读
            if (activeChatUser && !activeChatUser.isSystem && newMsg.sender_id === activeChatUser.id) {
                appendMessageUI(newMsg);
                await client.from('private_messages').update({ is_read: true }).eq('id', newMsg.id);
            }
            else {
                // 如果没在聊 -> 增加该用户的红点
                const senderId = newMsg.sender_id;
                const current = unreadCounts.get(senderId) || 0;
                unreadCounts.set(senderId, current + 1);

                // 更新 DOM
                const itemEl = document.querySelector(`.contact-item[data-uid="${senderId}"]`);
                if (itemEl) {
                    const badge = itemEl.querySelector('.unread-badge');
                    if (badge) {
                        badge.textContent = (current + 1) > 99 ? '99+' : (current + 1);
                        badge.classList.add('show');
                    }
                    // 更新预览
                    const preview = itemEl.querySelector('.contact-preview');
                    if (preview) preview.textContent = newMsg.content;
                } else {
                    // 如果列表里没这个人（新聊天），刷新列表
                    loadContacts();
                }

                Notifications.show(`收到新私信`, 'info');
            }
        })
        .subscribe();

    // 监听系统通知
    client.channel('public:notifications')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${myId}`
        }, (payload) => {
            const newNote = payload.new;
            if (activeChatUser && activeChatUser.isSystem) {
                const div = document.createElement('div');
                div.className = 'message-bubble system-msg';
                let html = '';
                if (newNote.title) html += `<div class="system-msg-title">${escapeHtml(newNote.title)}</div>`;
                html += escapeHtml(newNote.content);
                html += `<div class="message-time">${new Date(newNote.created_at).toLocaleString()}</div>`;
                div.innerHTML = html;
                messagesArea.appendChild(div);
                scrollToBottom();
                client.from('notifications').update({ is_read: true }).eq('id', newNote.id);
            } else {
                // 更新系统通知红点
                const current = unreadCounts.get(SYSTEM_BOT.id) || 0;
                unreadCounts.set(SYSTEM_BOT.id, current + 1);

                const itemEl = document.querySelector('.contact-item.system-item');
                if (itemEl) {
                    const badge = itemEl.querySelector('.unread-badge');
                    if (badge) {
                        badge.textContent = (current + 1);
                        badge.classList.add('show');
                    }
                }
                Notifications.show(`收到系统通知`, 'info');
            }
        })
        .subscribe();

    document.getElementById('back-to-contacts').addEventListener('click', () => {
        chatContainer.classList.remove('active-chat');
        activeChatUser = null;
    });

    // 初始加载
    loadContacts();
});
