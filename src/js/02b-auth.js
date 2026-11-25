
      /* ========================================================================
         B2. AUTHENTIFICATION PAR API — aucun identifiant, hash ni ID de feuille dans le code
         Le mot de passe est vérifié côté serveur (worker/), qui émet un jeton signé à durée limitée.
         ======================================================================== */
      var PulseAuth = (function () {
        var API = String(window.__PULSE_API__ || '').replace(/\/$/, '');
        var KEY = 'pulse_token_v1';
        var token = null;
        function adopt() {
          try { token = window.sessionStorage.getItem(KEY) || window.localStorage.getItem(KEY); } catch (e) { token = null; }
          return !!token;
        }
        function store(t, remember) {
          token = t;
          try {
            window.sessionStorage.setItem(KEY, t);
            if (remember) window.localStorage.setItem(KEY, t); else window.localStorage.removeItem(KEY);
          } catch (e) {}
        }
        function clear() {
          token = null;
          try { window.sessionStorage.removeItem(KEY); window.localStorage.removeItem(KEY); } catch (e) {}
        }
        function call(method, path, body) {
          var headers = { 'Content-Type': 'application/json' };
          if (token) headers.Authorization = 'Bearer ' + token;
          return fetch(API + path, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : undefined,
            cache: 'no-store'
          }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
              if (res.status === 401 && token) { clear(); window.location.reload(); }
              if (!res.ok) {
                var err = new Error(data.error || ('Erreur ' + res.status));
                err.status = res.status;
                throw err;
              }
              return data;
            });
          });
        }
        return { adopt: adopt, store: store, clear: clear, call: call };
      })();

      function applyBootstrap(boot) {
        Object.assign(LIVE_SHEETS_CONFIG, boot.config.live || {});
        Object.assign(KOOL_SHEETS_CONFIG, boot.config.kool || {});
        Object.assign(DEFAULT_COMMISSIONS_MAP, boot.defaults.commissions || {});
        Object.assign(DEFAULT_PORTFOLIOS_COMPACT, boot.defaults.portfolios || {});
        if (currentBrand === 'kool') {
          state.customCommissions = loadKoolStoredCommissions();
          var kp = loadKoolStoredPortfolios();
          if (Object.keys(kp).length > 0) state.amPortfolios = kp;
          var ko = loadKoolStoredOffreParticipation();
          if (ko.length > 0) state.offreParticipationRules = ko;
        } else {
          state.customCommissions = loadInitialCommissions();
          state.amPortfolios = loadInitialPortfolios();
        }
      }

      function onAuthenticated(user, remember, fresh) {
        return PulseAuth.call('GET', '/api/bootstrap').then(function (boot) {
          applyBootstrap(boot);
          activateSession(user, remember);
          startBackgroundDataLoadAfterLogin();
          if (fresh) {
            showToast('Bienvenue sur <strong>Yassir Pulse</strong>, <strong>' + escapeHtml(user.displayName || user.amName || user.username) + '</strong> !', 'success');
          }
        });
      }

      window.yassirHandleLogin = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        var errorBox = document.getElementById('loginErrorBox');
        var errorText = document.getElementById('loginErrorText');
        var loginCard = document.getElementById('loginCard');
        var btn = document.getElementById('btnSubmitLogin');
        var remember = document.getElementById('loginRememberMe').checked;
        if (btn) btn.disabled = true;
        PulseAuth.call('POST', '/api/login', {
          username: document.getElementById('loginUsername').value.trim(),
          password: document.getElementById('loginPassword').value,
          remember: remember
        }).then(function (res) {
          PulseAuth.store(res.token, remember);
          errorBox.classList.add('hidden');
          document.getElementById('loginPassword').value = '';
          return onAuthenticated(res.user, remember, true);
        }).catch(function (err) {
          errorText.textContent = err.status === 429
            ? 'Trop de tentatives. Réessayez dans quelques minutes.'
            : (err.status === 401 ? 'Identifiant ou mot de passe incorrect.' : 'Connexion impossible pour le moment. Réessayez.');
          errorBox.classList.remove('hidden');
          loginCard.classList.remove('animate-shake');
          void loginCard.offsetWidth;
          loginCard.classList.add('animate-shake');
          PulseAuth.clear();
        }).then(function () { if (btn) btn.disabled = false; });
        return false;
      };

      /* ---- Gestion des accès (propriétaire admin) : tout passe par l'API ---- */
      var accountsCache = [];
      function getAccounts() { return accountsCache; }
      function refreshAccounts() {
        return PulseAuth.call('GET', '/api/accounts').then(function (r) { accountsCache = r.accounts || []; return accountsCache; });
      }

      window.yassirOpenAccessModal = function () {
        if (!isOwnerAdmin()) return;
        refreshAccounts().then(function () {
          renderAccountsTable();
          document.getElementById('accessManagerModal').classList.remove('hidden');
        }).catch(function (err) { showToast(escapeHtml(err.message), 'error'); });
      };

      window.yassirCloseAccessModal = function () {
        document.getElementById('accessManagerModal').classList.add('hidden');
      };

      window.yassirPrefillAccount = function (idx) {
        if (!isOwnerAdmin()) return;
        var acc = getAccounts()[idx];
        if (!acc) return;
        var pwd = document.getElementById('newAccountPassword');
        document.getElementById('newAccountLogin').value = acc.username;
        pwd.value = '';
        pwd.placeholder = 'Nouveau mot de passe (laisser vide = inchangé)';
        pwd.required = false;
        var sel = document.getElementById('newAccountAmBinding');
        if (acc.role === 'owner') sel.value = 'OWNER';
        else if (acc.role === 'viewer_all') sel.value = 'VIEWER_ALL';
        else if (acc.role === 'market_am' || acc.role === 'market_viewer') sel.value = 'MARKET_AM';
        else sel.value = acc.amName || 'Aziza Souli';
      };

      window.yassirSaveAccount = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!isOwnerAdmin()) return false;
        var login = document.getElementById('newAccountLogin').value.trim();
        var pwd = document.getElementById('newAccountPassword').value;
        var binding = document.getElementById('newAccountAmBinding').value;
        if (!login) return false;
        if (pwd && pwd.length < 10) { showToast('Le mot de passe doit contenir au moins 10 caractères.', 'error'); return false; }
        var role = binding === 'OWNER' ? 'owner' : (binding === 'VIEWER_ALL' ? 'viewer_all' : (binding === 'MARKET_AM' ? 'market_am' : 'am'));
        var amName = role === 'am' ? binding : (role === 'market_am' ? 'Eya Majdoub' : null);
        PulseAuth.call('PUT', '/api/accounts/' + encodeURIComponent(login), {
          password: pwd || undefined, role: role, amName: amName, displayName: amName || login
        }).then(refreshAccounts).then(function () {
          renderAccountsTable();
          showToast('Compte <strong>' + escapeHtml(login) + '</strong> enregistré.', 'success');
          var p = document.getElementById('newAccountPassword');
          document.getElementById('newAccountLogin').value = '';
          p.value = ''; p.placeholder = 'Au moins 10 caractères'; p.required = true;
        }).catch(function (err) { showToast(escapeHtml(err.message), 'error'); });
        return false;
      };

      function renderAccountsTable() {
        var accounts = getAccounts();
        var tbody = document.getElementById('accountsTableBody');
        var countEl = document.getElementById('accountsTotalCount');
        if (!tbody || !countEl) return;

        countEl.textContent = accounts.length;
        tbody.innerHTML = accounts.map(function (acc, idx) {
          var badge = '';
          if (acc.role === 'owner') {
            badge = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#F3EBFF] text-[#6C2BD9]">Propriétaire Admin</span>';
          } else if (acc.role === 'viewer_all') {
            badge = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Propriétaire • Lecture seule (' + escapeHtml(acc.displayName || '') + ')</span>';
          } else if (acc.role === 'market_am' || acc.role === 'market_viewer') {
            badge = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-[#00897B]">AM Market • Eya Majdoub (Market uniquement + Synthèse)</span>';
          } else {
            badge = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#E0F7F4] text-[#00897B]">AM • ' + escapeHtml(acc.amName || '') + '</span>';
          }

          var deleteBtn = acc.protected
            ? ''
            : '<button type="button" data-del-acc="' + idx + '" class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 hover:bg-rose-100 text-[#FF2A6D] transition cursor-pointer ml-1"><i class="fa-solid fa-trash-can"></i></button>';

          return '<tr class="hover:bg-[#F8F9FC]">' +
            '<td class="px-4 py-2.5 font-bold text-[#1A1A2E]">' + escapeHtml(acc.username) + '</td>' +
            '<td class="px-4 py-2.5 font-mono text-slate-400"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600"><i class="fa-solid fa-shield-halved text-[#00BFA5]"></i>Chiffré SHA-256</span></td>' +
            '<td class="px-4 py-2.5">' + badge + '</td>' +
            '<td class="px-4 py-2.5 text-right whitespace-nowrap">' +
              '<button type="button" onclick="window.yassirPrefillAccount(' + idx + ')" class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F3EBFF] hover:bg-purple-200 text-[#6C2BD9] transition cursor-pointer">Modifier</button>' +
              deleteBtn +
            '</td>' +
            '</tr>';
        }).join('');

        tbody.querySelectorAll('[data-del-acc]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var target = getAccounts()[parseInt(btn.getAttribute('data-del-acc'), 10)];
            if (!target || target.protected) return;
            PulseAuth.call('DELETE', '/api/accounts/' + encodeURIComponent(target.username))
              .then(refreshAccounts).then(renderAccountsTable)
              .then(function () { showToast('Compte <strong>' + escapeHtml(target.username) + '</strong> supprimé.', 'info'); })
              .catch(function (err) { showToast(escapeHtml(err.message), 'error'); });
          });
        });
      }


      function initApp() {
        // Nettoyage des anciennes clés (comptes + hash SHA-256 et session en clair stockés dans le navigateur)
        safeRemove('yassir_vf_accounts_v10_sha256');
        safeRemove('yassir_vf_remember_v9');
        setupDropZone('dropZoneMain', chargerFichierPrincipal);
        setupDropZone('dropZonePrev', chargerFichierPrecedent);
        setupDropZone('dropZoneComm', chargerFichierCommissions);
        applyBrandVisualTheme(currentBrand);
        if (!PulseAuth.adopt()) return;
        PulseAuth.call('GET', '/api/me')
          .then(function (res) { return onAuthenticated(res.user, false, false); })
          .catch(function () { PulseAuth.clear(); });
      }
