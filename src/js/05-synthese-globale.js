      /* ========================================================================
         E2. MODULE SYNTHÈSE GLOBALE (17 KPIs ARRAYFORMULA + TABLEAU LUNDI-DIMANCHE)
         ======================================================================== */
      function getStrictlyFoodRecords() {
        var idxServices = TARGET_HEADERS.indexOf('services');
        var idxResto = TARGET_HEADERS.indexOf('restaurant name');

        // Filtrer strictement les commandes Food VF (exclure Market et tout autre service)
        return state.foodRows.filter(function (rec) {
          var srv = String(rec.cells[idxServices] || '').trim().toLowerCase();
          var rName = String(rec.cells[idxResto] || '').trim().toLowerCase();
          if (srv.includes('market') || rName.includes('mg market') || rName.includes('market')) {
            return false;
          }
          if (srv.includes('express') || srv.includes('coursier') || srv.includes('courier') || srv.includes('last mile') || srv.includes('b2b')) {
            return false;
          }
          return true;
        });
      }

      function getStrictlyMarketRecords() {
        var activeAm = getEffectiveAmFilter();
        return activeAm === 'ALL'
          ? state.marketRows.slice()
          : state.marketRows.filter(function (rec) { return rec.am === activeAm; });
      }

      function calculerSyntheseGlobaleData() {
        var isMktMode = isMarketOnlyViewer();
        var allRecords = isMktMode ? getStrictlyMarketRecords() : getStrictlyFoodRecords();
        if (!allRecords || allRecords.length === 0) {
          return {
            empty: true,
            foodCount: 0,
            kpiRows: [],
            dayStats: [],
            totals: { req: 0, del: 0, gmv: 0 }
          };
        }

        var idxW_OrderId = TARGET_HEADERS.indexOf('order id');
        var idxAI_Resto = TARGET_HEADERS.indexOf('restaurant name');
        var idxAP_Status = TARGET_HEADERS.indexOf('status');
        var idxAV_ItemTotal = TARGET_HEADERS.indexOf('item total');
        var idxBB_LrLg = TARGET_HEADERS.indexOf('à payer réduits');
        var idxOrigDelivStat = TARGET_HEADERS.indexOf('original delivery amount');
        var idxDelivAmtStat = TARGET_HEADERS.indexOf('delivery amount');
        var idxOrigDeliv = TARGET_HEADERS.indexOf('original delivery amount');
        var idxDelivAmt = TARGET_HEADERS.indexOf('delivery amount');
        var idxBN_Comm = TARGET_HEADERS.indexOf('CA');
        var idxBP_TotalFood = TARGET_HEADERS.indexOf('Total Food');
        var idxBR_TotalFoodVF = TARGET_HEADERS.indexOf('Total Food VF');
        var idxCN_DiscAmt = TARGET_HEADERS.indexOf('Discount Amount');
        var idxCO_DiscType = TARGET_HEADERS.indexOf('Discount Type');
        var idxCR_FoodCat = TARGET_HEADERS.indexOf('Food Category');
        var idxCS_FoodItem = TARGET_HEADERS.indexOf('Food Item');
        var idxCT_AcceptedBy = TARGET_HEADERS.indexOf('Accepted By');
        var idxOrderDay = TARGET_HEADERS.indexOf('order day');
        var idxOrderTime = TARGET_HEADERS.indexOf('order time');

        // Détecter la borne calendaire minCalIso et maxCalIso (order day) :
        // Si la période se termine un Lundi (trailing Monday après Dimanche, diff >= 6j),
        // toutes les commandes de ce dernier Lundi sont ajoutées au Dimanche (dIdx = 6).
        var minCalIso = '';
        var maxCalIso = '';
        for (var k = 0; k < allRecords.length; k++) {
          var ck = allRecords[k].cells;
          var calK = parseOrderDayToIsoDate(ck[idxOrderDay]);
          if (!calK) continue;
          if (!minCalIso || calK < minCalIso) minCalIso = calK;
          if (!maxCalIso || calK > maxCalIso) maxCalIso = calK;
        }
        var trailingMondayCalIso = '';
        if (minCalIso && maxCalIso && diffDaysBetweenIso(minCalIso, maxCalIso) >= 6) {
          if (getFrenchWeekdayIndexFromOrderDay(maxCalIso) === 0) {
            trailingMondayCalIso = maxCalIso;
          }
        }

        var requested = 0;
        var deliveredOrders = 0;
        var cancelledByResto = 0;
        var gmvBrut = 0;
        var gmvTotalFoodVF = 0;
        var gmvNetTotalFood = 0;
        var promoOrder = 0;
        var propPromoNumerator = 0;
        var acceptedByResto = 0;
        var uniqueStores = new Set();
        var caYassir = 0;
        var lrLgCosts = 0;

        var dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
        var dayStats = dayNames.map(function (d) { return { day: d, req: 0, del: 0, gmv: 0 }; });

        for (var i = 0; i < allRecords.length; i++) {
          var c = allRecords[i].cells;
          var orderIdStr = String(c[idxW_OrderId] || '').trim();
          var restoStr = String(c[idxAI_Resto] || '').trim();
          var statusLower = String(c[idxAP_Status] || '').trim().toLowerCase();

          var isReq = orderIdStr.length > 0;
          var isDel = statusLower.includes('delivered');
          var isCancResto = statusLower.includes('restaurant rejected') || (!isDel && isRestaurantRejectedReason(c[TARGET_HEADERS.indexOf('cancellation reason VF')] || c[TARGET_HEADERS.indexOf('cancellation reason')]));

          if (isReq) requested++;
          if (isDel) deliveredOrders++;
          if (isCancResto) cancelledByResto++;
          if (restoStr) uniqueStores.add(restoStr.toLowerCase());

          var brVal = purgerNombre(c[idxBR_TotalFoodVF]);
          if (isDel) {
            gmvBrut += purgerNombre(c[idxAV_ItemTotal]);
            gmvTotalFoodVF += brVal;
            gmvNetTotalFood += purgerNombre(c[idxBP_TotalFood]);
            caYassir += purgerNombre(c[idxBN_Comm]);
            var rowOrigDeliv = idxOrigDeliv !== -1 ? purgerNombre(c[idxOrigDeliv]) : 0;
            var rowDelivAmt = idxDelivAmt !== -1 ? purgerNombre(c[idxDelivAmt]) : 0;
            lrLgCosts += (rowOrigDeliv - rowDelivAmt);

            var acceptedByLower = String(c[idxCT_AcceptedBy] || '').trim().toLowerCase();
            if (acceptedByLower.includes('restaurant')) {
              acceptedByResto++;
            }

            // Formule exacte =ARRAYFORMULA :
            // Promo Order = (SEARCH("Super Promo", Extract!CQ) + SEARCH("Percentage", Extract!CO)) * Delivered
            // Kool : le normaliseur ne remplit jamais 'Discount Type' / 'Food Category' / 'Time Taken',
            // mais la remise (Discount Amount) est bien renseignée : une commande livrée Kool avec
            // remise > 0 est une commande promo.
            var colCQ_TimeTaken = TARGET_HEADERS.indexOf('Time Taken');
            var cqStr = colCQ_TimeTaken !== -1 ? String(c[colCQ_TimeTaken] || '') : '';
            var discTypeStr = idxCO_DiscType !== -1 ? String(c[idxCO_DiscType] || '') : '';
            var discAmtNum = idxCN_DiscAmt !== -1 ? purgerNombre(c[idxCN_DiscAmt]) : 0;
            var isKoolDiscounted = (typeof currentBrand !== 'undefined' && currentBrand === 'kool') && discAmtNum > 0;
            if (/super\s*promo/i.test(cqStr) || /percentage/i.test(discTypeStr) || isKoolDiscounted) {
              promoOrder++;
            }

            // Prop Promo Order = (SEARCH("Super Promo", Extract!CR) + SEARCH("Percentage", Extract!CN)) * Delivered
            var foodCatStr = idxCR_FoodCat !== -1 ? String(c[idxCR_FoodCat] || '') : '';
            var discAmtRawStr = idxCN_DiscAmt !== -1 ? String(c[idxCN_DiscAmt] || '') : '';
            if (/super\s*promo/i.test(foodCatStr) || /percentage/i.test(discAmtRawStr) || isKoolDiscounted) {
              propPromoNumerator++;
            }
          }

          var calIsoRow = parseOrderDayToIsoDate(c[idxOrderDay]);
          var dIdx = -1;
          if (trailingMondayCalIso && calIsoRow === trailingMondayCalIso) {
            // Le lundi du dernier jour est ajouté au Dimanche dans le tableau
            dIdx = 6;
          } else {
            dIdx = getFrenchWeekdayIndexFromOrderDay(c[idxOrderDay]);
          }
          if (dIdx >= 0 && dIdx <= 6) {
            if (isReq) dayStats[dIdx].req += 1;
            if (isDel) {
              dayStats[dIdx].del += 1;
              dayStats[dIdx].gmv += brVal;
            }
          }
        }

        var cancellationPct = requested > 0 ? ((cancelledByResto / requested) * 100).toFixed(2) + '%' : '0.00%';
        var aovTnd = deliveredOrders > 0 ? (gmvTotalFoodVF / deliveredOrders).toFixed(2) : '0.00';
        var propPromoPct = deliveredOrders > 0 ? ((propPromoNumerator / deliveredOrders) * 100).toFixed(2) + '%' : '0.00%';
        var automationPct = deliveredOrders > 0 ? ((acceptedByResto / deliveredOrders) * 100).toFixed(2) + '%' : '0.00%';
        var propLrCaPct = caYassir > 0 ? ((lrLgCosts / caYassir) * 100).toFixed(2) + '%' : '0.00%';
        var commissionPct = gmvTotalFoodVF > 0 ? ((caYassir / gmvTotalFoodVF) * 100).toFixed(2) + '%' : '0.00%';

        var kpiRows = [
          { label: 'Requested', value: requested, numVal: requested },
          { label: 'Delivered Orders', value: deliveredOrders, numVal: deliveredOrders },
          { label: 'Cancelled By Restaurant', value: cancelledByResto, numVal: cancelledByResto },
          { label: 'Cancellation', value: cancellationPct, numVal: cancellationPct },
          { label: 'GMV Brut (Item total)', value: Number(gmvBrut.toFixed(1)), numVal: Number(gmvBrut.toFixed(2)) },
          { label: isMktMode ? 'GMV (Total Market VF)' : 'GMV (Total Food VF)', value: Number(gmvTotalFoodVF.toFixed(1)), numVal: Number(gmvTotalFoodVF.toFixed(2)) },
          { label: isMktMode ? 'GMV Net (Total Market)' : 'GMV Net (Total Food)', value: Number(gmvNetTotalFood.toFixed(1)), numVal: Number(gmvNetTotalFood.toFixed(2)) },
          { label: 'AOV TND', value: aovTnd, numVal: Number(aovTnd) },
          { label: 'Promo Order', value: promoOrder, numVal: promoOrder },
          { label: 'Prop Promo Order', value: propPromoPct, numVal: propPromoPct },
          { label: 'Accepted by restaurant', value: acceptedByResto, numVal: acceptedByResto },
          { label: 'Automation', value: automationPct, numVal: automationPct },
          { label: 'Active Store', value: uniqueStores.size, numVal: uniqueStores.size },
          { label: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? 'CA KOOL' : 'CA YASSIR', value: Number(caYassir.toFixed(1)), numVal: Number(caYassir.toFixed(2)) },
          { label: 'L.R/L.G Costs', value: Number(lrLgCosts.toFixed(1)), numVal: Number(lrLgCosts.toFixed(2)) },
          { label: 'Prop L.R/CA', value: propLrCaPct, numVal: propLrCaPct },
          { label: 'Commission', value: commissionPct, numVal: commissionPct }
        ];

        var totalDayReq = dayStats.reduce(function (s, d) { return s + d.req; }, 0);
        var totalDayDel = dayStats.reduce(function (s, d) { return s + d.del; }, 0);
        var totalDayGmv = dayStats.reduce(function (s, d) { return s + d.gmv; }, 0);

        return {
          empty: false,
          foodCount: allRecords.length,
          kpiRows: kpiRows,
          dayStats: dayStats,
          totals: { req: totalDayReq, del: totalDayDel, gmv: Number(totalDayGmv.toFixed(2)) }
        };
      }

      window.yassirInspectSourceColumns = function () {
        var activeRows = obtenirSourceAoaFiltreeParDate();
        if (!activeRows || activeRows.length < 2) {
          showToast('Importez d’abord un fichier Excel/CSV.', 'info');
          return;
        }
        var hdrs = activeRows[0];
        var matches = [];
        for (var i = 0; i < hdrs.length; i++) {
          var h = String(hdrs[i] || '').trim();
          if (/item|total|food|coupon|delivery|payer|amount|ca|discount/i.test(h)) {
            var sumDel = 0;
            var stIdx = hdrs.findIndex(function (x) { return String(x || '').trim().toLowerCase() === 'status'; });
            var srvIdx = hdrs.findIndex(function (x) { return String(x || '').trim().toLowerCase() === 'services'; });
            var oidIdx = hdrs.findIndex(function (x) { return String(x || '').trim().toLowerCase() === 'order id'; });
            for (var r = 1; r < activeRows.length; r++) {
              var row = activeRows[r];
              if (!row) continue;
              if (oidIdx !== -1 && !estOrderIdYaf(row[oidIdx])) continue;
              if (stIdx !== -1 && !/delivered/i.test(String(row[stIdx] || ''))) continue;
              if (srvIdx !== -1 && /market/i.test(String(row[srvIdx] || ''))) continue;
              sumDel += purgerNombre(row[i]);
            }
            var colLet = '', nCol = i + 1;
            while (nCol > 0) { var rem = (nCol - 1) % 26; colLet = String.fromCharCode(65 + rem) + colLet; nCol = Math.floor((nCol - 1) / 26); }
            matches.push('<strong>' + colLet + '</strong> [' + escapeHtml(h) + '] = <strong>' + sumDel.toFixed(2) + '</strong>');
          }
        }
        showToast('<strong>Colonnes financières (période filtrée, Food Delivered) :</strong><br/>' + matches.join(' • '), 'info');
      };

      var YASSIR_2025_STORAGE_KEY = 'yassir_vf_hist_2025_rows_v1';
      var KOOL_2025_STORAGE_KEY = 'kool_vf_hist_2025_rows_v1';
      var execSummaryDailyChartInst = null;
      var weeklyWowPerfChartInst = null;
      var weeklyAovCompareChartInst = null;
      var yoyDeliveredChartInst = null;
      var yoyGmvChartInst = null;

      // Palette des séries de graphiques selon la marque : Yassir violet/rose, Kool jaune/noir.
      // series = couleurs des barres/courbes ; labels = couleurs des valeurs affichées dessus.
      function brandChartPalette() {
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          return { series: ['#FFD100', '#111111'], labels: ['#FFD100', '#111111'] };
        }
        return { series: ['#6C2BD9', '#FF1E6E'], labels: ['#5B21B6', '#FF1E6E'] };
      }

      // Plugin Chart.js pour afficher toutes les valeurs directement sur les barres et courbes (comme les captures)
      var yassirSlideDataLabelsPlugin = {
        id: 'yassirSlideDataLabelsPlugin',
        afterDatasetsDraw: function (chart) {
          var ctx = chart.ctx;
          var chartTypeMode = chart.options && chart.options.yassirLabelMode ? chart.options.yassirLabelMode : 'default';
          var chartPal = brandChartPalette();
          var chartIsKool = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
          ctx.save();
          chart.data.datasets.forEach(function (dataset, dsIndex) {
            var meta = chart.getDatasetMeta(dsIndex);
            if (!meta || meta.hidden) return;
            meta.data.forEach(function (element, idx) {
              var rawVal = dataset.data[idx];
              if (rawVal === null || rawVal === undefined || rawVal === '') return;
              var labelStr = dataset.formatLabel ? dataset.formatLabel(rawVal) : String(rawVal);

              if (chartTypeMode === 'exec_daily') {
                if (dataset.type === 'line') {
                  ctx.font = '800 10px "Plus Jakarta Sans", sans-serif';
                  ctx.fillStyle = '#FFFFFF';
                  ctx.strokeStyle = '#1A1A2E';
                  ctx.lineWidth = 3;
                  ctx.textAlign = 'center';
                  ctx.strokeText(labelStr, element.x, element.y - 8);
                  ctx.fillText(labelStr, element.x, element.y - 8);
                } else {
                  // Valeur centrée à mi-hauteur de la barre avec contour blanc/violet
                  var midY = (element.y + element.base) / 2;
                  ctx.font = '800 10px "Plus Jakarta Sans", sans-serif';
                  ctx.textAlign = 'center';
                  ctx.strokeStyle = '#FFFFFF';
                  ctx.lineWidth = 3;
                  ctx.strokeText(labelStr, element.x, midY + 4);
                  ctx.fillStyle = dataset.label === 'Req' ? chartPal.labels[0] : chartPal.labels[1];
                  ctx.fillText(labelStr, element.x, midY + 4);
                }
              } else if (chartTypeMode === 'wow_perf') {
                if (dataset.type === 'line') {
                  ctx.font = '800 10px "Plus Jakarta Sans", sans-serif';
                  ctx.fillStyle = '#FFFFFF';
                  ctx.strokeStyle = '#1A1A2E';
                  ctx.lineWidth = 3;
                  ctx.textAlign = 'center';
                  ctx.strokeText(labelStr, element.x, element.y - 7);
                  ctx.fillText(labelStr, element.x, element.y - 7);
                } else {
                  var midY2 = (element.y + element.base) / 2;
                  ctx.font = '800 10px "Plus Jakarta Sans", sans-serif';
                  ctx.textAlign = 'center';
                  ctx.strokeStyle = '#FFFFFF';
                  ctx.lineWidth = 3;
                  ctx.strokeText(labelStr, element.x, midY2 + 4);
                  ctx.fillStyle = dataset.label === 'Received' ? chartPal.labels[0] : chartPal.labels[1];
                  ctx.fillText(labelStr, element.x, midY2 + 4);
                }
              } else if (chartTypeMode === 'aov_bars') {
                var midY3 = (element.y + element.base) / 2;
                ctx.font = '800 11px "Plus Jakarta Sans", sans-serif';
                ctx.textAlign = 'center';
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 3;
                ctx.strokeText(labelStr, element.x, midY3 + 4);
                ctx.fillStyle = dsIndex === 0 ? chartPal.labels[0] : chartPal.labels[1];
                ctx.fillText(labelStr, element.x, midY3 + 4);
              } else if (chartTypeMode === 'yoy_line') {
                ctx.font = '800 10px "Plus Jakarta Sans", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = dsIndex === 0 ? chartPal.labels[0] : chartPal.labels[1];
                var yOffset = dsIndex === 0 ? -9 : 16;
                if (chartIsKool && dsIndex === 0) {
                  // Jaune sur fond blanc peu lisible : contour noir pour le libellé 2025 en mode Kool.
                  ctx.strokeStyle = '#111111';
                  ctx.lineWidth = 3;
                  ctx.strokeText(labelStr, element.x, element.y + yOffset);
                }
                ctx.fillText(labelStr, element.x, element.y + yOffset);
              }
            });
          });
          ctx.restore();
        }
      };

      (function loadSaved2025FromStore() {
        try {
          var raw25 = safeGet(YASSIR_2025_STORAGE_KEY);
          if (raw25) {
            var parsed25 = JSON.parse(raw25);
            if (Array.isArray(parsed25) && parsed25.length > 0) {
              state.historical2025Rows = parsed25;
            }
          }
        } catch (e) {}
      })();

      // Historique 2025 Kool (onglet « 2025 Kool » du classeur fusionné) : stocké
      // à part, comme les autres données Kool (motif loadKoolStored*).
      (function loadSaved2025KoolFromStore() {
        try {
          var raw25k = safeGet(KOOL_2025_STORAGE_KEY);
          if (raw25k) {
            var parsed25k = JSON.parse(raw25k);
            if (Array.isArray(parsed25k) && parsed25k.length > 0) {
              state.historical2025RowsKool = parsed25k;
            }
          }
        } catch (e) {}
      })();

      // Validation d'une matrice 2025 : au moins 3 colonnes « semaine » dans
      // les 8 premières lignes (même détection que extract2025MetricsByWeekMap).
      // Protège contre une mauvaise feuille renvoyée par Google malgré le gid
      // (gviz renvoie parfois le 1er onglet) : sans elle, des lignes de
      // portefeuilles seraient stockées comme « données 2025 » et la comparaison
      // YoY resterait vide sans aucun message d'erreur.
      var WEEK_HEADER_RE_2025 = /^(?:w|week|semaine)\s*0*(\d{1,2})(?:\s*[-_]\s*\d{2,4})?$/i;
      function yassirValiderLignes2025(rows) {
        if (!Array.isArray(rows) || rows.length < 2) return false;
        for (var r = 0; r < Math.min(8, rows.length); r++) {
          var row = rows[r] || [];
          var found = 0;
          for (var c = 0; c < row.length; c++) {
            var wm = String(row[c] || '').trim().match(WEEK_HEADER_RE_2025);
            if (wm) {
              var wNum = parseInt(wm[1], 10);
              if (wNum >= 1 && wNum <= 53) found++;
            }
          }
          if (found >= 3) return true;
        }
        return false;
      }
      window.yassirValiderLignes2025 = yassirValiderLignes2025;

      function nettoyerLignes2025(rows) {
        return (rows || []).filter(function (r) {
          return Array.isArray(r) && r.some(function (c) { return String(c || '').trim() !== ''; });
        });
      }

      // Valide puis stocke les lignes 2025 d'une marque. Retourne le nombre de
      // lignes stockées, 0 sinon — sans jamais écraser de bonnes données déjà
      // stockées par de mauvaises.
      function stockerLignes2025Kool(rows) {
        var cleaned = nettoyerLignes2025(rows);
        if (cleaned.length < 2 || !yassirValiderLignes2025(cleaned)) return 0;
        state.historical2025RowsKool = cleaned;
        safeSet(KOOL_2025_STORAGE_KEY, JSON.stringify(cleaned));
        return cleaned.length;
      }
      function stockerLignes2025Yassir(rows) {
        var cleaned = nettoyerLignes2025(rows);
        if (cleaned.length < 2 || !yassirValiderLignes2025(cleaned)) return 0;
        state.historical2025Rows = cleaned;
        safeSet(YASSIR_2025_STORAGE_KEY, JSON.stringify(cleaned));
        return cleaned.length;
      }
      window.yassirStockerLignes2025Kool = stockerLignes2025Kool;
      window.yassirStockerLignes2025Yassir = stockerLignes2025Yassir;

      window.yassirSync2025Sheet = function (manualTrigger) {
        var sheetId = LIVE_SHEETS_CONFIG.HISTORICAL_2025_SHEET_ID;
        var gid = LIVE_SHEETS_CONFIG.HISTORICAL_2025_GID || '0';
        if (!sheetId) return Promise.resolve();
        var icon = document.getElementById('iconSync2025');
        var label = document.getElementById('labelSync2025');
        if (icon) icon.classList.add('fa-spin');
        if (label) label.textContent = 'Sync YoY 2025...';

        function finirSucces() {
          noterStatutSynchro('Données 2025 (YoY)', true);
          if (icon) icon.classList.remove('fa-spin');
          if (label) label.textContent = 'YoY 2025 OK';
          if (state.activeTab === 'synth_global') renderSynth2025Panel();
          if (manualTrigger) {
            showToast('<strong>Données 2025 synchronisées</strong> pour les semaines YoY.', 'success');
          }
        }
        function finirEchec() {
          noterStatutSynchro('Données 2025 (YoY)', false);
          if (icon) icon.classList.remove('fa-spin');
          if (label) label.textContent = 'Sync YoY 2025';
        }

        // Lecture par gid, puis replis par nom d'onglet (JSONP puis XLSX) :
        // Google renvoie parfois le 1er onglet malgré le gid, donc chaque
        // lecture est validée avant stockage.
        return fetchGoogleSheetByGidSmart(sheetId, gid, '')
          .catch(function () { return null; })
          .then(function (rows) {
            if (rows && stockerLignes2025Yassir(rows) > 0) { finirSucces(); return; }
            return fetchGoogleSheetJsonp(sheetId, '2025 Yassir', false)
              .catch(function () { return null; })
              .then(function (rowsByName) {
                if (rowsByName && stockerLignes2025Yassir(rowsByName) > 0) { finirSucces(); return; }
                return fetchGoogleWorkbookXlsx(sheetId).then(function (wb) {
                  // Le classeur fusionné a 14 onglets : SheetNames[0] serait 'Omar Beldi'
                  // (portefeuilles). On cherche l'onglet 2025 Yassir par son nom.
                  var sName = wb.SheetNames.find(function (n) { return normalizeText(n).includes('2025') && normalizeText(n).includes('yassir'); });
                  if (!sName) throw new Error('Onglet 2025 Yassir introuvable');
                  return XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' });
                }).then(function (rowsXlsx) {
                  if (stockerLignes2025Yassir(rowsXlsx) > 0) finirSucces(); else finirEchec();
                });
              });
          })
          .catch(function () {
            finirEchec();
            if (manualTrigger) {
              showToast('Impossible de lire la feuille 2025 (vérifiez le partage public en lecture).', 'error');
            }
          });
      };

      // Données 2025 Kool (onglet « 2025 Kool » du classeur fusionné, gid=14) :
      // parallèle exact de yassirSync2025Sheet, stocké par marque. Appelée par la
      // synchro Kool (automatique + manuelle). Ne rejette jamais : un échec 2025
      // ne doit pas faire échouer la synchro Kool. Résout avec le nombre de lignes.
      window.yassirSync2025KoolSheet = function (manualTrigger) {
        var sheetId = KOOL_SHEETS_CONFIG.HISTORICAL_2025_SHEET_ID;
        var gid = KOOL_SHEETS_CONFIG.HISTORICAL_2025_GID || '0';
        if (!sheetId) return Promise.resolve(0);
        return fetchGoogleSheetByGidSmart(sheetId, gid, '')
          .catch(function () {
            return fetchGoogleWorkbookXlsx(sheetId).then(function (wb) {
              // Repli : chercher l'onglet « 2025 Kool » par son nom — surtout pas
              // un autre onglet 2025 (les valeurs Yassir ne doivent pas passer
              // pour des valeurs Kool).
              var sName = wb.SheetNames.find(function (n) { return normalizeText(n).includes('2025') && normalizeText(n).includes('kool'); });
              if (!sName) throw new Error('Onglet 2025 Kool introuvable');
              return XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' });
            });
          })
          .then(function (rows) {
            var count = stockerLignes2025Kool(rows);
            if (count > 0) {
              if (state.activeTab === 'synth_global' && typeof currentBrand !== 'undefined' && currentBrand === 'kool') renderSynth2025Panel();
              if (manualTrigger) {
                showToast('<strong>Données 2025 Kool synchronisées</strong> pour les semaines YoY.', 'success');
              }
              return count;
            }
            // Lignes invalides (Google a renvoyé une autre feuille malgré le gid) :
            // repli par NOM d'onglet, qui lui est fiable (gviz sheet=).
            return fetchGoogleSheetJsonp(sheetId, '2025 Kool', false)
              .then(function (rowsByName) {
                var count2 = stockerLignes2025Kool(rowsByName);
                if (count2 > 0) {
                  if (state.activeTab === 'synth_global' && typeof currentBrand !== 'undefined' && currentBrand === 'kool') renderSynth2025Panel();
                  if (manualTrigger) {
                    showToast('<strong>Données 2025 Kool synchronisées</strong> pour les semaines YoY.', 'success');
                  }
                }
                return count2;
              })
              .catch(function () { return 0; });
          })
          .catch(function () {
            if (manualTrigger) {
              showToast('Impossible de lire la feuille 2025 Kool (vérifiez le partage public en lecture).', 'error');
            }
            return 0;
          });
      };

      function getIsoWeekNumber(isoDateStr) {
        if (!isoDateStr) return 0;
        var parts = isoDateStr.split('-');
        if (parts.length !== 3) return 0;
        var dt = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
        var dayNum = dt.getUTCDay() || 7;
        dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
        var yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
        return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
      }

      // Lignes 2025 de la marque active (Yassir / Kool, stockées séparément).
      function getActive2025Rows() {
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          return state.historical2025RowsKool || [];
        }
        return state.historical2025Rows || [];
      }
      window.yassirGetActive2025Rows = getActive2025Rows;

      // Extraction complète des semaines de 2025 (format horizontal W 07, W 08, ..., W 47 en colonnes et indicateurs en lignes, OU format vertical)
      function extract2025MetricsByWeekMap(rowsOverride) {
        var map25 = new Map();
        var rows = rowsOverride || state.historical2025Rows || [];
        if (rows.length < 2) return map25;

        // 1. Détecter si le fichier 2025 est en format horizontal (colonnes W 07, W 08, ..., W 47) comme dans la capture
        var weekHeaderRowIdx = -1;
        var weekColMap = new Map(); // colIndex -> weekNumber
        for (var r = 0; r < Math.min(8, rows.length); r++) {
          var row = rows[r] || [];
          var foundCols = new Map();
          for (var c = 0; c < row.length; c++) {
            var cellStr = String(row[c] || '').trim();
            var wm = cellStr.match(/^(?:w|week|semaine)\s*0*(\d{1,2})(?:\s*[-_]\s*\d{2,4})?$/i);
            if (wm) {
              var wNum = parseInt(wm[1], 10);
              if (wNum >= 1 && wNum <= 53) {
                foundCols.set(c, wNum);
              }
            }
          }
          if (foundCols.size >= 3) {
            weekHeaderRowIdx = r;
            weekColMap = foundCols;
            break;
          }
        }

        if (weekHeaderRowIdx !== -1 && weekColMap.size >= 3) {
          // Initialiser toutes les semaines trouvées en en-tête
          weekColMap.forEach(function (wNum) {
            if (!map25.has(wNum)) {
              map25.set(wNum, { week: wNum, req: 0, del: 0, gmv: 0, ca: 0, aov: 0 });
            }
          });

          // Parcourir les lignes d'indicateurs (Requested, Delivered Orders, GMV (Total Food VF), AOV TND, CA YASSIR, etc.)
          for (var rr = weekHeaderRowIdx + 1; rr < rows.length; rr++) {
            var dRow = rows[rr] || [];
            var metricLabel = normalizeText(dRow[0] || dRow[1] || '');
            if (!metricLabel) continue;

            var targetField = '';
            if (metricLabel === 'requested' || metricLabel === 'req') targetField = 'req';
            else if (metricLabel.includes('delivered order') || metricLabel === 'delivered' || metricLabel === 'del') targetField = 'del';
            else if (metricLabel.includes('total food vf') || metricLabel === 'gmv' || (metricLabel.startsWith('gmv') && !metricLabel.includes('brut') && !metricLabel.includes('net'))) targetField = 'gmv';
            else if (metricLabel.includes('ca yassir') || metricLabel === 'ca' || metricLabel === 'ca ht') targetField = 'ca';
            else if (metricLabel.includes('aov')) targetField = 'aov';

            if (!targetField) continue;

            weekColMap.forEach(function (wNum, colIdx) {
              var entry = map25.get(wNum);
              var val = colIdx < dRow.length ? purgerNombre(dRow[colIdx]) : 0;
              entry[targetField] = val;
            });
          }

          // Calculer AOV si manquant
          map25.forEach(function (entry) {
            if (!entry.aov && entry.del > 0 && entry.gmv > 0) {
              entry.aov = entry.gmv / entry.del;
            }
          });
          return map25;
        }

        // 2. Fallback format vertical (semaines en lignes)
        var headerRowIdx = 0;
        for (var i = 0; i < Math.min(5, rows.length); i++) {
          var nonEmpty = (rows[i] || []).filter(function (c) { return String(c || '').trim() !== ''; }).length;
          if (nonEmpty >= 2) { headerRowIdx = i; break; }
        }
        var headers = (rows[headerRowIdx] || []).map(function (h) { return normalizeText(h); });
        var idxW = headers.findIndex(function (h) { return h.includes('week') || h.includes('semaine') || h === 'w'; });
        var idxReq = headers.findIndex(function (h) { return h === 'req' || h.includes('requested') || h.includes('recu'); });
        var idxDel = headers.findIndex(function (h) { return h === 'del' || h.includes('delivered') || h.includes('livre'); });
        var idxGmv = headers.findIndex(function (h) { return h === 'gmv' || h.includes('total food') || h.includes('gmv vf'); });
        var idxCa = headers.findIndex(function (h) { return h === 'ca' || h.includes('ca yassir') || h.includes('commission'); });
        var idxAov = headers.findIndex(function (h) { return h.includes('aov'); });

        if (idxW === -1) return map25;

        for (var r2 = headerRowIdx + 1; r2 < rows.length; r2++) {
          var row2 = rows[r2];
          if (!row2) continue;
          var wStr = String(row2[idxW] || '');
          if (/total/i.test(wStr)) continue;
          var wm2 = wStr.match(/(\d{1,2})/);
          if (!wm2) continue;
          var wNum2 = parseInt(wm2[1], 10);
          if (!wNum2) continue;

          var reqVal = idxReq !== -1 ? purgerNombre(row2[idxReq]) : 0;
          var delVal = idxDel !== -1 ? purgerNombre(row2[idxDel]) : 0;
          var gmvVal = idxGmv !== -1 ? purgerNombre(row2[idxGmv]) : 0;
          var caVal = idxCa !== -1 ? purgerNombre(row2[idxCa]) : 0;
          var aovVal = idxAov !== -1 ? purgerNombre(row2[idxAov]) : (delVal > 0 ? gmvVal / delVal : 0);

          if (!map25.has(wNum2)) {
            map25.set(wNum2, { week: wNum2, req: 0, del: 0, gmv: 0, ca: 0, aov: 0 });
          }
          var cur = map25.get(wNum2);
          cur.req += reqVal;
          cur.del += delVal;
          cur.gmv += gmvVal;
          cur.ca += caVal;
          cur.aov = cur.del > 0 ? (cur.gmv / cur.del) : aovVal;
        }
        return map25;
      }

      // Agrégation hebdomadaire sur TOUTES les semaines disponibles dans la base 2026 (W44, W45, W46, W47...)
      function compute2026AllWeeksStatsMap() {
        var map26 = new Map();
        var aoa = state.rawSourceRows;
        if (!aoa || aoa.length < 2) return map26;

        var hdrs = aoa[0].map(function (h) { return String(h || '').trim().toLowerCase().replace(/[_\s]+/g, ' '); });
        var idxOid = hdrs.indexOf('order id');
        var idxSt = hdrs.indexOf('status');
        var idxSrv = hdrs.indexOf('services');
        var idxResto = hdrs.indexOf('restaurant name');
        var idxDay = hdrs.indexOf('order day') !== -1 ? hdrs.indexOf('order day') : hdrs.indexOf('delivered day');
        var idxTime = hdrs.indexOf('order time');
        var idxItem = hdrs.indexOf('item total');
        var idxTfVf = hdrs.indexOf('total food vf');
        var idxTf = hdrs.indexOf('total food');
        var idxCAdm = hdrs.lastIndexOf('coupon admin');
        var idxCRes = hdrs.lastIndexOf('coupon restaurant');
        var idxCDisc = hdrs.lastIndexOf('coupon discount');
        var idxDiscAmt = hdrs.lastIndexOf('discount amount');
        var idxProv = hdrs.lastIndexOf('discount type provider');
        var idxAmtRest = hdrs.indexOf('amount to restaurant');
        var idxCa = hdrs.indexOf('ca');
        var idxDiscType = hdrs.lastIndexOf('discount type');
        var idxFoodCat = hdrs.indexOf('food category');

        var isMktMode = isMarketOnlyViewer();
        var activeAm = getEffectiveAmFilter();

        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          if (idxOid !== -1 && !estOrderIdYaf(row[idxOid])) continue;

          var rName = idxResto !== -1 ? String(row[idxResto] || '').trim() : '';
          var rKey = rName.toLowerCase();
          var srv = idxSrv !== -1 ? String(row[idxSrv] || '').trim().toLowerCase() : '';
          var isMkt = srv.includes('market') || rKey.includes('mg market') || rKey.includes('market');
          if (isMktMode ? !isMkt : isMkt) continue;
          if (!isMkt && (srv.includes('express') || srv.includes('coursier') || srv.includes('courier') || srv.includes('last mile') || srv.includes('b2b'))) continue;

          if (activeAm !== 'ALL') {
            if (determinerAmPourCommande(rName) !== activeAm) continue;
          }

          var calIso = idxDay !== -1 ? parseOrderDayToIsoDate(row[idxDay]) : '';
          if (!calIso) continue;
          var opIso = idxTime !== -1 ? getOperationalIsoDate(calIso, row[idxTime]) : calIso;
          var wNum = getIsoWeekNumber(opIso);
          if (!wNum) continue;

          if (!map26.has(wNum)) {
            map26.set(wNum, {
              week: wNum,
              req: 0,
              del: 0,
              gmvBrut: 0,
              gmv: 0,
              ca: 0,
              promo: 0,
              stores: new Set(),
              dailyDel: new Map()
            });
          }
          var entry = map26.get(wNum);
          entry.req += 1;
          if (rKey) entry.stores.add(rKey);

          if (idxSt !== -1 && estCommandeLivree(row[idxSt])) {
            entry.del += 1;
            entry.dailyDel.set(opIso, (entry.dailyDel.get(opIso) || 0) + 1);

            var tf = idxTf !== -1 ? purgerNombre(row[idxTf]) : 0;
            var coup = Math.max(
              (idxCAdm !== -1 ? purgerNombre(row[idxCAdm]) : 0) + (idxCRes !== -1 ? purgerNombre(row[idxCRes]) : 0),
              idxCDisc !== -1 ? purgerNombre(row[idxCDisc]) : 0
            );
            var gmvRow = (idxTfVf !== -1 && row[idxTfVf] !== '' && row[idxTfVf] !== null) ? purgerNombre(row[idxTfVf]) : (tf + coup);
            entry.gmv += gmvRow;
            entry.gmvBrut += (idxItem !== -1 ? purgerNombre(row[idxItem]) : gmvRow);

            var dAmt = idxDiscAmt !== -1 ? purgerNombre(row[idxDiscAmt]) : 0;
            var prov = idxProv !== -1 ? String(row[idxProv] || '').trim().toLowerCase() : '';
            var caResto = tf + coup + ((prov === 'admin' || prov === 'yassir') ? dAmt : 0);
            if (Object.prototype.hasOwnProperty.call(state.customCommissions, rKey)) {
              entry.ca += (state.customCommissions[rKey] * caResto) / 100;
            } else if (idxCa !== -1 && row[idxCa] !== '' && row[idxCa] !== null) {
              entry.ca += purgerNombre(row[idxCa]);
            } else {
              entry.ca += (caResto - (idxAmtRest !== -1 ? purgerNombre(row[idxAmtRest]) : 0));
            }

            var dtStr = idxDiscType !== -1 ? String(row[idxDiscType] || '') : '';
            var fcStr = idxFoodCat !== -1 ? String(row[idxFoodCat] || '') : '';
            // Kool : 'Discount Type' / 'Food Category' ne sont jamais remplis, mais la remise
            // (Discount Amount, déjà calculée dans dAmt) l'est : remise > 0 = commande promo.
            if (/super\s*promo/i.test(fcStr) || /percentage/i.test(dtStr) || ((typeof currentBrand !== 'undefined' && currentBrand === 'kool') && dAmt > 0)) {
              entry.promo += 1;
            }
          }
        }
        return map26;
      }

      function formatWowBadgeHtml(pctVal, suffixLabel) {
        if (pctVal === null || pctVal === undefined || !Number.isFinite(pctVal)) return '(-)';
        var sign = pctVal >= 0 ? '+' : '';
        var cls = pctVal >= 0 ? 'text-[#00897B]' : 'text-[#FF1E6E]';
        return '<span class="' + cls + '">(' + sign + pctVal.toFixed(0) + '%' + (suffixLabel || 'WoW') + ')</span>';
      }

      function renderSynth2025Panel() {
        var yoyGrid = document.getElementById('synth2025YoyCardsGrid');
        var synth = calculerSyntheseGlobaleData();
        if (!synth || synth.empty) return;

        var kpiMap = {};
        synth.kpiRows.forEach(function (k) { kpiMap[k.label] = Number(k.numVal) || 0; });

        var req26 = kpiMap['Requested'] || 0;
        var del26 = kpiMap['Delivered Orders'] || 0;
        var gmvBrut26 = kpiMap['GMV Brut (Item total)'] || 0;
        var gmvAfter26 = kpiMap['GMV (Total Food VF)'] || kpiMap['GMV (Total Market VF)'] || 0;
        var aovAfter26 = del26 > 0 ? (gmvAfter26 / del26) : 0;
        var aovBrut26 = del26 > 0 ? (gmvBrut26 / del26) : 0;
        var ca26 = kpiMap['CA YASSIR'] || kpiMap['CA KOOL'] || 0;
        var promo26 = kpiMap['Promo Order'] || 0;
        var promoPct26 = del26 > 0 ? ((promo26 / del26) * 100) : 0;
        var activeStores26 = kpiMap['Active Store'] || 0;

        // Toutes les semaines de 2025 (Google Sheet 2025 en colonnes W 07..W 47) et de 2026 (Data exp)
        // Kool : les lignes 2025 Kool (onglet « 2025 Kool ») quand elles existent,
        // sinon map25 reste vide (pas de comparaison YoY, le message l'explique).
        var isKoolBrand = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        var map25 = extract2025MetricsByWeekMap(getActive2025Rows());
        var map26AllWeeks = compute2026AllWeeksStatsMap();
        var allSortedW26 = Array.from(map26AllWeeks.keys()).sort(function (a, b) { return a - b; });

        // Déterminer la semaine courante sélectionnée (ex: W47) — ne JAMAIS forcer W48 si l'utilisateur a sélectionné W47
        var curSelectedW = 0;
        if (state.dateStart) {
          curSelectedW = getIsoWeekNumber(state.dateStart);
        } else if (state.dateEnd) {
          curSelectedW = getIsoWeekNumber(state.dateEnd);
        } else if (allSortedW26.length > 0) {
          curSelectedW = allSortedW26[allSortedW26.length - 1];
        }

        var prevSelectedW = 0;
        if (state.prevDateStart) {
          prevSelectedW = getIsoWeekNumber(state.prevDateStart);
        } else if (state.prevDateEnd) {
          prevSelectedW = getIsoWeekNumber(state.prevDateEnd);
        } else if (curSelectedW > 1 && map26AllWeeks.has(curSelectedW - 1)) {
          prevSelectedW = curSelectedW - 1;
        }

        // Construire automatiquement la fenêtre des 4 semaines : [W-3, W-2, W-1, W] (ex: si W47 sélectionnée -> W44, W45, W46, W47)
        var last4Weeks = [];
        if (curSelectedW >= 4) {
          last4Weeks = [curSelectedW - 3, curSelectedW - 2, curSelectedW - 1, curSelectedW];
        } else if (allSortedW26.length > 0) {
          last4Weeks = allSortedW26.slice(-4);
        }

        var badgeWeeksEl = document.getElementById('weeklyOverviewWeeksBadge');
        if (badgeWeeksEl && last4Weeks.length > 0) {
          badgeWeeksEl.textContent = last4Weeks.map(function (w) { return 'W' + w; }).join(' • ');
        }

        // 1. Variation Year-over-Year (YoY) depuis le fichier 2025 :
        // Prend la semaine en cours et la semaine précédente (ex: W47 et W46, comme le filtre) et affiche les variations YoY exactes
        if (yoyGrid) {
          var targetWeeksForYoy = [];
          if (curSelectedW && map25.has(curSelectedW)) targetWeeksForYoy.push(curSelectedW);
          var prevWForYoy = prevSelectedW || (curSelectedW > 1 ? curSelectedW - 1 : 0);
          if (prevWForYoy && prevWForYoy !== curSelectedW && map25.has(prevWForYoy)) targetWeeksForYoy.push(prevWForYoy);
          if (targetWeeksForYoy.length === 0) {
            last4Weeks.forEach(function (w) { if (map25.has(w)) targetWeeksForYoy.push(w); });
          }

          if (targetWeeksForYoy.length > 0) {
            var cardsHtml = '';
            targetWeeksForYoy.forEach(function (wNo) {
              var m25 = map25.get(wNo);
              var m26 = map26AllWeeks.get(wNo) || { req: req26, del: del26, gmv: gmvAfter26, ca: ca26 };
              var delPct = m25.del > 0 ? (((m26.del - m25.del) / m25.del) * 100) : 0;
              var gmvPct = m25.gmv > 0 ? (((m26.gmv - m25.gmv) / m25.gmv) * 100) : 0;
              var reqPct = m25.req > 0 ? (((m26.req - m25.req) / m25.req) * 100) : 0;
              var aov26W = m26.del > 0 ? (m26.gmv / m26.del) : 0;
              var aov25W = m25.del > 0 ? (m25.gmv / m25.del) : 0;
              var aovPct = aov25W > 0 ? (((aov26W - aov25W) / aov25W) * 100) : 0;

              function fmtPctPill(p) {
                var s = p >= 0 ? '+' : '';
                var c = p >= 0 ? 'text-[#00897B] bg-emerald-50 border-emerald-200' : 'text-[#FF1E6E] bg-pink-50 border-pink-200';
                return '<span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold font-mono border ' + c + '">' + s + p.toFixed(1) + '%</span>';
              }

              cardsHtml += '<div class="rounded-2xl border border-purple-200 p-3.5 bg-white shadow-2xs space-y-2">' +
                '<div class="flex items-center justify-between border-b border-slate-100 pb-1.5">' +
                  '<span class="text-xs font-extrabold text-[#5B21B6]">W' + wNo + ' • Variation YoY (2026 vs 2025)</span>' +
                  '<span class="text-[10px] font-bold text-slate-400">Fichier 2025</span>' +
                '</div>' +
                '<div class="grid grid-cols-2 gap-1.5 text-[11px]">' +
                  '<div class="flex items-center justify-between bg-[#F8F9FC] px-2 py-1 rounded-lg"><span class="font-bold text-slate-600">Delivered :</span>' + fmtPctPill(delPct) + '</div>' +
                  '<div class="flex items-center justify-between bg-[#F8F9FC] px-2 py-1 rounded-lg"><span class="font-bold text-slate-600">GMV :</span>' + fmtPctPill(gmvPct) + '</div>' +
                  '<div class="flex items-center justify-between bg-[#F8F9FC] px-2 py-1 rounded-lg"><span class="font-bold text-slate-600">Requested :</span>' + fmtPctPill(reqPct) + '</div>' +
                  '<div class="flex items-center justify-between bg-[#F8F9FC] px-2 py-1 rounded-lg"><span class="font-bold text-slate-600">AOV :</span>' + fmtPctPill(aovPct) + '</div>' +
                '</div>' +
              '</div>';
            });
            // Ne pas écraser xl:col-span-12 (défini dans index.html) : sans lui,
            // la grille ne prend qu'1 des 12 colonnes et les cartes sont
            // écrasées dans une étroite bande à gauche (vu en capture).
            yoyGrid.className = 'xl:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-3';
            yoyGrid.innerHTML = cardsHtml;
          } else if (isKoolBrand) {
            yoyGrid.innerHTML = '<div class="col-span-full text-xs text-slate-500 py-1">Comparaison 2025 indisponible pour Kool : aucune donnée Kool 2025 (ni feuille 2025, ni historique).</div>';
          } else {
            yoyGrid.innerHTML = '<div class="col-span-full text-xs text-slate-500 py-1">Cliquez sur <strong>Sync YoY 2025</strong> pour charger les semaines de référence 2025 (W07–W47).</div>';
          }
        }

        // Note Kool sous les graphiques YoY : visible seulement s'il n'y a aucune
        // donnée 2025 Kool (la courbe 2025 est alors absente).
        var koolYoyNote = document.getElementById('koolNoYoyNote');
        if (koolYoyNote) koolYoyNote.classList.toggle('hidden', !(isKoolBrand && map25.size === 0));

        // 2. Calcul des métriques de la semaine précédente (Data préc ou W-1 automatique) pour WoW
        var prevReq = 0, prevDel = 0, prevGmvBrut = 0, prevGmvAfter = 0, prevCa = 0, prevPromo = 0, prevStoresCount = 0;
        var hasPrevData = false;

        if (state.prevSourceRows && state.prevSourceRows.length > 1) {
          var pHdrs = state.prevSourceRows[0].map(function (h) { return String(h || '').trim().toLowerCase().replace(/[_\s]+/g, ' '); });
          var pIdxOid = pHdrs.indexOf('order id');
          var pIdxSt = pHdrs.indexOf('status');
          var pIdxSrv = pHdrs.indexOf('services');
          var pIdxResto = pHdrs.indexOf('restaurant name');
          var pIdxItem = pHdrs.indexOf('item total');
          var pIdxTfVf = pHdrs.indexOf('total food vf');
          var pIdxTf = pHdrs.indexOf('total food');
          var pIdxCAdm = pHdrs.lastIndexOf('coupon admin');
          var pIdxCRes = pHdrs.lastIndexOf('coupon restaurant');
          var pIdxCDisc = pHdrs.lastIndexOf('coupon discount');
          var pIdxDiscAmt = pHdrs.lastIndexOf('discount amount');
          var pIdxDiscType = pHdrs.lastIndexOf('discount type');
          var pIdxFoodCat = pHdrs.indexOf('food category');
          var pIdxProv = pHdrs.lastIndexOf('discount type provider');
          var pIdxAmtRest = pHdrs.indexOf('amount to restaurant');
          var pIdxCa = pHdrs.indexOf('ca');
          var pSetSt = new Set();

          for (var pr = 1; pr < state.prevSourceRows.length; pr++) {
            var prow = state.prevSourceRows[pr];
            if (!prow) continue;
            if (pIdxOid !== -1 && !estOrderIdYaf(prow[pIdxOid])) continue;
            var rKey = pIdxResto !== -1 ? String(prow[pIdxResto] || '').trim().toLowerCase() : '';
            var srv = pIdxSrv !== -1 ? String(prow[pIdxSrv] || '').trim().toLowerCase() : '';
            var isMkt = srv.includes('market') || rKey.includes('mg market');
            if (isMarketOnlyViewer() ? !isMkt : isMkt) continue;

            hasPrevData = true;
            prevReq++;
            if (rKey) pSetSt.add(rKey);
            if (pIdxSt !== -1 && estCommandeLivree(prow[pIdxSt])) {
              prevDel++;
              var pTf = pIdxTf !== -1 ? purgerNombre(prow[pIdxTf]) : 0;
              var pCoup = Math.max(
                (pIdxCAdm !== -1 ? purgerNombre(prow[pIdxCAdm]) : 0) + (pIdxCRes !== -1 ? purgerNombre(prow[pIdxCRes]) : 0),
                pIdxCDisc !== -1 ? purgerNombre(prow[pIdxCDisc]) : 0
              );
              var pGmv = (pIdxTfVf !== -1 && prow[pIdxTfVf] !== '' && prow[pIdxTfVf] !== null) ? purgerNombre(prow[pIdxTfVf]) : (pTf + pCoup);
              prevGmvAfter += pGmv;
              prevGmvBrut += (pIdxItem !== -1 ? purgerNombre(prow[pIdxItem]) : pGmv);

              var pDAmt = pIdxDiscAmt !== -1 ? purgerNombre(prow[pIdxDiscAmt]) : 0;
              var pProv = pIdxProv !== -1 ? String(prow[pIdxProv] || '').trim().toLowerCase() : '';
              var pCaResto = pTf + pCoup + ((pProv === 'admin' || pProv === 'yassir') ? pDAmt : 0);
              if (Object.prototype.hasOwnProperty.call(state.customCommissions, rKey)) {
                prevCa += (state.customCommissions[rKey] * pCaResto) / 100;
              } else if (pIdxCa !== -1 && prow[pIdxCa] !== '' && prow[pIdxCa] !== null) {
                prevCa += purgerNombre(prow[pIdxCa]);
              } else {
                prevCa += (pCaResto - (pIdxAmtRest !== -1 ? purgerNombre(prow[pIdxAmtRest]) : 0));
              }

              var pDtStr = pIdxDiscType !== -1 ? String(prow[pIdxDiscType] || '') : '';
              var pFcStr = pIdxFoodCat !== -1 ? String(prow[pIdxFoodCat] || '') : '';
              if (/super\s*promo/i.test(pFcStr) || /percentage/i.test(pDtStr)) prevPromo++;
            }
          }
          prevStoresCount = pSetSt.size;
        } else if (prevSelectedW && map26AllWeeks.has(prevSelectedW)) {
          var prevWObj = map26AllWeeks.get(prevSelectedW);
          hasPrevData = true;
          prevReq = prevWObj.req;
          prevDel = prevWObj.del;
          prevGmvBrut = prevWObj.gmvBrut;
          prevGmvAfter = prevWObj.gmv;
          prevCa = prevWObj.ca;
          prevPromo = prevWObj.promo;
          prevStoresCount = prevWObj.stores.size;
        }

        // 3. SLIDE 1 : EXECUTIVE SUMMARY (Exactement comme la capture)
        var periodDays = 7;
        if (state.dateStart && state.dateEnd) {
          periodDays = Math.max(1, diffDaysBetweenIso(state.dateStart, state.dateEnd) + 1);
        } else if (allSortedW26.length > 0) {
          periodDays = allSortedW26.length * 7;
        }
        var avgDayDel = Math.round(del26 / periodDays);
        var prevAvgDayDel = hasPrevData ? Math.round(prevDel / periodDays) : 0;
        var avgDayWowPct = (hasPrevData && prevAvgDayDel > 0) ? (((avgDayDel - prevAvgDayDel) / prevAvgDayDel) * 100) : null;

        var elAvgVal = document.getElementById('execAvgDayVal');
        var elAvgWow = document.getElementById('execAvgDayWow');
        if (elAvgVal) elAvgVal.textContent = avgDayDel.toLocaleString('fr-FR');
        if (elAvgWow) elAvgWow.innerHTML = avgDayWowPct !== null ? ((avgDayWowPct >= 0 ? '+' : '') + avgDayWowPct.toFixed(0) + '%(WoW)') : 'AVG Del/Day';

        var wowGmvBrut = (hasPrevData && prevGmvBrut > 0) ? (((gmvBrut26 - prevGmvBrut) / prevGmvBrut) * 100) : null;
        var wowGmvAfter = (hasPrevData && prevGmvAfter > 0) ? (((gmvAfter26 - prevGmvAfter) / prevGmvAfter) * 100) : null;
        var wowReq = (hasPrevData && prevReq > 0) ? (((req26 - prevReq) / prevReq) * 100) : null;
        var wowDel = (hasPrevData && prevDel > 0) ? (((del26 - prevDel) / prevDel) * 100) : null;
        var prevAovAfter = prevDel > 0 ? (prevGmvAfter / prevDel) : 0;
        var diffAov = hasPrevData ? (aovAfter26 - prevAovAfter) : null;
        var caHt26 = ca26 / 1.19;
        var prevCaHt = prevCa / 1.19;
        var wowCa = (hasPrevData && prevCaHt > 0) ? (((caHt26 - prevCaHt) / prevCaHt) * 100) : null;
        var wowPromo = (hasPrevData && prevPromo > 0) ? (((promo26 - prevPromo) / prevPromo) * 100) : null;
        var diffStores = hasPrevData ? (activeStores26 - prevStoresCount) : null;

        var elGb = document.getElementById('execGmvBrutVal');
        var elGbW = document.getElementById('execGmvBrutWow');
        if (elGb) elGb.textContent = Math.round(gmvBrut26).toLocaleString('fr-FR');
        if (elGbW) elGbW.innerHTML = wowGmvBrut !== null ? formatWowBadgeHtml(wowGmvBrut, '') : '';

        var elGa = document.getElementById('execGmvAfterVal');
        var elGaW = document.getElementById('execGmvAfterWow');
        if (elGa) elGa.textContent = Math.round(gmvAfter26).toLocaleString('fr-FR');
        if (elGaW) elGaW.innerHTML = wowGmvAfter !== null ? formatWowBadgeHtml(wowGmvAfter, '') : '';

        var elReqV = document.getElementById('execCardReqVal');
        var elReqW = document.getElementById('execCardReqWow');
        if (elReqV) elReqV.textContent = req26.toLocaleString('fr-FR');
        if (elReqW) elReqW.innerHTML = formatWowBadgeHtml(wowReq, 'WoW');

        var elDelV = document.getElementById('execCardDelVal');
        var elDelW = document.getElementById('execCardDelWow');
        if (elDelV) elDelV.textContent = del26.toLocaleString('fr-FR');
        if (elDelW) elDelW.innerHTML = formatWowBadgeHtml(wowDel, 'WoW');

        var elAovV = document.getElementById('execCardAovVal');
        var elAovSub = document.getElementById('execCardAovBrutSub');
        var elAovW = document.getElementById('execCardAovWow');
        if (elAovV) elAovV.textContent = aovAfter26.toFixed(1);
        if (elAovSub) elAovSub.textContent = '(' + Math.round(aovBrut26) + ')';
        if (elAovW) {
          if (diffAov !== null) {
            var sA = diffAov >= 0 ? '+' : '';
            var cA = diffAov >= 0 ? 'text-[#00897B]' : 'text-[#FF1E6E]';
            elAovW.innerHTML = '<span class="' + cA + '">(' + sA + diffAov.toFixed(1) + 'WoW)</span>';
          } else {
            elAovW.textContent = '(-)';
          }
        }

        var elCaV = document.getElementById('execCardCaVal');
        var elCaW = document.getElementById('execCardCaWow');
        if (elCaV) elCaV.textContent = Math.round(caHt26).toLocaleString('fr-FR');
        if (elCaW) {
          elCaW.innerHTML = wowCa !== null
            ? '<span>(' + (wowCa >= 0 ? '+' : '') + wowCa.toFixed(0) + '%WoW)</span>'
            : '(-)';
        }

        var elPrV = document.getElementById('execCardPromoVal');
        var elPrW = document.getElementById('execCardPromoWow');
        if (elPrV) elPrV.textContent = promo26.toLocaleString('fr-FR') + '(' + Math.round(promoPct26) + '%)';
        if (elPrW) elPrW.innerHTML = formatWowBadgeHtml(wowPromo, 'WoW');

        var elStV = document.getElementById('execCardStoreVal');
        var elStW = document.getElementById('execCardStoreWow');
        if (elStV) elStV.textContent = activeStores26.toLocaleString('fr-FR');
        if (elStW) {
          if (diffStores !== null) {
            var sSt = diffStores >= 0 ? '+' : '';
            var cSt = diffStores >= 0 ? 'text-[#00897B]' : 'text-[#FF1E6E]';
            elStW.innerHTML = '<span class="' + cSt + '">(' + sSt + diffStores + 'WoW)</span>';
          } else {
            elStW.textContent = '(-)';
          }
        }

        // Highlights texte sous le graphe Executive Summary :
        // - Top Weekly Order performance : basé sur la semaine sélectionnée (curSelectedW, ex: W47-26) et le pic historique (2025 + 2026 jusqu'à curSelectedW, sans forcer W48 !)
        // - Top AVG Del/Day : pic AVG/Day vs AVG/Day de la semaine sélectionnée (ex: W47-26)
        // - Top Del Ord/Day : record journalier exact (2025 + 2026)
        var bulletsEl = document.getElementById('execSummaryBullets');
        if (bulletsEl) {
          var bestWeekObj = null;
          var bestWeekYearTag = '26';
          // Chercher le pic hebdomadaire dans 2026 (jusqu'à curSelectedW si une semaine est sélectionnée)
          map26AllWeeks.forEach(function (wObj) {
            if (curSelectedW && wObj.week > curSelectedW) return;
            if (!bestWeekObj || wObj.del > bestWeekObj.del) {
              bestWeekObj = wObj;
              bestWeekYearTag = '26';
            }
          });
          // Comparer aussi avec les semaines disponibles dans le fichier 2025 (jusqu'à curSelectedW)
          map25.forEach(function (w25Obj) {
            if (curSelectedW && w25Obj.week > curSelectedW) return;
            if (!bestWeekObj || w25Obj.del > bestWeekObj.del) {
              bestWeekObj = w25Obj;
              bestWeekYearTag = '25';
            }
          });

          var bestWLabel = bestWeekObj ? ('W' + bestWeekObj.week + '-' + bestWeekYearTag) : '-';
          var bestWStr = bestWeekObj
            ? ('(Req)' + Math.round(bestWeekObj.req) + '/(Del)' + Math.round(bestWeekObj.del) + '/(GMV)' + Math.round(bestWeekObj.gmv))
            : '-';

          var curWLabel = curSelectedW ? ('W' + curSelectedW + '-26') : 'Période';
          var curWObj = curSelectedW && map26AllWeeks.has(curSelectedW)
            ? map26AllWeeks.get(curSelectedW)
            : { req: req26, del: del26, gmv: gmvAfter26 };

          var vsReqPct = (bestWeekObj && bestWeekObj.req > 0) ? (((curWObj.req - bestWeekObj.req) / bestWeekObj.req) * 100) : 0;
          var vsDelPct = (bestWeekObj && bestWeekObj.del > 0) ? (((curWObj.del - bestWeekObj.del) / bestWeekObj.del) * 100) : 0;
          var vsGmvPct = (bestWeekObj && bestWeekObj.gmv > 0) ? (((curWObj.gmv - bestWeekObj.gmv) / bestWeekObj.gmv) * 100) : 0;
          var vsTripleStr = bestWeekObj
            ? ((vsReqPct >= 0 ? '+' : '') + vsReqPct.toFixed(1).replace('.', ',') + '%/' +
               (vsDelPct >= 0 ? '+' : '') + vsDelPct.toFixed(1).replace('.', ',') + '%/' +
               (vsGmvPct >= 0 ? '+' : '') + vsGmvPct.toFixed(0) + '%')
            : '';

          var bestWAvg = bestWeekObj ? Math.round(bestWeekObj.del / 7) : avgDayDel;
          var vsBestAvgPct = bestWAvg > 0 ? Math.round(((avgDayDel - bestWAvg) / bestWAvg) * 100) : 0;

          // Meilleur jour (commandes livrées) calculé sur les données disponibles.
          // Yassir : record historique codé en dur (3006 le 25/11/2022).
          // Kool : meilleur jour de l'archive chargée (oct.–nov. 2026) — jamais inventé.
          var topDayTxt = '3006(25/11/2022)';
          if (isKoolBrand) {
            var bestDayVal = 0;
            var bestDayIso = '';
            map26AllWeeks.forEach(function (wObj) {
              if (curSelectedW && wObj.week > curSelectedW) return;
              if (!wObj.dailyDel) return;
              wObj.dailyDel.forEach(function (cnt, iso) {
                if (cnt > bestDayVal) { bestDayVal = cnt; bestDayIso = iso; }
              });
            });
            if (bestDayVal > 0 && bestDayIso) {
              var bdParts = bestDayIso.split('-');
              topDayTxt = Number(bestDayVal).toLocaleString('fr-FR') + ' (' + bdParts[2] + '/' + bdParts[1] + '/' + bdParts[0] + ') • sur les données disponibles (oct.–nov. 2026)';
            } else {
              topDayTxt = 'n/a • sur les données disponibles (oct.–nov. 2026)';
            }
          }

          bulletsEl.innerHTML =
            '<li>• <span class="text-[#5B21B6] font-extrabold">Top Weekly Order performance : ' + escapeHtml(bestWLabel) + ' :</span> <span class="text-[#5B21B6] font-bold">' + escapeHtml(bestWStr) + '</span> <span class="text-[#FF1E6E] font-extrabold">__ ' + escapeHtml(vsTripleStr) + '</span></li>' +
            '<li>• <span class="text-[#5B21B6] font-extrabold">Top AVG Del/Day :</span> <span class="text-[#5B21B6] font-bold">' + bestWAvg.toLocaleString('fr-FR') + '(' + escapeHtml(bestWLabel) + ') <strong>VS</strong> ' + avgDayDel.toLocaleString('fr-FR') + '(' + escapeHtml(curWLabel) + ')</span> <span class="text-[#FF1E6E] font-extrabold">' + (vsBestAvgPct >= 0 ? '+' : '') + vsBestAvgPct + '%</span></li>' +
            '<li>• <span class="text-[#5B21B6] font-extrabold">Top Del Ord/Day :</span> <span class="text-[#5B21B6] font-bold">' + escapeHtml(topDayTxt) + '</span></li>';
        }

        // Graphe Executive Summary (Lundi -> Dimanche : Barres Req & Del + Courbe GMV avec toutes les valeurs affichées)
        var execCanvas = document.getElementById('execSummaryDailyChartCanvas');
        if (execCanvas && window.Chart) {
          if (execSummaryDailyChartInst) execSummaryDailyChartInst.destroy();
          var dLabels = synth.dayStats.map(function (d) { return d.day; });
          var dReq = synth.dayStats.map(function (d) { return d.req; });
          var dDel = synth.dayStats.map(function (d) { return d.del; });
          var dGmv = synth.dayStats.map(function (d) { return Math.round(d.gmv); });

          execSummaryDailyChartInst = new Chart(execCanvas.getContext('2d'), {
            type: 'bar',
            plugins: [yassirSlideDataLabelsPlugin],
            data: {
              labels: dLabels,
              datasets: [
                {
                  type: 'line',
                  label: 'GMV',
                  data: dGmv,
                  borderColor: '#1A1A2E',
                  backgroundColor: '#1A1A2E',
                  borderWidth: 2,
                  borderDash: [2, 2],
                  pointRadius: 3.5,
                  yAxisID: 'y1',
                  order: 0
                },
                {
                  label: 'Req',
                  data: dReq,
                  backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9',
                  borderRadius: 2,
                  yAxisID: 'y',
                  order: 1
                },
                {
                  label: 'Del',
                  data: dDel,
                  backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF1E6E',
                  borderRadius: 2,
                  yAxisID: 'y',
                  order: 2
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              yassirLabelMode: 'exec_daily',
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, position: 'left', grid: { color: window.yassirCouleurGraphique('#E2E8F0') }, ticks: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#6C2BD9') } },
                y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#6C2BD9') } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } }
              }
            }
          });
        }

        // 4. SLIDE 2 : WEEKLY & YEARLY PERFORMANCE OVERVIEW (Remplit automatiquement W44, W45, W46, W47)
        var wLabelsLower = last4Weeks.map(function (w) { return 'w' + w; });
        var wLabelsUpper = last4Weeks.map(function (w) { return 'W' + w; });

        var w26ReqArr = last4Weeks.map(function (w) { return map26AllWeeks.has(w) ? map26AllWeeks.get(w).req : 0; });
        var w26DelArr = last4Weeks.map(function (w) { return map26AllWeeks.has(w) ? map26AllWeeks.get(w).del : 0; });
        var w26GmvArr = last4Weeks.map(function (w) { return map26AllWeeks.has(w) ? Math.round(map26AllWeeks.get(w).gmv) : 0; });
        var w26AovBeforeArr = last4Weeks.map(function (w) {
          var o = map26AllWeeks.get(w);
          return (o && o.del > 0) ? Number((o.gmvBrut / o.del).toFixed(1)) : 0;
        });
        var w26AovAfterArr = last4Weeks.map(function (w) {
          var o = map26AllWeeks.get(w);
          return (o && o.del > 0) ? Number((o.gmv / o.del).toFixed(1)) : 0;
        });

        var w25DelArr = last4Weeks.map(function (w) { return map25.has(w) ? Math.round(map25.get(w).del) : null; });
        var w25GmvArr = last4Weeks.map(function (w) { return map25.has(w) ? Math.round(map25.get(w).gmv) : null; });

        // Kool (slide 34 du deck) : Daily Orders (barres) vs Avg Daily GMV (courbe) par semaine.
        // Avg Daily GMV = GMV de la semaine / 7 jours calendaires ; Daily Orders = livrées / 7.
        // Yassir : graphique WoW inchangé (GMV + Received + Delivered).
        var wowPerfTitle = document.getElementById('weeklyWowPerfTitle');
        if (wowPerfTitle) wowPerfTitle.textContent = isKoolBrand ? 'Daily Orders vs Avg Daily GMV' : 'WoW Performance';
        var wowPerfDatasets;
        if (isKoolBrand) {
          wowPerfDatasets = [
            {
              type: 'line',
              label: 'Avg Daily GMV',
              data: w26GmvArr.map(function (v) { return Math.round(v / 7); }),
              borderColor: '#111111',
              backgroundColor: '#111111',
              borderWidth: 2,
              borderDash: [2, 2],
              pointRadius: 3.5,
              yAxisID: 'y1',
              order: 0
            },
            {
              label: 'Daily Orders',
              data: w26DelArr.map(function (v) { return Math.round(v / 7); }),
              backgroundColor: '#FFD100',
              borderRadius: 2,
              yAxisID: 'y',
              order: 1
            }
          ];
        } else {
          wowPerfDatasets = [
            {
              type: 'line',
              label: 'GMV',
              data: w26GmvArr,
              borderColor: '#1A1A2E',
              backgroundColor: '#1A1A2E',
              borderWidth: 2,
              borderDash: [2, 2],
              pointRadius: 3.5,
              yAxisID: 'y1',
              order: 0
            },
            {
              label: 'Received',
              data: w26ReqArr,
              backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9',
              borderRadius: 2,
              yAxisID: 'y',
              order: 1
            },
            {
              label: 'Delivered',
              data: w26DelArr,
              backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF1E6E',
              borderRadius: 2,
              yAxisID: 'y',
              order: 2
            }
          ];
        }

        var wowPerfCanvas = document.getElementById('weeklyWowPerfChartCanvas');
        if (wowPerfCanvas && window.Chart) {
          if (weeklyWowPerfChartInst) weeklyWowPerfChartInst.destroy();
          weeklyWowPerfChartInst = new Chart(wowPerfCanvas.getContext('2d'), {
            type: 'bar',
            plugins: [yassirSlideDataLabelsPlugin],
            data: {
              labels: wLabelsLower,
              datasets: wowPerfDatasets
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              yassirLabelMode: 'wow_perf',
              plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } } },
              scales: {
                y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#6C2BD9') } },
                y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#6C2BD9') } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } }
              }
            }
          });
        }

        var aovCanvas = document.getElementById('weeklyAovCompareChartCanvas');
        if (aovCanvas && window.Chart) {
          if (weeklyAovCompareChartInst) weeklyAovCompareChartInst.destroy();
          weeklyAovCompareChartInst = new Chart(aovCanvas.getContext('2d'), {
            type: 'bar',
            plugins: [yassirSlideDataLabelsPlugin],
            data: {
              labels: wLabelsUpper,
              datasets: [
                {
                  label: 'AOV Before %',
                  data: w26AovBeforeArr,
                  backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9',
                  borderRadius: 2,
                  formatLabel: function (v) { return Number(v).toFixed(1).replace('.', ','); }
                },
                {
                  label: 'AOV After %',
                  data: w26AovAfterArr,
                  backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF1E6E',
                  borderRadius: 2,
                  formatLabel: function (v) { return Number(v).toFixed(1).replace('.', ','); }
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              yassirLabelMode: 'aov_bars',
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, suggestedMax: 40, ticks: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6'), callback: function (v) { return Number(v).toFixed(1).replace('.', ','); } } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } }
              }
            }
          });
        }

        var yoyDelCanvas = document.getElementById('yoyDeliveredChartCanvas');
        if (yoyDelCanvas && window.Chart) {
          if (yoyDeliveredChartInst) yoyDeliveredChartInst.destroy();
          yoyDeliveredChartInst = new Chart(yoyDelCanvas.getContext('2d'), {
            type: 'line',
            plugins: [yassirSlideDataLabelsPlugin],
            data: {
              labels: wLabelsUpper,
              datasets: [
                { label: '2025', data: w25DelArr, borderColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9', backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9', borderWidth: 2, tension: 0.35, pointRadius: 3.5, spanGaps: true },
                { label: '2026', data: w26DelArr, borderColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF1E6E', backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF1E6E', borderWidth: 2, tension: 0.35, pointRadius: 3.5 }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              yassirLabelMode: 'yoy_line',
              layout: { padding: { top: 20, bottom: 20, left: 12, right: 12 } },
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, ticks: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } }
              }
            }
          });
        }

        var yoyGmvCanvas = document.getElementById('yoyGmvChartCanvas');
        if (yoyGmvCanvas && window.Chart) {
          if (yoyGmvChartInst) yoyGmvChartInst.destroy();
          yoyGmvChartInst = new Chart(yoyGmvCanvas.getContext('2d'), {
            type: 'line',
            plugins: [yassirSlideDataLabelsPlugin],
            data: {
              labels: wLabelsUpper,
              datasets: [
                { label: '2025', data: w25GmvArr, borderColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9', backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9', borderWidth: 2, tension: 0.35, pointRadius: 3.5, spanGaps: true },
                { label: '2026', data: w26GmvArr, borderColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF1E6E', backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF1E6E', borderWidth: 2, tension: 0.35, pointRadius: 3.5 }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              yassirLabelMode: 'yoy_line',
              layout: { padding: { top: 20, bottom: 20, left: 12, right: 12 } },
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, ticks: { font: { size: 10, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' }, color: window.yassirCouleurGraphique('#5B21B6') } }
              }
            }
          });
        }
      }

      // Génération haute résolution PNG des Slides (Executive Summary & Weekly/YoY Overview)
      function renderExecSummarySlidePngCanvas() {
        var c = document.createElement('canvas');
        c.width = 1600;
        c.height = 900;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, c.width, c.height);

        // Bandeau titre rose
        ctx.fillStyle = '#FF1E6E';
        ctx.beginPath();
        ctx.moveTo(0, 28);
        ctx.lineTo(390, 28);
        ctx.lineTo(415, 56);
        ctx.lineTo(390, 84);
        ctx.lineTo(0, 84);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 22px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Executive Summary', 28, 63);

        // Carte AVG/DAY
        ctx.fillStyle = '#5B21B6';
        ctx.fillRect(60, 110, 190, 34);
        ctx.fillStyle = '#6C2BD9';
        ctx.fillRect(60, 144, 190, 62);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.font = '800 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('AVG/DAY', 155, 132);
        var avgVal = (document.getElementById('execAvgDayVal') || {}).textContent || '0';
        var avgWow = (document.getElementById('execAvgDayWow') || {}).textContent || '';
        ctx.font = '800 24px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(avgVal, 155, 173);
        ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#FBCFE8';
        ctx.fillText(avgWow, 155, 195);

        // Graphe Lundi-Dimanche
        var dailyCanvas = document.getElementById('execSummaryDailyChartCanvas');
        if (dailyCanvas) {
          ctx.drawImage(dailyCanvas, 50, 225, 860, 440);
        }

        // Bullets sous le graphe
        var bulletsEl = document.getElementById('execSummaryBullets');
        if (bulletsEl) {
          var lis = bulletsEl.querySelectorAll('li');
          ctx.textAlign = 'left';
          ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = '#5B21B6';
          lis.forEach(function (li, idx) {
            ctx.fillText(li.textContent.trim(), 55, 705 + idx * 32);
          });
        }

        // GMV Brut & GMV After %
        var gmvB = (document.getElementById('execGmvBrutVal') || {}).textContent || '0';
        var gmvBW = (document.getElementById('execGmvBrutWow') || {}).textContent || '';
        var gmvA = (document.getElementById('execGmvAfterVal') || {}).textContent || '0';
        var gmvAW = (document.getElementById('execGmvAfterWow') || {}).textContent || '';

        ctx.textAlign = 'center';
        ctx.fillStyle = '#1A1A2E';
        ctx.font = '800 18px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('GMV Brut', 1075, 140);
        ctx.fillText('GMV After %', 1375, 140);
        ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(gmvB + ' ' + gmvBW, 1075, 178);
        ctx.fillText(gmvA + ' ' + gmvAW, 1375, 178);

        // 6 Cartes KPI
        var cards = [
          { val: (document.getElementById('execCardReqVal') || {}).textContent || '0', lbl: 'Req', wow: (document.getElementById('execCardReqWow') || {}).textContent || '', pink: false },
          { val: (document.getElementById('execCardDelVal') || {}).textContent || '0', lbl: 'Del', wow: (document.getElementById('execCardDelWow') || {}).textContent || '', pink: false },
          { val: ((document.getElementById('execCardAovVal') || {}).textContent || '0') + ((document.getElementById('execCardAovBrutSub') || {}).textContent || ''), lbl: 'AOV', wow: (document.getElementById('execCardAovWow') || {}).textContent || '', pink: false },
          { val: (document.getElementById('execCardCaVal') || {}).textContent || '0', lbl: 'CA HT', wow: (document.getElementById('execCardCaWow') || {}).textContent || '', pink: true },
          { val: (document.getElementById('execCardPromoVal') || {}).textContent || '0', lbl: 'Promo.Order', wow: (document.getElementById('execCardPromoWow') || {}).textContent || '', pink: false },
          { val: (document.getElementById('execCardStoreVal') || {}).textContent || '0', lbl: 'Active Store', wow: (document.getElementById('execCardStoreWow') || {}).textContent || '', pink: false }
        ];
        cards.forEach(function (cd, i) {
          var col = i % 2;
          var row = Math.floor(i / 2);
          var x = 945 + col * 305;
          var y = 225 + row * 185;
          ctx.fillStyle = cd.pink ? '#FF1E6E' : '#E4DFF5';
          ctx.fillRect(x, y, 275, 160);
          ctx.fillStyle = cd.pink ? '#FFFFFF' : '#5B21B6';
          ctx.font = '800 30px "Plus Jakarta Sans", sans-serif';
          ctx.fillText(cd.val, x + 137, y + 60);
          ctx.font = '700 18px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = cd.pink ? '#FCE7F3' : '#6C2BD9';
          ctx.fillText(cd.lbl, x + 137, y + 92);
          ctx.font = '800 16px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = cd.pink ? '#FFFFFF' : '#475569';
          ctx.fillText(cd.wow, x + 137, y + 128);
        });

        // Pied de page
        ctx.fillStyle = '#6C2BD9';
        ctx.font = '800 16px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Yassir   |   Commercial Review   |   2026', 45, 865);
        ctx.textAlign = 'right';
        ctx.fillText('Yassir.com   |   3', 1555, 865);
        return c;
      }

      function renderWeeklyOverviewSlidePngCanvas() {
        var c = document.createElement('canvas');
        c.width = 1600;
        c.height = 900;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#EFEFF3';
        ctx.fillRect(0, 0, c.width, c.height);

        // Bandeau titre rose
        ctx.fillStyle = '#FF1E6E';
        ctx.beginPath();
        ctx.moveTo(0, 28);
        ctx.lineTo(590, 28);
        ctx.lineTo(615, 56);
        ctx.lineTo(590, 84);
        ctx.lineTo(0, 84);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 22px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Weekly & Yearly Performance Overview', 28, 63);

        // Séparateur pointillé vertical
        ctx.save();
        ctx.strokeStyle = '#FF1E6E';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(800, 115);
        ctx.lineTo(800, 825);
        ctx.stroke();
        ctx.restore();

        // Titres & graphes
        ctx.fillStyle = '#5B21B6';
        ctx.font = '800 18px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('WoW Performance', 415, 130);
        ctx.fillText('Delivered YoY (2025-2026)', 1200, 130);
        ctx.fillText('GMV YoY (2025-2026)', 1200, 485);

        var c1 = document.getElementById('weeklyWowPerfChartCanvas');
        var c2 = document.getElementById('weeklyAovCompareChartCanvas');
        var c3 = document.getElementById('yoyDeliveredChartCanvas');
        var c4 = document.getElementById('yoyGmvChartCanvas');

        if (c1) ctx.drawImage(c1, 55, 145, 710, 325);
        if (c2) ctx.drawImage(c2, 55, 495, 710, 320);
        if (c3) ctx.drawImage(c3, 835, 145, 720, 315);
        if (c4) ctx.drawImage(c4, 835, 500, 720, 315);

        // Pied de page
        ctx.fillStyle = '#6C2BD9';
        ctx.font = '800 16px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Yassir   |   Commercial Business Review   |   2026', 45, 868);
        ctx.textAlign = 'right';
        ctx.fillText('Yassir.com   |   4', 1555, 868);
        return c;
      }

      function triggerCanvasPngDownload(canvas, filename) {
        var link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        window.yassirJournaliser('export', 'Graphique PNG : ' + filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      window.yassirDownloadSingleSlidePng = function (which) {
        var dateStr = new Date().toISOString().slice(0, 10);
        if (which === 'exec') {
          triggerCanvasPngDownload(renderExecSummarySlidePngCanvas(), 'YASSIR_Executive_Summary_' + dateStr + '.png');
          showToast('Slide <strong>Executive Summary (.png)</strong> téléchargée.', 'success');
        } else {
          triggerCanvasPngDownload(renderWeeklyOverviewSlidePngCanvas(), 'YASSIR_Weekly_YoY_Overview_' + dateStr + '.png');
          showToast('Slide <strong>Weekly & Yearly Overview (.png)</strong> téléchargée.', 'success');
        }
      };

      window.yassirDownloadSlidesPng = function () {
        var dateStr = new Date().toISOString().slice(0, 10);
        triggerCanvasPngDownload(renderExecSummarySlidePngCanvas(), 'YASSIR_Slide1_Executive_Summary_' + dateStr + '.png');
        setTimeout(function () {
          triggerCanvasPngDownload(renderWeeklyOverviewSlidePngCanvas(), 'YASSIR_Slide2_Weekly_YoY_Overview_' + dateStr + '.png');
        }, 300);
        showToast('Les 2 slides (<strong>Executive Summary</strong> & <strong>Weekly/YoY Overview</strong>) ont été téléchargées en PNG haute résolution.', 'success');
      };

      function renderSynthGlobalPanel() {
        var emptyEl = document.getElementById('synthGlobalEmptyState');
        var gridEl = document.getElementById('synthGlobalContentGrid');
        var btnXlsx = document.getElementById('btnExportSynthGlobalXlsx');
        var btnCsv = document.getElementById('btnExportSynthGlobalCsv');
        var kpisBody = document.getElementById('synthGlobalKpisBody');
        var daysBody = document.getElementById('synthGlobalDaysBody');

        var isMktMode = isMarketOnlyViewer();
        var sBadge = document.getElementById('synthServiceBadge');
        var sHeading = document.getElementById('synthMainHeading');
        var sDesc = document.getElementById('synthMainDesc');
        var sBtnXlsx = document.getElementById('btnExportSynthGlobalXlsx');
        var sVarSub = document.getElementById('synthVariationSubDesc');
        if (isMktMode) {
          var scopeLbl = getEffectiveAmFilter() === 'ALL' ? 'Vue Globale Market' : ('Portefeuille ' + getEffectiveAmFilter());
          if (sBadge) sBadge.textContent = 'Market VF Uniquement • ' + scopeLbl;
          if (sHeading) sHeading.textContent = 'Synthèse Market (17 KPIs & Récapitulatif Lundi–Dimanche)';
          if (sDesc) sDesc.innerHTML = 'Calculé <strong>uniquement sur les commandes Market VF (<span id="synthFoodOnlyCountBadge">0</span> commandes)</strong>. Périmètre : <strong>' + escapeHtml(scopeLbl) + '</strong>.';
          if (sBtnXlsx) sBtnXlsx.innerHTML = '<i class="fa-solid fa-file-excel"></i><span>Télécharger Synthèse Market (.xlsx)</span>';
          if (sVarSub) sVarSub.innerHTML = 'Commandes <strong>Market VF</strong> uniquement • Trié par commandes livrées décroissantes';
        } else {
          if (sBadge) sBadge.textContent = 'Food VF Uniquement (Hors Market) • Vue Globale';
          if (sHeading) sHeading.textContent = 'Synthèse Globale Food (17 KPIs & Récapitulatif Lundi–Dimanche)';
          if (sDesc) sDesc.innerHTML = 'Calculé <strong>uniquement sur les commandes Food VF (<span id="synthFoodOnlyCountBadge">0</span> commandes)</strong>, sans inclure le Market. Réservé à <strong>Ahmed Marrouki</strong>, <strong>Karim Ben Rahal</strong> et au <strong>Propriétaire</strong>.';
          if (sBtnXlsx) sBtnXlsx.innerHTML = '<i class="fa-solid fa-file-excel"></i><span>Télécharger Synthèse Food (.xlsx)</span>';
          if (sVarSub) sVarSub.innerHTML = 'Commandes <strong>Food VF</strong> uniquement • Trié par commandes livrées décroissantes';
        }

        var synth = calculerSyntheseGlobaleData();
        var countBadge = document.getElementById('synthFoodOnlyCountBadge');
        if (countBadge) countBadge.textContent = synth ? synth.foodCount : 0;

        if (!synth || synth.empty) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          if (gridEl) gridEl.classList.add('hidden');
          if (btnXlsx) btnXlsx.disabled = true;
          if (btnCsv) btnCsv.disabled = true;
          return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');
        if (gridEl) gridEl.classList.remove('hidden');
        if (btnXlsx) btnXlsx.disabled = false;
        if (btnCsv) btnCsv.disabled = false;

        if (kpisBody) {
          kpisBody.innerHTML = synth.kpiRows.map(function (r) {
            return '<tr>' +
              '<td class="px-4 py-2 font-extrabold text-white bg-[#5B21B6] border border-purple-400/30 w-3/5">' + escapeHtml(r.label) + '</td>' +
              '<td class="px-4 py-2 font-extrabold text-white bg-[#FF1E6E] border border-pink-400/30 text-center font-mono w-2/5">' + escapeHtml(String(r.value)) + '</td>' +
            '</tr>';
          }).join('');
        }

        if (daysBody) {
          var rowsHtml = synth.dayStats.map(function (d) {
            return '<tr class="hover:bg-[#F3EBFF]/40">' +
              '<td class="px-4 py-2 text-center font-semibold text-[#1A1A2E] border border-slate-200">' + escapeHtml(d.day) + '</td>' +
              '<td class="px-4 py-2 text-center font-mono text-[#1A1A2E] border border-slate-200">' + d.req + '</td>' +
              '<td class="px-4 py-2 text-center font-mono text-[#1A1A2E] border border-slate-200">' + d.del + '</td>' +
              '<td class="px-4 py-2 text-center font-mono text-[#1A1A2E] border border-slate-200">' + Math.round(d.gmv) + '</td>' +
            '</tr>';
          }).join('');

          rowsHtml += '<tr class="bg-[#FF1E6E] text-white font-extrabold">' +
            '<td class="px-4 py-2.5 text-center border border-pink-400/40">Total</td>' +
            '<td class="px-4 py-2.5 text-center font-mono border border-pink-400/40">' + synth.totals.req + '</td>' +
            '<td class="px-4 py-2.5 text-center font-mono border border-pink-400/40">' + synth.totals.del + '</td>' +
            '<td class="px-4 py-2.5 text-center font-mono border border-pink-400/40">' + synth.totals.gmv.toFixed(2) + '</td>' +
          '</tr>';

          daysBody.innerHTML = rowsHtml;
        }

        renderSynth2025Panel();

        var varSection = document.getElementById('synthVariationSection');
        var hasPrev = canSeeGlobalSynth() && ((state.prevSourceRows && state.prevSourceRows.length > 1) || ((state.prevDateStart || state.prevDateEnd) && state.rawSourceRows && state.rawSourceRows.length > 1));
        // Bascule Top 20 / Top Growth (slides 35-36 du deck) : visible en Kool uniquement.
        var varSortBtns = document.getElementById('variationSortButtons');
        if (varSortBtns) {
          var isKoolVar = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
          varSortBtns.classList.toggle('hidden', !isKoolVar);
          if (isKoolVar) updateVariationSortButtonsUI();
        }
        if (varSection) {
          if (hasPrev) {
            currentVariationRowsList = calculerVariationEntrePeriodes();
            varSection.classList.remove('hidden');
            window.yassirRenderVariationTable();
          } else {
            currentVariationRowsList = [];
            varSection.classList.add('hidden');
          }
        }
      }

      function buildSynthSheetFromData(synth) {
        var combinedAoa = [];
        if (!synth || synth.empty) {
          combinedAoa.push(['Aucune commande dans cette catégorie', 0]);
          var wsEmpty = XLSX.utils.aoa_to_sheet(combinedAoa);
          wsEmpty['!cols'] = [{ wch: 36 }, { wch: 14 }];
          return wsEmpty;
        }
        var maxRows = Math.max(synth.kpiRows.length, synth.dayStats.length + 2);
        for (var i = 0; i < maxRows; i++) {
          var rowArr = ['', '', '', '', '', '', ''];
          if (i < synth.kpiRows.length) {
            rowArr[0] = synth.kpiRows[i].label;
            rowArr[1] = synth.kpiRows[i].numVal;
          }
          if (i === 0) {
            rowArr[3] = 'Day';
            rowArr[4] = 'Req';
            rowArr[5] = 'Del';
            rowArr[6] = 'GMV';
          } else if (i >= 1 && i <= synth.dayStats.length) {
            var dObj = synth.dayStats[i - 1];
            rowArr[3] = dObj.day;
            rowArr[4] = dObj.req;
            rowArr[5] = dObj.del;
            rowArr[6] = Number(dObj.gmv.toFixed(2));
          } else if (i === synth.dayStats.length + 1) {
            rowArr[3] = 'Total';
            rowArr[4] = synth.totals.req;
            rowArr[5] = synth.totals.del;
            rowArr[6] = synth.totals.gmv;
          }
          combinedAoa.push(rowArr);
        }
        var ws = XLSX.utils.aoa_to_sheet(combinedAoa);
        ws['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 4 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
        return ws;
      }

      window.yassirExportSynthGlobalExcel = function () {
        if (!canSeeGlobalSynth() || (!isMarketOnlyViewer() && getEffectiveAmFilter() !== 'ALL')) return;
        var isMktMode = isMarketOnlyViewer();
        var synthFood = calculerSyntheseGlobaleData();
        if (!synthFood || synthFood.empty) return;

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, buildSynthSheetFromData(synthFood), isMktMode ? 'Synthèse Market' : 'Synthèse Food');

        if ((state.prevSourceRows && state.prevSourceRows.length > 1) || ((state.prevDateStart || state.prevDateEnd) && state.rawSourceRows && state.rawSourceRows.length > 1)) {
          var vRows = calculerVariationEntrePeriodes();
          if (vRows.length > 0) {
            var vHeaders = [
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
            var vAoa = [vHeaders];
            vRows.forEach(function (r) {
              vAoa.push([
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
            var wsVar = XLSX.utils.aoa_to_sheet(vAoa);
            wsVar['!cols'] = vHeaders.map(function (h) { return { wch: Math.max(14, h.length + 3) }; });
            XLSX.utils.book_append_sheet(wb, wsVar, isMktMode ? 'Variation Market' : 'Variation Food');
          }
        }
        var map25Exp = extract2025MetricsByWeekMap(getActive2025Rows());
        var map26Exp = compute2026AllWeeksStatsMap();
        var yoyAoa = [['Week', 'Req 2025', 'Req 2026', 'Req YoY %', 'Del 2025', 'Del 2026', 'Del YoY %', 'GMV 2025', 'GMV 2026', 'GMV YoY %', 'CA 2025', 'CA 2026', 'CA YoY %']];
        Array.from(map26Exp.keys()).sort(function (a, b) { return a - b; }).forEach(function (wNo) {
          if (!map25Exp.has(wNo)) return;
          var m25 = map25Exp.get(wNo);
          var m26 = map26Exp.get(wNo);
          var reqPct = m25.req > 0 ? (((m26.req - m25.req) / m25.req) * 100).toFixed(1) + '%' : '-';
          var delPct = m25.del > 0 ? (((m26.del - m25.del) / m25.del) * 100).toFixed(1) + '%' : '-';
          var gmvPct = m25.gmv > 0 ? (((m26.gmv - m25.gmv) / m25.gmv) * 100).toFixed(1) + '%' : '-';
          var caPct = m25.ca > 0 ? (((m26.ca - m25.ca) / m25.ca) * 100).toFixed(1) + '%' : '-';
          yoyAoa.push(['W' + wNo, m25.req, m26.req, reqPct, m25.del, m26.del, delPct, Number(m25.gmv.toFixed(1)), Number(m26.gmv.toFixed(1)), gmvPct, Number(m25.ca.toFixed(1)), Number(m26.ca.toFixed(1)), caPct]);
        });
        if (yoyAoa.length > 1) {
          var wsYoy = XLSX.utils.aoa_to_sheet(yoyAoa);
          wsYoy['!cols'] = yoyAoa[0].map(function () { return { wch: 14 }; });
          XLSX.utils.book_append_sheet(wb, wsYoy, 'Variation YoY 2025-2026');
        }
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, (isMktMode ? 'YASSIR_Synthese_Market_' : 'YASSIR_Synthese_Food_') + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : ' + (isMktMode ? 'YASSIR_Synthese_Market_' : 'YASSIR_Synthese_Food_') + dateStr + '.xlsx');
        showToast('Fichier <strong>YASSIR_Synthese_Food_' + dateStr + '.xlsx</strong> téléchargé (commandes Food uniquement).', 'success');
      };

      window.yassirExportSynthGlobalCsv = function () {
        if (!canSeeGlobalSynth() || (!isMarketOnlyViewer() && getEffectiveAmFilter() !== 'ALL')) return;
        var synth = calculerSyntheseGlobaleData();
        if (!synth || synth.empty) return;

        var aoa = [['Indicateur', 'Valeur']];
        synth.kpiRows.forEach(function (r) { aoa.push([r.label, r.value]); });
        aoa.push(['', '']);
        aoa.push(['Day', 'Req', 'Del', 'GMV']);
        synth.dayStats.forEach(function (d) { aoa.push([d.day, d.req, d.del, Number(d.gmv.toFixed(2))]); });
        aoa.push(['Total', synth.totals.req, synth.totals.del, synth.totals.gmv]);

        var ws = XLSX.utils.aoa_to_sheet(aoa);
        var csvContent = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
        var blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'YASSIR_Synthese_Globale.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        window.yassirJournaliser('export', 'Export CSV : YASSIR_Synthese_Globale.csv');
        showToast('Synthèse Globale exportée en CSV.', 'success');
      };
