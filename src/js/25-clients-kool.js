      /* ========================================================================
         E8. MODULE CLIENTS KOOL (slides 34 partie 3, 37-38 du deck Kool) :
         Nouveaux vs Retours vs Réactivés, par ville (Area) et par partenaire.
         Colonnes lues : « customer id » (ID Client, col. F de la feuille Data Kool)
         et « new client » (New Client, col. AG : 1 = nouveau, 0 = ancien) —
         remplies par le normaliseur Kool (24-multi-marque.js).
         DÉFINITIONS (affichées dans le panneau) :
         - Nouveau : New Client = 1 sur la première commande livrée du client
           dans la période filtrée.
         - Retour : New Client = 0 et commande précédente dans l'archive
           moins de 60 jours avant la première commande de la période.
         - Réactivé : New Client = 0 et commande précédente dans l'archive
           plus de 60 jours avant la première commande de la période
           (seuil de 60 jours par défaut).
         Comptage par client distinct, sur les commandes livrées Food
         uniquement, dans la période filtrée (filtre de date + filtre AM).
         La commande précédente est cherchée dans l'archive chargée
         (oct.–nov. 2026) : avec une archive qui ne couvre que 2 mois, un
         écart de plus de 60 jours est presque impossible — les réactivés
         resteront à 0 tant que l'archive ne couvrira pas plus de 60 jours.
         Par zone : ville du portefeuille (Area) — les zones du deck
         (Banlieue Nord/Sud, Bardo & CV…) ne correspondent pas aux villes,
         aucun mapping n'est inventé.
         ======================================================================== */
      var KOOL_CLIENT_REACTIVATION_DAYS = 60;
      var koolClientsCache = { key: '', result: null };

      // Classifie un client : 'new' | 'returning' | 'reactivated'.
      // isNew : New Client = 1. prevIso : date ISO de la commande précédente
      // dans l'archive ('' si aucune). firstIso : date ISO de la première
      // commande livrée du client dans la période.
      function classifierClientKool(isNew, prevIso, firstIso) {
        if (isNew) return 'new';
        if (prevIso && firstIso) {
          var gap = diffDaysBetweenIso(prevIso, firstIso);
          if (gap !== null && gap > KOOL_CLIENT_REACTIVATION_DAYS) return 'reactivated';
        }
        return 'returning';
      }
      window.yassirClassifierClientKool = classifierClientKool;

      function calculerClientsKool() {
        var idxClientId = TARGET_HEADERS.indexOf('customer id');
        var idxNewClient = TARGET_HEADERS.indexOf('new client');
        var idxOrderDay = TARGET_HEADERS.indexOf('order day');
        var idxOrderId = TARGET_HEADERS.indexOf('order id');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxArea = TARGET_HEADERS.indexOf('Area');
        var idxCity = TARGET_HEADERS.indexOf('city');
        var idxServices = TARGET_HEADERS.indexOf('services');

        var cacheKey = (typeof currentBrand !== 'undefined' ? currentBrand : '') + '|' + getEffectiveAmFilter() + '|' +
          (state.dateStart || '') + '|' + (state.dateEnd || '') + '|' +
          state.foodRows.length + '|' + (state.rawSourceRows ? state.rawSourceRows.length : 0);
        if (koolClientsCache.key === cacheKey && koolClientsCache.result) return koolClientsCache.result;

        var hasClientData = idxClientId !== -1 && idxNewClient !== -1;

        // 1. Première commande livrée de chaque client dans la période filtrée.
        var byClient = new Map();
        var sansIdCount = 0;
        var allRecords = filtrerParAmSelectionne(getStrictlyFoodRecords());
        for (var r = 0; r < allRecords.length; r++) {
          var rec = allRecords[r];
          var c = rec.cells;
          if (!estCommandeLivree(c[idxStatus])) continue;
          var clientId = hasClientData ? String(c[idxClientId] || '').trim() : '';
          if (!clientId) { sansIdCount++; continue; }
          var iso = parseOrderDayToIsoDate(c[idxOrderDay]);
          if (!iso) continue;
          var isNew = hasClientData && Number(c[idxNewClient]) === 1;
          var area = String(c[idxArea] || c[idxCity] || '').trim();
          var resto = String(c[idxResto] || '').trim();
          var entry = byClient.get(clientId);
          if (!entry) {
            byClient.set(clientId, { clientId: clientId, firstIso: iso, isNew: isNew, area: area, resto: resto });
          } else if (iso < entry.firstIso) {
            entry.firstIso = iso;
            entry.isNew = isNew;
            entry.area = area;
            entry.resto = resto;
          } else if (iso === entry.firstIso && isNew) {
            entry.isNew = true;
          }
        }

        // 2. Dernière commande livrée AVANT la première de la période, dans l'archive complète.
        var prevByClient = new Map();
        if (state.rawSourceRows && state.rawSourceRows.length > 1) {
          var hdrs = state.rawSourceRows[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
          var aIdxClient = hdrs.indexOf('customer id');
          var aIdxDay = hdrs.indexOf('order day');
          var aIdxStatus = hdrs.indexOf('status');
          var aIdxServices = hdrs.indexOf('services');
          var aIdxOid = hdrs.indexOf('order id');
          if (aIdxClient !== -1 && aIdxDay !== -1 && aIdxStatus !== -1) {
            for (var ar = 1; ar < state.rawSourceRows.length; ar++) {
              var aRow = state.rawSourceRows[ar];
              if (!aRow) continue;
              var aClient = String(aRow[aIdxClient] || '').trim();
              if (!aClient || !byClient.has(aClient)) continue;
              if (aIdxOid !== -1 && !estOrderIdYaf(aRow[aIdxOid])) continue;
              if (!estCommandeLivree(aRow[aIdxStatus])) continue;
              if (aIdxServices !== -1) {
                var aSrv = String(aRow[aIdxServices] || '').trim().toLowerCase();
                if (aSrv.includes('market')) continue;
              }
              var aIso = parseOrderDayToIsoDate(aRow[aIdxDay]);
              if (!aIso) continue;
              var firstIso = byClient.get(aClient).firstIso;
              if (aIso >= firstIso) continue;
              var prev = prevByClient.get(aClient);
              if (!prev || aIso > prev) prevByClient.set(aClient, aIso);
            }
          }
        }

        // 3. Classification + agrégation par ville et par restaurant.
        var totals = { nouveaux: 0, retours: 0, reactives: 0, total: 0 };
        var byAreaMap = new Map();
        var byRestoMap = new Map();
        byClient.forEach(function (entry) {
          var kind = classifierClientKool(entry.isNew, prevByClient.get(entry.clientId) || '', entry.firstIso);
          if (kind === 'new') totals.nouveaux++;
          else if (kind === 'reactivated') totals.reactives++;
          else totals.retours++;
          totals.total++;
          var areaKey = entry.area || '(sans ville)';
          if (!byAreaMap.has(areaKey)) byAreaMap.set(areaKey, { area: areaKey, nouveaux: 0, retours: 0, reactives: 0, total: 0 });
          var aEntry = byAreaMap.get(areaKey);
          if (kind === 'new') aEntry.nouveaux++;
          else if (kind === 'reactivated') aEntry.reactives++;
          else aEntry.retours++;
          aEntry.total++;
          var restoKey = (entry.resto || '(sans restaurant)').toLowerCase();
          if (!byRestoMap.has(restoKey)) byRestoMap.set(restoKey, { resto: entry.resto || '(sans restaurant)', area: entry.area || '', nouveaux: 0, retours: 0, reactives: 0, total: 0 });
          var rEntry = byRestoMap.get(restoKey);
          if (kind === 'new') rEntry.nouveaux++;
          else if (kind === 'reactivated') rEntry.reactives++;
          else rEntry.retours++;
          rEntry.total++;
        });

        var byArea = Array.from(byAreaMap.values()).sort(function (a, b) { return (b.total - a.total) || a.area.localeCompare(b.area, 'fr'); });
        var byResto = Array.from(byRestoMap.values());
        function topBy(field) {
          return byResto.slice().sort(function (a, b) { return (b[field] - a[field]) || (b.total - a.total) || a.resto.localeCompare(b.resto, 'fr'); }).slice(0, 10);
        }

        var result = {
          hasClientData: hasClientData,
          sansIdCount: sansIdCount,
          totals: totals,
          byArea: byArea,
          topAcq: topBy('nouveaux'),
          topRet: topBy('retours'),
          topRea: topBy('reactives')
        };
        koolClientsCache = { key: cacheKey, result: result };
        return result;
      }
      window.yassirCalculerClientsKool = calculerClientsKool;

      var koolClientsChartInst = null;

      function renderKoolClientsPanel() {
        var res = calculerClientsKool();

        var kpiN = document.getElementById('koolCliKpiNouveaux');
        var kpiR = document.getElementById('koolCliKpiRetours');
        var kpiRe = document.getElementById('koolCliKpiReactives');
        var kpiT = document.getElementById('koolCliKpiTotal');
        var tot = res.totals.total;
        if (kpiN) kpiN.textContent = Number(res.totals.nouveaux).toLocaleString('fr-FR');
        if (kpiR) kpiR.textContent = Number(res.totals.retours).toLocaleString('fr-FR');
        if (kpiRe) kpiRe.textContent = Number(res.totals.reactives).toLocaleString('fr-FR');
        if (kpiT) kpiT.textContent = Number(tot).toLocaleString('fr-FR');
        var pctN = document.getElementById('koolCliPctNouveaux');
        var pctR = document.getElementById('koolCliPctRetours');
        var pctRe = document.getElementById('koolCliPctReactives');
        if (pctN) pctN.textContent = tot > 0 ? ((res.totals.nouveaux / tot * 100).toFixed(1).replace('.', ',') + ' % des clients') : '—';
        if (pctR) pctR.textContent = tot > 0 ? ((res.totals.retours / tot * 100).toFixed(1).replace('.', ',') + ' % des clients') : '—';
        if (pctRe) pctRe.textContent = tot > 0 ? ((res.totals.reactives / tot * 100).toFixed(1).replace('.', ',') + ' % des clients') : '—';

        var covEl = document.getElementById('koolCliCoverage');
        if (covEl) {
          var periodTxt = (state.dateStart || state.dateEnd) ? ('Période : ' + (state.dateStart || '…') + ' → ' + (state.dateEnd || '…')) : 'Période : toute la période chargée';
          covEl.textContent = periodTxt + ' • Archive Kool : oct.–nov. 2026 (la commande précédente est cherchée dans cette archive) • ' +
            (res.hasClientData ? '' : 'Colonnes « ID Client » / « New Client » absentes des données chargées — refaites « Sync Kool ». ') +
            (res.sansIdCount > 0 ? (Number(res.sansIdCount).toLocaleString('fr-FR') + ' commande(s) livrée(s) sans ID Client (non comptées).') : 'Toutes les commandes livrées ont un ID Client.');
        }

        // Graphique empilé par ville (top 10 villes par nombre de clients).
        var chartCanvas = document.getElementById('koolCliAreaChartCanvas');
        if (chartCanvas && window.Chart) {
          if (koolClientsChartInst) koolClientsChartInst.destroy();
          var topAreas = res.byArea.slice(0, 10);
          koolClientsChartInst = new Chart(chartCanvas.getContext('2d'), {
            type: 'bar',
            data: {
              labels: topAreas.map(function (a) { return a.area; }),
              datasets: [
                { label: 'Nouveaux', data: topAreas.map(function (a) { return a.nouveaux; }), backgroundColor: '#FFD100', borderRadius: 2 },
                { label: 'Retours', data: topAreas.map(function (a) { return a.retours; }), backgroundColor: '#111111', borderRadius: 2 },
                { label: 'Réactivés', data: topAreas.map(function (a) { return a.reactives; }), backgroundColor: '#9CA3AF', borderRadius: 2 }
              ]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { stacked: true, beginAtZero: true, ticks: { font: { size: 10, weight: 'bold' }, color: '#6C2BD9' } },
                y: { stacked: true, grid: { display: false }, ticks: { font: { size: 10, weight: 'bold' }, color: '#5B21B6' } }
              },
              plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' }, color: '#5B21B6' } } }
            }
          });
        }

        // Tableau par ville.
        var areaBody = document.getElementById('koolCliAreaTableBody');
        if (areaBody) {
          var pctTotalNewTxt = tot > 0 ? ((res.totals.nouveaux / tot * 100).toFixed(1).replace('.', ',') + ' %') : '—';
          if (res.byArea.length === 0) {
            areaBody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">Aucun client dans la période filtrée.</td></tr>';
          } else {
            areaBody.innerHTML = res.byArea.map(function (a) {
              var pctNew = a.total > 0 ? ((a.nouveaux / a.total * 100).toFixed(1).replace('.', ',') + ' %') : '—';
              return '<tr class="border-b border-slate-100 hover:bg-slate-50">' +
                '<td class="px-3 py-2 font-bold text-slate-700">' + escapeHtml(a.area) + '</td>' +
                '<td class="px-3 py-2 text-center font-mono">' + Number(a.nouveaux).toLocaleString('fr-FR') + '</td>' +
                '<td class="px-3 py-2 text-center font-mono">' + Number(a.retours).toLocaleString('fr-FR') + '</td>' +
                '<td class="px-3 py-2 text-center font-mono">' + Number(a.reactives).toLocaleString('fr-FR') + '</td>' +
                '<td class="px-3 py-2 text-center font-mono font-extrabold">' + Number(a.total).toLocaleString('fr-FR') + '</td>' +
                '<td class="px-3 py-2 text-center font-mono">' + escapeHtml(pctNew) + '</td></tr>';
            }).join('') +
            '<tr class="bg-slate-50 font-extrabold">' +
              '<td class="px-3 py-2 text-slate-700">Total</td>' +
              '<td class="px-3 py-2 text-center font-mono">' + Number(res.totals.nouveaux).toLocaleString('fr-FR') + '</td>' +
              '<td class="px-3 py-2 text-center font-mono">' + Number(res.totals.retours).toLocaleString('fr-FR') + '</td>' +
              '<td class="px-3 py-2 text-center font-mono">' + Number(res.totals.reactives).toLocaleString('fr-FR') + '</td>' +
              '<td class="px-3 py-2 text-center font-mono">' + Number(res.totals.total).toLocaleString('fr-FR') + '</td>' +
              '<td class="px-3 py-2 text-center font-mono">' + escapeHtml(pctTotalNewTxt) + '</td></tr>';
          }
        }

        // Top 10 par partenaire : Acquisition / Retours / Réactivés.
        function renderTop10(bodyId, rows, field) {
          var body = document.getElementById(bodyId);
          if (!body) return;
          var shown = rows.filter(function (x) { return x[field] > 0; });
          if (shown.length === 0) {
            body.innerHTML = '<tr><td colspan="3" class="px-4 py-6 text-center text-slate-400">Aucun.</td></tr>';
            return;
          }
          body.innerHTML = shown.map(function (x, i) {
            return '<tr class="border-b border-slate-100 hover:bg-slate-50">' +
              '<td class="px-3 py-2 text-center font-mono text-slate-500">' + Number(i + 1) + '</td>' +
              '<td class="px-3 py-2 font-bold text-slate-700">' + escapeHtml(x.resto) + '<span class="block text-[10px] font-normal text-slate-400">' + escapeHtml(x.area || '') + '</span></td>' +
              '<td class="px-3 py-2 text-center font-mono font-extrabold">' + Number(x[field]).toLocaleString('fr-FR') + '</td></tr>';
          }).join('');
        }
        renderTop10('koolCliTopAcqBody', res.topAcq, 'nouveaux');
        renderTop10('koolCliTopRetBody', res.topRet, 'retours');
        renderTop10('koolCliTopReaBody', res.topRea, 'reactives');
      }
      window.yassirRenderKoolClientsPanel = renderKoolClientsPanel;
