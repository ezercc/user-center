// static/js/invite.js

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof client === 'undefined') {
        console.error('Supabase client not initialized. Make sure common.js is loaded.');
        return;
    }

    // 1. 检查 Session
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session) {
        window.location.href = getLoginUrl(window.location.pathname);
        return;
    }

    const user = session.user;
    let inviteCode = '';

    // 初始化加载
    try {
        await initInvitePage();
    } catch (err) {
        console.error('Failed to initialize invite page:', err);
        Notifications.show('加载页面失败: ' + err.message, 'error');
    }

    // 初始化核心逻辑
    async function initInvitePage() {
        // A. 从 profiles 表获取当前用户的邀请码
        let { data: profile, error: profileError } = await client
            .from('profiles')
            .select('invitation_code')
            .eq('id', user.id)
            .maybeSingle();

        if (profileError) {
            console.error('Fetch profile failed:', profileError);
            throw new Error('获取个人资料失败');
        }

        // 如果用户目前没有邀请码 (比如历史老用户)，执行自愈逻辑生成一个
        if (!profile || !profile.invitation_code) {
            console.log('User has no invitation code, generating one dynamically...');
            inviteCode = generateRandomInviteCode();
            
            // 存入 profiles 数据库
            const { error: updateError } = await client
                .from('profiles')
                .update({ invitation_code: inviteCode })
                .eq('id', user.id);

            if (updateError) {
                console.error('Save generated invite code failed:', updateError);
                Notifications.show('自动分配邀请码失败，请刷新重试。', 'error');
                return;
            }
        } else {
            inviteCode = profile.invitation_code;
        }

        // B. 渲染邀请码与邀请链接
        const codeDisplay = document.getElementById('invite-code-display');
        const linkInput = document.getElementById('invite-link-input');
        
        if (codeDisplay) codeDisplay.textContent = inviteCode;
        
        // 动态构建链接：兼容多语言子路径以及本地和生产环境
        const isEn = window.location.pathname.startsWith('/en/');
        const baseLoginUrl = isEn ? `${window.location.origin}/en/login/` : `${window.location.origin}/login/`;
        const fullInviteLink = `${baseLoginUrl}?aff=${inviteCode}`;
        
        if (linkInput) {
            linkInput.value = fullInviteLink;
        }

        // C. 设置复制按钮监听
        setupCopyBtn(fullInviteLink);

        // D. 载入被邀请好友列表
        await loadReferredUsers(inviteCode);
    }

    // 随机大写 8 位字符生成器 (自愈模式 fallback)
    function generateRandomInviteCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // 复制链接功能实现 (带动画状态)
    function setupCopyBtn(linkText) {
        const copyBtn = document.getElementById('btn-copy-link');
        if (!copyBtn) return;

        copyBtn.addEventListener('click', async () => {
            if (!linkText) {
                Notifications.show(window.inviteI18n ? window.inviteI18n.invite_code_not_found : '未获取到邀请链接', 'warning');
                return;
            }

            try {
                // 使用现代 Clipboard API
                await navigator.clipboard.writeText(linkText);
                showCopiedState(copyBtn);
            } catch (err) {
                // Fallback 方案
                const input = document.getElementById('invite-link-input');
                if (input) {
                    input.select();
                    input.setSelectionRange(0, 99999);
                    document.execCommand('copy');
                    showCopiedState(copyBtn);
                } else {
                    console.error('Clipboard copy failed:', err);
                    Notifications.show('复制失败，请手动选择复制', 'error');
                }
            }
        });
    }

    // 变换复制按钮状态动画
    function showCopiedState(btn) {
        const origText = btn.querySelector('.btn-text');
        const origIcon = btn.querySelector('.btn-icon');
        
        if (!origText || !origIcon) return;

        const prevText = origText.textContent;
        const prevIconText = origIcon.textContent;

        origText.textContent = window.inviteI18n ? window.inviteI18n.copied : '已复制';
        origIcon.textContent = 'check';
        btn.style.background = '#4caf50';
        btn.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.3)';

        Notifications.show(window.inviteI18n ? window.inviteI18n.invite_link_copied : '邀请链接已复制到剪贴板！', 'success');

        setTimeout(() => {
            origText.textContent = prevText;
            origIcon.textContent = prevIconText;
            btn.style.background = '';
            btn.style.boxShadow = '';
        }, 2000);
    }

    // 查询并加载受邀人列表
    async function loadReferredUsers(code) {
        const container = document.getElementById('referred-users-container');
        if (!container) return;

        // 查询 profiles 表中所有以该用户的邀请码作为 referred_by 的记录
        const { data: users, error } = await client
            .from('profiles')
            .select('email, created_at')
            .eq('referred_by', code)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Query referred users failed:', error);
            container.innerHTML = `<div style="padding: 30px; text-align: center; color: #ff4d4f;">加载受邀人数据失败</div>`;
            return;
        }

        if (!users || users.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="material-icons-round">sentiment_dissatisfied</span>
                    <p>${window.inviteI18n ? window.inviteI18n.no_invited_users : '您还没有邀请过任何好友，快去分享链接吧！'}</p>
                </div>
            `;
            return;
        }

        // 渲染表格
        const emailLabel = window.inviteI18n ? window.inviteI18n.reg_email : '注册邮箱';
        const dateLabel = window.inviteI18n ? window.inviteI18n.reg_date : '注册日期';

        let html = `
            <table class="invite-table">
                <thead>
                    <tr>
                        <th>${emailLabel}</th>
                        <th>${dateLabel}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const lang = document.documentElement.lang || 'zh-CN';

        users.forEach(item => {
            const masked = maskEmail(item.email);
            const date = new Date(item.created_at).toLocaleDateString(lang, {
                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            html += `
                <tr>
                    <td>${masked}</td>
                    <td>${date}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    }

    // 邮箱敏感信息打码逻辑 (保留前两位字符和@后面的域名)
    function maskEmail(email) {
        if (!email) return '***';
        const atIndex = email.indexOf('@');
        if (atIndex === -1) return email;
        
        const username = email.substring(0, atIndex);
        const domain = email.substring(atIndex);
        
        if (username.length <= 2) {
            return username + '***' + domain;
        }
        return username.substring(0, 2) + '***' + domain;
    }
});
