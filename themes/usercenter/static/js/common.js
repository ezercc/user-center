// ----------------------------------------------------------------
// Supabase 配置与初始化
// ----------------------------------------------------------------
const supabaseUrl = 'https://msufgvqofnihylcnxyac.supabase.co';
const supabaseKey = 'sb_publishable_XMPIdUpNn_dPH7iKdGK_Zg_J8InT4c9';

const rootDomainStorage = {
    getItem: (key) => {
        const name = key + "=";
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1);
            if (c.indexOf(name) === 0) return c.substring(name.length, c.length);
        }
        return null;
    },
    setItem: (key, value) => {
        const d = new Date();
        d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
        const expires = "expires=" + d.toUTCString();
        document.cookie = `${key}=${value};${expires};domain=.ezer.cc;path=/;SameSite=Lax;Secure`;
    },
    removeItem: (key) => {
        document.cookie = `${key}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;domain=.ezer.cc;path=/;`;
    }
};

let client = null;
try {
    if (typeof supabase !== 'undefined' && supabase && typeof supabase.createClient === 'function') {
        client = supabase.createClient(supabaseUrl, supabaseKey, {
            auth: {
                storage: rootDomainStorage,
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true
            }
        });
    }
} catch (e) {
    console.warn('Supabase client initialization skipped or failed:', e);
}

// ----------------------------------------------------------------
// 侧边栏账户与订阅管理器
// ----------------------------------------------------------------
const AccountPlan = {
    portalUrl: 'https://msufgvqofnihylcnxyac.supabase.co/functions/v1/create-stripe-portal',

    getElements() {
        const root = document.getElementById('dashboard-account-plan');
        if (!root) return null;

        return {
            root,
            planName: document.getElementById('dashboard-plan-name'),
            action: document.getElementById('dashboard-plan-action'),
            expiry: document.getElementById('dashboard-plan-expiry'),
            expiryRow: document.getElementById('dashboard-plan-expiry-row')
        };
    },

    setAction(elements, label, onClick) {
        elements.action.hidden = false;
        elements.action.textContent = label;
        elements.action.removeAttribute('href');
        elements.action.onclick = onClick;
    },

    showFree(elements) {
        elements.planName.textContent = elements.root.dataset.freePlan;
        if (elements.expiryRow) elements.expiryRow.hidden = true;
        this.setAction(elements, elements.root.dataset.upgrade, null);
        const locale = elements.root.dataset.locale === 'en' ? 'en' : 'zh';
        elements.action.href = locale === 'en'
            ? 'https://www.ezer.cc/en/premium/'
            : 'https://www.ezer.cc/premium/';
    },

    showUnavailable(elements) {
        elements.planName.textContent = elements.root.dataset.unavailable;
        elements.action.hidden = true;
        if (elements.expiryRow) elements.expiryRow.hidden = true;
    },

    showPremium(elements, session, paidThrough) {
        const locale = elements.root.dataset.locale === 'en' ? 'en' : 'zh';
        const formattedDate = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).format(paidThrough);

        elements.planName.textContent = elements.root.dataset.proPlan;
        if (elements.expiryRow) {
            elements.expiryRow.hidden = false;
            elements.expiry.textContent = formattedDate;
        }
        this.setAction(elements, elements.root.dataset.manage, () => this.openPortal(elements, session));
    },

    async openPortal(elements, session) {
        const button = elements.action;
        if (button.dataset.loading === 'true') return;

        button.dataset.loading = 'true';
        button.setAttribute('aria-disabled', 'true');
        button.classList.add('is-loading');
        button.textContent = elements.root.dataset.openingPortal;

        try {
            const response = await fetch(this.portalUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ locale: elements.root.dataset.locale === 'en' ? 'en' : 'zh' })
            });
            const data = await response.json().catch(() => null);
            const portalUrl = data?.url;
            const parsedUrl = portalUrl ? new URL(portalUrl) : null;

            if (!response.ok || !parsedUrl || parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.stripe.com')) {
                throw new Error('Could not open billing portal');
            }

            window.location.assign(parsedUrl.toString());
        } catch (error) {
            console.error('Stripe portal request failed:', error);
            Notifications.show(elements.root.dataset.portalError, 'error');
            button.dataset.loading = 'false';
            button.removeAttribute('aria-disabled');
            button.classList.remove('is-loading');
            button.textContent = elements.root.dataset.manage;
        }
    },

    async init() {
        const elements = this.getElements();
        if (!elements) return;

        try {
            const { data: { session } } = await client.auth.getSession();
            if (!session) {
                elements.root.hidden = true;
                return;
            }

            const { data: plan, error } = await client
                .from('user_plans')
                .select('plan_type, paid_through, billing_status, billing_current_period_end, cancel_at_period_end')
                .eq('uid', session.user.id)
                .maybeSingle();

            if (error) {
                console.error('Subscription status lookup failed:', error);
                this.showUnavailable(elements);
                return;
            }

            const paidThrough = plan?.paid_through ? new Date(plan.paid_through) : null;
            const hasActivePremium = plan?.plan_type === 'premium'
                && paidThrough
                && !Number.isNaN(paidThrough.getTime())
                && paidThrough > new Date();

            if (hasActivePremium) {
                this.showPremium(elements, session, paidThrough);
            } else {
                this.showFree(elements);
            }
        } catch (error) {
            console.error('Subscription status initialization failed:', error);
            this.showUnavailable(elements);
        }
    }
};

