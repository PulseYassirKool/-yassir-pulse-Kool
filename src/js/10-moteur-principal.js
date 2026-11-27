      /* ========================================================================
         G. MOTEUR PRINCIPAL : GÉNÉRATION DES 109 COLONNES + DOUBLE FILTRAGE
         ======================================================================== */
      function getFullPeriodCacheKey() {
        var b = (typeof currentBrand !== 'undefined' ? currentBrand : 'yassir');
        var roleKey = isMarketOnlyViewer() ? 'MKT' : (isFoodOnlyAm() ? 'FOOD' : 'ALL');
        var amCount = Object.keys(state.amPortfolios || {}).length;
        var commCount = Object.keys(state.customCommissions || {}).length;
        var offCount = (state.offreParticipationRules || []).length;
        return b + '|' + roleKey + '|' + amCount + '|' + commCount + '|' + offCount;
      }

      function executerTraitementMetier() {
        mettreAJourBarreDatesEtFichiers();
        var rawAoa = state.rawSourceRows;
        if (!rawAoa || rawAoa.length < 2) {
          state.marketRows = [];
          state.foodRows = [];
          state.offresRows = [];
          state.statRows = [];
          // Correctif 4 (2026-11-27, KPI figés) : comme le chemin normal et
          // le repli « toute la période », on invalide le cache des stats —
          // sinon mettreAJourInterface relit les stats mises en cache
          // (le global) au lieu de recalculer sur des lignes vides.
          state._calcRevision = (state._calcRevision || 0) + 1;
          _amStatsCache.clear();
          _notifCacheSig = '';
          mettreAJourInterface();
          return;
        }

        var idxCache = getOrBuildSourceIndex(rawAoa);
        var isFullPeriod = !state.dateStart && !state.dateEnd;
        var fullKey = getFullPeriodCacheKey();
        if (isFullPeriod && idxCache.fullCacheKey === fullKey) {
          state.marketRows = idxCache.fullMarketRows;
          state.foodRows = idxCache.fullFoodRows;
          state.offresRows = idxCache.fullOffresRows;
          state.statRows = idxCache.fullStatRows;
          state.currentPage = 1;
          state._calcRevision = (state._calcRevision || 0) + 1;
          _amStatsCache.clear();
          _notifCacheSig = '';
          syncLmdSidebarActiveState(state.activeTab);
          mettreAJourInterface();
          return;
        }

        var sourceData = obtenirSourceAoaFiltreeParDate();
        if (!sourceData || sourceData.length < 2) {
          state.marketRows = [];
          state.foodRows = [];
          state.offresRows = [];
          state.statRows = [];
          // Correctif 4 (2026-11-27, KPI figés) : une période sans commande
          // (ex. une semaine 2027 choisie par erreur) vidait les lignes mais
          // laissait le cache des stats intact — les cartes affichaient
          // l'ancien global au lieu de 0. On invalide comme partout ailleurs.
          state._calcRevision = (state._calcRevision || 0) + 1;
          _amStatsCache.clear();
          _notifCacheSig = '';
          mettreAJourInterface();
          return;
        }

        var sourceHeaders = sourceData[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim() : ''; });
        var sourceHeadersLower = sourceHeaders.map(function (h) { return h.toLowerCase(); });
        var sourceHeadersClean = sourceHeaders.map(function (h) { return h.toLowerCase().replace(/[_\s]+/g, ' ').trim(); });
        var colMapping = idxCache.colMapping;
        if (!colMapping) {
          colMapping = {};
          for (var i = 0; i < TARGET_HEADERS.length; i++) {
            var th = TARGET_HEADERS[i];
            var thClean = th.toLowerCase().replace(/[_\s]+/g, ' ').trim();
            var exactIdx = sourceHeaders.indexOf(th);
            if (exactIdx !== -1) {
              colMapping[th] = exactIdx;
            } else {
              var lowIdx = sourceHeadersLower.indexOf(th.toLowerCase());
              colMapping[th] = lowIdx !== -1 ? lowIdx : sourceHeadersClean.indexOf(thClean);
            }
          }
        // Auto-calibration en UN SEUL PASSAGE sur les colonnes candidates de Data exp
        var tmpStatusIdx = sourceHeadersClean.indexOf('status');
        var tmpSrvIdx = sourceHeadersClean.indexOf('services');
        var tmpRestoIdx = sourceHeadersClean.indexOf('restaurant name');

        var totalFoodCandidates = [];
        var itemTotCandidates = [];
        var fallbackItemCandidates = [];
        var origDelivCandidates = [];
        var delivAmtCandidates = [];
        var candidateColSet = new Set();

        for (var ci = 0; ci < sourceHeadersClean.length; ci++) {
          var hc = sourceHeadersClean[ci];
          if (hc === 'total food') {
            totalFoodCandidates.push(ci);
            candidateColSet.add(ci);
          } else if (hc === 'item total' || hc === 'sub total' || hc === 'subtotal' || hc === 'item total before discount' || hc === 'gross item total' || hc === 'order subtotal' || hc === 'items total' || hc === 'total items') {
            itemTotCandidates.push(ci);
            candidateColSet.add(ci);
          } else if (/^original\s*delivery\s*amount([._\s]*\d+)?$/i.test(hc)) {
            origDelivCandidates.push(ci);
            candidateColSet.add(ci);
          } else if (/^delivery\s*amount([._\s]*\d+)?$/i.test(hc)) {
            delivAmtCandidates.push(ci);
            candidateColSet.add(ci);
          } else if (/item|sub/i.test(hc) && !/food|delivery|driver|payout|earning|commission|tax|discount|coupon|distance|time/i.test(hc)) {
            // Correctif 2026-11-27 (bug CA/GMV : la calibration choisissait
            // « Primary Paid Amount » comme « item total ») : le repli ne doit
            // porter que sur des colonnes qui parlent d'ARTICLES ou de
            // SOUS-TOTAL (« item total charged », « subtotal », …). Les colonnes
            // « Primary Paid Amount », « amount to restaurant », « Payable
            // Amount », « order day », « order id » ne sont pas un total
            // d'articles : les accepter faussait la base BRUT de la
            // participation (part plateforme) et certains KPI.
            fallbackItemCandidates.push(ci);
            candidateColSet.add(ci);
          }
        }

        var candidateColsArr = Array.from(candidateColSet);
        var candidateSums = new Float64Array(sourceHeadersClean.length);
        if (candidateColsArr.length > 0 && !(typeof currentBrand !== 'undefined' && currentBrand === 'kool')) {
          var stepCalib = sourceData.length > 8000 ? 2 : 1;
          for (var sr = 1; sr < sourceData.length; sr += stepCalib) {
            var rowCal = sourceData[sr];
            if (!rowCal) continue;
            if (tmpStatusIdx !== -1 && !estCommandeLivree(rowCal[tmpStatusIdx])) continue;
            var srvCal = tmpSrvIdx !== -1 ? String(rowCal[tmpSrvIdx] || '').toLowerCase() : '';
            var rNmCal = tmpRestoIdx !== -1 ? String(rowCal[tmpRestoIdx] || '').toLowerCase() : '';
            if (srvCal.includes('market') || rNmCal.includes('mg market') || rNmCal.includes('market')) continue;
            for (var cc = 0; cc < candidateColsArr.length; cc++) {
              var cIdx = candidateColsArr[cc];
              candidateSums[cIdx] += purgerNombre(rowCal[cIdx]);
            }
          }
        }

        if (totalFoodCandidates.length >= 1) {
          colMapping['Total Food'] = totalFoodCandidates[0];
          colMapping['Total Food.1'] = totalFoodCandidates.length >= 2 ? totalFoodCandidates[1] : totalFoodCandidates[0];
        }
        var refTotalFoodSum = colMapping['Total Food'] !== -1 ? candidateSums[colMapping['Total Food']] : 0;

        var bestItemIdx = itemTotCandidates.length >= 1 ? itemTotCandidates[0] : -1;
        var bestItemSum = bestItemIdx !== -1 ? candidateSums[bestItemIdx] : -1;
        for (var ic = 1; ic < itemTotCandidates.length; ic++) {
          var cSum = candidateSums[itemTotCandidates[ic]];
          if (cSum > bestItemSum) {
            bestItemSum = cSum;
            bestItemIdx = itemTotCandidates[ic];
          }
        }
        if (refTotalFoodSum > 0 && bestItemSum < refTotalFoodSum) {
          for (var fi = 0; fi < fallbackItemCandidates.length; fi++) {
            var sVal = candidateSums[fallbackItemCandidates[fi]];
            if (sVal > refTotalFoodSum * 1.10 && sVal < refTotalFoodSum * 1.50) {
              bestItemIdx = fallbackItemCandidates[fi];
              bestItemSum = sVal;
              break;
            }
          }
        }
        if (bestItemIdx !== -1) {
          colMapping['item total'] = bestItemIdx;
        }

        if (origDelivCandidates.length > 0) {
          var bestOrigD = origDelivCandidates[0];
          var maxOrigDSum = candidateSums[bestOrigD];
          for (var od = 1; od < origDelivCandidates.length; od++) {
            var sOd = candidateSums[origDelivCandidates[od]];
            if (sOd >= maxOrigDSum) { maxOrigDSum = sOd; bestOrigD = origDelivCandidates[od]; }
          }
          colMapping['original delivery amount'] = bestOrigD;
        }
        if (delivAmtCandidates.length > 0) {
          var bestDelivA = delivAmtCandidates[0];
          var maxDelivASum = candidateSums[bestDelivA];
          for (var da = 1; da < delivAmtCandidates.length; da++) {
            var sDa = candidateSums[delivAmtCandidates[da]];
            if (sDa >= maxDelivASum) { maxDelivASum = sDa; bestDelivA = delivAmtCandidates[da]; }
          }
          colMapping['delivery amount'] = bestDelivA;
        }

        // 4. Coupons & Discounts pour Total Food VF (= 190351.6) et CA Yassir (= 38083.0)
        var lastCouponAdminIdx = sourceHeadersClean.lastIndexOf('coupon admin');
        if (lastCouponAdminIdx !== -1) colMapping['coupon admin'] = lastCouponAdminIdx;
        var lastCouponRestoIdx = sourceHeadersClean.lastIndexOf('coupon restaurant');
        if (lastCouponRestoIdx !== -1) colMapping['coupon restaurant'] = lastCouponRestoIdx;
        var lastCouponDiscIdx = sourceHeadersClean.lastIndexOf('coupon discount');
        if (lastCouponDiscIdx !== -1) colMapping['coupon discount'] = lastCouponDiscIdx;
        var lastDiscAmtIdx = sourceHeadersClean.lastIndexOf('discount amount');
        if (lastDiscAmtIdx !== -1) colMapping['Discount Amount'] = lastDiscAmtIdx;
        var lastProviderIdx = sourceHeadersClean.lastIndexOf('discount type provider');
        if (lastProviderIdx !== -1) colMapping['Discount Type Provider'] = lastProviderIdx;

        // Garantir que 'Discount Type' (offre, col CA) pointe bien sur la dernière occurrence de 'discount type'
        var lastDiscTypeIdx = sourceHeadersClean.lastIndexOf('discount type');
        if (lastDiscTypeIdx !== -1) {
          colMapping['Discount Type'] = lastDiscTypeIdx;
        }
        var firstDiscTypeIdx = sourceHeadersClean.indexOf('discount type');
        if (firstDiscTypeIdx !== -1 && firstDiscTypeIdx !== lastDiscTypeIdx) {
          colMapping['discount type'] = firstDiscTypeIdx;
        }
        idxCache.colMapping = colMapping;
        }

        var idxRestaurantName = colMapping['restaurant name'] !== -1
          ? colMapping['restaurant name']
          : sourceHeaders.findIndex(function (h) { return h.toLowerCase() === 'restaurant name'; });
        var idxCommercial = colMapping['commercial'] !== -1
          ? colMapping['commercial']
          : sourceHeaders.findIndex(function (h) { return h.toLowerCase() === 'commercial'; });
        var idxTotalFood = colMapping['Total Food'];
        var idxCouponDiscount = colMapping['coupon discount'];
        var idxDiscountAmount = colMapping['Discount Amount'];
        var idxProvider = colMapping['Discount Type Provider'];
        var idxAmountToRestaurant = colMapping['amount to restaurant'];
        var idxCouponAdmin = colMapping['coupon admin'];
        var idxCouponRestaurant = colMapping['coupon restaurant'];
        var idxOriginalDeliveryAmount = colMapping['original delivery amount'];
        var idxDeliveryAmount = colMapping['delivery amount'];
        var idxOrderTime = colMapping['order time'];
        var idxExistingTotalFoodVF = colMapping['Total Food VF'];
        var idxExistingCA = colMapping['CA'];
        var idxExistingAPayerReduits = colMapping['à payer réduits'];

        var idxAcceptedAtRaw = sourceHeaders.indexOf('Accepted at');
        var idxAcceptedAt = idxAcceptedAtRaw !== -1
          ? idxAcceptedAtRaw
          : (colMapping['Accepted Time'] !== -1 ? colMapping['Accepted Time'] : colMapping['Accepted']);

        var idxDriverAssignedTime = colMapping['driver assigned time'];
        var idxPickedUpTime = colMapping['picked up time'];
        var idxCR = colMapping['cancellation reason'];
        var idxServices = colMapping['services'] !== -1
          ? colMapping['services']
          : sourceHeaders.findIndex(function (h) { return h.toLowerCase() === 'services'; });

        var outIdx_tpAccep = TARGET_HEADERS.indexOf("tp d'accep");
        var outIdx_tpAssig = TARGET_HEADERS.indexOf("tp d'assig");
        var outIdx_tpPrepar = TARGET_HEADERS.indexOf('tp de prepar');
        var outIdx_aPayerReduits = TARGET_HEADERS.indexOf('à payer réduits');
        var outIdx_caResto = TARGET_HEADERS.indexOf("chiffre d'affaire restaurant");
        var outIdx_totalFoodVF = TARGET_HEADERS.indexOf('Total Food VF');
        var outIdx_CA = TARGET_HEADERS.indexOf('CA');
        var outIdx_commCa = TARGET_HEADERS.indexOf('commission ca');
        var outIdx_crVF = TARGET_HEADERS.indexOf('cancellation reason VF');

        // Pré-calculer les tables de correspondance par colonne pour éviter les lookups Set.has() dans la boucle
        var colIsComputed = new Uint8Array(TARGET_HEADERS.length);
        var colIsNumeric = new Uint8Array(TARGET_HEADERS.length);
        var colIsDate = new Uint8Array(TARGET_HEADERS.length);
        var colIsTime = new Uint8Array(TARGET_HEADERS.length);
        var colSrcIdxArr = new Int32Array(TARGET_HEADERS.length);
        for (var ch = 0; ch < TARGET_HEADERS.length; ch++) {
          var hName = TARGET_HEADERS[ch];
          colIsComputed[ch] = COMPUTED_COLS.has(hName) ? 1 : 0;
          colIsNumeric[ch] = NUMERIC_COLS.has(hName) ? 1 : 0;
          colIsDate[ch] = DATE_COLS.has(hName) ? 1 : 0;
          colIsTime[ch] = TIME_FORMAT_COLS.has(hName) ? 1 : 0;
          colSrcIdxArr[ch] = colMapping[hName] !== undefined ? colMapping[hName] : -1;
        }
        var amLookupCache = new Map();

        var marketRows = [];
        var foodRows = [];

        var idxOrderIdSrc = colMapping['order id'] !== -1
          ? colMapping['order id']
          : sourceHeaders.findIndex(function (h) { return h.toLowerCase() === 'order id'; });

        for (var r = 1; r < sourceData.length; r++) {
          var sourceRow = sourceData[r];
          if (!sourceRow || sourceRow.every(function (cell) { return cell === null || cell === undefined || String(cell).trim() === ''; })) {
            continue;
          }
          if (idxOrderIdSrc !== -1 && !estOrderIdYaf(sourceRow[idxOrderIdSrc])) {
            continue;
          }

          var targetRow = new Array(TARGET_HEADERS.length).fill('');

          var timeOrder = idxOrderTime !== -1 ? extraireObjetHeureNormalise(sourceRow[idxOrderTime]) : null;
          var timeAccepted = idxAcceptedAt !== -1 ? extraireObjetHeureNormalise(sourceRow[idxAcceptedAt]) : null;
          var timeAssigned = idxDriverAssignedTime !== -1 ? extraireObjetHeureNormalise(sourceRow[idxDriverAssignedTime]) : null;
          var timePicked = idxPickedUpTime !== -1 ? extraireObjetHeureNormalise(sourceRow[idxPickedUpTime]) : null;

          var tpAccep = calculerDifferenceTemps(timeAccepted, timeOrder);
          var tpAssig = calculerDifferenceTemps(timeAssigned, timeOrder);
          var tpPrepar = calculerDifferenceTemps(timePicked, timeAccepted);

          var rawRestName = idxRestaurantName !== -1 && sourceRow[idxRestaurantName] !== undefined && sourceRow[idxRestaurantName] !== null
            ? String(sourceRow[idxRestaurantName]).trim()
            : '';
          var currentRestName = rawRestName.toLowerCase();

          var rawCommCell = idxCommercial !== -1 && sourceRow[idxCommercial] !== undefined && sourceRow[idxCommercial] !== null
            ? String(sourceRow[idxCommercial]).trim()
            : '';

          var idxTotalFoodGross = colMapping['Total Food.1'] !== -1 ? colMapping['Total Food.1'] : idxTotalFood;
          var totalFood = idxTotalFood !== -1 ? purgerNombre(sourceRow[idxTotalFood]) : 0;
          var totalFoodGross = idxTotalFoodGross !== -1 ? purgerNombre(sourceRow[idxTotalFoodGross]) : totalFood;
          var couponDiscount = idxCouponDiscount !== -1 ? purgerNombre(sourceRow[idxCouponDiscount]) : 0;
          var discountAmount = idxDiscountAmount !== -1 ? purgerNombre(sourceRow[idxDiscountAmount]) : 0;
          var provider = idxProvider !== -1 && sourceRow[idxProvider] !== undefined && sourceRow[idxProvider] !== null
            ? String(sourceRow[idxProvider]).trim().toLowerCase()
            : '';
          var amountToRest = idxAmountToRestaurant !== -1 ? purgerNombre(sourceRow[idxAmountToRestaurant]) : 0;
          var couponAdmin = idxCouponAdmin !== -1 ? purgerNombre(sourceRow[idxCouponAdmin]) : 0;
          var couponRestaurant = idxCouponRestaurant !== -1 ? purgerNombre(sourceRow[idxCouponRestaurant]) : 0;
          var origDelivery = idxOriginalDeliveryAmount !== -1 ? purgerNombre(sourceRow[idxOriginalDeliveryAmount]) : 0;
          var deliveryAmt = idxDeliveryAmount !== -1 ? purgerNombre(sourceRow[idxDeliveryAmount]) : 0;

          var hasPrecomputedTotalFoodVF = idxExistingTotalFoodVF !== -1 && sourceRow[idxExistingTotalFoodVF] !== '' && sourceRow[idxExistingTotalFoodVF] !== null && sourceRow[idxExistingTotalFoodVF] !== undefined;
          var hasPrecomputedCA = idxExistingCA !== -1 && sourceRow[idxExistingCA] !== '' && sourceRow[idxExistingCA] !== null && sourceRow[idxExistingCA] !== undefined;
          var hasPrecomputedAPayerRed = idxExistingAPayerReduits !== -1 && sourceRow[idxExistingAPayerReduits] !== '' && sourceRow[idxExistingAPayerReduits] !== null && sourceRow[idxExistingAPayerReduits] !== undefined;

          var aPayerReduits = origDelivery - deliveryAmt;
          var effectiveCouponTotal = Math.max(couponAdmin + couponRestaurant, couponDiscount);
          var totalFoodVF = totalFood + effectiveCouponTotal;

          var idxExistingCaResto = colMapping["chiffre d'affaire restaurant"];
          var hasPrecomputedCaResto = idxExistingCaResto !== -1 && sourceRow[idxExistingCaResto] !== '' && sourceRow[idxExistingCaResto] !== null && sourceRow[idxExistingCaResto] !== undefined;
          var isKoolBrand = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
          var isAdminDisc = (provider === 'admin' || provider === 'yassir');
          var caRestaurant = isKoolBrand
            ? totalFood
            : (hasPrecomputedCaResto
                ? purgerNombre(sourceRow[idxExistingCaResto])
                : (totalFood + effectiveCouponTotal + (isAdminDisc ? discountAmount : 0)));
          if (isKoolBrand) {
            totalFoodVF = totalFood;
          }

          var currentRestNameNormSpace = currentRestName.replace(/\s+/g, ' ').trim();
          var idxExistingCommCa = colMapping['commission ca'];
          var hasPrecomputedCommCa = idxExistingCommCa !== -1 && sourceRow[idxExistingCommCa] !== '' && sourceRow[idxExistingCommCa] !== null && sourceRow[idxExistingCommCa] !== undefined;
          var commCa = 0;
          var caFinal = 0;
          if (hasPrecomputedCA && !isKoolBrand) {
            caFinal = purgerNombre(sourceRow[idxExistingCA]);
            commCa = hasPrecomputedCommCa ? purgerNombre(sourceRow[idxExistingCommCa]) : (totalFoodVF > 0 ? (caFinal / totalFoodVF) * 100 : 0);
          } else if (Object.prototype.hasOwnProperty.call(state.customCommissions, currentRestName)) {
            commCa = state.customCommissions[currentRestName];
            caFinal = (commCa * caRestaurant) / 100;
          } else if (Object.prototype.hasOwnProperty.call(state.customCommissions, currentRestNameNormSpace)) {
            commCa = state.customCommissions[currentRestNameNormSpace];
            caFinal = (commCa * caRestaurant) / 100;
          } else if (isKoolBrand) {
            // Si le restaurant Kool n'a pas de taux dans le fichier Commissions Kool, CA = 0 (et alerte dédiée au proprio)
            commCa = 0;
            caFinal = 0;
          } else {
            caFinal = caRestaurant - amountToRest;
            commCa = totalFoodVF > 0 ? (caFinal / totalFoodVF) * 100 : 0;
          }

          var targetLen = TARGET_HEADERS.length;
          var srcLen = sourceRow.length;
          for (var c = 0; c < targetLen; c++) {
            if (colIsComputed[c]) continue;
            var sIdx = colSrcIdxArr[c];
            if (sIdx !== -1 && sIdx < srcLen) {
              var valOriginale = sourceRow[sIdx];
              if (valOriginale === null || valOriginale === undefined || valOriginale === '') {
                targetRow[c] = '';
              } else if (colIsNumeric[c]) {
                targetRow[c] = Number(purgerNombre(valOriginale).toFixed(2));
              } else if (colIsDate[c]) {
                targetRow[c] = formaterDateAffichage(valOriginale);
              } else if (colIsTime[c]) {
                targetRow[c] = formaterHeureAffichage(valOriginale);
              } else {
                targetRow[c] = typeof valOriginale === 'string' ? valOriginale.trim() : String(valOriginale).trim();
              }
            }
          }

          targetRow[outIdx_tpAccep] = tpAccep;
          targetRow[outIdx_tpAssig] = tpAssig;
          targetRow[outIdx_tpPrepar] = tpPrepar;
          targetRow[outIdx_aPayerReduits] = Number(aPayerReduits.toFixed(2));
          targetRow[outIdx_caResto] = Number(caRestaurant.toFixed(2));
          targetRow[outIdx_totalFoodVF] = Number(totalFoodVF.toFixed(2));
          targetRow[outIdx_CA] = Number(caFinal.toFixed(2));
          targetRow[outIdx_commCa] = Number(commCa.toFixed(2));
          targetRow[outIdx_crVF] = idxCR !== -1 && sourceRow[idxCR] !== undefined && sourceRow[idxCR] !== null
            ? String(sourceRow[idxCR]).trim()
            : '';

          if (isKoolBrand && window.koolOrderItemsByOrderId && window.koolOrderItemsByOrderId.size > 0) {
            var oidKoolLow = String(targetRow[22] || '').trim().toLowerCase();
            var kItems = oidKoolLow ? window.koolOrderItemsByOrderId.get(oidKoolLow) : null;
            if (kItems && kItems.length > 0) {
              var foodItemParts = [];
              var catSet = new Set();
              for (var ki = 0; ki < kItems.length; ki++) {
                var kIt = kItems[ki];
                if (kIt.article) foodItemParts.push(kIt.quantity + ' x ' + kIt.article);
                if (kIt.category) catSet.add(kIt.category);
              }
              if (foodItemParts.length > 0) targetRow[96] = foodItemParts.join(', ');
              if (catSet.size > 0) targetRow[95] = Array.from(catSet).join(' | ');
            }
          }

          var amAssigned = amLookupCache.get(currentRestName);
          if (amAssigned === undefined) {
            amAssigned = determinerAmPourCommande(rawRestName);
            amLookupCache.set(currentRestName, amAssigned);
          }
          var rowRecord = { am: amAssigned, cells: targetRow };

          var serviceVal = idxServices !== -1 && sourceRow[idxServices] !== undefined && sourceRow[idxServices] !== null
            ? String(sourceRow[idxServices]).trim().toLowerCase()
            : '';

          if (serviceVal.includes('mg market') || serviceVal.includes('market') || currentRestName.includes('mg market') || currentRestName.includes('market')) {
            marketRows.push(rowRecord);
          } else {
            foodRows.push(rowRecord);
          }
        }

        if (isMarketOnlyViewer()) {
          var marketOnlySource = [sourceData[0]];
          var idxSrvFilterM = sourceHeadersLower.indexOf('services');
          var idxRestoFilterM = sourceHeadersLower.indexOf('restaurant name');
          for (var mr = 1; mr < sourceData.length; mr++) {
            var sRowM = sourceData[mr];
            if (!sRowM) continue;
            var srvM = idxSrvFilterM !== -1 && sRowM[idxSrvFilterM] !== undefined && sRowM[idxSrvFilterM] !== null
              ? String(sRowM[idxSrvFilterM]).trim().toLowerCase()
              : '';
            var rNameM = idxRestoFilterM !== -1 && sRowM[idxRestoFilterM] !== undefined && sRowM[idxRestoFilterM] !== null
              ? String(sRowM[idxRestoFilterM]).trim().toLowerCase()
              : '';
            if (srvM.includes('mg market') || srvM.includes('market') || rNameM.includes('mg market') || rNameM.includes('market')) {
              marketOnlySource.push(sRowM);
            }
          }
          state.marketRows = marketRows;
          state.foodRows = [];
          state.offresRows = calculerOffresDepuisDataExp(marketOnlySource);
          state.statRows = calculerStatDepuisDataExp(marketRows);
        } else if (isFoodOnlyAm()) {
          var foodOnlySource = [sourceData[0]];
          var idxSrvFilterF = sourceHeadersLower.indexOf('services');
          var idxRestoFilterF = sourceHeadersLower.indexOf('restaurant name');
          for (var fr = 1; fr < sourceData.length; fr++) {
            var sRowF = sourceData[fr];
            if (!sRowF) continue;
            var srvF = idxSrvFilterF !== -1 && sRowF[idxSrvFilterF] !== undefined && sRowF[idxSrvFilterF] !== null
              ? String(sRowF[idxSrvFilterF]).trim().toLowerCase()
              : '';
            var rNameF = idxRestoFilterF !== -1 && sRowF[idxRestoFilterF] !== undefined && sRowF[idxRestoFilterF] !== null
              ? String(sRowF[idxRestoFilterF]).trim().toLowerCase()
              : '';
            if (!(srvF.includes('mg market') || srvF.includes('market') || rNameF.includes('mg market') || rNameF.includes('market'))) {
              foodOnlySource.push(sRowF);
            }
          }
          state.marketRows = [];
          state.foodRows = foodRows;
          state.offresRows = calculerOffresDepuisDataExp(foodOnlySource);
          state.statRows = calculerStatDepuisDataExp(foodRows);
        } else {
          state.marketRows = marketRows;
          state.foodRows = foodRows;
          state.offresRows = calculerOffresDepuisDataExp(sourceData);
          state.statRows = calculerStatDepuisDataExp(marketRows.concat(foodRows));
        }
        state.currentPage = 1;
        var prevBar = document.getElementById('prevDataImportBar');
        if (prevBar) {
          if (canSeeGlobalSynth()) prevBar.classList.remove('hidden');
          else prevBar.classList.add('hidden');
        }
        var btnSyncYassir = document.getElementById('btnSyncYassirAll');
        if (btnSyncYassir) {
          if (isOwnerAdmin()) { btnSyncYassir.classList.remove('hidden'); } else { btnSyncYassir.classList.add('hidden'); }
        }
        var btnReset = document.getElementById('btnResetAll');
        if (btnReset) {
          if (isOwnerAdmin() && state.rawSourceRows && state.rawSourceRows.length > 1) { btnReset.classList.remove('hidden'); btnReset.style.display = 'inline-flex'; } else { btnReset.classList.add('hidden'); btnReset.style.display = 'none'; }
        }
        if (isFullPeriod) {
          idxCache.fullCacheKey = fullKey;
          idxCache.fullMarketRows = state.marketRows;
          idxCache.fullFoodRows = state.foodRows;
          idxCache.fullOffresRows = state.offresRows;
          idxCache.fullStatRows = state.statRows;
        }
        state._calcRevision = (state._calcRevision || 0) + 1;
        _amStatsCache.clear();
        _notifCacheSig = '';
        syncLmdSidebarActiveState(state.activeTab);
        mettreAJourInterface();
      }

      var _amStatsCache = new Map();
      var _restosWithOrdersCache = { rev: '', set: new Set() };
      var _orderCountsMapCache = { rev: '', map: new Map() };
      var _notifCacheSig = '';
      var _notifTimerId = null;
