document.addEventListener('DOMContentLoaded', async () => {
    if (typeof client === 'undefined') return;

    // 拦截 Recovery 状态
    const hash = window.location.hash;
    const isRecoveryFlow = hash && hash.includes('type=recovery');

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost && !isRecoveryFlow) {
        console.log('[Login] Dev mode: Bypassing login on localhost');
        const params = new URLSearchParams(window.location.search);
        let redirect = params.get('redirect') || '/';
        
        if (redirect.startsWith('http://localhost') || redirect.startsWith('http://127.0.0.1')) {
            window.location.href = redirect;
        } else {
            if (redirect.includes('account.ezer.cc')) {
                try {
                    const url = new URL(redirect);
                    redirect = url.pathname + url.search;
                } catch(e) {}
            }
            if (!redirect.startsWith('/')) {
                redirect = '/' + redirect;
            }
            window.location.href = window.location.origin + redirect;
        }
        return;
    }

    if (isRecoveryFlow) {
        console.log(window.i18n ? window.i18n.recovery_lock_log : "🔒 检测到重置密码流程，已锁定跳转逻辑。");
    }

    // 状态变量
    let currentEmail = '';

    // DOM 元素引用
    const steps = {
        email: document.getElementById('step-email'),
        password: document.getElementById('step-password'),
        otp: document.getElementById('step-otp'),
        register: document.getElementById('step-register'),
        forgot: document.getElementById('step-forgot'), // 请求邮件页
        update: document.getElementById('step-update-password'), // 设置新密码页
        registerSuccess: document.getElementById('step-register-success') // 注册成功激活提示页
    };

    const elements = {
        inputEmail: document.getElementById('input-email'),
        regEmail: document.getElementById('reg-email'),
        forgotEmail: document.getElementById('forgot-email'),
        displayEmail: document.getElementById('display-email'),
        displayOtpEmail: document.getElementById('display-otp-email'),
        title: document.getElementById('auth-title'),
        subtitle: document.getElementById('auth-subtitle'),
        // 新密码输入框
        newPwd: document.getElementById('new-password'),
        newPwdConfirm: document.getElementById('new-password-confirm'),
        regInviteCode: document.getElementById('reg-invite-code')
    };

    // 解析 URL 中的邀请码 (aff)
    const urlParams = new URLSearchParams(window.location.search);
    const affCode = urlParams.get('aff');
    if (affCode && elements.regInviteCode) {
        elements.regInviteCode.value = affCode.trim();
        elements.regInviteCode.parentElement.classList.add('filled');
    }

    // 支持直接从链接跳转至注册状态（极大提升新用户转化率）
    const stepParam = urlParams.get('step');
    if (stepParam === 'register' && !isRecoveryFlow) {
        switchStep('register');
    }

    // 获取重定向 URL
    function getRedirectUrl() {
        const params = new URLSearchParams(window.location.search);
        const redirect = params.get('redirect');
        if (redirect) {
            if (isAllowedEzerCcRedirect(redirect)) return "https://account.ezer.cc/callback/?redirect=" + encodeURIComponent(redirect);
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
        } else if (stepName === 'otp') {
            elements.title.textContent = window.i18n ? window.i18n.title_otp : '输入验证码';
            elements.subtitle.textContent = window.i18n ? window.i18n.subtitle_otp : '验证码已发送，请输入以继续';
            if (elements.displayOtpEmail) elements.displayOtpEmail.textContent = currentEmail;
            setTimeout(() => {
                const firstInput = document.querySelector('.otp-input[data-index="0"]');
                if (firstInput) firstInput.focus();
            }, 100);
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
        } else if (stepName === 'registerSuccess') {
            elements.title.textContent = window.i18n ? window.i18n.title_register_success : '验证您的邮箱';
            elements.subtitle.textContent = window.i18n ? window.i18n.subtitle_register_success : '已发送激活邮件';
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

    // 6. OTP 登录与 6 位数字验证码交互
    let resendTimer = null;
    function startResendCountdown() {
        const btnResend = document.getElementById('btn-otp-resend');
        if (!btnResend) return;

        let seconds = 60;
        btnResend.disabled = true;
        const resendLabel = window.i18n ? window.i18n.otp_resend : '重新发送';
        btnResend.textContent = `${resendLabel} (${seconds}s)`;

        if (resendTimer) clearInterval(resendTimer);
        resendTimer = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
                clearInterval(resendTimer);
                btnResend.disabled = false;
                btnResend.textContent = resendLabel;
            } else {
                btnResend.textContent = `${resendLabel} (${seconds}s)`;
            }
        }, 1000);
    }

    async function sendOtpCode() {
        if (isLocalhost) {
            console.log("[Localhost mock mode] Sending simulated OTP, switching to step-otp.");
            Notifications.show(window.i18n ? window.i18n.local_mock_otp_sent : '[本地模拟] 验证码已发送至您的邮箱 (已自动模拟为 123456)', 'info');
            switchStep('otp');
            startResendCountdown();
            return;
        }

        try {
            const token = await executeCaptcha();
            const { error } = await client.auth.signInWithOtp({
                email: currentEmail,
                options: {
                    captchaToken: token
                }
            });
            if (error) throw error;
            Notifications.show(window.i18n ? window.i18n.otp_sent : '验证码已发送至您的邮箱', 'success');
            switchStep('otp');
            startResendCountdown();
        } catch (err) {
            if (err !== 'Captcha closed') Notifications.show(err.message || '发送验证码失败', 'error');
        }
    }

    document.getElementById('btn-otp-login').addEventListener('click', sendOtpCode);

    const btnOtpResend = document.getElementById('btn-otp-resend');
    if (btnOtpResend) {
        btnOtpResend.addEventListener('click', sendOtpCode);
    }

    // OTP 输入框联动逻辑
    const otpInputs = document.querySelectorAll('.otp-input');
    otpInputs.forEach((input, index) => {
        // 限制只能输入数字
        input.addEventListener('input', (e) => {
            const val = e.target.value;
            // 如果不是数字，清空
            if (!/^[0-9]$/.test(val)) {
                e.target.value = '';
                return;
            }
            // 聚焦到下一个框
            if (index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            } else {
                // 最后一个输入框，且全部已填满，自动校验
                checkAndSubmitOtp();
            }
        });

        // 监听退格键 (Backspace)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') {
                if (input.value === '') {
                    // 如果当前框为空，聚焦到上一个框并清除内容
                    if (index > 0) {
                        otpInputs[index - 1].focus();
                        otpInputs[index - 1].value = '';
                    }
                } else {
                    // 当前框有值，直接清空
                    input.value = '';
                }
                e.preventDefault();
            }
        });

        // 监听粘贴事件
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const clipboardData = e.clipboardData || window.clipboardData;
            const pastedText = clipboardData.getData('Text').trim();

            // 提取前6位数字
            const digits = pastedText.replace(/\D/g, '').slice(0, 6);

            // 依次填入框中
            for (let i = 0; i < digits.length && i < otpInputs.length; i++) {
                otpInputs[i].value = digits[i];
            }

            // 聚焦到填写的最后一个框或保持聚焦
            const focusIndex = Math.min(digits.length, otpInputs.length - 1);
            if (focusIndex >= 0) {
                otpInputs[focusIndex].focus();
            }

            if (digits.length === 6) {
                checkAndSubmitOtp();
            }
        });
    });

    function getOtpCode() {
        let code = '';
        otpInputs.forEach(input => code += input.value);
        return code;
    }

    function checkAndSubmitOtp() {
        const code = getOtpCode();
        if (code.length === 6) {
            submitOtpVerification(code);
        }
    }

    async function submitOtpVerification(code) {
        if (!code || code.length !== 6) {
            return Notifications.show(window.i18n ? window.i18n.please_enter_6digit_otp : '请输入6位验证码', 'warning');
        }

        const btnVerify = document.getElementById('btn-verify-otp');
        const originalText = btnVerify ? btnVerify.textContent : '';
        if (btnVerify) {
            btnVerify.disabled = true;
            btnVerify.textContent = window.i18n ? window.i18n.otp_verifying : '验证中...';
        }

        if (isLocalhost) {
            setTimeout(() => {
                if (btnVerify) {
                    btnVerify.disabled = false;
                    btnVerify.textContent = originalText;
                }
                if (code === '123456') {
                    Notifications.show(window.i18n ? window.i18n.local_mock_login_success : '[本地模拟] 登录成功！正在跳转...', 'success');
                    setTimeout(() => {
                        window.location.href = getRedirectUrl();
                    }, 1000);
                } else {
                    Notifications.show(window.i18n ? window.i18n.local_mock_otp_error : '[本地模拟] 验证码错误，请输入 123456', 'error');
                    otpInputs.forEach(input => input.value = '');
                    if (otpInputs[0]) otpInputs[0].focus();
                }
            }, 800);
            return;
        }

        try {
            const { error } = await client.auth.verifyOtp({
                email: currentEmail,
                token: code,
                type: 'email'
            });
            if (error) throw error;
            Notifications.show(window.i18n ? window.i18n.login_success : '登录成功', 'success');
        } catch (err) {
            Notifications.show(err.message || (window.i18n ? window.i18n.otp_invalid_or_expired : '验证码错误或已失效'), 'error');
            otpInputs.forEach(input => input.value = '');
            if (otpInputs[0]) otpInputs[0].focus();
        } finally {
            if (btnVerify) {
                btnVerify.disabled = false;
                btnVerify.textContent = originalText;
            }
        }
    }

    const btnVerifyOtp = document.getElementById('btn-verify-otp');
    if (btnVerifyOtp) {
        btnVerifyOtp.addEventListener('click', () => {
            submitOtpVerification(getOtpCode());
        });
    }

    const btnBackOtp = document.getElementById('btn-back-otp');
    if (btnBackOtp) {
        btnBackOtp.addEventListener('click', () => {
            if (resendTimer) {
                clearInterval(resendTimer);
                resendTimer = null;
            }
            switchStep('password');
        });
    }

    // 7. 第三方登录
    document.querySelectorAll('.social-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const provider = e.currentTarget.getAttribute('data-provider');
            try {
                const token = await executeCaptcha();
                const oauthOptions = {
                    captchaToken: token,
                    redirectTo: getRedirectUrl()
                };

                // 如果 URL 中带有邀请码，封装到 options.data 中传递给第三方登录，绑定为新用户的推荐人
                if (affCode) {
                    oauthOptions.data = {
                        referred_by: affCode.trim()
                    };
                }

                await client.auth.signInWithOAuth({
                    provider: provider,
                    options: oauthOptions
                });
            } catch (err) { if (err !== 'Captcha closed') Notifications.show(err.message, 'error'); }
        });
    });

    // 8. 注册
    document.getElementById('btn-register').addEventListener('click', async () => {
        const email = elements.regEmail.value.trim();
        const pwd = document.getElementById('reg-password').value;
        const pwdR = document.getElementById('reg-password-repeat').value;
        const inviteCode = elements.regInviteCode ? elements.regInviteCode.value.trim() : '';

        if (!email) return Notifications.show(window.i18n ? window.i18n.please_enter_email : '请输入电子邮箱', 'warning');
        if (!/^\S+@\S+\.\S+$/.test(email)) return Notifications.show(window.i18n ? window.i18n.invalid_email_format : '邮箱格式不正确', 'warning');
        if (pwd.length < 8) return Notifications.show(window.i18n ? window.i18n.password_too_short : '密码长度需大于8位', 'warning');
        if (pwd !== pwdR) return Notifications.show(window.i18n ? window.i18n.password_mismatch : '两次密码输入不一致', 'warning');

        try {
            const token = await executeCaptcha();
            const signUpData = {
                email: email,
                password: pwd,
                options: {
                    captchaToken: token,
                    emailRedirectTo: getRedirectUrl()
                }
            };
            if (inviteCode) {
                signUpData.options.data = {
                    referred_by: inviteCode
                };
            }
            const { error } = await client.auth.signUp(signUpData);
            if (error) throw error;
            currentEmail = email;
            const successEmailEl = document.getElementById('register-success-email');
            if (successEmailEl) successEmailEl.textContent = email;
            switchStep('registerSuccess');
        } catch (err) {
            if (err !== 'Captcha closed') Notifications.show(err.message, 'error');
        }
    });

    // 已激活，去登录
    const btnSuccessLogin = document.getElementById('btn-success-login');
    if (btnSuccessLogin) {
        btnSuccessLogin.addEventListener('click', () => {
            if (currentEmail) {
                elements.inputEmail.value = currentEmail;
                switchStep('password');
            } else {
                switchStep('email');
            }
        });
    }

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
