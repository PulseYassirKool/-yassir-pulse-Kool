      /* ========================================================================
         E3. MODULE VARIATION ENTRE DEUX PÉRIODES (DATA EXP VS DATA PRÉC)
         ======================================================================== */
      var currentVariationRowsList = [];
      // Mode de tri du tableau Variation — Kool uniquement (slides 35-36 du deck) :
      // 'score' = score composite (défaut, Yassir inchangé), 'top20' = Top 20 par livrées,
      // 'growth' = Top Growth par croissance % vs période précédente.
      var variationSortMode = 'score';

      function updateVariationSortButtonsUI() {
        var btnIds = { score: 'btnVariationSortScore', top20: 'btnVariationSortTop20', growth: 'btnVariationSortGrowth' };
        var activeCls = 'px-2 py-1 rounded-full text-[11px] font-extrabold cursor-pointer bg-[#FFD100] text-[#111111] border border-[#111111] transition';
        var idleCls = 'px-2 py-1 rounded-full text-[11px] font-bold cursor-pointer bg-white text-slate-600 border border-slate-300 hover:bg-slate-50 transition';
        Object.keys(btnIds).forEach(function (m) {
          var btn = document.getElementById(btnIds[m]);
          if (btn) btn.className = (variationSortMode === m) ? activeCls : idleCls;
        });
      }

      // Bascule Top 20 / Top Growth (Kool uniquement ; Yassir reste en tri par score).
      window.yassirSetVariationSort = function (mode) {
        if (mode !== 'top20' && mode !== 'growth') mode = 'score';
        variationSortMode = mode;
        updateVariationSortButtonsUI();
        window.yassirRenderVariationTable();
      };

      function chargerFichierPrecedent(file) {
        if (!file || !canSeeGlobalSynth()) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var data = new Uint8Array(e.target.result);
            var workbook = XLSX.read(data, { type: 'array', cellDates: true });
            var sourceSheetName = workbook.SheetNames.find(function (n) { return n.trim().toLowerCase() === 'data exp'; }) || workbook.SheetNames[0];
            var aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sourceSheetName], { header: 1, defval: '' });

            if (!aoa || aoa.length < 2) {
              showToast('Le fichier <strong>Data préc</strong> est vide.', 'error');
              return;
            }

            state.prevSourceRows = aoa;
            state.prevDateStart = '';
            state.prevDateEnd = '';

            // Détecter bornes de dates de Data préc
            var pHeaders = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
            var pIdxDay = pHeaders.indexOf('order day') !== -1 ? pHeaders.indexOf('order day') : pHeaders.indexOf('delivered day');
            var pMin = '', pMax = '';
            if (pIdxDay !== -1) {
              for (var pr = 1; pr < aoa.length; pr++) {
                if (!aoa[pr]) continue;
                var pIso = parseOrderDayToIsoDate(aoa[pr][pIdxDay]);
                if (!pIso) continue;
                if (!pMin || pIso < pMin) pMin = pIso;
                if (!pMax || pIso > pMax) pMax = pIso;
              }
            }
            state.minPrevDate = pMin;
            state.maxPrevDate = pMax;

            var inpPS = document.getElementById('filterPrevDateStart');
            var inpPE = document.getElementById('filterPrevDateEnd');
            if (inpPS) inpPS.value = pMin || '';
            if (inpPE) inpPE.value = pMax || '';

            var lbl = document.getElementById('prevFileNameLabel');
            var btnClear = document.getElementById('btnClearPrevData');
            if (lbl) {
              lbl.textContent = file.name + ' (' + (aoa.length - 1) + ' lignes)';
              lbl.title = file.name;
              lbl.className = 'text-[11px] font-bold text-[#00897B] truncate';
            }
            if (btnClear) btnClear.classList.remove('hidden');

            mettreAJourBarreDatesEtFichiers();
            if (state.activeTab === 'synth_global') {
              renderSynthGlobalPanel();
            } else if (state.rawSourceRows && state.rawSourceRows.length > 1) {
              window.yassirSwitchTab('synth_global');
            }

            showToast('<strong>Data préc</strong> chargé (' + (aoa.length - 1) + ' lignes). Vous pouvez filtrer ses dates dans <strong>Filtre Data préc</strong>.', 'success');
          } catch (err) {
            showToast('Erreur lecture Data préc : ' + escapeHtml(err.message), 'error');
          }
        };
        reader.readAsArrayBuffer(file);
      }

      window.yassirOnPrevFileChange = function (e) {
        if (e.target.files && e.target.files[0]) chargerFichierPrecedent(e.target.files[0]);
      };

      window.yassirClearPrevData = function () {
        state.prevSourceRows = [];
        state.prevDateStart = '';
        state.prevDateEnd = '';
        state.minPrevDate = '';
        state.maxPrevDate = '';
        currentVariationRowsList = [];
        var inp = document.getElementById('inputPrevFile');
        var inpPS = document.getElementById('filterPrevDateStart');
        var inpPE = document.getElementById('filterPrevDateEnd');
        var lbl = document.getElementById('prevFileNameLabel');
        var btnClear = document.getElementById('btnClearPrevData');
        if (inp) inp.value = '';
        if (inpPS) inpPS.value = '';
        if (inpPE) inpPE.value = '';
        if (lbl) {
          lbl.textContent = 'Aucune période précédente chargée';
          lbl.title = '';
          lbl.className = 'text-[11px] text-slate-400 truncate';
        }
        if (btnClear) btnClear.classList.add('hidden');
        mettreAJourBarreDatesEtFichiers();
        if (state.activeTab === 'synth_global') renderSynthGlobalPanel();
      };

      function extraireDeliveredFoodParRestoDepuisAoa(aoa, dStart, dEnd) {
        var prevStatsMap = new Map();
        if (!aoa || aoa.length < 2) return prevStatsMap;

        var headers = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
        var headersClean = headers.map(function (h) { return h.replace(/[_\s]+/g, ' ').trim(); });
        var idxResto = headersClean.indexOf('restaurant name');
        var idxStatus = headersClean.indexOf('status');
        var idxServices = headersClean.indexOf('services');
        var idxOidCheck = headersClean.indexOf('order id');
        var idxOrderDay = headersClean.indexOf('order day') !== -1 ? headersClean.indexOf('order day') : headersClean.indexOf('delivered day');
        var idxOrderTimePrev = headersClean.indexOf('order time');
        var idxTotalFoodVF = headersClean.indexOf('total food vf');
        var idxTotalFood = (idxTotalFoodVF === -1 && headersClean.length > 63) ? 63 : headersClean.indexOf('total food');
        var idxCouponAdmin = headersClean.indexOf('coupon admin');
        var idxCouponResto = headersClean.indexOf('coupon restaurant');
        var idxCouponDisc = headersClean.indexOf('coupon discount');
        var idxDiscAmt = headersClean.indexOf('discount amount');
        var idxProvider = headersClean.indexOf('discount type provider');
        var idxAmtToRest = headersClean.indexOf('amount to restaurant');
        var idxExistingCa = headersClean.indexOf('ca');

        if (idxResto === -1 || idxStatus === -1) return prevStatsMap;

        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          if (idxOidCheck !== -1 && !estOrderIdYaf(row[idxOidCheck])) continue;

          if ((dStart || dEnd) && idxOrderDay !== -1) {
            var calIso = parseOrderDayToIsoDate(row[idxOrderDay]);
            if (!calIso) continue;
            var opIso = idxOrderTimePrev !== -1 ? getOperationalIsoDate(calIso, row[idxOrderTimePrev]) : calIso;
            if (!opIso) continue;
            if (dStart && opIso < dStart) continue;
            if (dEnd && opIso > dEnd) continue;
          }

          var rName = String(row[idxResto] || '').trim();
          var rKey = rName.toLowerCase();
          if (!rKey) continue;

          var srv = idxServices !== -1 ? String(row[idxServices] || '').trim().toLowerCase() : '';
          var isMarketPrevRow = srv.includes('market') || rKey.includes('mg market');
          if (isMarketOnlyViewer()) {
            if (!isMarketPrevRow) continue;
          } else {
            if (isMarketPrevRow) continue;
            if (srv.includes('express') || srv.includes('coursier') || srv.includes('courier') || srv.includes('last mile') || srv.includes('b2b')) continue;
          }

          if (estCommandeLivree(row[idxStatus])) {
            if (!prevStatsMap.has(rKey)) {
              prevStatsMap.set(rKey, { deliv: 0, gmv: 0, ca: 0 });
            }
            var pEntry = prevStatsMap.get(rKey);
            pEntry.deliv += 1;

            var tfVal = idxTotalFood !== -1 ? purgerNombre(row[idxTotalFood]) : 0;
            var cAdm = idxCouponAdmin !== -1 ? purgerNombre(row[idxCouponAdmin]) : 0;
            var cRes = idxCouponResto !== -1 ? purgerNombre(row[idxCouponResto]) : 0;
            var gmvRow = (idxTotalFoodVF !== -1 && row[idxTotalFoodVF] !== '' && row[idxTotalFoodVF] !== null)
              ? purgerNombre(row[idxTotalFoodVF])
              : (tfVal + cAdm + cRes);
            pEntry.gmv += gmvRow;

            var caRow = 0;
            var cDisc = idxCouponDisc !== -1 ? purgerNombre(row[idxCouponDisc]) : 0;
            var dAmt = idxDiscAmt !== -1 ? purgerNombre(row[idxDiscAmt]) : 0;
            var prov = idxProvider !== -1 && row[idxProvider] ? String(row[idxProvider]).trim().toLowerCase() : '';
            var caRestoRow = tfVal + cDisc + (prov === 'admin' ? dAmt : 0);
            if (Object.prototype.hasOwnProperty.call(state.customCommissions, rKey)) {
              caRow = (state.customCommissions[rKey] * caRestoRow) / 100;
            } else if (idxExistingCa !== -1 && row[idxExistingCa] !== '' && row[idxExistingCa] !== null) {
              caRow = purgerNombre(row[idxExistingCa]);
            } else {
              var amtRest = idxAmtToRest !== -1 ? purgerNombre(row[idxAmtToRest]) : 0;
              caRow = caRestoRow - amtRest;
            }
            pEntry.ca += caRow;
          }
        }
        return prevStatsMap;
      }

      function calculerVariationEntrePeriodes() {
        var hasDedicatedPrev = state.prevSourceRows && state.prevSourceRows.length > 1;
        var hasPrevDateRangeOnArchive = !hasDedicatedPrev && (state.prevDateStart || state.prevDateEnd) && state.rawSourceRows && state.rawSourceRows.length > 1;
        if (!hasDedicatedPrev && !hasPrevDateRangeOnArchive) return [];

        var foodRecords = isMarketOnlyViewer() ? getStrictlyMarketRecords() : getStrictlyFoodRecords();
        if (!foodRecords || foodRecords.length === 0) return [];

        var sourcePrevAoa = hasDedicatedPrev ? state.prevSourceRows : state.rawSourceRows;
        var prevStatsMap = extraireDeliveredFoodParRestoDepuisAoa(sourcePrevAoa, state.prevDateStart, state.prevDateEnd);

        var idxCity = TARGET_HEADERS.indexOf('city');
        var idxArea = TARGET_HEADERS.indexOf('Area');
        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxOrderId = TARGET_HEADERS.indexOf('order id');
        var idxOrderDay = TARGET_HEADERS.indexOf('order day');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxGmv = TARGET_HEADERS.indexOf('Total Food VF');
        var idxComm = TARGET_HEADERS.indexOf('CA');
        var idxCommCa = TARGET_HEADERS.indexOf('commission ca');

        // Calculer le nombre de jours de la période actuelle et le pic maximal historique par restaurant
        var periodDaysSet = new Set();
        var activeDaysByResto = new Map();
        foodRecords.forEach(function (rec) {
          var c = rec.cells;
          var iso = parseOrderDayToIsoDate(c[idxOrderDay]);
          if (iso) periodDaysSet.add(iso);
        });
        var periodDaysCount = Math.max(1, periodDaysSet.size);

        // Pic maximal historique (Maximal Gap vs Now) calculé sur l'archive complète par fenêtre équivalente
        var maxHistDelivByResto = new Map();
        if (state.rawSourceRows && state.rawSourceRows.length > 1) {
          var allHdrs = state.rawSourceRows[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
          var aIdxResto = allHdrs.indexOf('restaurant name');
          var aIdxStatus = allHdrs.indexOf('status');
          var aIdxDay = allHdrs.indexOf('order day') !== -1 ? allHdrs.indexOf('order day') : allHdrs.indexOf('delivered day');
          var aIdxOid = allHdrs.indexOf('order id');
          if (aIdxResto !== -1 && aIdxStatus !== -1 && aIdxDay !== -1) {
            var dailyRestoDeliv = new Map();
            var allSortedDaysSet = new Set();
            for (var ar = 1; ar < state.rawSourceRows.length; ar++) {
              var aRow = state.rawSourceRows[ar];
              if (!aRow) continue;
              if (aIdxOid !== -1 && !estOrderIdYaf(aRow[aIdxOid])) continue;
              if (!estCommandeLivree(aRow[aIdxStatus])) continue;
              var rk = String(aRow[aIdxResto] || '').trim().toLowerCase();
              var dIso = parseOrderDayToIsoDate(aRow[aIdxDay]);
              if (!rk || !dIso) continue;
              allSortedDaysSet.add(dIso);
              if (!dailyRestoDeliv.has(rk)) dailyRestoDeliv.set(rk, new Map());
              var rDayMap = dailyRestoDeliv.get(rk);
              rDayMap.set(dIso, (rDayMap.get(dIso) || 0) + 1);
            }
            var sortedDays = Array.from(allSortedDaysSet).sort();
            var winLen = Math.min(periodDaysCount, sortedDays.length);
            dailyRestoDeliv.forEach(function (rDayMap, rk) {
              var bestWinSum = 0;
              if (winLen <= 1) {
                rDayMap.forEach(function (cnt) { if (cnt > bestWinSum) bestWinSum = cnt; });
              } else {
                for (var s = 0; s <= sortedDays.length - winLen; s++) {
                  var wSum = 0;
                  for (var k = 0; k < winLen; k++) {
                    wSum += (rDayMap.get(sortedDays[s + k]) || 0);
                  }
                  if (wSum > bestWinSum) bestWinSum = wSum;
                }
              }
              maxHistDelivByResto.set(rk, bestWinSum);
            });
          }
        }

        var aggMap = new Map();
        var globalDeliveredTotal = 0;
        var globalGmvTotal = 0;

        foodRecords.forEach(function (rec) {
          var c = rec.cells;
          var rawResto = String(c[idxResto] || '').trim();
          var rKey = rawResto.toLowerCase();
          if (!rKey) return;

          var cfg = state.amPortfolios[rKey];
          var cityVal = (idxCity !== -1 ? String(c[idxCity] || '').trim() : '') ||
                        String(c[idxArea] || '').trim() ||
                        (cfg && cfg.ville ? cfg.ville : '');
          var displayResto = cfg ? cfg.displayName : rawResto;
          var segVal = (cfg && cfg.segment) ? cfg.segment : 'Long Tail';

          if (!aggMap.has(rKey)) {
            aggMap.set(rKey, {
              key: rKey,
              partenaire: displayResto,
              city: cityVal,
              segment: segVal,
              req: 0,
              deliv: 0,
              gmv: 0,
              comm: 0,
              commRateSum: 0,
              commRateCount: 0,
              activeDays: new Set()
            });
          }

          var entry = aggMap.get(rKey);
          if (!entry.city && cityVal) entry.city = cityVal;

          var ordIso = parseOrderDayToIsoDate(c[idxOrderDay]);
          if (String(c[idxOrderId] || '').trim().length > 0) {
            entry.req += 1;
            if (ordIso) entry.activeDays.add(ordIso);
          }

          if (estCommandeLivree(c[idxStatus])) {
            var gVal = purgerNombre(c[idxGmv]);
            var caVal = purgerNombre(c[idxComm]);
            entry.deliv += 1;
            entry.gmv += gVal;
            entry.comm += caVal;
            globalDeliveredTotal += 1;
            globalGmvTotal += gVal;
            if (idxCommCa !== -1 && purgerNombre(c[idxCommCa]) > 0) {
              entry.commRateSum += purgerNombre(c[idxCommCa]);
              entry.commRateCount += 1;
            }
          }
        });

        var maxGmvInPeriod = 0;
        var maxDelivInPeriod = 0;
        var maxMsGmvInPeriod = 0;
        aggMap.forEach(function (e) {
          if (e.gmv > maxGmvInPeriod) maxGmvInPeriod = e.gmv;
          if (e.deliv > maxDelivInPeriod) maxDelivInPeriod = e.deliv;
          var msG = globalGmvTotal > 0 ? (e.gmv / globalGmvTotal) : 0;
          if (msG > maxMsGmvInPeriod) maxMsGmvInPeriod = msG;
        });

        var rows = [];
        aggMap.forEach(function (entry) {
          var pObj = prevStatsMap.get(entry.key) || { deliv: 0, gmv: 0, ca: 0 };
          var prevDeliv = pObj.deliv;
          var variation = entry.deliv - prevDeliv;
          var growthPct = prevDeliv > 0 ? ((variation / prevDeliv) * 100) : (entry.deliv > 0 ? 100 : 0);

          var histPeak = Math.max(entry.deliv, prevDeliv, maxHistDelivByResto.get(entry.key) || 0);
          var maxGapVsNow = Math.max(0, histPeak - entry.deliv);
          var maxGapPct = entry.deliv > 0 ? ((maxGapVsNow / entry.deliv) * 100) : (maxGapVsNow > 0 ? 100 : 0);

          var avgDay = entry.deliv / periodDaysCount;
          var successRateNet = entry.req > 0 ? ((entry.deliv / entry.req) * 100) : 0;
          var aov = entry.deliv > 0 ? (entry.gmv / entry.deliv) : 0;
          var msOrder = globalDeliveredTotal > 0 ? ((entry.deliv / globalDeliveredTotal) * 100) : 0;
          var msGmv = globalGmvTotal > 0 ? ((entry.gmv / globalGmvTotal) * 100) : 0;

          // Activation : offres récupérées directement depuis le fichier Offre Participation
          var restoNormKey = normalizeText(entry.partenaire);
          var matchingOffers = (state.offreParticipationRules || []).filter(function (rl) {
            if (!rl) return false;
            var rk1 = (rl.restaurant || '').trim().toLowerCase();
            var rk2 = rl.restaurantNorm || normalizeText(rk1);
            if (rk1 !== entry.key && rk2 !== restoNormKey) return false;
            if (state.dateStart && rl.endDate && rl.endDate < state.dateStart) return false;
            if (state.dateEnd && rl.startDate && rl.startDate > state.dateEnd) return false;
            return true;
          });
          var activationLabel = matchingOffers.length > 0
            ? matchingOffers.map(function (of) {
                var baseLbl = of.details ? of.details : ((of.tag || 'Offre') + (of.cPct ? (' ' + of.cPct + '%') : ''));
                // partPct = points du taux pris en charge par la plateforme (0 = le restaurant prend toute l'offre).
                var partLbl = ' [Part. plateforme ' + Number(of.partPct || 0) + '%]';
                return baseLbl + partLbl;
              }).join(' + ')
            : 'Aucune offre';

          var tier = entry.deliv >= 80 ? 'Tier 1' : (entry.deliv >= 25 ? 'Tier 2' : 'Tier 3');

          // Répartition exacte des scores : 30 | 25 | 15 | 10 | 10 | 10 (Total = 100)
          var scoreGmv = maxGmvInPeriod > 0 ? Math.min(30, (entry.gmv / maxGmvInPeriod) * 30) : 0;
          var scoreCommandes = maxDelivInPeriod > 0 ? Math.min(25, (entry.deliv / maxDelivInPeriod) * 25) : 0;
          var msGmvRatio = globalGmvTotal > 0 ? (entry.gmv / globalGmvTotal) : 0;
          var scoreMsGmv = maxMsGmvInPeriod > 0 ? Math.min(15, (msGmvRatio / maxMsGmvInPeriod) * 15) : 0;
          var scoreSuccess = Math.min(10, Math.max(0, (successRateNet / 100) * 10));
          var scoreCroissance = prevDeliv > 0
            ? Math.min(10, Math.max(0, 5 + (growthPct * 0.05)))
            : (entry.deliv > 0 ? 7.5 : 0);
          var scoreStrategique = entry.segment === 'Top Performer' ? 10
            : (entry.segment === 'High Potentiel' ? 8.5
            : (entry.segment === 'New' ? 7.5
            : (entry.segment === 'Long Tail' ? 6 : 4)));

          var scoreTotal = scoreGmv + scoreCommandes + scoreMsGmv + scoreSuccess + scoreCroissance + scoreStrategique;

          // Statut partenaire & Action recommandée
          var statutPartenaire = 'Stable';
          var actionRecommandee = 'Maintenir accompagnement & visibilité';
          if (entry.deliv === 0 && entry.req === 0) {
            statutPartenaire = 'Inactif';
            actionRecommandee = 'Réactiver store & vérifier ouverture tablette';
          } else if (successRateNet < 80 && entry.req >= 5) {
            statutPartenaire = 'À optimiser (Ops)';
            actionRecommandee = 'Réduire rejets/annulations pour monter le Success Rate à 92%';
          } else if (growthPct >= 15 && variation >= 5) {
            statutPartenaire = 'En forte croissance';
            actionRecommandee = 'Capitaliser : mise en avant & campagne promo ciblée';
          } else if (growthPct <= -15 && variation <= -5) {
            statutPartenaire = 'En baisse (Drop)';
            actionRecommandee = 'Plan de relance immédiat & offre commerciale';
          } else if (scoreTotal >= 65) {
            statutPartenaire = 'Partenaire Clé';
            actionRecommandee = 'Sécuriser exclusivité & co-financement promo';
          }

          // Potentiels (Capacité, Exécution, Réaliste Success Rate, Ambitieux, GMV & CA potentiels)
          var cmdJourGap = maxGapVsNow / periodDaysCount;
          var potCapacite = Math.round(maxGapVsNow);
          var potExecution = Math.max(0, Math.round(entry.req - entry.deliv));
          var targetSuccessRate = Math.max(successRateNet, 95);
          var potRealiste = Math.max(entry.deliv, Math.round(entry.req * (targetSuccessRate / 100)));
          var gmvPotRealiste = potRealiste * aov;
          var ecartGmvPot = Math.max(0, gmvPotRealiste - entry.gmv);

          var potAmbitieux = Math.max(potRealiste, Math.round(histPeak * 1.15), Math.round(entry.deliv * 1.20));
          var gmvPotAmbitieux = potAmbitieux * aov;

          var avgCommRate = Object.prototype.hasOwnProperty.call(state.customCommissions, entry.key)
            ? state.customCommissions[entry.key]
            : (entry.commRateCount > 0
              ? (entry.commRateSum / entry.commRateCount)
              : (entry.gmv > 0 ? ((entry.comm / entry.gmv) * 100) : 20));

          var caPotentiel = (gmvPotAmbitieux * avgCommRate) / 100;
          var ecartCaPotentiel = Math.max(0, caPotentiel - entry.comm);

          rows.push({
            partenaire: entry.partenaire,
            city: entry.city || '-',
            segment: entry.segment,
            tier: tier,
            req: entry.req,
            deliv: entry.deliv,
            maxGapVsNow: Number(maxGapVsNow.toFixed(0)),
            maxGapPct: Number(maxGapPct.toFixed(1)),
            avgDay: Number(avgDay.toFixed(2)),
            gmv: Number(entry.gmv.toFixed(2)),
            successRateNet: Number(successRateNet.toFixed(2)),
            previous: prevDeliv,
            variation: variation,
            growthPct: Number(growthPct.toFixed(2)),
            hasPrev: prevDeliv > 0,
            aov: Number(aov.toFixed(2)),
            msOrder: Number(msOrder.toFixed(2)),
            msGmv: Number(msGmv.toFixed(2)),
            activation: activationLabel,
            scoreGmv: Number(scoreGmv.toFixed(1)),
            scoreCommandes: Number(scoreCommandes.toFixed(1)),
            scoreMsGmv: Number(scoreMsGmv.toFixed(1)),
            scoreSuccess: Number(scoreSuccess.toFixed(1)),
            scoreCroissance: Number(scoreCroissance.toFixed(1)),
            scoreStrategique: Number(scoreStrategique.toFixed(1)),
            scoreTotal: Number(scoreTotal.toFixed(1)),
            statutPartenaire: statutPartenaire,
            actionRecommandee: actionRecommandee,
            gmvActuel: Number(entry.gmv.toFixed(2)),
            cmdActuelles: entry.deliv,
            cmdJourGap: Number(cmdJourGap.toFixed(2)),
            potCapacite: potCapacite,
            potExecution: potExecution,
            potRealiste: potRealiste,
            gmvPotRealiste: Number(gmvPotRealiste.toFixed(2)),
            ecartGmvPot: Number(ecartGmvPot.toFixed(2)),
            potAmbitieux: potAmbitieux,
            gmvPotAmbitieux: Number(gmvPotAmbitieux.toFixed(2)),
            caPotentiel: Number(caPotentiel.toFixed(2)),
            ecartCaPotentiel: Number(ecartCaPotentiel.toFixed(2))
          });
        });

        rows.sort(function (a, b) {
          return (b.scoreTotal - a.scoreTotal) || (b.deliv - a.deliv) || a.partenaire.localeCompare(b.partenaire, 'fr');
        });

        return rows;
      }

      window.yassirRenderVariationTable = function () {
        var tbody = document.getElementById('synthVariationTableBody');
        if (!tbody) return;
        var qEl = document.getElementById('searchVariationRestoInput');
        var q = qEl ? qEl.value.trim().toLowerCase() : '';
        var tierEl = document.getElementById('filterVariationTierSelect');
        var tierFilter = tierEl ? tierEl.value : 'ALL';

        var filtered = currentVariationRowsList.filter(function (r) {
          if (tierFilter !== 'ALL' && r.tier !== tierFilter) return false;
          if (!q) return true;
          return r.partenaire.toLowerCase().includes(q) ||
                 (r.city && r.city.toLowerCase().includes(q)) ||
                 (r.segment && r.segment.toLowerCase().includes(q)) ||
                 (r.statutPartenaire && r.statutPartenaire.toLowerCase().includes(q));
        });

        // Modes de tri Kool (slides 35-36 du deck) ; Yassir reste trié par score composite.
        var isKoolBrand = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        var sortMode = isKoolBrand ? variationSortMode : 'score';
        var subEl = document.getElementById('synthVariationSubDesc');
        if (sortMode === 'top20') {
          filtered.sort(function (a, b) { return (b.deliv - a.deliv) || a.partenaire.localeCompare(b.partenaire, 'fr'); });
          filtered = filtered.slice(0, 20);
          if (subEl) subEl.textContent = 'Top 20 — trié par commandes livrées décroissantes • Période précédente via « Data préc »';
        } else if (sortMode === 'growth') {
          filtered = filtered.filter(function (r) { return r.hasPrev; });
          filtered.sort(function (a, b) { return (b.growthPct - a.growthPct) || (b.deliv - a.deliv); });
          filtered = filtered.slice(0, 20);
          if (subEl) subEl.textContent = 'Top Growth — trié par croissance % vs période précédente • Restaurants avec une période précédente uniquement';
        } else if (isKoolBrand && subEl) {
          subEl.textContent = 'Commandes Food VF uniquement • Trié par score composite';
        }

        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="39" class="px-4 py-8 text-center text-slate-400">Aucun partenaire trouvé.</td></tr>';
          return;
        }

        tbody.innerHTML = filtered.map(function (r) {
          var varColor = r.variation > 0 ? 'text-[#00897B] font-extrabold' : (r.variation < 0 ? 'text-[#FF2A6D] font-extrabold' : 'text-slate-600');
          var growthStr = r.hasPrev ? (r.growthPct.toFixed(2) + '%') : (r.deliv > 0 ? 'New' : '0.00%');
          var tierBadgeClass = r.tier === 'Tier 1'
            ? 'bg-emerald-400 text-[#1A1A2E] font-extrabold'
            : (r.tier === 'Tier 2' ? 'bg-amber-300 text-[#1A1A2E] font-bold' : 'bg-orange-200 text-orange-900 font-semibold');
          var scoreBadgeClass = r.scoreTotal >= 70
            ? 'bg-emerald-100 text-emerald-900 font-extrabold'
            : (r.scoreTotal >= 45 ? 'bg-amber-100 text-amber-900 font-bold' : 'bg-rose-100 text-rose-900 font-bold');

          return '<tr class="hover:bg-[#F3EBFF]/35">' +
            '<td class="px-3 py-1.5 text-left border border-slate-200 font-bold text-[#1A1A2E] whitespace-nowrap">' + escapeHtml(r.partenaire) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 text-slate-700 whitespace-nowrap">' + escapeHtml(r.city) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 text-slate-600 whitespace-nowrap">' + escapeHtml(r.segment) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 whitespace-nowrap ' + tierBadgeClass + '">' + escapeHtml(r.tier) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.req + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono font-extrabold">' + r.deliv + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono text-indigo-700 font-bold">' + r.maxGapVsNow + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono text-indigo-700">' + r.maxGapPct.toFixed(1) + '%</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.avgDay.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.gmv.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.successRateNet.toFixed(2) + '%</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.previous + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono ' + varColor + '">' + (r.variation > 0 ? '+' + r.variation : r.variation) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono ' + varColor + '">' + growthStr + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.aov.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.msOrder.toFixed(2) + '%</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-slate-200 font-mono">' + r.msGmv.toFixed(2) + '%</td>' +
            '<td class="px-3 py-1.5 text-left border border-slate-200 font-semibold whitespace-nowrap ' + (r.activation !== 'Aucune offre' ? 'text-[#6C2BD9] bg-purple-50/50' : 'text-slate-400') + '">' + escapeHtml(r.activation) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-indigo-200 bg-indigo-50/50 font-mono">' + r.scoreGmv.toFixed(1) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-indigo-200 bg-indigo-50/50 font-mono">' + r.scoreCommandes.toFixed(1) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-indigo-200 bg-indigo-50/50 font-mono">' + r.scoreMsGmv.toFixed(1) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-indigo-200 bg-indigo-50/50 font-mono">' + r.scoreSuccess.toFixed(1) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-indigo-200 bg-indigo-50/50 font-mono">' + r.scoreCroissance.toFixed(1) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-indigo-200 bg-indigo-50/50 font-mono">' + r.scoreStrategique.toFixed(1) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-indigo-300 font-mono ' + scoreBadgeClass + '">' + r.scoreTotal.toFixed(1) + '</td>' +
            '<td class="px-3 py-1.5 text-center border border-amber-200 bg-amber-50/70 font-bold text-[#1A1A2E] whitespace-nowrap">' + escapeHtml(r.statutPartenaire) + '</td>' +
            '<td class="px-3 py-1.5 text-left border border-amber-200 bg-amber-50/70 font-medium text-[#6C2BD9] whitespace-nowrap">' + escapeHtml(r.actionRecommandee) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono">' + r.gmvActuel.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono">' + r.cmdActuelles + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono">' + r.cmdJourGap.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono font-bold text-teal-800">' + r.potCapacite + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono font-bold text-teal-800">' + r.potExecution + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono font-bold text-teal-900">' + r.potRealiste + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono">' + r.gmvPotRealiste.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-teal-200 bg-teal-50/40 font-mono text-[#00897B] font-bold">+' + r.ecartGmvPot.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-pink-200 bg-pink-50/40 font-mono font-bold text-[#FF1E6E]">' + r.potAmbitieux + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-pink-200 bg-pink-50/40 font-mono">' + r.gmvPotAmbitieux.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-pink-200 bg-pink-50/40 font-mono font-bold text-[#6C2BD9]">' + r.caPotentiel.toFixed(2) + '</td>' +
            '<td class="px-2.5 py-1.5 text-center border border-pink-200 bg-pink-50/40 font-mono font-extrabold text-[#00897B]">+' + r.ecartCaPotentiel.toFixed(2) + '</td>' +
          '</tr>';
        }).join('');
      };

      window.yassirExportVariationExcel = function () {
        if (!canSeeGlobalSynth() || currentVariationRowsList.length === 0) return;
        var headers = [
          'Partenaires', 'City', 'Segment', 'Tier', 'Requested', 'Delivered',
          'Maximal Gap vs Now', 'Maximal Gap %', 'AVG/Day', 'GMV', 'Success Rate Net',
          'Previous', 'Variation', 'Growth/Drop %', 'AOV', 'Market Share Order', 'Market Share GMV', 'Activation',
          'Score GMV', 'Score commandes', 'Score part de marché GMV', 'Score taux de succès',
          'Score croissance', 'Score stratégique', 'Score total',
          'Statut partenaire', 'Action recommandée',
          'GMV actuel', 'Commandes actuelles', 'Commandes/jour Gap',
          'Potentiel de capacité (commandes)', "Potentiel d'exécution (commandes)",
          'Potentiel réaliste (Amélioration Success Rate)', 'GMV potentiel réaliste', 'Écart de GMV potentiel',
          'Potentiel ambitieux (commandes)', 'GMV potentiel ambitieux', 'CA potentiel', 'Écart de CA potentiel'
        ];
        var aoa = [headers];
        currentVariationRowsList.forEach(function (r) {
          aoa.push([
            r.partenaire, r.city, r.segment, r.tier, r.req, r.deliv,
            r.maxGapVsNow, r.maxGapPct + '%', r.avgDay, r.gmv, r.successRateNet + '%',
            r.previous, r.variation, r.hasPrev ? (r.growthPct + '%') : 'New', r.aov,
            r.msOrder + '%', r.msGmv + '%', r.activation,
            r.scoreGmv, r.scoreCommandes, r.scoreMsGmv, r.scoreSuccess,
            r.scoreCroissance, r.scoreStrategique, r.scoreTotal,
            r.statutPartenaire, r.actionRecommandee,
            r.gmvActuel, r.cmdActuelles, r.cmdJourGap,
            r.potCapacite, r.potExecution, r.potRealiste, r.gmvPotRealiste, r.ecartGmvPot,
            r.potAmbitieux, r.gmvPotAmbitieux, r.caPotentiel, r.ecartCaPotentiel
          ]);
        });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = headers.map(function (h) { return { wch: Math.max(14, h.length + 3) }; });
        XLSX.utils.book_append_sheet(wb, ws, 'Variation & Potentiel');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Variation_Potentiel_' + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : YASSIR_Variation_Potentiel_' + dateStr + '.xlsx');
        showToast('Tableau de variation & potentiel complet téléchargé en Excel (.xlsx).', 'success');
      };
