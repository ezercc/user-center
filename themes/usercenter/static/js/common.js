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

const client = supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
        storage: rootDomainStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

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
            type === 'error' ? 'error' : 'warning';

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

        requestAnimationFrame(() => notification.classList.add('show'));

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
// 人机验证 (Cloudflare Turnstile)
// ----------------------------------------------------------------
const SITE_KEY = '0x4AAAAAADMD3poPSTGFvxsO';

function executeCaptcha() {
    return new Promise((resolve, reject) => {
        // 动态注入加载器样式
        if (!document.getElementById('captcha-loader-style')) {
            const style = document.createElement('style');
            style.id = 'captcha-loader-style';
            style.innerHTML = `
                .captcha-box-loading {
                    position: relative;
                    min-width: 320px;
                    min-height: 90px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .captcha-loader {
                    position: absolute;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 10px;
                    color: var(--text-secondary);
                    font-size: 13px;
                    pointer-events: none;
                }
                .captcha-loader .spinner {
                    width: 24px;
                    height: 24px;
                    border: 3px solid var(--border-color);
                    border-top-color: var(--primary-color);
                    border-radius: 50%;
                    animation: captcha-spin 0.8s linear infinite;
                }
                @keyframes captcha-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        const overlay = document.createElement('div');
        overlay.className = 'captcha-overlay';
        const box = document.createElement('div');
        box.className = 'captcha-box captcha-box-loading';

        const loader = document.createElement('div');
        loader.className = 'captcha-loader';
        loader.innerHTML = `
            <div class="spinner"></div>
            <span>正在加载验证组件...</span>
        `;
        box.appendChild(loader);

        const captchaDiv = document.createElement('div');
        const uniqueId = 'turnstile-' + Date.now();
        captchaDiv.id = uniqueId;
        captchaDiv.style.position = 'relative';
        captchaDiv.style.zIndex = '2';
        box.appendChild(captchaDiv);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        // 点击遮罩层可以关闭验证
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 300);
                reject('Captcha closed');
            }
        });

        if (!window.turnstile) {
            const msg = (window.i18n && window.i18n.captcha_load_failed) ||
                (window.userI18n && window.userI18n.captcha_load_failed) ||
                '验证组件加载失败';
            Notifications.show(msg, 'error');
            overlay.remove(); reject('Captcha fail'); return;
        }

        try {
            window.turnstile.render(captchaDiv, {
                sitekey: SITE_KEY,
                'before-interactive-callback': () => {
                    loader.style.display = 'none';
                },
                callback: (token) => {
                    overlay.classList.remove('active');
                    setTimeout(() => overlay.remove(), 300);
                    resolve(token);
                },
                'error-callback': () => {
                    const msg = (window.i18n && window.i18n.captcha_failed) ||
                        (window.userI18n && window.userI18n.captcha_failed) ||
                        '验证失败';
                    Notifications.show(msg, 'error');
                    overlay.classList.remove('active');
                    setTimeout(() => overlay.remove(), 300);
                    reject('Captcha error');
                },
                'expired-callback': () => {
                    Notifications.show('验证已过期，请重试', 'warning');
                    overlay.classList.remove('active');
                    setTimeout(() => overlay.remove(), 300);
                    reject('Captcha expired');
                }
            });
        } catch (e) {
            overlay.remove(); reject(e);
        }
    });
}

window.executeCaptcha = executeCaptcha;
