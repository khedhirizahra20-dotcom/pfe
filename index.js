document.addEventListener('DOMContentLoaded', async () => {
    const registerView  = document.getElementById('registerView');
    const loginView     = document.getElementById('loginView');
    const registerForm  = document.getElementById('registerForm');
    const loginForm     = document.getElementById('loginForm');
    const registerError = document.getElementById('registerError');
    const loginError    = document.getElementById('loginError');

    // Déjà connecté → dashboard
    if (sessionStorage.getItem('flexitrack_token')) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Vérifier si un admin existe déjà
    try {
        const res        = await fetch('/api/auth/registered');
        const { registered } = await res.json();
        if (registered) {
            registerView.classList.add('hidden');
            loginView.classList.remove('hidden');
        }
    } catch {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                        font-family:Inter,sans-serif;color:#ef4444;font-size:1.1rem;
                        text-align:center;padding:2rem;background:#0f172a">
                <div>
                    <i class="fa-solid fa-server" style="font-size:3rem;display:block;margin-bottom:1rem"></i>
                    Impossible de se connecter au serveur.<br>
                    <small style="color:#94a3b8">Lancez <strong>start.bat</strong> puis rechargez la page.</small>
                </div>
            </div>`;
        return;
    }

    // Afficher/masquer le mot de passe
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.previousElementSibling;
            const icon  = btn.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });

    // ── Inscription ───────────────────────────────────────────────────────────
    registerForm.addEventListener('submit', async e => {
        e.preventDefault();
        registerError.classList.add('hidden');

        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;
        const confirm  = document.getElementById('regConfirm').value;

        if (password !== confirm) {
            registerError.textContent = 'Les mots de passe ne correspondent pas.';
            registerError.classList.remove('hidden');
            return;
        }
        if (password.length < 4) {
            registerError.textContent = 'Le mot de passe doit contenir au moins 4 caractères.';
            registerError.classList.remove('hidden');
            return;
        }

        const res  = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            registerError.textContent = data.error;
            registerError.classList.remove('hidden');
            return;
        }
        sessionStorage.setItem('flexitrack_token',    data.token);
        sessionStorage.setItem('flexitrack_username', data.username);
        window.location.href = 'dashboard.html';
    });

    // ── Connexion ─────────────────────────────────────────────────────────────
    loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        loginError.classList.add('hidden');

        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;

        const res  = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            loginError.textContent = data.error;
            loginError.classList.remove('hidden');
            return;
        }
        sessionStorage.setItem('flexitrack_token',    data.token);
        sessionStorage.setItem('flexitrack_username', data.username);
        window.location.href = 'dashboard.html';
    });
});
