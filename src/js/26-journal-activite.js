      /* ========================================================================
         26. JOURNAL D'ACTIVITÉ DES AM — visible uniquement par le propriétaire.
         Journal partagé (serveur) : chaque navigateur AM envoie ses événements
         à l'API, le propriétaire les lit ici (rubrique « Historique d'activité »
         dans System Settings). Le propriétaire n'est JAMAIS journalisé
         (ni ses connexions, ni ses synchros, ni ses actions) : la règle est
         appliquée ici (front) ET côté Worker (défense en profondeur).
         Événements journalisés (et seulement ceux-là) : connexion réussie,
         déconnexion, tentative de connexion échouée (côté Worker), exports /
         téléchargements, alertes marquées « Traité ». Jamais : synchros,
         imports, changements de mot de passe, consultations, /api/me.
         ======================================================================== */

      var _activityLogEntries = [];
      var _activityLogTypeLabels = {
        login: 'Connexion',
        logout: 'Déconnexion',
        login_fail: 'Échec connexion',
        export: 'Export',
        alerte: 'Alerte traitée'
      };

      // Envoie un événement au journal (AM uniquement, fire-and-forget :
      // ne bloque jamais l'action, n'affiche jamais d'erreur).
      window.yassirJournaliser = function (type, detail) {
        try {
          if (!currentUser || currentUser.role === 'owner') return;
          if (!type || !detail) return;
          PulseAuth.log(type, String(detail).slice(0, 200));
        } catch (e) {}
      };

      function yassirFormaterDateJournal(ts) {
        try {
          return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (e) { return String(ts || ''); }
      }

      function renderJournalActivite() {
        var tbody = document.getElementById('activityLogTableBody');
        if (!tbody) return;
        var userSel = document.getElementById('activityLogUserFilter');
        var typeSel = document.getElementById('activityLogTypeFilter');
        var userFilter = (userSel && userSel.value) || 'ALL';
        var typeFilter = (typeSel && typeSel.value) || 'ALL';
        var rows = _activityLogEntries.filter(function (e) {
          if (userFilter !== 'ALL' && e.user !== userFilter) return false;
          if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
          return true;
        });
        var countEl = document.getElementById('activityLogCount');
        if (countEl) countEl.textContent = rows.length;
        if (rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-slate-400">Aucune activité enregistrée pour ces filtres.</td></tr>';
          return;
        }
        tbody.innerHTML = rows.map(function (e) {
          return '<tr class="hover:bg-[#F8F9FC]">' +
            '<td class="px-4 py-2.5 text-slate-600 whitespace-nowrap">' + escapeHtml(yassirFormaterDateJournal(e.ts)) + '</td>' +
            '<td class="px-4 py-2.5 font-bold text-[#1A1A2E]">' + escapeHtml(e.user || '') + '</td>' +
            '<td class="px-4 py-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(_activityLogTypeLabels[e.type] || e.type || '') + '</span></td>' +
            '<td class="px-4 py-2.5 text-slate-600">' + escapeHtml(e.detail || '') + '</td>' +
            '</tr>';
        }).join('');
      }

      // Ouvre le journal (propriétaire uniquement) : remplit le filtre AM
      // depuis les comptes, puis charge les entrées depuis le serveur.
      window.yassirOuvrirJournalActivite = function () {
        if (!isOwnerAdmin()) return;
        var modal = document.getElementById('activityLogModal');
        if (modal) modal.classList.remove('hidden');
        refreshAccounts().then(function () {
          var sel = document.getElementById('activityLogUserFilter');
          if (!sel) return;
          var current = sel.value || 'ALL';
          var opts = '<option value="ALL">Tous les AM</option>';
          getAccounts().forEach(function (acc) {
            if (acc.role === 'owner') return;
            opts += '<option value="' + escapeHtml(acc.username) + '">' + escapeHtml(acc.displayName || acc.username) + ' (' + escapeHtml(acc.username) + ')</option>';
          });
          sel.innerHTML = opts;
          sel.value = current;
          if (sel.value !== current) sel.value = 'ALL';
        }).catch(function () {});
        window.yassirActualiserJournalActivite();
      };

      window.yassirFermerJournalActivite = function () {
        var modal = document.getElementById('activityLogModal');
        if (modal) modal.classList.add('hidden');
      };

      window.yassirActualiserJournalActivite = function () {
        if (!isOwnerAdmin()) return Promise.resolve();
        return PulseAuth.call('GET', '/api/activity').then(function (r) {
          _activityLogEntries = Array.isArray(r.entries) ? r.entries : [];
          renderJournalActivite();
        }).catch(function () {
          showToast('Impossible de charger l\'historique d\'activité.', 'error');
        });
      };

      window.yassirFiltrerJournalActivite = function () { renderJournalActivite(); };

      window.yassirEffacerJournalActivite = function () {
        if (!isOwnerAdmin()) return;
        if (!window.confirm('Effacer tout l\'historique d\'activité ? Cette action est définitive.')) return;
        PulseAuth.call('DELETE', '/api/activity').then(function () {
          _activityLogEntries = [];
          renderJournalActivite();
          showToast('Historique d\'activité effacé.', 'success');
        }).catch(function (err) { showToast(escapeHtml(err.message), 'error'); });
      };