// ----------------------------------------------------------------
// 全局未读消息管理器
// ----------------------------------------------------------------
const UnreadBadge = {
    userId: null,

    async init() {
        // 获取当前用户
        const { data: { session } } = await client.auth.getSession();
        if (!session) return;
        this.userId = session.user.id;

        // 初次检查
        this.check();

        // 开启全局实时监听
        this.subscribe();
    },

    async check() {
        if (!this.userId) return;

        try {
            // 1. 查询系统通知未读数
            const { count: sysCount } = await client
                .from('notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', this.userId)
                .eq('is_read', false);

            // 2. 查询私信未读数
            const { count: msgCount } = await client
                .from('private_messages')
                .select('id', { count: 'exact', head: true })
                .eq('receiver_id', this.userId)
                .eq('is_read', false);

            const total = (sysCount || 0) + (msgCount || 0);
            this.updateUI(total);

        } catch (err) {
            console.error('Check unread failed:', err);
        }
    },

    updateUI(count) {
        const dot = document.getElementById('sidebar-unread-dot');
        if (!dot) return;

        if (count > 0) {
            dot.classList.add('show');
        } else {
            dot.classList.remove('show');
        }
    },

    subscribe() {
        if (!this.userId) return;

        // 监听所有针对我的新插入消息
        const channel = client.channel('global_badge_listener')
            // 监听新私信
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'private_messages',
                filter: `receiver_id=eq.${this.userId}`
            }, () => {
                this.updateUI(1); // 只要有新的，肯定显示红点，不用重新查库
                Notifications.show('收到新私信', 'info');
            })
            // 监听新系统通知
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${this.userId}`
            }, () => {
                this.updateUI(1);
                Notifications.show('收到系统通知', 'info');
            })
            // 监听消息状态变为“已读” (UPDATE) -> 重新计算总数
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'private_messages',
                filter: `receiver_id=eq.${this.userId}`
            }, () => this.check())
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${this.userId}`
            }, () => this.check())
            .subscribe();
    }
};

