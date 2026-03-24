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
        for (let i = arr.length - 1; i >= 0; i--) {
            const item = arr[i];
            const offset = 16 + (arr.length - 1 - i) * 70;
            item.style.bottom = `${offset}px`;
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
function getLoginUrl(redirectPath = '/') {
    const isEn = window.location.pathname.startsWith('/en/');
    const base = isEn ? '/en/login/' : '/login/';
    const redirect = isEn ? (redirectPath.startsWith('/en/') ? redirectPath : '/en' + redirectPath) : redirectPath;
    return `${base}?redirect=${encodeURIComponent(redirect)}`;
}

window.getLoginUrl = getLoginUrl;

// ----------------------------------------------------------------
// 人机验证 (hCaptcha)
// ----------------------------------------------------------------
const SITE_KEY = 'ea4ad0ce-1bf0-4b58-be28-3730062ac914';

function executeCaptcha() {
    return new Promise((resolve, reject) => {
        const overlay = document.createElement('div');
        overlay.className = 'captcha-overlay';
        const box = document.createElement('div');
        box.className = 'captcha-box';
        const captchaDiv = document.createElement('div');
        const uniqueId = 'h-captcha-' + Date.now();
        captchaDiv.id = uniqueId;
        box.appendChild(captchaDiv);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        if (!window.hcaptcha) {
            const msg = (window.i18n && window.i18n.captcha_load_failed) || 
                        (window.userI18n && window.userI18n.captcha_load_failed) || 
                        '验证组件加载失败';
            Notifications.show(msg, 'error');
            overlay.remove(); reject('Captcha fail'); return;
        }

        try {
            window.hcaptcha.render(uniqueId, {
                sitekey: SITE_KEY,
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
                    overlay.remove(); reject('Captcha error');
                },
                'close-callback': () => {
                    overlay.remove(); reject('Captcha closed');
                }
            });
        } catch (e) {
            overlay.remove(); reject(e);
        }
    });
}

window.executeCaptcha = executeCaptcha;
