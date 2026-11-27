      /* ========================================================================
         O3. GLOBAL ANALYSIS & RESTAURANT ANALYSIS (GROWTH / DROP HEBDOMADAIRE)
         ======================================================================== */
      var YASSIR_WEEKS_CALENDAR = [
        { num: 1, key: 'week 01', label: 'Semaine 01', start: '2025-12-29', end: '2026-01-04' },
        { num: 2, key: 'week 02', label: 'Semaine 02', start: '2026-01-05', end: '2026-01-11' },
        { num: 3, key: 'week 03', label: 'Semaine 03', start: '2026-01-12', end: '2026-01-18' },
        { num: 4, key: 'week 04', label: 'Semaine 04', start: '2026-01-19', end: '2026-01-25' },
        { num: 5, key: 'week 05', label: 'Semaine 05', start: '2026-01-26', end: '2026-02-01' },
        { num: 6, key: 'week 06', label: 'Semaine 06', start: '2026-02-02', end: '2026-02-08' },
        { num: 7, key: 'week 07', label: 'Semaine 07', start: '2026-02-09', end: '2026-02-15' },
        { num: 8, key: 'week 08', label: 'Semaine 08', start: '2026-02-16', end: '2026-02-22' },
        { num: 9, key: 'week 09', label: 'Semaine 09', start: '2026-02-23', end: '2026-03-01' },
        { num: 10, key: 'week 10', label: 'Semaine 10', start: '2026-03-02', end: '2026-03-08' },
        { num: 11, key: 'week 11', label: 'Semaine 11', start: '2026-03-09', end: '2026-03-15' },
        { num: 12, key: 'week 12', label: 'Semaine 12', start: '2026-03-16', end: '2026-03-22' },
        { num: 13, key: 'week 13', label: 'Semaine 13', start: '2026-03-23', end: '2026-03-29' },
        { num: 14, key: 'week 14', label: 'Semaine 14', start: '2026-03-30', end: '2026-04-05' },
        { num: 15, key: 'week 15', label: 'Semaine 15', start: '2026-04-06', end: '2026-04-12' },
        { num: 16, key: 'week 16', label: 'Semaine 16', start: '2026-04-13', end: '2026-04-19' },
        { num: 17, key: 'week 17', label: 'Semaine 17', start: '2026-04-20', end: '2026-04-26' },
        { num: 18, key: 'week 18', label: 'Semaine 18', start: '2026-04-27', end: '2026-05-03' },
        { num: 19, key: 'week 19', label: 'Semaine 19', start: '2026-05-04', end: '2026-05-10' },
        { num: 20, key: 'week 20', label: 'Semaine 20', start: '2026-05-11', end: '2026-05-17' },
        { num: 21, key: 'week 21', label: 'Semaine 21', start: '2026-05-18', end: '2026-05-24' },
        { num: 22, key: 'week 22', label: 'Semaine 22', start: '2026-05-25', end: '2026-05-31' },
        { num: 23, key: 'week 23', label: 'Semaine 23', start: '2026-06-01', end: '2026-06-07' },
        { num: 24, key: 'week 24', label: 'Semaine 24', start: '2026-06-08', end: '2026-06-14' },
        { num: 25, key: 'week 25', label: 'Semaine 25', start: '2026-06-15', end: '2026-06-21' },
        { num: 26, key: 'week 26', label: 'Semaine 26', start: '2026-06-22', end: '2026-06-28' },
        { num: 27, key: 'week 27', label: 'Semaine 27', start: '2026-06-29', end: '2026-07-05' },
        { num: 28, key: 'week 28', label: 'Semaine 28', start: '2026-07-06', end: '2026-07-12' },
        { num: 29, key: 'week 29', label: 'Semaine 29', start: '2026-07-13', end: '2026-07-19' },
        { num: 30, key: 'week 30', label: 'Semaine 30', start: '2026-07-20', end: '2026-07-26' },
        { num: 31, key: 'week 31', label: 'Semaine 31', start: '2026-07-27', end: '2026-08-02' },
        { num: 32, key: 'week 32', label: 'Semaine 32', start: '2026-08-03', end: '2026-08-09' },
        { num: 33, key: 'week 33', label: 'Semaine 33', start: '2026-08-10', end: '2026-08-16' },
        { num: 34, key: 'week 34', label: 'Semaine 34', start: '2026-08-17', end: '2026-08-23' },
        { num: 35, key: 'week 35', label: 'Semaine 35', start: '2026-08-24', end: '2026-08-30' },
        { num: 36, key: 'week 36', label: 'Semaine 36', start: '2026-08-31', end: '2026-09-06' },
        { num: 37, key: 'week 37', label: 'Semaine 37', start: '2026-09-07', end: '2026-09-13' },
        { num: 38, key: 'week 38', label: 'Semaine 38', start: '2026-09-14', end: '2026-09-20' },
        { num: 39, key: 'week 39', label: 'Semaine 39', start: '2026-09-21', end: '2026-09-27' },
        { num: 40, key: 'week 40', label: 'Semaine 40', start: '2026-09-28', end: '2026-10-04' },
        { num: 41, key: 'week 41', label: 'Semaine 41', start: '2026-10-05', end: '2026-10-11' },
        { num: 42, key: 'week 42', label: 'Semaine 42', start: '2026-10-12', end: '2026-10-18' },
        { num: 43, key: 'week 43', label: 'Semaine 43', start: '2026-10-19', end: '2026-10-25' },
        { num: 44, key: 'week 44', label: 'Semaine 44', start: '2026-10-26', end: '2026-11-01' },
        { num: 45, key: 'week 45', label: 'Semaine 45', start: '2026-11-02', end: '2026-11-08' },
        { num: 46, key: 'week 46', label: 'Semaine 46', start: '2026-11-09', end: '2026-11-15' },
        { num: 47, key: 'week 47', label: 'Semaine 47', start: '2026-11-16', end: '2026-11-22' },
        { num: 48, key: 'week 48', label: 'Semaine 48', start: '2026-11-23', end: '2026-11-29' },
        { num: 49, key: 'week 49', label: 'Semaine 49', start: '2026-11-30', end: '2026-12-06' },
        { num: 50, key: 'week 50', label: 'Semaine 50', start: '2026-12-07', end: '2026-12-13' },
        { num: 51, key: 'week 51', label: 'Semaine 51', start: '2026-12-14', end: '2026-12-20' },
        { num: 52, key: 'week 52', label: 'Semaine 52', start: '2026-12-21', end: '2026-12-27' },
        { num: 53, key: 'week 53', label: 'Semaine 53', start: '2026-12-28', end: '2027-01-03' }
      ];

      function findWeekNumForIsoDate(isoDate) {
        if (!isoDate) return -1;
        for (var i = 0; i < YASSIR_WEEKS_CALENDAR.length; i++) {
          var w = YASSIR_WEEKS_CALENDAR[i];
          if (isoDate >= w.start && isoDate <= w.end) return w.num;
        }
        return -1;
      }

      var currentGlobalAnalysisRows = [];

      window.yassirRenderGlobalAnalysis = function () {
        var emptyEl = document.getElementById('globalAnalysisEmptyState');
        var wrapEl = document.getElementById('globalAnalysisTableWrapper');
        var tbody = document.getElementById('globalAnalysisTableBody');
        var bannerTitle = document.getElementById('globalAnalysisBannerTitle');
        var scopeSelect = document.getElementById('globalAnalysisServiceScope');
        if (!tbody) return;

        var aoa = state.rawSourceRows;
        if (!aoa || aoa.length < 2) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          if (wrapEl) wrapEl.classList.add('hidden');
          return;
        }

        var serviceMode = scopeSelect ? scopeSelect.value : 'FOOD';
        var activeAm = getEffectiveAmFilter();
        var currentMaxWeek = findWeekNumForIsoDate(getTodayIsoLocal());

        if (bannerTitle) {
          bannerTitle.textContent = 'Yassir — ' + (activeAm === 'ALL' ? 'Global' : activeAm) + ' (' + ((isMarketOnlyViewer() || serviceMode === 'MARKET_ONLY') ? 'Market VF' : (serviceMode === 'FOOD' ? 'Food VF' : 'Tous services')) + ')';
        }

        var headers = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
        var idxOrderDay = headers.indexOf('order day') !== -1 ? headers.indexOf('order day') : headers.indexOf('delivered day');
        var idxOrderTimeGa = headers.indexOf('order time');
        var idxStatus = headers.indexOf('status');
        var idxServices = headers.indexOf('services');
        var idxOidCheck = headers.indexOf('order id');
        var idxResto = headers.indexOf('restaurant name');
        var idxCommercial = headers.indexOf('commercial');
        var idxOrderIdOff = headers.indexOf('order id');
        var idxTotalFood = headers.indexOf('total food');
        var idxCouponAdmin = headers.indexOf('coupon admin');
        var idxCouponResto = headers.indexOf('coupon restaurant');
        var idxCouponDisc = headers.indexOf('coupon discount');
        var idxDiscAmt = headers.indexOf('discount amount');
        var idxProvider = headers.indexOf('discount type provider');
        var idxAmountToRest = headers.indexOf('amount to restaurant');

        var weekMap = new Map();
        var globalWeekDelivMap = new Map();

        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          if (typeof idxOidCheck !== 'undefined' && idxOidCheck !== -1 && !estOrderIdYaf(row[idxOidCheck])) continue;

          var calIsoGa = idxOrderDay !== -1 ? parseOrderDayToIsoDate(row[idxOrderDay]) : '';
          var iso = (calIsoGa && idxOrderTimeGa !== -1) ? getOperationalIsoDate(calIsoGa, row[idxOrderTimeGa]) : calIsoGa;
          var wNum = findWeekNumForIsoDate(iso);
          if (wNum === -1 || (currentMaxWeek !== -1 && wNum > currentMaxWeek)) continue;

          var rawResto = idxResto !== -1 && row[idxResto] ? String(row[idxResto]).trim() : '';
          var rKey = rawResto.toLowerCase();
          var srv = idxServices !== -1 && row[idxServices] ? String(row[idxServices]).trim().toLowerCase() : '';
          var isMarket = srv.includes('market') || rKey.includes('mg market') || rKey.includes('market');
          if ((isMarketOnlyViewer() || serviceMode === 'MARKET_ONLY') && !isMarket) continue;
          if (!isMarketOnlyViewer() && serviceMode === 'FOOD' && isMarket) continue;

          var rawComm = idxCommercial !== -1 && row[idxCommercial] ? String(row[idxCommercial]).trim() : '';
          var amName = determinerAmPourCommande(rawResto);

          var isDel = idxStatus !== -1 && estCommandeLivree(row[idxStatus]);
          if (isDel) {
            globalWeekDelivMap.set(wNum, (globalWeekDelivMap.get(wNum) || 0) + 1);
          }

          if (activeAm !== 'ALL' && amName !== activeAm) continue;

          if (!weekMap.has(wNum)) {
            weekMap.set(wNum, { wNum: wNum, recu: 0, livre: 0, gmv: 0, ca: 0 });
          }
          var entry = weekMap.get(wNum);
          entry.recu += 1;

          if (isDel) {
            entry.livre += 1;
            var totalFood = idxTotalFood !== -1 ? purgerNombre(row[idxTotalFood]) : 0;
            var cAdmin = idxCouponAdmin !== -1 ? purgerNombre(row[idxCouponAdmin]) : 0;
            var cResto = idxCouponResto !== -1 ? purgerNombre(row[idxCouponResto]) : 0;
            var cDisc = idxCouponDisc !== -1 ? purgerNombre(row[idxCouponDisc]) : 0;
            var dAmt = idxDiscAmt !== -1 ? purgerNombre(row[idxDiscAmt]) : 0;
            var prov = idxProvider !== -1 && row[idxProvider] ? String(row[idxProvider]).trim().toLowerCase() : '';
            var amtRest = idxAmountToRest !== -1 ? purgerNombre(row[idxAmountToRest]) : 0;

            var gmvRow = totalFood + cAdmin + cResto;
            var caRestoRow = totalFood + cDisc + (prov === 'admin' ? dAmt : 0);
            var caRow = Object.prototype.hasOwnProperty.call(state.customCommissions, rKey)
              ? ((state.customCommissions[rKey] * caRestoRow) / 100)
              : (caRestoRow - amtRest);

            entry.gmv += gmvRow;
            entry.ca += caRow;
          }
        }

        var sortedWeeks = Array.from(weekMap.values()).sort(function (a, b) { return a.wNum - b.wNum; });
        if (sortedWeeks.length === 0) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          if (wrapEl) wrapEl.classList.add('hidden');
          return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');
        if (wrapEl) wrapEl.classList.remove('hidden');

        var rowsOut = [];
        for (var idx = 0; idx < sortedWeeks.length; idx++) {
          var cur = sortedWeeks[idx];
          var prev = idx > 0 ? sortedWeeks[idx - 1] : null;
          var aov = cur.livre > 0 ? (cur.gmv / cur.livre) : 0;
          var prevAov = (prev && prev.livre > 0) ? (prev.gmv / prev.livre) : 0;

          var vRecu = (prev && prev.recu > 0) ? (((cur.recu - prev.recu) / prev.recu) * 100) : null;
          var vLivre = (prev && prev.livre > 0) ? (((cur.livre - prev.livre) / prev.livre) * 100) : null;
          var vGmv = (prev && prev.gmv > 0) ? (((cur.gmv - prev.gmv) / prev.gmv) * 100) : null;
          var vCa = (prev && prev.ca > 0) ? (((cur.ca - prev.ca) / prev.ca) * 100) : null;
          var vAov = (prev && prevAov > 0) ? (((aov - prevAov) / prevAov) * 100) : null;

          var globDel = globalWeekDelivMap.get(cur.wNum) || 0;
          var pctGlobalLivre = globDel > 0 ? ((cur.livre / globDel) * 100) : 0;

          rowsOut.push({
            weekLabel: 'week ' + String(cur.wNum).padStart(2, '0'),
            wNum: cur.wNum,
            recu: cur.recu,
            livre: cur.livre,
            gmv: Number(cur.gmv.toFixed(2)),
            ca: Number(cur.ca.toFixed(2)),
            aov: Number(aov.toFixed(2)),
            vRecu: vRecu,
            vLivre: vLivre,
            vGmv: vGmv,
            vCa: vCa,
            vAov: vAov,
            pctGlobalLivre: Number(pctGlobalLivre.toFixed(2))
          });
        }

        currentGlobalAnalysisRows = rowsOut;

        function fmtDeltaCell(val) {
          if (val === null || val === undefined || isNaN(val)) {
            return '<td class="px-2.5 py-2 text-center border border-slate-200 bg-slate-50 text-slate-400">-</td>';
          }
          var bg = val > 0 ? 'bg-[#D9EAD3] text-[#1E4620] font-bold' : (val < 0 ? 'bg-[#F4CCCC] text-[#7F1D1D] font-bold' : 'bg-white text-slate-600');
          return '<td class="px-2.5 py-2 text-center border border-slate-200 ' + bg + '">' + val.toFixed(2) + '%</td>';
        }

        tbody.innerHTML = rowsOut.map(function (r, idx) {
          var isLast = idx === rowsOut.length - 1;
          var pctGlobCell = isLast
            ? '<td class="px-3 py-2 text-center border border-slate-200 bg-[#D9EAD3] text-[#1A1A2E] font-extrabold">' + r.pctGlobalLivre.toFixed(2) + '%</td>'
            : '<td class="px-3 py-2 text-center border border-slate-200 text-slate-500">' + r.pctGlobalLivre.toFixed(2) + '%</td>';

          return '<tr class="hover:bg-[#F3EBFF]/30">' +
            '<td class="px-3 py-2 text-center font-extrabold text-white bg-[#FF1E6E] border border-pink-400/40 whitespace-nowrap">' + escapeHtml(r.weekLabel) + '</td>' +
            '<td class="px-3 py-2 text-center border border-slate-200 font-semibold text-[#1A1A2E]">' + r.recu + '</td>' +
            '<td class="px-3 py-2 text-center border border-slate-200 font-bold text-[#1A1A2E]">' + r.livre + '</td>' +
            '<td class="px-3 py-2 text-center border border-slate-200">' + r.gmv.toFixed(2) + '</td>' +
            '<td class="px-3 py-2 text-center border border-slate-200 font-semibold text-[#6C2BD9]">' + r.ca.toFixed(2) + '</td>' +
            '<td class="px-3 py-2 text-center border border-slate-200">' + r.aov.toFixed(2) + '</td>' +
            fmtDeltaCell(r.vRecu) +
            fmtDeltaCell(r.vLivre) +
            fmtDeltaCell(r.vGmv) +
            fmtDeltaCell(r.vCa) +
            fmtDeltaCell(r.vAov) +
            pctGlobCell +
          '</tr>';
        }).join('');
      };

      window.yassirExportGlobalAnalysisExcel = function () {
        if (!currentGlobalAnalysisRows || currentGlobalAnalysisRows.length === 0) return;
        var aoa = [[
          'Week n°', 'Reçu', 'Livré', 'GMV', 'CA', 'AOV',
          'V.Reçu', 'V.Livré', 'V.GMV', 'V.CA', 'V.AOV', '% Global Livré'
        ]];
        currentGlobalAnalysisRows.forEach(function (r) {
          aoa.push([
            r.weekLabel,
            r.recu,
            r.livre,
            r.gmv,
            r.ca,
            r.aov,
            r.vRecu !== null ? (r.vRecu.toFixed(2) + '%') : '',
            r.vLivre !== null ? (r.vLivre.toFixed(2) + '%') : '',
            r.vGmv !== null ? (r.vGmv.toFixed(2) + '%') : '',
            r.vCa !== null ? (r.vCa.toFixed(2) + '%') : '',
            r.vAov !== null ? (r.vAov.toFixed(2) + '%') : '',
            r.pctGlobalLivre.toFixed(2) + '%'
          ]);
        });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [
          { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
          { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'Global Analysis');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Global_Analysis_' + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : YASSIR_Global_Analysis_' + dateStr + '.xlsx');
        showToast('Tableau <strong>Global Analysis</strong> exporté en Excel (.xlsx).', 'success');
      };

      /* ---- RESTAURANT ANALYSIS (GROWTH & DROP PAR SEMAINE) ---- */
      var currentGrowthRows = [];
      var currentDropRows = [];

      window.yassirUpdateGrowthDropReason = function (reasonKey, newVal) {
        state.growthDropReasons[reasonKey] = newVal;
        saveReasonsToStore();
      };

      function snapOfferPercentageToTier(rawPct) {
        if (!rawPct || rawPct <= 0) return 0;
        var tiers = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
        var best = tiers[0];
        var minDiff = Math.abs(rawPct - best);
        for (var i = 1; i < tiers.length; i++) {
          var diff = Math.abs(rawPct - tiers[i]);
          if (diff < minDiff) {
            minDiff = diff;
            best = tiers[i];
          }
        }
        return best;
      }

      window.yassirRenderRestaurantAnalysis = function () {
        var emptyEl = document.getElementById('restAnalysisEmptyState');
        var gridEl = document.getElementById('restAnalysisContentGrid');
        var weekSel = document.getElementById('restAnalysisWeekSelect');
        var growthBody = document.getElementById('growthTableBody');
        var dropBody = document.getElementById('dropTableBody');
        if (!weekSel || !growthBody || !dropBody) return;

        var aoa = state.rawSourceRows;
        if (!aoa || aoa.length < 2) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          if (gridEl) gridEl.classList.add('hidden');
          return;
        }

        var headers = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
        var idxOrderDay = headers.indexOf('order day') !== -1 ? headers.indexOf('order day') : headers.indexOf('delivered day');
        var idxOrderTimeRa = headers.indexOf('order time');
        var idxArea = headers.indexOf('area');
        var idxResto = headers.indexOf('restaurant name');
        var idxStatus = headers.indexOf('status');
        var idxServices = headers.indexOf('services');
        var idxOidCheck = headers.indexOf('order id');
        var idxCommercial = headers.indexOf('commercial');
        var idxOrderIdOff = headers.indexOf('order id');
        var idxAcceptedBy = headers.indexOf('accepted by');
        var idxItemTotalRa = headers.indexOf('item total');
        var idxTotalFoodRa = headers.indexOf('total food');
        var idxDiscAmtRa = headers.indexOf('discount amount');
        var idxDiscType = headers.lastIndexOf('discount type') !== -1 ? headers.lastIndexOf('discount type') : headers.indexOf('discount type');
        var idxProvider = headers.indexOf('discount type provider');
        var idxFoodCat = headers.indexOf('food category');
        var idxTags = headers.indexOf('tags');

        var activeAm = getEffectiveAmFilter();
        var currentMaxWeek = findWeekNumForIsoDate(getTodayIsoLocal());

        var availableWeeksSet = new Set();
        var restoWeekMap = new Map();

        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          if (typeof idxOidCheck !== 'undefined' && idxOidCheck !== -1 && !estOrderIdYaf(row[idxOidCheck])) continue;

          var calIsoRa = idxOrderDay !== -1 ? parseOrderDayToIsoDate(row[idxOrderDay]) : '';
          var iso = (calIsoRa && idxOrderTimeRa !== -1) ? getOperationalIsoDate(calIsoRa, row[idxOrderTimeRa]) : calIsoRa;
          var wNum = findWeekNumForIsoDate(iso);
          if (wNum === -1 || (currentMaxWeek !== -1 && wNum > currentMaxWeek)) continue;

          var rawResto = idxResto !== -1 && row[idxResto] ? String(row[idxResto]).trim() : '';
          var rKey = rawResto.toLowerCase();
          if (!rKey) continue;

          var srv = idxServices !== -1 && row[idxServices] ? String(row[idxServices]).trim().toLowerCase() : '';
          var isMarketRowRa = srv.includes('market') || rKey.includes('mg market') || rKey.includes('market');
          if (isMarketOnlyViewer()) {
            if (!isMarketRowRa) continue;
          } else {
            if (isMarketRowRa) continue;
          }

          var rawComm = idxCommercial !== -1 && row[idxCommercial] ? String(row[idxCommercial]).trim() : '';
          var amName = determinerAmPourCommande(rawResto);
          if (activeAm !== 'ALL' && amName !== activeAm) continue;

          availableWeeksSet.add(wNum);

          var cfg = state.amPortfolios[rKey];
          var areaVal = (idxArea !== -1 && row[idxArea]) ? String(row[idxArea]).trim() : (cfg && cfg.ville ? cfg.ville : '');
          var displayResto = cfg ? cfg.displayName : rawResto;

          if (!restoWeekMap.has(rKey)) {
            restoWeekMap.set(rKey, {
              key: rKey,
              area: areaVal,
              resto: displayResto,
              am: amName,
              weeks: new Map()
            });
          }
          var rEntry = restoWeekMap.get(rKey);
          if (!rEntry.area && areaVal) rEntry.area = areaVal;

          // Si un filtre de période précis (dateStart / dateEnd) est actif, filtrer la semaine cible sur cette plage exacte
          var filterWeekFromBarCheck = state.dateStart ? findWeekNumForIsoDate(state.dateStart) : -1;
          if (filterWeekFromBarCheck !== -1 && wNum === filterWeekFromBarCheck) {
            if (state.dateStart && iso < state.dateStart) continue;
            if (state.dateEnd && iso > state.dateEnd) continue;
          }
          if (!rEntry.weeks.has(wNum)) {
            rEntry.weeks.set(wNum, { req: 0, deliv: 0, accResto: 0, promoResto: 0, cvm: 0, offersSet: new Set() });
          }
          var wStats = rEntry.weeks.get(wNum);
          wStats.req += 1;

          var isDel = idxStatus !== -1 && estCommandeLivree(row[idxStatus]);
          if (isDel) {
            wStats.deliv += 1;
            var accBy = idxAcceptedBy !== -1 && row[idxAcceptedBy] ? String(row[idxAcceptedBy]).toLowerCase() : '';
            if (accBy.includes('restaurant')) wStats.accResto += 1;

            var dType = idxDiscType !== -1 && row[idxDiscType] ? String(row[idxDiscType]).toLowerCase() : '';
            var prov = idxProvider !== -1 && row[idxProvider] ? String(row[idxProvider]).toLowerCase() : '';
            var fCat = idxFoodCat !== -1 && row[idxFoodCat] ? String(row[idxFoodCat]) : '';
            var tagsVal = idxTags !== -1 && row[idxTags] ? String(row[idxTags]) : '';

            var isSuperPromo = /super\s*promo/i.test(fCat);
            var isPercDisc = /(percentage|pourcentage)/i.test(dType);
            var isPercResto = isPercDisc && prov.includes('restaurant');
            var isPercAdmin = isPercDisc && prov.includes('admin');

            // Calcul précis du pourcentage d'offre (depuis item total avant remise ou Total Food + Discount Amount)
            var snappedPct = 0;
            if (isPercResto || isPercAdmin) {
              var iTotalVal = idxItemTotalRa !== -1 ? purgerNombre(row[idxItemTotalRa]) : 0;
              var tFoodVal = idxTotalFoodRa !== -1 ? purgerNombre(row[idxTotalFoodRa]) : 0;
              var dAmtVal = idxDiscAmtRa !== -1 ? purgerNombre(row[idxDiscAmtRa]) : 0;
              var rawPct = 0;
              if (iTotalVal > 0 && dAmtVal > 0 && dAmtVal <= iTotalVal) {
                rawPct = (dAmtVal / iTotalVal) * 100;
              } else if ((tFoodVal + dAmtVal) > 0 && dAmtVal > 0) {
                rawPct = (dAmtVal / (tFoodVal + dAmtVal)) * 100;
              } else {
                var mPct = (fCat + ' ' + tagsVal).match(/(\d{1,2})\s*%/);
                if (mPct) rawPct = parseInt(mPct[1], 10);
              }
              snappedPct = snapOfferPercentageToTier(rawPct);
            }

            if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
              var evRaKool = evaluerOffreKoolPourCommande(rawResto, iso);
              if (evRaKool) {
                wStats.promoResto += 1;
                wStats.offersSet.add(evRaKool.label);
              }
            } else {
              if (isSuperPromo) {
                wStats.promoResto += 1;
                wStats.offersSet.add('Promo articles');
              }
              if (isPercResto) {
                if (!isSuperPromo) wStats.promoResto += 1;
                if (snappedPct > 0) {
                  wStats.offersSet.add(snappedPct + '% sur toute la carte');
                }
              }
              if (isPercAdmin) {
                wStats.cvm += 1;
                if (snappedPct > 0) {
                  wStats.offersSet.add('Boost : ' + snappedPct + '%');
                } else {
                  wStats.offersSet.add('Boost');
                }
              }
            }
          }
        }

        var sortedAvailWeeks = Array.from(availableWeeksSet).sort(function (a, b) { return a - b; });
        if (sortedAvailWeeks.length === 0) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          if (gridEl) gridEl.classList.add('hidden');
          return;
        }

        var filterWeekFromBar = state.dateStart ? findWeekNumForIsoDate(state.dateStart) : -1;
        var prevSelectedWeek = parseInt(weekSel.value, 10);
        var targetWeekNum = (filterWeekFromBar !== -1 && sortedAvailWeeks.indexOf(filterWeekFromBar) !== -1)
          ? filterWeekFromBar
          : (sortedAvailWeeks.indexOf(prevSelectedWeek) !== -1
              ? prevSelectedWeek
              : sortedAvailWeeks[sortedAvailWeeks.length - 1]);

        weekSel.innerHTML = sortedAvailWeeks.map(function (wn) {
          var wMeta = YASSIR_WEEKS_CALENDAR.find(function (x) { return x.num === wn; });
          var lbl = wMeta ? ('Week ' + String(wn).padStart(2, '0') + ' (' + wMeta.start + ' → ' + wMeta.end + ')') : ('Week ' + wn);
          return '<option value="' + wn + '"' + (wn === targetWeekNum ? ' selected' : '') + '>' + escapeHtml(lbl) + '</option>';
        }).join('');

        var searchQ = (document.getElementById('searchRestAnalysisInput') ? document.getElementById('searchRestAnalysisInput').value : '').trim().toLowerCase();

        var growthList = [];
        var dropList = [];

        restoWeekMap.forEach(function (rEntry) {
          if (searchQ && !rEntry.resto.toLowerCase().includes(searchQ) && !rEntry.area.toLowerCase().includes(searchQ)) {
            return;
          }
          var curW = rEntry.weeks.get(targetWeekNum) || { req: 0, deliv: 0, accResto: 0, promoResto: 0, cvm: 0, offersSet: new Set() };

          var sumPrev4 = 0;
          var countPrev4Weeks = 0;
          for (var pw = targetWeekNum - 4; pw <= targetWeekNum - 1; pw++) {
            if (pw >= 1 && availableWeeksSet.has(pw)) {
              countPrev4Weeks++;
              var pStats = rEntry.weeks.get(pw);
              if (pStats) sumPrev4 += pStats.deliv;
            }
          }
          var avgLast4 = countPrev4Weeks > 0 ? Math.round(sumPrev4 / countPrev4Weeks) : 0;

          var prev1Stats = rEntry.weeks.get(targetWeekNum - 1) || { deliv: 0 };
          var wowDeliv = curW.deliv - prev1Stats.deliv;

          if (curW.req === 0 && avgLast4 === 0 && prev1Stats.deliv === 0) return;

          var successRate = curW.req > 0 ? ((curW.deliv / curW.req) * 100) : 0;
          var tauxAccept = curW.deliv > 0 ? ((curW.accResto / curW.deliv) * 100) : 0;
          if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
            var wMetaRa = YASSIR_WEEKS_CALENDAR.find(function (x) { return x.num === targetWeekNum; });
            var wStartIso = (state.dateStart && findWeekNumForIsoDate(state.dateStart) === targetWeekNum) ? state.dateStart : (wMetaRa ? wMetaRa.start : '');
            var wEndIso = (state.dateEnd && findWeekNumForIsoDate(state.dateEnd) === targetWeekNum) ? state.dateEnd : (wMetaRa ? wMetaRa.end : '');
            (state.offreParticipationRules || []).forEach(function (rl) {
              if (!rl || !rl.restaurant) return;
              if (rl.restaurant !== rEntry.key && (rl.restaurantNorm || normalizeText(rl.restaurant)) !== normalizeText(rEntry.key)) return;
              if (wStartIso && rl.endDate && rl.endDate < wStartIso) return;
              if (wEndIso && rl.startDate && rl.startDate > wEndIso) return;
              var lblK = formaterLibelleOffreKool(rl);
              if (rl.startDate || rl.endDate) {
                lblK += ' [' + (rl.startDate || '?') + ' → ' + (rl.endDate || '?') + ']';
              }
              curW.offersSet.add(lblK);
            });
          }
          var offersStr = curW.offersSet.size > 0 ? Array.from(curW.offersSet).join(' + ') : '-';
          var reasonKey = 'w' + targetWeekNum + '_' + rEntry.key;

          var itemObj = {
            reasonKey: reasonKey,
            area: rEntry.area || '-',
            resto: rEntry.resto,
            req: curW.req,
            deliv: curW.deliv,
            avgLast4: avgLast4,
            successRate: successRate,
            tauxAccept: tauxAccept,
            wowDeliv: wowDeliv,
            promoResto: curW.promoResto,
            cvm: curW.cvm,
            reason: state.growthDropReasons[reasonKey] || '',
            offre: offersStr
          };

          if (curW.deliv >= avgLast4 && curW.deliv > 0) {
            growthList.push(itemObj);
          } else if (curW.deliv < avgLast4) {
            dropList.push(itemObj);
          }
        });

        growthList.sort(function (a, b) { return (b.deliv - a.deliv) || (b.wowDeliv - a.wowDeliv); });
        dropList.sort(function (a, b) { return (b.avgLast4 - a.avgLast4) || (a.wowDeliv - b.wowDeliv); });

        currentGrowthRows = growthList;
        currentDropRows = dropList;

        if (emptyEl) emptyEl.classList.add('hidden');
        if (gridEl) gridEl.classList.remove('hidden');

        document.getElementById('growthCountBadge').textContent = growthList.length;
        document.getElementById('dropCountBadge').textContent = dropList.length;
        var gDelta = growthList.reduce(function (s, x) { return s + (x.deliv - x.avgLast4); }, 0);
        var dDelta = dropList.reduce(function (s, x) { return s + (x.deliv - x.avgLast4); }, 0);
        document.getElementById('growthTotalDeltaBadge').textContent = (gDelta >= 0 ? '+' : '') + gDelta + ' vs Avg4W';
        document.getElementById('dropTotalDeltaBadge').textContent = dDelta + ' vs Avg4W';

        var growthReasonsOptions = ['', 'Promo active', 'Nouveau restaurant', 'Meilleure disponibilité', 'Campagne CVM / Push', 'Forte demande zone'];
        var dropReasonsOptions = ['', 'Fin de promo', 'Fermeture / Indisponible', 'Taux rejet élevé', 'Manque de livreurs', 'Saisonnalité / Baisse trafic'];

        function renderSideRows(list, isGrowth) {
          if (list.length === 0) {
            return '<tr><td colspan="12" class="px-4 py-8 text-center text-slate-400">Aucun restaurant dans cette catégorie pour cette semaine.</td></tr>';
          }
          var opts = isGrowth ? growthReasonsOptions : dropReasonsOptions;
          var areaBg = isGrowth ? 'bg-[#D9EAD3]/60' : 'bg-[#F4CCCC]/50';
          return list.map(function (it) {
            var promoCellClass = it.promoResto > 0 ? 'bg-[#3D85C6] text-white font-bold' : 'bg-white text-slate-700';
            var selectHtml = '<select data-key="' + escapeHtml(it.reasonKey) + '" onchange="window.yassirUpdateGrowthDropReason(this.getAttribute(\'data-key\'), this.value)" class="w-28 px-1.5 py-0.5 text-[10px] bg-white border border-slate-300 rounded focus:outline-none">' +
              opts.map(function (op) {
                return '<option value="' + escapeHtml(op) + '"' + (it.reason === op ? ' selected' : '') + '>' + (op ? escapeHtml(op) : '-- Choisir --') + '</option>';
              }).join('') +
            '</select>';

            return '<tr class="hover:bg-slate-50">' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-semibold ' + areaBg + ' whitespace-nowrap">' + escapeHtml(it.area) + '</td>' +
              '<td class="px-2.5 py-1.5 border border-slate-200 font-bold text-[#1A1A2E] whitespace-nowrap">' + escapeHtml(it.resto) + '</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono">' + it.req + '</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono font-extrabold">' + it.deliv + '</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono">' + it.avgLast4 + '</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono">' + it.successRate.toFixed(1) + '%</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono">' + it.tauxAccept.toFixed(2) + '%</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono font-bold ' + (it.wowDeliv > 0 ? 'text-[#00897B]' : (it.wowDeliv < 0 ? 'text-[#FF2A6D]' : '')) + '">' + it.wowDeliv + '</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono ' + promoCellClass + '">' + it.promoResto + '</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono">' + it.cvm + '</td>' +
              '<td class="px-2 py-1.5 border border-slate-200 text-center">' + selectHtml + '</td>' +
              '<td class="px-2.5 py-1.5 border border-slate-200 text-left text-slate-600 whitespace-nowrap" title="' + escapeHtml(it.offre) + '">' + escapeHtml(it.offre) + '</td>' +
            '</tr>';
          }).join('');
        }

        growthBody.innerHTML = renderSideRows(growthList, true);
        dropBody.innerHTML = renderSideRows(dropList, false);

        // Construire la liste des Restaurants 0 Commande sur la semaine sélectionnée (avec Statut Active/Inactive et Commentaire CRM)
        var zeroTbody = document.getElementById('zeroOrdersWeekTableBody');
        var zeroBadge = document.getElementById('zeroOrdersWeekCountBadge');
        var statusFilterEl = document.getElementById('zeroOrdersStatusFilterSelect');
        var statusFilterVal = statusFilterEl ? statusFilterEl.value : 'ALL';

        var zeroList = [];
        var allowedAmsForZero = getAllowedAmListForCurrentUser();

        Object.entries(state.amPortfolios).forEach(function (pair) {
          var rKey = pair[0];
          var info = pair[1];
          if (!canViewAllPortfolios() && allowedAmsForZero.indexOf(info.am) === -1) return;
          if (activeAm !== 'ALL' && info.am !== activeAm) return;
          if (searchQ && !info.displayName.toLowerCase().includes(searchQ) && !(info.ville && info.ville.toLowerCase().includes(searchQ)) && !info.am.toLowerCase().includes(searchQ)) {
            return;
          }

          var rEntry = restoWeekMap.get(rKey);
          var curW = rEntry ? (rEntry.weeks.get(targetWeekNum) || { req: 0, deliv: 0 }) : { req: 0, deliv: 0 };
          if (curW.req > 0) return; // Uniquement les restaurants à 0 commande sur cette semaine

          var sumPrev4 = 0;
          var countPrev4Weeks = 0;
          if (rEntry) {
            for (var pw = targetWeekNum - 4; pw <= targetWeekNum - 1; pw++) {
              if (pw >= 1 && availableWeeksSet.has(pw)) {
                countPrev4Weeks++;
                var pStats = rEntry.weeks.get(pw);
                if (pStats) sumPrev4 += pStats.deliv;
              }
            }
          }
          var avgLast4 = countPrev4Weeks > 0 ? Math.round(sumPrev4 / countPrev4Weeks) : 0;

          var stVal = lookupRestoStatusAuto(rKey, info.displayName);
          if (statusFilterVal === 'Active' && stVal !== 'Active') return;
          if (statusFilterVal === 'Inactive' && stVal !== 'Inactive') return;
          if (statusFilterVal === 'UNKNOWN' && stVal !== '') return;

          var crmKey = 'crm_w' + targetWeekNum + '_' + rKey;
          zeroList.push({
            rKey: rKey,
            crmKey: crmKey,
            am: info.am,
            area: info.ville || (rEntry ? rEntry.area : '') || '-',
            resto: info.displayName,
            status: stVal,
            deliv: curW.deliv,
            avgLast4: avgLast4,
            crmComment: state.crmComments[crmKey] || ''
          });
        });

        zeroList.sort(function (a, b) {
          return a.am.localeCompare(b.am, 'fr') || (b.avgLast4 - a.avgLast4) || a.resto.localeCompare(b.resto, 'fr');
        });

        currentZeroOrdersWeekRows = zeroList;
        if (zeroBadge) zeroBadge.textContent = zeroList.length;

        if (zeroTbody) {
          if (zeroList.length === 0) {
            zeroTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400">Aucun restaurant à 0 commande pour ce filtre.</td></tr>';
          } else {
            zeroTbody.innerHTML = zeroList.map(function (z) {
              var stSelectHtml = z.status === 'Active'
                ? '<span class="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-[#00897B] border border-emerald-300"><span class="w-1.5 h-1.5 rounded-full bg-[#00BFA5]"></span>Active</span>'
                : (z.status === 'Inactive'
                    ? '<span class="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-100 text-[#FF2A6D] border border-rose-300"><span class="w-1.5 h-1.5 rounded-full bg-[#FF2A6D]"></span>Inactive</span>'
                    : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">Non renseigné</span>');

              return '<tr class="hover:bg-amber-50/40">' +
                '<td class="px-2.5 py-1.5 border border-slate-200 whitespace-nowrap"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(z.am) + '</span></td>' +
                '<td class="px-2.5 py-1.5 border border-slate-200 text-slate-600 whitespace-nowrap">' + escapeHtml(z.area) + '</td>' +
                '<td class="px-3 py-1.5 border border-slate-200 font-bold text-[#1A1A2E] whitespace-nowrap">' + escapeHtml(z.resto) + '</td>' +
                '<td class="px-2.5 py-1.5 border border-slate-200 text-center whitespace-nowrap">' + stSelectHtml + '</td>' +
                '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono font-bold text-[#FF2A6D]">0</td>' +
                '<td class="px-2 py-1.5 border border-slate-200 text-center font-mono text-slate-600">' + z.avgLast4 + '</td>' +
                '<td class="px-2.5 py-1.5 border border-slate-200">' +
                  '<input type="text" value="' + escapeHtml(z.crmComment) + '" data-key="' + escapeHtml(z.crmKey) + '" onchange="window.yassirUpdateZeroOrderCrmComment(this.getAttribute(\'data-key\'), this.value)" placeholder="Saisir commentaire CRM..." class="w-full px-2.5 py-1 text-[11px] bg-[#F8F9FC] border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F59E0B] focus:bg-white" />' +
                '</td>' +
              '</tr>';
            }).join('');
          }
        }
      };

      var currentZeroOrdersWeekRows = [];

      window.yassirUpdateZeroOrderCrmComment = function (crmKey, newVal) {
        state.crmComments[crmKey] = newVal;
        saveCrmCommentsToStore();
      };

      function lookupRestoStatusAuto(rKey, displayName) {
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') return '';
        if (!state.restoStatuses) return '';
        if (rKey && Object.prototype.hasOwnProperty.call(state.restoStatuses, rKey)) {
          return state.restoStatuses[rKey];
        }
        var normTarget = normalizeText(displayName || rKey);
        if (!normTarget) return '';
        var normKey = '__norm__' + normTarget;
        if (Object.prototype.hasOwnProperty.call(state.restoStatuses, normKey)) {
          return state.restoStatuses[normKey];
        }
        return '';
      }

      window.yassirSyncRestoStatusSheet = function (manualTrigger) {
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          if (manualTrigger) showToast('Le statut Active/Inactive est désactivé en mode <strong>Kool</strong>.', 'info');
          return Promise.resolve();
        }
        if (manualTrigger && !isOwnerAdmin() && !canViewAllPortfolios()) return;
        var icon = document.getElementById('iconSyncRestoStatus');
        var label = document.getElementById('labelSyncRestoStatus');
        if (icon) icon.classList.add('fa-spin');
        if (label) label.textContent = 'Sync Statut...';

        var statusRowsPromise = fetchGoogleWorkbookXlsx(LIVE_SHEETS_CONFIG.RESTO_STATUS_SHEET_ID)
          .then(function (wb) {
            var targetSheet = wb.SheetNames.find(function (n) {
              var low = n.toLowerCase();
              return low.includes('active') || low.includes('status') || low.includes('statut');
            }) || wb.SheetNames[0];
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { header: 1, defval: '' });
            if (!rows || rows.length < 2) throw new Error('Feuille statut vide');
            return rows;
          })
          .catch(function () {
            return fetchGoogleSheetByGidSmart(LIVE_SHEETS_CONFIG.RESTO_STATUS_SHEET_ID, LIVE_SHEETS_CONFIG.RESTO_STATUS_GID, '');
          });

        return statusRowsPromise
          .then(function (rows) {
            if (!rows || rows.length < 2) throw new Error('Feuille statut vide');

            // Feuille Active / Inactive :
            // Colonne B (index 1) = Restaurant Name
            // Colonne K (index 10) = Status (Active / Inactive / Archived)
            var headerLower = rows[0].map(function (c) { return normalizeText(c); });
            var idxStatusCol = 10; // Colonne K par défaut
            for (var h = 0; h < headerLower.length; h++) {
              if (headerLower[h] === 'status' || headerLower[h] === 'statut') {
                idxStatusCol = h;
                break;
              }
            }
            var idxNameCol = 1; // Colonne B par défaut
            var nameHeaders = ['restaurant name', 'restaurant', 'nom du restaurant', 'nom restaurant', 'store name', 'store', 'enseigne', 'name', 'nom'];
            for (var nh = 0; nh < nameHeaders.length; nh++) {
              var foundIdx = headerLower.indexOf(nameHeaders[nh]);
              if (foundIdx !== -1 && foundIdx !== idxStatusCol) {
                idxNameCol = foundIdx;
                break;
              }
            }

            var firstRowStatusNorm = normalizeText(rows[0][idxStatusCol] || '');
            var startRow = (firstRowStatusNorm === 'status' || firstRowStatusNorm === 'statut' || normalizeText(rows[0][idxNameCol] || '') === 'restaurant name') ? 1 : 0;

            var freshStatuses = {};
            var activeCount = 0;
            var inactiveCount = 0;
            var archivedSkipped = 0;

            for (var r = startRow; r < rows.length; r++) {
              var row = rows[r];
              if (!row || row.length <= idxStatusCol) continue;

              var rawSt = String(row[idxStatusCol] !== null && row[idxStatusCol] !== undefined ? row[idxStatusCol] : '').trim();
              if (!rawSt) continue;
              var stNorm = rawSt.toLowerCase();

              // Prendre UNIQUEMENT Active et Inactive, ignorer Archived
              if (stNorm.includes('archiv')) {
                archivedSkipped++;
                continue;
              }
              var canonicalSt = '';
              if (stNorm === 'inactive' || stNorm === 'inactif') {
                canonicalSt = 'Inactive';
              } else if (stNorm === 'active' || stNorm === 'actif') {
                canonicalSt = 'Active';
              } else {
                continue;
              }

              var rName = row[idxNameCol] !== undefined && row[idxNameCol] !== null
                ? String(row[idxNameCol]).trim()
                : '';
              if (!rName) continue;
              var rKey = rName.toLowerCase();
              if (rKey === 'restaurant name' || rKey === 'restaurant') continue;

              // Si un même nom apparaît plusieurs fois, conserver Active en priorité
              if (freshStatuses[rKey] !== 'Active') {
                freshStatuses[rKey] = canonicalSt;
              }
              var normKey = '__norm__' + normalizeText(rName);
              if (freshStatuses[normKey] !== 'Active') {
                freshStatuses[normKey] = canonicalSt;
              }

              if (canonicalSt === 'Active') activeCount++;
              else inactiveCount++;
            }

            if (activeCount > 0 || inactiveCount > 0) {
              state.restoStatuses = freshStatuses;
              saveRestoStatusesToStore();
            }

            if (icon) icon.classList.remove('fa-spin');
            if (label) {
              var now = new Date();
              var hh = String(now.getHours()).padStart(2, '0');
              var mm = String(now.getMinutes()).padStart(2, '0');
              label.textContent = (activeCount > 0 || inactiveCount > 0) ? ('Statuts OK (' + hh + ':' + mm + ')') : 'Sync Statut Active/Inactive';
            }
            noterStatutSynchro('Statut Active/Inactive', activeCount > 0 || inactiveCount > 0);

            if (state.activeTab === 'restaurant_analysis') {
              window.yassirRenderRestaurantAnalysis();
            }

            if (manualTrigger) {
              if (activeCount > 0 || inactiveCount > 0) {
                showToast(
                  '<strong>Statuts Restaurants synchronisés (Colonne K) !</strong><br/>' +
                  '• Active : <strong>' + activeCount + '</strong> | Inactive : <strong>' + inactiveCount + '</strong> (Archived ignorés : ' + archivedSkipped + ').',
                  'success'
                );
              } else {
                showToast(
                  'Aucune ligne Active/Inactive trouvée. Vérifiez que la feuille Google Sheets est partagée en <strong>« Tous les utilisateurs disposant du lien : Lecteur »</strong>.',
                  'error'
                );
              }
            }
          })
          .catch(function () {
            noterStatutSynchro('Statut Active/Inactive', false);
            if (icon) icon.classList.remove('fa-spin');
            if (label) label.textContent = 'Sync Statut Active/Inactive';
            if (manualTrigger) {
              showToast('Impossible de lire la feuille Active / Inactive (vérifiez le partage public en lecture de la feuille Google Sheets).', 'error');
            }
          });
      };

      window.yassirExportRestaurantAnalysisExcel = function () {
        if (currentGrowthRows.length === 0 && currentDropRows.length === 0 && currentZeroOrdersWeekRows.length === 0) return;
        var headers = [
          'Area', 'Restaurant', 'Requested', 'Delivered', 'AVG Last 4 Week',
          'Succes Rate', 'Taux Acceptation', 'WoW Delivered', 'Promo Restaurant',
          'CVM', 'Raison', 'Offre'
        ];
        var wb = XLSX.utils.book_new();

        var gAoa = [headers].concat(currentGrowthRows.map(function (r) {
          return [
            r.area, r.resto, r.req, r.deliv, r.avgLast4,
            r.successRate.toFixed(1) + '%', r.tauxAccept.toFixed(2) + '%',
            r.wowDeliv, r.promoResto, r.cvm, r.reason, r.offre
          ];
        }));
        var wsG = XLSX.utils.aoa_to_sheet(gAoa);
        wsG['!cols'] = [
          { wch: 18 }, { wch: 28 }, { wch: 11 }, { wch: 11 }, { wch: 15 },
          { wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 8 },
          { wch: 24 }, { wch: 26 }
        ];
        XLSX.utils.book_append_sheet(wb, wsG, 'Growth');

        var dAoa = [headers].concat(currentDropRows.map(function (r) {
          return [
            r.area, r.resto, r.req, r.deliv, r.avgLast4,
            r.successRate.toFixed(1) + '%', r.tauxAccept.toFixed(2) + '%',
            r.wowDeliv, r.promoResto, r.cvm, r.reason, r.offre
          ];
        }));
        var wsD = XLSX.utils.aoa_to_sheet(dAoa);
        wsD['!cols'] = wsG['!cols'];
        XLSX.utils.book_append_sheet(wb, wsD, 'Drop');

        var zHeaders = ['Portefeuille AM', 'Area', 'Restaurant', 'Statut (Active/Inactive)', 'Delivered Semaine', 'AVG Last 4W', 'Commentaire (CRM)'];
        var zAoa = [zHeaders].concat(currentZeroOrdersWeekRows.map(function (r) {
          return [r.am, r.area, r.resto, r.status || 'Non renseigné', r.deliv, r.avgLast4, r.crmComment || ''];
        }));
        var wsZ = XLSX.utils.aoa_to_sheet(zAoa);
        wsZ['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 36 }];
        XLSX.utils.book_append_sheet(wb, wsZ, '0 Commande (Active-Inactive)');

        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Restaurant_Analysis_Growth_Drop_0Cmd_' + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : YASSIR_Restaurant_Analysis_Growth_Drop_0Cmd_' + dateStr + '.xlsx');
        showToast('Fichier <strong>Growth, Drop & Restaurants 0 Commande (.xlsx)</strong> téléchargé.', 'success');
      };
