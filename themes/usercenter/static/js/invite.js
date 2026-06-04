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

    console.log('[Invite] DOMContentLoaded. Current User ID:', user.id, 'Email:', user.email);

    // 初始化加载
    try {
        await initInvitePage();
    } catch (err) {
        console.error('[Invite] Failed to initialize invite page:', err);
        Notifications.show('加载页面失败: ' + err.message, 'error');
    }

    // 初始化核心逻辑
    async function initInvitePage() {
        console.log('[Invite] Fetching profile from database for ID:', user.id);
        // A. 从 profiles 表获取当前用户的邀请码
        let { data: profile, error: profileError } = await client
            .from('profiles')
            .select('invitation_code')
            .eq('id', user.id)
            .maybeSingle();

        console.log('[Invite] Profile query result:', profile, 'Error:', profileError);

        if (profileError) {
            console.error('[Invite] Fetch profile failed:', profileError);
            throw new Error('获取个人资料失败: ' + (profileError.message || JSON.stringify(profileError)));
        }

        // 如果用户目前没有邀请码 (比如历史老用户)，执行自愈逻辑生成一个
        if (!profile || !profile.invitation_code) {
            console.log('User has no invitation code, generating one dynamically...');
            inviteCode = generateRandomInviteCode();

            // 存入 profiles 数据库 (使用 upsert 兼容无 Profile 记录的极端情况)
            const { error: updateError } = await client
                .from('profiles')
                .upsert({
                    id: user.id,
                    email: user.email,
                    invitation_code: inviteCode
                });

            if (updateError) {
                console.error('Save generated invite code failed:', updateError);
                Notifications.show(window.inviteI18n && window.inviteI18n.auto_assign_invite_code_failed ? window.inviteI18n.auto_assign_invite_code_failed : '自动分配邀请码失败，请刷新重试。', 'error');
                return;
            }
        } else {
            inviteCode = profile.invitation_code;
        }

        // B. 渲染邀请码与邀请链接
        const codeDisplay = document.getElementById('invite-code-display');
        const linkInput = document.getElementById('invite-link-input');

        if (codeDisplay) codeDisplay.textContent = inviteCode;

        // 动态构建链接：指向产品落地页，并支持多语言
        const isEn = window.location.pathname.startsWith('/en/');
        const fullInviteLink = isEn 
            ? `https://audit.ezer.cc/en/?aff=${inviteCode}`
            : `https://audit.ezer.cc/?aff=${inviteCode}`;

        if (linkInput) {
            linkInput.value = fullInviteLink;
        }

        // C. 设置复制按钮监听
        setupCopyBtn(fullInviteLink);

        // D. 载入被邀请好友列表
        await loadReferredUsers(inviteCode);

        // E. 载入使用额度统计
        await loadQuotaStatistics();
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
        const origTextFull = btn.querySelector('.btn-text-full');
        const origTextShort = btn.querySelector('.btn-text-short');
        const origIcon = btn.querySelector('.btn-icon');

        if (!origTextFull || !origTextShort || !origIcon) return;

        const prevTextFull = origTextFull.textContent;
        const prevTextShort = origTextShort.textContent;
        const prevIconText = origIcon.textContent;

        const copiedText = window.inviteI18n ? window.inviteI18n.copied : '已复制';
        origTextFull.textContent = copiedText;
        origTextShort.textContent = copiedText;
        origIcon.textContent = 'check';
        btn.style.background = '#4caf50';
        btn.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.3)';

        Notifications.show(window.inviteI18n ? window.inviteI18n.invite_link_copied : '邀请链接已复制到剪贴板！', 'success');

        setTimeout(() => {
            origTextFull.textContent = prevTextFull;
            origTextShort.textContent = prevTextShort;
            origIcon.textContent = prevIconText;
            btn.style.background = '';
            btn.style.boxShadow = '';
        }, 2000);
    }

    // 查询并加载受邀人列表
    async function loadReferredUsers(code) {
        const container = document.getElementById('referred-users-container');
        if (!container) return;

        console.log('[Invite] Querying referred users where referred_by =', code);
        // 查询 profiles 表中所有以该用户的邀请码作为 referred_by 的记录
        const { data: users, error } = await client
            .from('profiles')
            .select('email, created_at')
            .eq('referred_by', code)
            .order('created_at', { ascending: false });

        console.log('[Invite] Referred users query result:', users, 'Error:', error);

        if (error) {
            console.error('[Invite] Query referred users failed:', error);
            const failText = window.inviteI18n && window.inviteI18n.load_referred_users_failed ? window.inviteI18n.load_referred_users_failed : '加载受邀人数据失败';
            container.innerHTML = `<div style="padding: 30px; text-align: center; color: #ff4d4f;">${failText}: ${error.message || JSON.stringify(error)}</div>`;
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

    // 查询并加载额度统计信息
    async function loadQuotaStatistics() {
        const remainingEl = document.getElementById('remaining-quota-display');
        const accumulatedEl = document.getElementById('accumulated-quota-display');
        const expireEl = document.getElementById('expiration-quota-text');
        const expireBanner = document.getElementById('expiration-banner');

        console.log('[Invite] Loading quota statistics for user:', user.id);

        try {
            // 1. 查询 profiles 个人资料（获取受邀人自身的注册激活时间及已用额度）
            const { data: profile, error: profileError } = await client
                .from('profiles')
                .select('created_at, referred_by, invitee_quota_used')
                .eq('id', user.id)
                .maybeSingle();

            if (profileError) {
                console.error('[Invite] Query profile for quota failed:', profileError);
                throw profileError;
            }

            // 2. 查询 invitations 邀请奖励表
            let invRecord = null;
            try {
                const { data, error: invError } = await client
                    .from('invitations')
                    .select('remaining_uses, accumulated_uses, expiration_dates')
                    .eq('user_id', user.id)
                    .maybeSingle();
                
                if (invError) {
                    console.warn('[Invite] Query invitations table failed. It might not be created yet.', invError);
                } else {
                    invRecord = data;
                }
            } catch (err) {
                console.warn('[Invite] Failed to fetch invitations records, assuming 0 rewards.', err);
            }

            const now = new Date();
            let inviteeRemaining = 0;
            let inviteeExpiresAt = null;

            // A. 被邀请者额度计算：若有推荐人且在注册后 1 个月内，拥有 (3 - 已用) 次额度
            if (profile) {
                const regDate = new Date(profile.created_at);
                const expireDate = new Date(regDate);
                expireDate.setMonth(expireDate.getMonth() + 1);

                if (profile.referred_by && expireDate > now) {
                    inviteeRemaining = Math.max(0, 3 - (profile.invitee_quota_used || 0));
                    inviteeExpiresAt = expireDate;
                }
            }

            // B. 邀请人额度计算
            let inviterRemaining = 0;
            let inviterAccumulated = 0;
            let inviterDates = [];

            if (invRecord) {
                inviterRemaining = invRecord.remaining_uses || 0;
                inviterAccumulated = invRecord.accumulated_uses || 0;
                inviterDates = invRecord.expiration_dates || [];
            }

            // C. 过滤出未过期的邀请人额度时间数组，并校正额度（防止数据库未清理时的时差）
            const validInviterDates = inviterDates
                .map(d => new Date(d))
                .filter(d => d > now);

            // 本地校正后的邀请人可用额度上限 = 有效未过期数量 * 5
            const localMaxInviterQuota = validInviterDates.length * 5;
            const correctedInviterRemaining = Math.min(inviterRemaining, localMaxInviterQuota);

            // D. 汇总结果
            const totalRemaining = inviteeRemaining + correctedInviterRemaining;
            const totalAccumulated = inviterAccumulated + (profile && profile.referred_by ? 3 : 0);

            if (remainingEl) remainingEl.textContent = totalRemaining;
            if (accumulatedEl) accumulatedEl.textContent = totalAccumulated;

            // E. 查找最先过期的额度
            const expirationList = [];

            // 如果被邀请人赠送额度还有剩余，将其过期时间加入列表
            if (inviteeRemaining > 0 && inviteeExpiresAt) {
                expirationList.push({
                    date: inviteeExpiresAt,
                    amount: inviteeRemaining
                });
            }

            // 将所有有效的邀请人过期日期加入列表（每笔算 5 次或剩余的额度）
            let tempRemaining = correctedInviterRemaining;
            const sortedInviterDates = validInviterDates.sort((a, b) => a - b);
            
            sortedInviterDates.forEach(date => {
                if (tempRemaining > 0) {
                    const amount = Math.min(5, tempRemaining);
                    expirationList.push({ date, amount });
                    tempRemaining -= amount;
                }
            });

            // 找出最早过期的那一笔
            if (expirationList.length > 0) {
                const soonest = expirationList.sort((a, b) => a.date - b.date)[0];
                const diffTime = soonest.date - now;
                const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

                let expireMsg = '';
                if (window.inviteI18n && window.inviteI18n.uses_expire_format) {
                    expireMsg = window.inviteI18n.uses_expire_format
                        .replace('{uses}', soonest.amount)
                        .replace('{days}', diffDays);
                } else {
                    expireMsg = `${soonest.amount}次将于${diffDays}天后过期`;
                }

                if (expireEl) expireEl.textContent = expireMsg;
                if (expireBanner) expireBanner.style.display = 'flex';
            } else {
                if (expireEl) expireEl.textContent = window.inviteI18n ? window.inviteI18n.no_expiring_quota : '暂无即将过期的额度';
                if (expireBanner) expireBanner.style.display = 'none';
            }
        } catch (err) {
            console.error('[Invite] Failed to process quota stats:', err);
            if (remainingEl) remainingEl.textContent = '-';
            if (accumulatedEl) accumulatedEl.textContent = '-';
            if (expireEl) expireEl.textContent = '加载出错';
            if (expireBanner) expireBanner.style.display = 'none';
        }
    }
});