// ----------------------------------------------------------------
// 通知系统 (Toast)
// ----------------------------------------------------------------
const Notifications = {
    list: new Set(),

    show(message, type = 'info') {
        if (message && typeof message === 'string') {
            if (message.includes("Password should contain at least one character of each:")) {
                message = (window.i18n && window.i18n.password_complexity_error) ||
                          (window.userI18n && window.userI18n.password_complexity_error) ||
                          "密码需包含大小写字母、数字和特殊字符";
            }
        }
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;

        const icon = type === 'success' ? 'check_circle' :
            type === 'error' ? 'error' :
            type === 'info' ? 'info' : 'warning';

        notification.innerHTML = `
            <div class="notification-wrapper">
                <div class="notification-icon">
                    <span class="material-icons-round">${icon}</span>
                </div>
                <div class="notification-content"><p>${message}</p></div>
            </div>
        `;

        document.body.appendChild(notification);
        this.list.add(notification);
        this.updatePosition();

        // 同步触发布局回流，确保初始帧确认后立即显示，不进入 rAF 队列等待
        void notification.offsetWidth;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                this.list.delete(notification);
                notification.remove();
                this.updatePosition();
            }, 300);
        }, 3000);
    },

    updatePosition() {
        const arr = Array.from(this.list);
        let offset = 16;
        for (let i = arr.length - 1; i >= 0; i--) {
            const item = arr[i];
            item.style.bottom = `${offset}px`;
            offset += item.offsetHeight + 12;
        }
    }
};

// ----------------------------------------------------------------
// 布局与主题
// ----------------------------------------------------------------
const AppLayout = {
    init() {
        // 清理旧 localStorage
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
                localStorage.removeItem(key);
            }
        });

        this.initTheme();
        this.initSidebar();
        AccountPlan.init();

        // >>> 启动全局未读检测 <<<
        UnreadBadge.init();
    },

    initTheme() {
        const toggleBtn = document.getElementById('theme-toggle');
        if (!toggleBtn) return;
        const icon = toggleBtn.querySelector('.material-icons-round');

        const savedTheme = localStorage.getItem('theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        const applyTheme = (theme) => {
            document.documentElement.setAttribute('data-theme', theme);
            if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
        };

        if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
            applyTheme('dark');
        }

        toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            localStorage.setItem('theme', next);
        });
    },

    initSidebar() {
        const menuBtn = document.getElementById('menu-btn');
        const closeBtn = document.getElementById('close-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const sidebar = document.getElementById('sidebar');

        if (!menuBtn) return;

        const toggleMenu = (show) => {
            if (show) {
                sidebar.classList.add('active');
                overlay.classList.add('active');
            } else {
                sidebar.classList.remove('active');
                overlay.classList.remove('active');
            }
        };

        menuBtn.addEventListener('click', () => toggleMenu(true));
        closeBtn.addEventListener('click', () => toggleMenu(false));
        overlay.addEventListener('click', () => toggleMenu(false));
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AppLayout.init();
});

// 将 UnreadBadge 暴露给全局，以便 message.js 在阅读后手动调用刷新
window.UnreadBadge = UnreadBadge;

// ----------------------------------------------------------------
// 路由与重定向辅助 (i18n 兼容)
// ----------------------------------------------------------------
function isEzerCcHostname(hostname) {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    return host === 'ezer.cc' || host.endsWith('.ezer.cc');
}

function isAllowedEzerCcRedirect(url) {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        return isEzerCcHostname(parsed.hostname);
    } catch {
        return false;
    }
}

window.isEzerCcHostname = isEzerCcHostname;
window.isAllowedEzerCcRedirect = isAllowedEzerCcRedirect;

function getLoginUrl(redirectPath = '/') {
    const isEn = window.location.pathname.startsWith('/en/');
    const base = isEn ? '/en/login/' : '/login/';
    const redirect = isEn ? (redirectPath.startsWith('/en/') ? redirectPath : '/en' + redirectPath) : redirectPath;
    return `${base}?redirect=${encodeURIComponent(redirect)}`;
}

window.getLoginUrl = getLoginUrl;

// ----------------------------------------------------------------
// 人机验证 (Cloudflare Turnstile - 无感验证与交互质询升级模式)
// ----------------------------------------------------------------
const SITE_KEY = '0x4AAAAAADMD3poPSTGFvxsO';

let _cachedCaptchaToken = null;
let _pendingCaptchaPromise = null;
let _needsInteraction = false;
let _activeOverlay = null;
let _activeWidgetId = null;
let _pendingReject = null;
let _currentForceModal = false;
let _activeTimeoutTimer = null;

// 安全销毁挂载的 Turnstile 组件，杜绝内存与事件句柄泄漏
function safeRemoveWidget() {
    if (_activeWidgetId !== null && window.turnstile && typeof window.turnstile.remove === 'function') {
        try {
            window.turnstile.remove(_activeWidgetId);
        } catch (_) {}
        _activeWidgetId = null;
    }
}

