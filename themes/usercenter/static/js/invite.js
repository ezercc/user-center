document.addEventListener('DOMContentLoaded', async () => {
    if (typeof client === 'undefined') {
        console.error('Supabase client not initialized. Make sure common.js is loaded.');
        return;
    }

    // 1. 检查 Session
    let session = null;
    try {
        const { data, error: sessionError } = await client.auth.getSession();
        if (!sessionError && data && data.session) {
            session = data.session;
        }
    } catch (e) {
        console.warn('获取 session 失败:', e);
    }

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!session) {
        if (isLocalhost) {
            console.log('[Invite] 本地开发环境：模拟登录状态');
            session = {
                user: {
                    id: 'dev-mock-user-id',
                    email: 'dev-user@ezer.cc'
                }
            };
        } else {
            window.location.href = getLoginUrl(window.location.pathname);
            return;
        }
    }

    const user = session.user;
    let inviteCode = '';
    let availableBalanceCny = 0;
    let availableBalanceUsd = 0;
    let hasPendingWithdrawal = false;

    console.log('[Invite] DOMContentLoaded. Current User ID:', user.id, 'Email:', user.email);

    // 初始化加载
    try {
        initWithdrawalModal();
        await initInvitePage();
    } catch (err) {
        console.error('[Invite] Failed to initialize invite page:', err);
        Notifications.show('加载页面失败: ' + err.message, 'error');
    }

    // 初始化核心逻辑
    async function initInvitePage() {
        console.log('[Invite] Fetching profile from database for ID:', user.id);
        // A. 从 profiles 表获取当前用户的邀请码和自定义返利比率
        let { data: profile, error: profileError } = await client
            .from('profiles')
            .select('invitation_code, custom_affiliate_rate')
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

        // B. 渲染邀请码与邀请链接，并根据具体用户的返利比率更新规则说明
        const codeDisplay = document.getElementById('invite-code-display');
        const linkInput = document.getElementById('invite-link-input');

        if (codeDisplay) codeDisplay.textContent = inviteCode;

        // 动态构建链接：指向产品落地页，并支持多语言
        const isEn = window.location.pathname.startsWith('/en/');
        const fullInviteLink = isEn
            ? `https://www.ezer.cc/en/?aff=${inviteCode}`
            : `https://www.ezer.cc/?aff=${inviteCode}`;

        if (linkInput) {
            linkInput.value = fullInviteLink;
        }

        const rebateRate = profile && profile.custom_affiliate_rate != null
            ? profile.custom_affiliate_rate
            : 0.15;
        const ratePercent = Math.round(rebateRate * 100) + '%';
        const rebatePercentEl = document.getElementById('rules-rebate-percentage');
        if (rebatePercentEl) {
            rebatePercentEl.textContent = ratePercent;
        }

        // C. 设置复制按钮监听
        setupCopyBtn(fullInviteLink);

        // D. 载入被邀请好友列表
        await loadReferredUsers(inviteCode);

        // E. 载入使用额度统计
        await loadQuotaStatistics();

        // F. 查询并加载待处理的提现申请状态
        await checkPendingWithdrawals();
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
                    .select('remaining_uses, accumulated_uses, expiration_dates, cash_balance_cny, cash_total_earned_cny, cash_balance_usd, cash_total_earned_usd')
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

            // 本地校正后的邀请人可用额度上限 = 有效未过期数量 * 3
            const localMaxInviterQuota = validInviterDates.length * 3;
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
                    const amount = Math.min(3, tempRemaining);
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

            // 渲染推广收益钱包
            renderRebateWallet(invRecord);
        } catch (err) {
            console.error('[Invite] Failed to process quota stats:', err);
            if (remainingEl) remainingEl.textContent = '-';
            if (accumulatedEl) accumulatedEl.textContent = '-';
            if (expireEl) expireEl.textContent = '加载出错';
            if (expireBanner) expireBanner.style.display = 'none';
            renderRebateWallet(null);
        }
    }

    // 渲染返利钱包的具体数据及处理计算
    function renderRebateWallet(invRecord) {
        const balanceCnyEl = document.getElementById('rebate-balance-cny');
        const earnedCnyEl = document.getElementById('rebate-earned-cny');
        const withdrawnCnyEl = document.getElementById('rebate-withdrawn-cny');

        const balanceUsdEl = document.getElementById('rebate-balance-usd');
        const earnedUsdEl = document.getElementById('rebate-earned-usd');
        const withdrawnUsdEl = document.getElementById('rebate-withdrawn-usd');

        const balanceCny = invRecord ? (invRecord.cash_balance_cny || 0) : 0;
        const earnedCny = invRecord ? (invRecord.cash_total_earned_cny || 0) : 0;
        const withdrawnCny = Math.max(0, earnedCny - balanceCny);

        const balanceUsd = invRecord ? (invRecord.cash_balance_usd || 0) : 0;
        const earnedUsd = invRecord ? (invRecord.cash_total_earned_usd || 0) : 0;
        const withdrawnUsd = Math.max(0, earnedUsd - balanceUsd);

        // 保存余额全局变量供模态框使用
        availableBalanceCny = balanceCny;
        availableBalanceUsd = balanceUsd;

        if (balanceCnyEl) balanceCnyEl.textContent = (balanceCny / 100).toFixed(2);
        if (earnedCnyEl) earnedCnyEl.textContent = (earnedCny / 100).toFixed(2);
        if (withdrawnCnyEl) withdrawnCnyEl.textContent = (withdrawnCny / 100).toFixed(2);

        if (balanceUsdEl) balanceUsdEl.textContent = (balanceUsd / 100).toFixed(2);
        if (earnedUsdEl) earnedUsdEl.textContent = (earnedUsd / 100).toFixed(2);
        if (withdrawnUsdEl) withdrawnUsdEl.textContent = (withdrawnUsd / 100).toFixed(2);

        // 动态绑定到提现模态框中的余额显示
        const modalBalCnyEl = document.getElementById('modal-bal-cny');
        const modalBalUsdEl = document.getElementById('modal-bal-usd');
        if (modalBalCnyEl) modalBalCnyEl.textContent = (balanceCny / 100).toFixed(2);
        if (modalBalUsdEl) modalBalUsdEl.textContent = (balanceUsd / 100).toFixed(2);
    }

    // 初始化提现申请模态框表单与逻辑
    function initWithdrawalModal() {
        const btnWithdraw = document.getElementById('btn-request-withdrawal');
        const modal = document.getElementById('withdrawal-modal');
        const btnCloseModal = document.getElementById('btn-close-withdrawal-modal');
        const btnCancelWithdrawal = document.getElementById('btn-cancel-withdrawal');
        const form = document.getElementById('withdrawal-form');

        const inputAmount = document.getElementById('withdrawal-amount');
        const amountHint = document.getElementById('amount-hint-text');
        const btnAmountAll = document.getElementById('btn-amount-all');

        const bankFields = document.getElementById('bank-fields-container');
        const bankRegionGroup = document.getElementById('bank-region-group');
        const inputBankRegion = document.getElementById('withdrawal-bank-region');
        const bankMainlandFields = document.getElementById('bank-mainland-fields');
        const bankNonMainlandFields = document.getElementById('bank-non-mainland-fields');

        const inputRealName = document.getElementById('withdrawal-real-name');
        const inputBankName = document.getElementById('withdrawal-bank-name');
        const inputBankNameEn = document.getElementById('withdrawal-bank-name-en');
        const inputBankSwift = document.getElementById('withdrawal-bank-swift');
        const inputBankCountry = document.getElementById('withdrawal-bank-country');

        const inputCardNum = document.getElementById('withdrawal-card-number');
        const inputCardNumConfirm = document.getElementById('withdrawal-card-number-confirm');
        const btnSubmit = document.getElementById('btn-submit-withdrawal');

        let selectedCurrency = 'CNY';
        let selectedMethod = 'bank';
        let selectedRegion = 'mainland';

        if (!modal || !btnWithdraw) return;

        // 统一更新表单可见性与字段必填属性
        function updateFormFields() {
            const labelCardNum = document.getElementById('label-card-number');
            const labelCardNumConfirm = document.getElementById('label-card-number-confirm');
            const i18n = window.inviteI18n || {};

            if (selectedMethod === 'bank') {
                bankFields.style.display = 'block';
                bankRegionGroup.style.display = 'block';

                if (selectedRegion === 'mainland') {
                    bankMainlandFields.style.display = 'block';
                    bankNonMainlandFields.style.display = 'none';

                    inputBankName.setAttribute('required', 'required');
                    inputBankNameEn.removeAttribute('required');
                    inputBankSwift.removeAttribute('required');
                    inputBankCountry.removeAttribute('required');

                    if (labelCardNum) labelCardNum.textContent = i18n.card_number || '银行卡号';
                    if (labelCardNumConfirm) labelCardNumConfirm.textContent = i18n.confirm_card_number || '确认银行卡号';
                    inputCardNum.setAttribute('placeholder', i18n.card_number_placeholder || '请输入银行卡号');
                    inputCardNumConfirm.setAttribute('placeholder', i18n.confirm_card_number_placeholder || '请再次输入银行卡号以核对');
                } else {
                    bankMainlandFields.style.display = 'none';
                    bankNonMainlandFields.style.display = 'block';

                    inputBankName.removeAttribute('required');
                    inputBankNameEn.setAttribute('required', 'required');
                    inputBankSwift.setAttribute('required', 'required');
                    inputBankCountry.setAttribute('required', 'required');

                    if (labelCardNum) labelCardNum.textContent = i18n.card_number_non_mainland || '银行账号/IBAN (Account Number/IBAN)';
                    if (labelCardNumConfirm) labelCardNumConfirm.textContent = i18n.confirm_card_number_non_mainland || '确认账号/IBAN';
                    inputCardNum.setAttribute('placeholder', i18n.card_number_non_mainland_placeholder || '请输入银行账号或IBAN');
                    inputCardNumConfirm.setAttribute('placeholder', i18n.confirm_card_number_non_mainland_placeholder || '请再次输入银行账号或IBAN以核对');
                }
            } else {
                bankFields.style.display = 'none';
                bankRegionGroup.style.display = 'none';

                inputBankName.removeAttribute('required');
                inputBankNameEn.removeAttribute('required');
                inputBankSwift.removeAttribute('required');
                inputBankCountry.removeAttribute('required');

                if (labelCardNum) labelCardNum.textContent = i18n.card_number_agreed || '收款账号';
                if (labelCardNumConfirm) labelCardNumConfirm.textContent = i18n.confirm_card_number_agreed || '确认收款账号';
                inputCardNum.setAttribute('placeholder', i18n.card_number_agreed_placeholder || '请输入收款账号（如支付宝/微信/其他约定账号）');
                inputCardNumConfirm.setAttribute('placeholder', i18n.confirm_card_number_agreed_placeholder || '请再次输入收款账号以核对');
            }
        }

        // 打开模态框
        btnWithdraw.addEventListener('click', (e) => {
            e.preventDefault();
            if (hasPendingWithdrawal) {
                Notifications.show(window.inviteI18n && window.inviteI18n.withdrawal_pending_limit_error
                    ? window.inviteI18n.withdrawal_pending_limit_error
                    : '您已有正在处理中的提现申请，需处理完毕后才能提交新的申请', 'warning');
                return;
            }
            modal.classList.add('active');

            // 使用 HTML 原生重置，自动恢复各语言模板预设的 selected 选项并清空所有输入框
            form.reset();

            selectedCurrency = form.elements['currency'].value;
            selectedMethod = form.elements['payment_method'].value;
            selectedRegion = form.elements['bank_region'].value;

            updateFormFields();
            updateBalanceDisplay();
        });

        // 关闭模态框
        const closeModal = () => {
            modal.classList.remove('active');
        };

        if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
        if (btnCancelWithdrawal) btnCancelWithdrawal.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // 更新余额显示与验证提示
        function updateBalanceDisplay() {
            const currentBal = selectedCurrency === 'CNY' ? (availableBalanceCny / 100) : (availableBalanceUsd / 100);
            const minLimit = selectedCurrency === 'CNY' ? 100 : 20;
            const symbol = selectedCurrency === 'CNY' ? '¥' : '$';

            const hintTemplate = window.inviteI18n && window.inviteI18n.withdrawal_balance_hint
                ? window.inviteI18n.withdrawal_balance_hint
                : "可提现余额: {symbol}{balance} (最低提现: {symbol}{min})";

            amountHint.textContent = hintTemplate
                .replace(/{symbol}/g, symbol)
                .replace('{balance}', currentBal.toFixed(2))
                .replace('{min}', minLimit);

            inputAmount.setAttribute('max', currentBal.toFixed(2));
            inputAmount.setAttribute('min', minLimit);
        }

        // 切换下拉菜单时更新可见性与验证
        form.addEventListener('change', (e) => {
            if (e.target.name === 'currency') {
                selectedCurrency = e.target.value;
                updateBalanceDisplay();
            }

            if (e.target.name === 'payment_method') {
                selectedMethod = e.target.value;
                updateFormFields();
            }

            if (e.target.name === 'bank_region') {
                selectedRegion = e.target.value;
                updateFormFields();
            }
        });

        // 点击 "全部" 自动输入余额
        if (btnAmountAll) {
            btnAmountAll.addEventListener('click', () => {
                const currentBal = selectedCurrency === 'CNY' ? (availableBalanceCny / 100) : (availableBalanceUsd / 100);
                inputAmount.value = currentBal.toFixed(2);
            });
        }

        // 表单提交事件
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const i18n = window.inviteI18n || {};
            const amountVal = parseFloat(inputAmount.value);
            const currentBal = selectedCurrency === 'CNY' ? (availableBalanceCny / 100) : (availableBalanceUsd / 100);

            // 验证提现金额
            if (isNaN(amountVal) || amountVal <= 0) {
                Notifications.show(i18n.amount_required || '请填写有效的提现金额', 'error');
                return;
            }

            if (amountVal > currentBal) {
                Notifications.show(i18n.amount_exceed || '提现金额已超过可提现余额', 'error');
                return;
            }

            // 验证最低提现金额限制
            if (selectedCurrency === 'CNY' && amountVal < 100) {
                Notifications.show(i18n.amount_min_cny || '人民币最低提现金额为100元', 'error');
                return;
            }
            if (selectedCurrency === 'USD' && amountVal < 20) {
                Notifications.show(i18n.amount_min_usd || '美元最低提现金额为20美金', 'error');
                return;
            }

            // 验证真实姓名
            const realName = inputRealName.value.trim();
            if (!realName) {
                Notifications.show(i18n.name_required || '请填写真实姓名', 'error');
                return;
            }

            let bankName = '';
            let cardNumber = '';

            // 验证银行汇款或约定方式的账号信息
            if (selectedMethod === 'bank') {
                cardNumber = inputCardNum.value.trim();
                const cardNumberConfirm = inputCardNumConfirm.value.trim();

                if (selectedRegion === 'mainland') {
                    bankName = inputBankName.value.trim();
                    if (!bankName) {
                        Notifications.show(i18n.bank_required || '请填写开户银行', 'error');
                        return;
                    }
                } else {
                    const bankNameEn = inputBankNameEn.value.trim();
                    const swiftCode = inputBankSwift.value.trim();
                    const country = inputBankCountry.value.trim();

                    if (!bankNameEn) {
                        Notifications.show(i18n.bank_name_en_required || '请填写银行英文名称', 'error');
                        return;
                    }
                    if (!swiftCode) {
                        Notifications.show(i18n.swift_required || '请填写 SWIFT Code', 'error');
                        return;
                    }
                    if (!country) {
                        Notifications.show(i18n.country_required || '请填写银行国家/地区', 'error');
                        return;
                    }
                    bankName = `${bankNameEn} (SWIFT: ${swiftCode}, Country: ${country})`;
                }

                if (!cardNumber) {
                    Notifications.show(i18n.card_required || '请填写银行卡号', 'error');
                    return;
                }
                if (cardNumber !== cardNumberConfirm) {
                    Notifications.show(i18n.card_mismatch || '两次输入的银行卡号不一致，请重新输入', 'error');
                    return;
                }
            } else {
                cardNumber = inputCardNum.value.trim();
                const cardNumberConfirm = inputCardNumConfirm.value.trim();

                if (!cardNumber) {
                    Notifications.show(i18n.card_required_agreed || '请填写收款账号', 'error');
                    return;
                }
                if (cardNumber !== cardNumberConfirm) {
                    Notifications.show(i18n.card_mismatch_agreed || '两次输入的收款账号不一致，请重新输入', 'error');
                    return;
                }
            }

            // 提交数据至 Supabase
            btnSubmit.disabled = true;
            const originalText = btnSubmit.textContent;
            btnSubmit.textContent = '提交中...';

            try {
                const amountCents = Math.round(amountVal * 100);

                const { error: insertError } = await client
                    .from('withdrawal_requests')
                    .insert({
                        user_id: user.id,
                        amount: amountCents,
                        currency: selectedCurrency,
                        payment_method: selectedMethod,
                        real_name: realName,
                        bank_name: bankName,
                        card_number: cardNumber,
                        status: 'pending'
                    });

                if (insertError) {
                    throw insertError;
                }

                Notifications.show(i18n.withdrawal_success || '提现申请已成功提交，我们将尽快为您处理！', 'success');
                closeModal();
                await checkPendingWithdrawals();
            } catch (err) {
                console.error('Submit withdrawal request failed:', err);
                Notifications.show((i18n.withdrawal_failed || '提交提现申请失败，请稍后重试：') + (err.message || JSON.stringify(err)), 'error');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalText;
            }
        });
    }

    // 查询并更新未决（pending）提现状态
    async function checkPendingWithdrawals() {
        console.log('[Invite] Checking pending withdrawal requests for user:', user.id);
        const banner = document.getElementById('withdrawal-pending-banner');
        const bannerText = document.getElementById('withdrawal-pending-text');
        const btnWithdraw = document.getElementById('btn-request-withdrawal');

        try {
            const { data: pendingRequests, error: pendingError } = await client
                .from('withdrawal_requests')
                .select('amount, currency')
                .eq('user_id', user.id)
                .eq('status', 'pending');

            if (pendingError) {
                console.warn('[Invite] Query pending withdrawal requests failed:', pendingError);
                return;
            }

            if (pendingRequests && pendingRequests.length > 0) {
                hasPendingWithdrawal = true;

                // 汇总各币种的 pending 金额
                const summaryParts = [];
                const cnySum = pendingRequests
                    .filter(r => r.currency === 'CNY')
                    .reduce((sum, r) => sum + r.amount, 0);
                const usdSum = pendingRequests
                    .filter(r => r.currency === 'USD')
                    .reduce((sum, r) => sum + r.amount, 0);

                if (cnySum > 0) {
                    summaryParts.push(`¥${(cnySum / 100).toFixed(2)}`);
                }
                if (usdSum > 0) {
                    summaryParts.push(`$${(usdSum / 100).toFixed(2)}`);
                }

                const pendingText = summaryParts.join(' / ');
                const hintTemplate = window.inviteI18n && window.inviteI18n.withdrawal_pending_hint
                    ? window.inviteI18n.withdrawal_pending_hint
                    : "您有 {amount} 提现正在等待处理，暂不能提交新的提现申请";

                if (bannerText) {
                    bannerText.textContent = hintTemplate.replace('{amount}', pendingText);
                }
                if (banner) {
                    banner.style.display = 'flex';
                }
                if (btnWithdraw) {
                    btnWithdraw.disabled = true;
                    btnWithdraw.style.opacity = '0.6';
                    btnWithdraw.style.cursor = 'not-allowed';
                    btnWithdraw.title = window.inviteI18n && window.inviteI18n.withdrawal_pending_limit_error
                        ? window.inviteI18n.withdrawal_pending_limit_error
                        : "您已有正在处理中的提现申请";
                }
            } else {
                hasPendingWithdrawal = false;
                if (banner) banner.style.display = 'none';
                if (btnWithdraw) {
                    btnWithdraw.disabled = false;
                    btnWithdraw.style.opacity = '';
                    btnWithdraw.style.cursor = '';
                    btnWithdraw.removeAttribute('title');
                }
            }
        } catch (e) {
            console.error('[Invite] Error checking pending withdrawals:', e);
        }
    }
});
