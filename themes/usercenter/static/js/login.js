document.addEventListener('DOMContentLoaded', async () => {
    if (typeof client === 'undefined') return;

    // 拦截 Recovery 状态
    const hash = window.location.hash;
    const isRecoveryFlow = hash && hash.includes('type=recovery');

    if (isRecoveryFlow) {
        console.log(window.i18n ? window.i18n.recovery_lock_log : "🔒 检测到重置密码流程，已锁定跳转逻辑。");
    }

    // 状态变量
    let currentEmail = '';

    // DOM 元素引用
    const steps = {
        email: document.getElementById('step-email'),
        password: document.getElementById('step-password'),
        register: document.getElementById('step-register'),
        forgot: document.getElementById('step-forgot'), // 请求邮件页
        update: document.getElementById('step-update-password') // 设置新密码页
    };

    const elements = {
        inputEmail: document.getElementById('input-email'),
        regEmail: document.getElementById('reg-email'),
        forgotEmail: document.getElementById('forgot-email'),
        displayEmail: document.getElementById('display-email'),
        title: document.getElementById('auth-title'),
        subtitle: document.getElementById('auth-subtitle'),
        // 新密码输入框
        newPwd: document.getElementById('new-password'),
        newPwdConfirm: document.getElementById('new-password-confirm')
    };

    // 获取重定向 URL
    function getRedirectUrl() {
        const params = new URLSearchParams(window.location.search);
        const redirect = params.get('redirect');
        if (redirect) {
            if (redirect.includes('ezer.cc')) return "https://account.ezer.cc/callback/?redirect=" + encodeURIComponent(redirect);
            if (redirect.startsWith('/')) return "https://account.ezer.cc" + redirect;
        }
        return 'https://account.ezer.cc/';
    }

    // 切换步骤 UI
    function switchStep(stepName) {
        Object.values(steps).forEach(el => { if (el) el.classList.remove('active'); });
        if (steps[stepName]) steps[stepName].classList.add('active');

        // 动态更新标题
        if (stepName === 'email') {
            elements.title.textContent = window.i18n ? window.i18n.title_email : '登录';
            elements.subtitle.textContent = window.i18n ? window.i18n.subtitle_email : '使用您的 Ezer 账号';
        } else if (stepName === 'password') {
            elements.title.textContent = window.i18n ? window.i18n.title_password : '欢迎回来';
            elements.subtitle.textContent = window.i18n ? window.i18n.subtitle_password : '请输入密码以继续';
            if (elements.displayEmail) elements.displayEmail.textContent = currentEmail;
        } else if (stepName === 'register') {
            elements.title.textContent = window.i18n ? window.i18n.title_register : '创建账号';
            elements.subtitle.textContent = window.i18n ? window.i18n.subtitle_register : '注册一个新的 Ezer 账号';

            // 邮箱同步逻辑
            if (currentEmail) {
                elements.regEmail.value = currentEmail;
                // 暂时添加 style 触发 focus 效果，或者依赖 css :not(:placeholder-shown)
            } else {
                elements.regEmail.value = '';
            }
        } else if (stepName === 'forgot') {
            elements.title.textContent = window.i18n ? window.i18n.title_forgot : '重置密码';
            elements.subtitle.textContent = window.i18n ? window.i18n.subtitle_forgot : '通过邮箱找回账号';
        } else if (stepName === 'update') {
            elements.title.textContent = window.i18n ? window.i18n.title_update : '重置密码';
            elements.subtitle.textContent = window.i18n ? window.i18n.subtitle_update : '请输入新的安全密码';
        }
    }

    // ============================================================
    // 监听 Auth 状态
    // ============================================================
    client.auth.onAuthStateChange(async (event, session) => {
        // 调试日志
        console.log("Auth Event:", event);

        // 情况 1: 明确捕获到 RECOVERY 事件 (最理想情况)
        if (event === 'PASSWORD_RECOVERY') {
            switchStep('update');
            Notifications.show(window.i18n ? window.i18n.verification_success_set_pwd : '验证成功，请设置新密码', 'success');
            return;
        }

        // 情况 2: 捕获到 SIGNED_IN 事件 (Supabase 恢复链接本质上也是一次登录)
        if (event === 'SIGNED_IN') {
            // >>> 关键修改：检查我们在页面加载初期捕获的变量 <<<
            if (isRecoveryFlow) {
                console.log(window.i18n ? window.i18n.intercept_redirect_log : "拦截自动跳转，进入重置密码界面");
                switchStep('update');

                // 只有当 session 存在时才显示提示，避免误报
                if (session) {
                    Notifications.show(window.i18n ? window.i18n.recovery_interception_msg : '请设置您的新密码', 'info');
                }
            } else {
                // 只有在【非】重置模式下，才执行自动跳转
                setTimeout(() => {
                    // 双重保险：再次检查 URL (虽然 hash 可能已经被清除了)
                    // 但主要依赖上面的 isRecoveryFlow 变量
                    window.location.href = getRedirectUrl();
                }, 500);
            }
        }
    });

    // ============================================================
    // 常规登录/注册逻辑
    // ============================================================

    // 1. 输入邮箱 -> 下一步
    document.getElementById('btn-next').addEventListener('click', () => {
        const email = elements.inputEmail.value.trim();
        if (!email) return Notifications.show(window.i18n ? window.i18n.please_enter_email : '请输入邮箱', 'warning');
        if (!/^\S+@\S+\.\S+$/.test(email)) return Notifications.show(window.i18n ? window.i18n.invalid_email_format : '邮箱格式不正确', 'warning');
        currentEmail = email;
        switchStep('password');
    });

    // 2. 去注册
    document.getElementById('btn-to-register').addEventListener('click', () => {
        if (elements.inputEmail.value) currentEmail = elements.inputEmail.value;
        switchStep('register');
    });

    // 3. 返回修改邮箱
    document.getElementById('btn-back-email').addEventListener('click', () => switchStep('email'));
    const userChip = document.getElementById('user-chip');
    if (userChip) userChip.addEventListener('click', () => switchStep('email'));

    // 4. 从注册页返回登录
    document.getElementById('btn-back-login').addEventListener('click', () => {
        const regEmailVal = elements.regEmail.value.trim();
        if (regEmailVal) currentEmail = regEmailVal;

        if (currentEmail) {
            elements.inputEmail.value = currentEmail;
            switchStep('password');
        } else {
            switchStep('email');
        }
    });

    // 5. 登录
    document.getElementById('btn-login').addEventListener('click', async () => {
        const password = document.getElementById('input-password').value;
        if (!password) return Notifications.show(window.i18n ? window.i18n.please_enter_password : '请输入密码', 'warning');

        try {
            const token = await executeCaptcha();
            const { error } = await client.auth.signInWithPassword({
                email: currentEmail,
                password: password,
                options: { captchaToken: token }
            });
            if (error) throw error;
            Notifications.show(window.i18n ? window.i18n.login_success : '登录成功', 'success');
        } catch (err) {
            if (err !== 'Captcha closed') Notifications.show(err.message || (window.i18n ? window.i18n.login_failed : '登录失败'), 'error');
        }
    });

    // 6. OTP 登录
    document.getElementById('btn-otp-login').addEventListener('click', async () => {
        try {
            const token = await executeCaptcha();
            const { error } = await client.auth.signInWithOtp({
                email: currentEmail,
                options: {
                    captchaToken: token,
                    emailRedirectTo: getRedirectUrl()
                }
            });
            if (error) throw error;
            Notifications.show(window.i18n ? window.i18n.otp_sent : '登录链接已发送至您的邮箱', 'success');
        } catch (err) {
            if (err !== 'Captcha closed') Notifications.show(err.message, 'error');
        }
    });

    // 7. 第三方登录
    document.querySelectorAll('.social-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const provider = e.currentTarget.getAttribute('data-provider');
            try {
                const token = await executeCaptcha();
                await client.auth.signInWithOAuth({
                    provider: provider,
                    options: { captchaToken: token, redirectTo: getRedirectUrl() }
                });
            } catch (err) { if (err !== 'Captcha closed') Notifications.show(err.message, 'error'); }
        });
    });

    // 8. 注册
    document.getElementById('btn-register').addEventListener('click', async () => {
        const email = elements.regEmail.value.trim();
        const pwd = document.getElementById('reg-password').value;
        const pwdR = document.getElementById('reg-password-repeat').value;

        if (!email) return Notifications.show(window.i18n ? window.i18n.please_enter_email : '请输入电子邮箱', 'warning');
        if (!/^\S+@\S+\.\S+$/.test(email)) return Notifications.show(window.i18n ? window.i18n.invalid_email_format : '邮箱格式不正确', 'warning');
        if (pwd.length < 8) return Notifications.show(window.i18n ? window.i18n.password_too_short : '密码长度需大于8位', 'warning');
        if (pwd !== pwdR) return Notifications.show(window.i18n ? window.i18n.password_mismatch : '两次密码输入不一致', 'warning');

        try {
            const token = await executeCaptcha();
            const { error } = await client.auth.signUp({
                email: email,
                password: pwd,
                options: {
                    captchaToken: token,
                    emailRedirectTo: getRedirectUrl()
                }
            });
            if (error) throw error;
            Notifications.show(window.i18n ? window.i18n.registration_success : '注册成功！请查收验证邮件', 'success');
            setTimeout(() => { elements.inputEmail.value = email; switchStep('email'); }, 3000);
        } catch (err) {
            if (err !== 'Captcha closed') Notifications.show(err.message, 'error');
        }
    });

    // ============================================================
    // 重置密码逻辑
    // ============================================================

    // A. 点击"忘记密码" -> 进入邮箱输入页
    document.getElementById('btn-forgot-pwd').addEventListener('click', () => {
        if (currentEmail) elements.forgotEmail.value = currentEmail;
        switchStep('forgot');
    });

    // B. 返回登录
    document.getElementById('btn-cancel-forgot').addEventListener('click', () => switchStep('email'));

    // C. 发送重置邮件
    document.getElementById('btn-send-reset-link').addEventListener('click', async () => {
        const email = elements.forgotEmail.value.trim();
        if (!email) return Notifications.show(window.i18n ? window.i18n.please_enter_email : '请输入注册邮箱', 'warning');

        try {
            const token = await executeCaptcha();
            const { error } = await client.auth.resetPasswordForEmail(email, {
                captchaToken: token,
                redirectTo: "https://account.ezer.cc/login/" // 强制跳回登录页处理
            });
            if (error) throw error;
            Notifications.show(window.i18n ? window.i18n.reset_email_sent : '重置邮件已发送，请查收', 'success');
            // 可以选择跳回登录页，或者停留在当前页提示
            setTimeout(() => switchStep('email'), 2000);
        } catch (err) {
            if (err !== 'Captcha closed') Notifications.show(err.message, 'error');
        }
    });

    // D. 提交新密码 (用户从邮件回来后)
    document.getElementById('btn-save-new-password').addEventListener('click', async () => {
        const newPwd = elements.newPwd.value;
        const confirmPwd = elements.newPwdConfirm.value;

        if (newPwd.length < 8) return Notifications.show(window.i18n ? window.i18n.password_too_short : '新密码长度需大于8位', 'warning');
        if (newPwd !== confirmPwd) return Notifications.show(window.i18n ? window.i18n.password_mismatch : '两次密码输入不一致', 'warning');

        try {
            Notifications.show(window.i18n ? window.i18n.updating_password : '正在更新密码...', 'info');
            // 调用 updateUser 修改密码
            const { error } = await client.auth.updateUser({ password: newPwd });

            if (error) throw error;

            Notifications.show(window.i18n ? window.i18n.password_updated_success : '密码修改成功！正在跳转...', 'success');
            setTimeout(() => {
                window.location.href = getRedirectUrl();
            }, 1500);

        } catch (err) {
            Notifications.show((window.i18n ? window.i18n.password_update_failed : '修改失败: ') + err.message, 'error');
        }
    });
});
