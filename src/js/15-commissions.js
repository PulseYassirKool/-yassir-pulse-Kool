      /* ========================================================================
         K. GESTION DES COMMISSIONS PERSONNALISÉES (STRICTEMENT OWNER ADMIN)
         ======================================================================== */
      window.yassirRenderCommTable = function () {
        var tbody = document.getElementById('commTableBody');
        if (!tbody) return;

        var searchEl = document.getElementById('searchCommInput');
        var q = searchEl ? searchEl.value.trim().toLowerCase() : '';
        var ownerAdmin = isOwnerAdmin();

        var entries = Object.entries(state.customCommissions)
          .filter(function (pair) { return !q || pair[0].includes(q); })
          .sort(function (a, b) { return a[0].localeCompare(b[0], 'fr'); });

        if (entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="' + (ownerAdmin ? 3 : 2) + '" class="px-4 py-8 text-center text-xs text-slate-400">Aucune commission trouvée.</td></tr>';
          return;
        }

        tbody.innerHTML = entries.map(function (pair) {
          var restName = pair[0];
          var rate = pair[1];
          var actionTd = ownerAdmin
            ? '<td class="px-4 py-2 text-right">' +
                '<button type="button" data-action="remove-commission" data-key="' + escapeHtml(restName) + '" class="px-3 py-1 rounded-full text-xs font-bold bg-rose-50 hover:bg-rose-100 text-[#FF2A6D] transition cursor-pointer">' +
                '<i class="fa-solid fa-trash-can mr-1"></i>Supprimer</button></td>'
            : '';

          return '<tr class="hover:bg-[#F8F9FC]">' +
            '<td class="px-4 py-2 font-semibold text-[#1A1A2E]">' + escapeHtml(restName) + '</td>' +
            '<td class="px-4 py-2 text-right font-mono font-bold text-[#6C2BD9]">' + Number(rate).toFixed(2) + ' %</td>' +
            actionTd +
          '</tr>';
        }).join('');
      };

      window.yassirAddCommission = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!isOwnerAdmin()) return false;

        var nameInput = document.getElementById('inputNewRestName');
        var rateInput = document.getElementById('inputNewRestRate');
        var rName = nameInput.value.trim().toLowerCase();
        var rRate = purgerNombre(rateInput.value);
        if (!rName || isNaN(rRate)) return false;

        state.customCommissions[rName] = rRate;
        saveCommissionsToStore();
        nameInput.value = '';
        rateInput.value = '';

        executerTraitementMetier();
        window.yassirRenderCommTable();
        showToast('Commission enregistrée : <strong>' + escapeHtml(rName) + '</strong> (' + rRate.toFixed(2) + ' %).', 'success');
        return false;
      };

      window.yassirRemoveCommission = function (key) {
        if (!isOwnerAdmin()) return;
        delete state.customCommissions[key];
        saveCommissionsToStore();
        executerTraitementMetier();
        window.yassirRenderCommTable();
        showToast('Taux supprimé pour <strong>' + escapeHtml(key) + '</strong>.', 'info');
      };

      window.yassirClearCommissions = function () {
        if (!isOwnerAdmin()) return;
        state.customCommissions = {};
        saveCommissionsToStore();
        document.getElementById('commFileName').textContent = 'Mettre à jour depuis un fichier';
        document.getElementById('inputCommFile').value = '';
        executerTraitementMetier();
        window.yassirRenderCommTable();
        showToast('Liste des commissions personnalisées vidée.', 'info');
      };

      // Relecture de la VRAIE feuille Google Sheets (audit item 4) : l'ancien
      // code rechargeait l'instantané figé du KV (bootstrap), pas la feuille.
      // En échec, la grille actuelle est conservée (jamais vidée).
      window.yassirSyncDefaultCommissions = function () {
        if (!isOwnerAdmin()) return Promise.resolve(false);
        var brand = (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? 'kool' : 'yassir';
        // Relecture manuelle : fresh=1 force le Worker à relire la feuille
        // (sinon le cache serveur de 5 minutes servirait les taux d'avant).
        return window.yassirLireCommissionsDepuisFeuille(brand, true).then(function (res) {
          if (!res.ok || res.count === 0) {
            showToast('Relecture de la feuille impossible pour le moment : vos taux actuels sont conservés.', 'error');
            return false;
          }
          state.customCommissions = Object.assign({}, res.map);
          saveCommissionsToStore();
          executerTraitementMetier();
          window.yassirRenderCommTable();
          showToast('Grille relue depuis Google Sheets (<strong>' + res.count + ' restaurants</strong>).', 'success');
          return true;
        });
      };
