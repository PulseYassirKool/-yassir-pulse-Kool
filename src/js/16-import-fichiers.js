      /* ========================================================================
         L. IMPORTATION DES FICHIERS DATA EXP & COMMISSIONS
         ======================================================================== */
      function lireFichierPrincipalPromise(file) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function (e) {
            try {
              var data = new Uint8Array(e.target.result);
              var workbook = XLSX.read(data, { type: 'array', cellDates: true });

              var repoSheetName = workbook.SheetNames.find(function (n) { return n.trim().toLowerCase() === 'restaurant par facture'; });
              var autoCommLoaded = 0;
              if (repoSheetName && isOwnerAdmin()) {
                var repoRows = XLSX.utils.sheet_to_json(workbook.Sheets[repoSheetName], { header: 1 });
                for (var r = 1; r < repoRows.length; r++) {
                  var row = repoRows[r];
                  if (row && row[0] !== undefined && row[0] !== null && row[1] !== undefined && row[1] !== '') {
                    var rName = String(row[0]).trim().toLowerCase();
                    var cVal = purgerNombre(row[1]);
                    if (rName && !isNaN(cVal)) {
                      state.customCommissions[rName] = cVal;
                      autoCommLoaded++;
                    }
                  }
                }
                if (autoCommLoaded > 0) saveCommissionsToStore();
              }

              var dataExpSheetName = workbook.SheetNames.find(function (n) { return n.trim().toLowerCase() === 'data exp'; });
              var extractSheetName = workbook.SheetNames.find(function (n) { return n.trim().toLowerCase() === 'extract'; });
              var foodVfSheetName = workbook.SheetNames.find(function (n) { return n.trim().toLowerCase() === 'food vf'; });
              var marketVfSheetName = workbook.SheetNames.find(function (n) { return n.trim().toLowerCase() === 'market vf'; });

              var aoa = [];
              var sourceSheetName = '';
              if (dataExpSheetName) {
                sourceSheetName = dataExpSheetName;
                aoa = XLSX.utils.sheet_to_json(workbook.Sheets[dataExpSheetName], { header: 1, defval: '' });
              } else if (extractSheetName) {
                sourceSheetName = extractSheetName;
                aoa = XLSX.utils.sheet_to_json(workbook.Sheets[extractSheetName], { header: 1, defval: '' });
              } else if (foodVfSheetName) {
                sourceSheetName = foodVfSheetName;
                aoa = XLSX.utils.sheet_to_json(workbook.Sheets[foodVfSheetName], { header: 1, defval: '' });
                if (marketVfSheetName) {
                  var mAoa = XLSX.utils.sheet_to_json(workbook.Sheets[marketVfSheetName], { header: 1, defval: '' });
                  if (mAoa && mAoa.length > 1) {
                    aoa = aoa.concat(mAoa.slice(1));
                  }
                }
              } else {
                sourceSheetName = workbook.SheetNames[0];
                aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sourceSheetName], { header: 1, defval: '' });
              }
              if (!aoa || aoa.length < 2) {
                reject(new Error('La feuille « ' + sourceSheetName + ' » de ' + file.name + ' est vide.'));
                return;
              }
              resolve({ fileName: file.name, aoa: aoa, autoCommLoaded: autoCommLoaded });
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = function () { reject(new Error('Erreur lecture ' + file.name)); };
          reader.readAsArrayBuffer(file);
        });
      }

      function chargerPlusieursFichiersPrincipaux(filesList) {
        var files = Array.from(filesList || []);
        if (files.length === 0) return;

        showToast('Chargement et fusion de <strong>' + files.length + ' fichier(s)</strong> en cours...', 'info');

        Promise.all(files.map(lireFichierPrincipalPromise))
          .then(function (results) {
            var totalAdded = 0;
            var totalAutoComm = 0;
            results.forEach(function (res) {
              totalAdded += fusionnerNouveauFichierDansArchive(res.fileName, res.aoa);
              totalAutoComm += res.autoCommLoaded;
            });

            state.dateStart = '';
            state.dateEnd = '';
            detecterBornesDatesSource(state.rawSourceRows);
            var inpStart = document.getElementById('filterDateStart');
            var inpEnd = document.getElementById('filterDateEnd');
            var selW = document.getElementById('filterWeekSelect');
            if (inpStart) inpStart.value = state.minAvailableDate || '';
            if (inpEnd) inpEnd.value = state.maxAvailableDate || '';
            if (selW) selW.value = '';
            updateDatePresetButtonsUI('ALL');

            var totalRowsInBase = Math.max(0, state.rawSourceRows.length - 1);
            var nbFiles = state.storedFilesMeta.length;
            document.getElementById('mainFileName').textContent = nbFiles + ' fichier(s) enregistré(s) • ' + totalRowsInBase.toLocaleString('fr-FR') + ' commandes';
            document.getElementById('mainFileName').title = state.storedFilesMeta.map(function (m) { return m.name; }).join(', ');
            document.getElementById('mainFileSub').textContent = state.minAvailableDate && state.maxAvailableDate
              ? ('Période globale : ' + state.minAvailableDate + ' → ' + state.maxAvailableDate)
              : ('Base cumulée prête');
            document.getElementById('badgeSourceStatus').textContent = nbFiles + ' fichier(s)';
            document.getElementById('badgeSourceStatus').className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#E0F7F4] text-[#00897B]';
            if (isOwnerAdmin()) document.getElementById('btnResetAll').classList.remove('hidden');

            saveArchiveToIndexedDb();
            executerTraitementMetier();
            if (state.activeTab === 'global_analysis') window.yassirRenderGlobalAnalysis();
            if (state.activeTab === 'restaurant_analysis') window.yassirRenderRestaurantAnalysis();

            var msg = '<strong>' + totalAdded.toLocaleString('fr-FR') + ' nouvelles lignes</strong> ajoutées et enregistrées automatiquement (' + totalRowsInBase.toLocaleString('fr-FR') + ' lignes au total sur ' + nbFiles + ' fichier(s)).';
            if (totalAutoComm > 0) {
              msg += '<br/>Onglet <em>« Restaurant par facture »</em> synchronisé (' + totalAutoComm + ' taux).';
            }
            showToast(msg, 'success');
          })
          .catch(function (err) {
            showToast('Erreur importation : ' + escapeHtml(err.message), 'error');
          });
      }

      function chargerFichierPrincipal(file) {
        if (file) chargerPlusieursFichiersPrincipaux([file]);
      }

      function chargerFichierCommissions(file) {
        if (!file || !isOwnerAdmin()) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var data = new Uint8Array(e.target.result);
            var workbook = XLSX.read(data, { type: 'array' });
            var sheetName = workbook.SheetNames.find(function (n) { return n.trim().toLowerCase() === 'restaurant par facture'; }) || workbook.SheetNames[0];
            var rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

            var count = 0;
            for (var r = 1; r < rows.length; r++) {
              var row = rows[r];
              if (row && row[0] !== undefined && row[0] !== null && row[1] !== undefined && row[1] !== '') {
                var rName = String(row[0]).trim().toLowerCase();
                var cVal = purgerNombre(row[1]);
                if (rName && !isNaN(cVal)) {
                  state.customCommissions[rName] = cVal;
                  count++;
                }
              }
            }

            saveCommissionsToStore();
            document.getElementById('commFileName').textContent = file.name + ' (' + count + ' taux importés)';
            executerTraitementMetier();
            if (state.activeTab === 'commissions') window.yassirRenderCommTable();
            showToast('<strong>' + count + ' taux</strong> de commission mis à jour depuis <strong>' + escapeHtml(file.name) + '</strong>.', 'success');
          } catch (err) {
            showToast('Erreur lecture commissions : ' + escapeHtml(err.message), 'error');
          }
        };
        reader.readAsArrayBuffer(file);
      }

      window.yassirOnMainFileChange = function (e) {
        if (e.target.files && e.target.files.length > 0) {
          chargerPlusieursFichiersPrincipaux(e.target.files);
          e.target.value = '';
        }
      };

      window.yassirOnCommFileChange = function (e) {
        if (e.target.files && e.target.files[0]) chargerFichierCommissions(e.target.files[0]);
      };

      window.yassirResetAll = function () {
        if (!isOwnerAdmin()) return;
        state.rawSourceRows = [];
        state.storedFilesMeta = [];
        state.dateStart = '';
        state.dateEnd = '';
        state.minAvailableDate = '';
        state.maxAvailableDate = '';
        state.marketRows = [];
        state.foodRows = [];
        state.offresRows = [];
        state.statRows = [];
        state.selectedAm = 'ALL';
        state.searchQuery = '';
        clearArchiveInIndexedDb();
        document.getElementById('searchInput').value = '';
        document.getElementById('inputMainFile').value = '';
        document.getElementById('mainFileName').textContent = 'Ajouter 1 ou plusieurs fichiers Data exp (cumul auto)';
        document.getElementById('mainFileName').title = 'Glissez-déposez 1 ou plusieurs fichiers Data exp ici';
        document.getElementById('mainFileSub').textContent = 'Unlimited Data • Filtre strict Order ID commençant par YAF-';
        document.getElementById('badgeSourceStatus').textContent = 'En attente';
        document.getElementById('badgeSourceStatus').className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600';
        var idbBadge = document.getElementById('badgeIndexedDbSaved');
        if (idbBadge) idbBadge.classList.add('hidden');
        document.getElementById('btnResetAll').classList.add('hidden');
        mettreAJourInterface();
        showToast('Base de données enregistrée réinitialisée.', 'info');
      };
