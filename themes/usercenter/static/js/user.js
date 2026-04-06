document.addEventListener('DOMContentLoaded', async () => {
    if (typeof client === 'undefined') {
        console.error('Supabase client not initialized. Make sure common.js is loaded.');
        return;
    }

    // 1. 检查 Session
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) {
        window.location.href = getLoginUrl('/');
        return;
    }

    const user = session.user;

    // =========================================
    // 2.1 渲染用户信息
    // =========================================
    document.getElementById('user-email').textContent = user.email;
    document.getElementById('user-id').textContent = user.id;

    // 格式化日期
    const lang = document.documentElement.lang || 'zh-CN';
    const regDate = new Date(user.created_at);
    document.getElementById('user-reg-date').textContent = regDate.toLocaleDateString(lang, {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    // =========================================
    // 2.2 渲染第三方绑定状态
    // =========================================
    function renderIdentities() {
        const identities = user.identities || [];
        const providers = identities.map(id => id.provider);

        ['google', 'github', 'azure'].forEach(provider => {
            // Azure 在 Supabase 中通常对应 provider 名 'azure' 或 'microsoft'
            // 视具体配置而定，这里假设 HTML 中 data-provider="azure"
            const btn = document.querySelector(`.bind-btn[data-provider="${provider}"]`);
            if (!btn) return;

            // 检查是否已绑定 (注意: azure 的 provider 可能是 'azure' 也可能是 'workos' 等)
            const isLinked = providers.includes(provider);

            if (isLinked) {
                btn.textContent = window.userI18n ? window.userI18n.linked : '已绑定';
                btn.classList.add('linked');
                btn.disabled = true;
            } else {
                btn.textContent = window.userI18n ? window.userI18n.bind : '绑定';
                btn.classList.remove('linked');
                btn.disabled = false;

                // 绑定事件
                btn.onclick = async () => {
                    try {
                        const { data, error } = await client.auth.signInWithOAuth({
                            provider: provider,
                            options: {
                                redirectTo: window.location.href // 绑定后跳回当前设置页
                            }
                        });
                        if (error) throw error;
                    } catch (err) {
                        Notifications.show('绑定启动失败: ' + err.message, 'error');
                    }
                };
            }
        });
    }
    renderIdentities();

    // =========================================
    // 2.3 修改密码
    // =========================================
    const pwdForm = document.getElementById('form-change-pwd');
    pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPwd = document.getElementById('old-pwd').value;
        const newPwd = document.getElementById('new-pwd').value;
        const repeatPwd = document.getElementById('new-pwd-repeat').value;

        if (newPwd.length < 8) return Notifications.show(window.userI18n ? window.userI18n.password_too_short : '新密码需大于8位', 'warning');
        if (newPwd !== repeatPwd) return Notifications.show(window.userI18n ? window.userI18n.password_mismatch : '两次新密码输入不一致', 'warning');

        // 直接使用 Supabase 的 updateUser 功能并传递 current_password (见后台文档)
        Notifications.show(window.userI18n ? window.userI18n.updating_password : '正在提交修改...', 'info');

        try {
            // 已登录用户修改密码，凭借 current_password 验证即可，无需验证码
            const { error: updateError } = await client.auth.updateUser({
                password: newPwd,
                current_password: oldPwd
            });

            if (updateError) {
                console.error('Password update failed:', updateError);
                let errMsg = updateError.message;
                const errLower = updateError.message.toLowerCase();

                // 只有当确认为密码错误时才显示转换后的提示，否则显示原始错误
                if (errLower.includes('current password') || errLower.includes('invalid password')) {
                    errMsg = window.userI18n ? window.userI18n.password_error : '原密码错误，请重新输入';
                }

                Notifications.show(errMsg, 'error');
            } else {
                Notifications.show(window.userI18n ? window.userI18n.password_updated_success : '密码修改成功！', 'success');
                pwdForm.reset();
            }
        } catch (err) {
            if (err === 'Captcha closed') return;
            Notifications.show(err.message || '操作失败', 'error');
        }
    });

    // =========================================
    // 2.4 修改邮箱
    // =========================================
    const emailForm = document.getElementById('form-change-email');
    emailForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newEmail = document.getElementById('new-email').value.trim();

        if (newEmail === user.email) return Notifications.show(window.userI18n ? window.userI18n.new_email_same : '新邮箱不能与当前邮箱相同', 'warning');

        // 发送修改请求
        const { error } = await client.auth.updateUser({ email: newEmail });

        if (error) {
            Notifications.show(error.message, 'error');
        } else {
            Notifications.show(window.userI18n ? window.userI18n.verification_email_sent : '验证邮件已发送至新邮箱，请查收确认', 'success');
            emailForm.reset();
        }
    });
});

// 侧边栏高亮逻辑 (简单实现：根据URL匹配)
const currentPath = window.location.pathname;
document.querySelectorAll('.sidebar-item').forEach(item => {
    if (item.getAttribute('href') === currentPath) {
        item.classList.add('active');
    }
});