// 统一彻底清理状态机，重置并发锁与超时定时器
function cleanupCaptchaState() {
    if (_activeTimeoutTimer) {
        clearTimeout(_activeTimeoutTimer);
        _activeTimeoutTimer = null;
    }
    safeRemoveWidget();
    _pendingCaptchaPromise = null;
    _needsInteraction = false;
    _pendingReject = null;
    _currentForceModal = false;
}

// 获取或创建交互质询弹窗
function getCaptchaOverlay() {
    let overlay = document.getElementById('cf-interactive-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cf-interactive-overlay';
        overlay.className = 'captcha-overlay';
        overlay.innerHTML = `
            <div class="captcha-box" style="position:relative; min-width:320px; display:flex; flex-direction:column; align-items:center; gap:16px;">
                <div style="font-size:14px; font-weight:500; color:var(--text-color); text-align:center;">
                    ${(window.i18n && window.i18n.security_check_title) || (window.userI18n && window.userI18n.security_check_title) || '请完成安全验证'}
                </div>
                <div id="cf-turnstile-slot" style="min-height:65px; display:flex; align-items:center; justify-content:center;"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        // 点击遮罩层取消：同步彻底清理状态与定时器，解除并发锁，保证用户可立即重试
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                abortCaptcha('Captcha closed');
            }
        });
    }
    return overlay;
}

function showCaptchaOverlay() {
    const overlay = getCaptchaOverlay();
    overlay.classList.add('active');
    _activeOverlay = overlay;
}

function closeCaptchaOverlay() {
    if (_activeOverlay) {
        _activeOverlay.classList.remove('active');
        _activeOverlay = null;
    }
}

// 中断取消流程：关闭弹窗，执行清理并拒绝 Promise
function abortCaptcha(reason = 'Captcha closed') {
    closeCaptchaOverlay();
    if (_pendingReject) {
        const rejectFn = _pendingReject;
        cleanupCaptchaState();
        rejectFn(new Error(reason));
    } else {
        cleanupCaptchaState();
    }
}

// 执行验证（forceModal: 是否在需要交互时强制立即弹出弹窗）
function runTurnstile(forceModal = true) {
    // 1. 如果已有预热就绪的 Token，直接返回并清空（单次消费）
    if (_cachedCaptchaToken) {
        const token = _cachedCaptchaToken;
        _cachedCaptchaToken = null;
        return Promise.resolve(token);
    }

    // 2. 如果当前已有正在进行的异步验证
    if (_pendingCaptchaPromise) {
        if (forceModal) {
            _currentForceModal = true;
            // 若预热期间已触发了交互质询，现在用户提交了，立刻唤起弹窗并重设为长交互超时
            if (_needsInteraction) {
                showCaptchaOverlay();
                if (typeof window.resetInteractiveTimeout === 'function') {
                    window.resetInteractiveTimeout();
                }
            }
        }
        return _pendingCaptchaPromise;
    }

    _currentForceModal = forceModal;

    // 3. 开启新一轮验证
    _pendingCaptchaPromise = new Promise((resolve, reject) => {
        _pendingReject = reject;

        // 等待 Turnstile SDK 就绪
        const waitForSdk = (retries = 30) => {
            if (window.turnstile && typeof window.turnstile.render === 'function') {
                return Promise.resolve(true);
            }
            if (retries <= 0) return Promise.resolve(false);
            return new Promise(r => setTimeout(r, 100)).then(() => waitForSdk(retries - 1));
        };

        waitForSdk().then(ready => {
            if (!ready) {
                const wasForce = _currentForceModal;
                cleanupCaptchaState();
                if (wasForce) {
                    const msg = (window.i18n && window.i18n.captcha_load_failed) ||
                        (window.userI18n && window.userI18n.captcha_load_failed) ||
                        '验证组件加载失败';
                    Notifications.show(msg, 'error');
                }
                return reject(new Error('Captcha load failed'));
            }

            const overlay = getCaptchaOverlay();
            const slot = overlay.querySelector('#cf-turnstile-slot');
            
            // 安全移除已有 widget，再清理 DOM 容器
            safeRemoveWidget();
            slot.innerHTML = '';

            // 启动定时器（静默阶段 15 秒，交互阶段可延展至 60 秒）
            setCaptchaTimeout(15000);

            function setCaptchaTimeout(ms) {
                if (_activeTimeoutTimer) clearTimeout(_activeTimeoutTimer);
                _activeTimeoutTimer = setTimeout(() => {
                    const wasForce = _currentForceModal;
                    closeCaptchaOverlay();
                    cleanupCaptchaState();
                    if (wasForce) {
                        const timeoutMsg = (window.i18n && window.i18n.captcha_timeout) ||
                            (window.userI18n && window.userI18n.captcha_timeout) ||
                            '验证超时，请重试';
                        Notifications.show(timeoutMsg, 'warning');
                    }
                    reject(new Error('Captcha timeout'));
                }, ms);
            }

            window.resetInteractiveTimeout = () => setCaptchaTimeout(60000);

            try {
                _activeWidgetId = window.turnstile.render(slot, {
                    sitekey: SITE_KEY,
                    size: 'invisible',
                    // 当需要用户交互时，Turnstile 会触发 before-interactive-callback
                    'before-interactive-callback': () => {
                        _needsInteraction = true;
                        if (_currentForceModal) {
                            showCaptchaOverlay();
                            setCaptchaTimeout(60000); // 交互质询给用户 60 秒充裕时间
                        }
                    },
                    callback: (token) => {
                        closeCaptchaOverlay();
                        cleanupCaptchaState();
                        resolve(token);
                    },
                    'error-callback': (code) => {
                        const wasForce = _currentForceModal;
                        closeCaptchaOverlay();
                        cleanupCaptchaState();
                        // 预热阶段失败静默吞掉，绝不向用户误报红字
                        if (wasForce) {
                            const msg = (window.i18n && window.i18n.captcha_failed) ||
                                (window.userI18n && window.userI18n.captcha_failed) ||
                                '验证失败';
                            Notifications.show(msg, 'error');
                        }
                        reject(new Error(`Captcha error: ${code}`));
                    },
                    'timeout-callback': () => {
                        const wasForce = _currentForceModal;
                        closeCaptchaOverlay();
                        cleanupCaptchaState();
                        if (wasForce) {
                            const timeoutMsg = (window.i18n && window.i18n.captcha_timeout) ||
                                (window.userI18n && window.userI18n.captcha_timeout) ||
                                '验证超时，请重试';
                            Notifications.show(timeoutMsg, 'warning');
                        }
                        reject(new Error('Captcha timeout'));
                    },
                    'expired-callback': () => {
                        _cachedCaptchaToken = null;
                        cleanupCaptchaState();
                        // 滑动保鲜机制：若页面当前仍对用户可见，静默重新触发一轮预热，确保用户点击时总有最新可用 Token
                        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                            setTimeout(() => {
                                prewarmCaptcha();
                            }, 1000);
                        }
                    }
                });
            } catch (e) {
                closeCaptchaOverlay();
                cleanupCaptchaState();
                reject(e);
            }
        });
    });

    return _pendingCaptchaPromise;
}

// 聚焦/开局预热（静默获取，若需交互则暂缓弹窗，等点击提交时再弹）
function prewarmCaptcha() {
    if (_cachedCaptchaToken || _pendingCaptchaPromise) return;
    runTurnstile(false)
        .then(token => {
            _cachedCaptchaToken = token;
            return token;
        })
        .catch(() => {
            _cachedCaptchaToken = null;
        });
}

// 标签页重新切回可见时，若 Token 已空则静默保鲜
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !_cachedCaptchaToken && !_pendingCaptchaPromise) {
            prewarmCaptcha();
        }
    });
}

// 消费执行（默认强制允许弹窗）
function executeCaptcha() {
    return runTurnstile(true);
}

window.executeCaptcha = executeCaptcha;
window.prewarmCaptcha = prewarmCaptcha;


