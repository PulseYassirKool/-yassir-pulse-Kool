      /* ========================================================================
         N. EXPORTS EXCEL (.XLSX) & CSV (DONT EXPORT STAT POUR PORTEFEUILLE & GLOBAL)
         ======================================================================== */
      function construireFeuille109Colonnes(recordsList) {
        var headers = ['Portefeuille AM'].concat(TARGET_HEADERS);
        var rows = recordsList.map(function (rec) { return [rec.am].concat(rec.cells); });
        var aoa = [headers].concat(rows);
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = headers.map(function (h) { return { wch: Math.max(15, h.length + 4) }; });
        return ws;
      }

      function construireFeuilleOffres(offresRecords) {
        var headers = getOffresVisibleHeaders();
        var rows = offresRecords.map(function (rec) { return filtrerCellulesOffresVisibles(rec.cells); });
        var aoa = [headers].concat(rows);
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = headers.map(function (h) { return { wch: Math.max(15, h.length + 4) }; });
        return ws;
      }

      function construireFeuilleStat(statRecords) {
        // En-tête exact de la formule VSTACK sans la colonne AM interne pour correspondre 100% à la formule demandée
        var exportHeaders = [
          'Area', 'Restaurant', 'Requested', 'Delivered', 'Success Rate',
          'AcceptedByRestaurant', 'Taux Acceptation', 'CancelledByRestaurant', 'Taux Cancellation',
          'GMV', 'AOV', 'Commission', 'Promo Restaurant', 'Promo Admin', 'LR_LG_Costs', '% Global Delivered'
        ];
        var rows = statRecords.map(function (rec) {
          var m = rec.rawMetrics;
          return [
            rec.cells[1], // Area
            rec.cells[2], // Restaurant
            m.req,
            m.deliv,
            Number((m.successRate * 100).toFixed(2)),
            m.acc,
            Number((m.tauxAccept * 100).toFixed(2)),
            m.canc,
            Number((m.tauxCanc * 100).toFixed(2)),
            m.gmv,
            m.aov,
            m.comm,
            m.promoResto,
            m.promoAdmin,
            m.lrLg,
            Number((m.pctGlobalDeliv * 100).toFixed(2))
          ];
        });
        var aoa = [exportHeaders].concat(rows);
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = exportHeaders.map(function (h) { return { wch: Math.max(15, h.length + 4) }; });
        return ws;
      }

      function construireFeuilleSyntheseAm() {
        var globalStats = calculerStatsPourAm('ALL');
        var allowedAms = getAllowedAmListForCurrentUser();
        var aoa = [[
          'Portefeuille AM',
          'Restaurants attribués',
          'Reçues',
          'Livrées',
          '% Livrées / Global',
          'Market Reçues',
          'Food Reçues',
          'Offres (Livrées)',
          '% Offres Livrées / Global',
          'Restos avec Offre',
          'Livraison Gratuite (Livrées)',
          '% LG / Global Livrées',
          'CA Livrées (TND)',
          'LR & LG Livrées (TND)',
          '% LR & LG / Budget',
          'Participation Offres Livrées (TND)',
          '% Part. Offres / Budget',
          'Budget AM (TND)',
          '% Total Budget Utilisé',
          'Reste Budget (TND)'
        ]];

        allowedAms.forEach(function (am) {
          var st = calculerStatsPourAm(am);
          var pctLivGlobal = globalStats.totalLivrees > 0 ? Number(((st.totalLivrees / globalStats.totalLivrees) * 100).toFixed(2)) : 0;
          var pctOffGlobal = globalStats.totalOffres > 0 ? Number(((st.totalOffres / globalStats.totalOffres) * 100).toFixed(2)) : 0;
          var pctLgGlobal = globalStats.livraisonGratuiteCount > 0 ? Number(((st.livraisonGratuiteCount / globalStats.livraisonGratuiteCount) * 100).toFixed(2)) : 0;
          var pctLrBudAm = st.budgetTnd > 0 ? Number(((st.lrLgTnd / st.budgetTnd) * 100).toFixed(2)) : 0;
          var pctOpBudAm = st.budgetTnd > 0 ? Number(((st.offerPartTnd / st.budgetTnd) * 100).toFixed(2)) : 0;
          var pctTotBudAm = st.budgetTnd > 0 ? Number(((st.totalBudgetUsedTnd / st.budgetTnd) * 100).toFixed(2)) : 0;
          aoa.push([
            am,
            st.assignedRestosCount,
            st.totalRecues,
            st.totalLivrees,
            pctLivGlobal,
            st.marketRecues,
            st.foodRecues,
            st.totalOffres,
            pctOffGlobal,
            st.restosOffreCount,
            st.livraisonGratuiteCount,
            pctLgGlobal,
            Number(st.caLivrees.toFixed(2)),
            Number(st.lrLgTnd.toFixed(2)),
            pctLrBudAm,
            Number(st.offerPartTnd.toFixed(2)),
            pctOpBudAm,
            Number(st.budgetTnd.toFixed(2)),
            pctTotBudAm,
            Number(st.remainingBudgetTnd.toFixed(2))
          ]);
        });

        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [
          { wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 18 },
          { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 18 }
        ];
        return ws;
      }

      window.yassirExportStatExcel = function () {
        if (state.statRows.length === 0) return;
        var activeFilter = getEffectiveAmFilter();
        var wb = XLSX.utils.book_new();
        var dateStr = new Date().toISOString().slice(0, 10);

        if (activeFilter === 'ALL') {
          // Export Global : onglet Global + 1 onglet Stat par portefeuille autorisé
          XLSX.utils.book_append_sheet(wb, construireFeuilleStat(state.statRows), 'Stat Global');
          var allowedAms = getAllowedAmListForCurrentUser();
          allowedAms.forEach(function (am) {
            var amStat = state.statRows.filter(function (rec) { return rec.am === am; });
            XLSX.utils.book_append_sheet(wb, construireFeuilleStat(amStat), am.slice(0, 31));
          });
          XLSX.writeFile(wb, 'YASSIR_Export_Stat_Global_' + dateStr + '.xlsx');
          showToast('Fichier <strong>YASSIR_Export_Stat_Global_' + dateStr + '.xlsx</strong> téléchargé (Global + Portefeuilles).', 'success');
        } else {
          // Export ciblé sur le portefeuille sélectionné
          var filteredStat = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.statRows));
          var suffix = activeFilter.replace(/\s+/g, '_');
          XLSX.utils.book_append_sheet(wb, construireFeuilleStat(filteredStat), ('Stat ' + activeFilter).slice(0, 31));
          XLSX.writeFile(wb, 'YASSIR_Export_Stat_' + suffix + '_' + dateStr + '.xlsx');
          showToast('Fichier <strong>YASSIR_Export_Stat_' + suffix + '_' + dateStr + '.xlsx</strong> téléchargé.', 'success');
        }
      };

      window.yassirExportExcelComplet = function () {
        if (state.marketRows.length === 0 && state.foodRows.length === 0) return;
        var activeFilter = getEffectiveAmFilter();
        var suffix = activeFilter === 'ALL' ? 'Global' : activeFilter.replace(/\s+/g, '_');

        var wb = XLSX.utils.book_new();
        if (!isFoodOnlyAm()) {
          XLSX.utils.book_append_sheet(wb, construireFeuille109Colonnes(filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.marketRows))), 'Market VF');
        }
        if (!isMarketOnlyViewer()) {
          XLSX.utils.book_append_sheet(wb, construireFeuille109Colonnes(filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.foodRows))), 'Food VF');
        }
        XLSX.utils.book_append_sheet(wb, construireFeuilleOffres(filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.offresRows))), 'Offres');
        XLSX.utils.book_append_sheet(wb, construireFeuilleStat(filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.statRows))), 'Stat');
        if (activeFilter === 'ALL' && canSeeGlobalSynth()) {
          var synthData = calculerSyntheseGlobaleData();
          if (synthData && !synthData.empty) {
            var sAoa = [['Indicateur', 'Valeur', '', 'Day', 'Req', 'Del', 'GMV']];
            var maxR = Math.max(synthData.kpiRows.length, synthData.dayStats.length + 1);
            for (var si = 0; si < maxR; si++) {
              var rLine = ['', '', '', '', '', '', ''];
              if (si < synthData.kpiRows.length) {
                rLine[0] = synthData.kpiRows[si].label;
                rLine[1] = synthData.kpiRows[si].numVal;
              }
              if (si < synthData.dayStats.length) {
                rLine[3] = synthData.dayStats[si].day;
                rLine[4] = synthData.dayStats[si].req;
                rLine[5] = synthData.dayStats[si].del;
                rLine[6] = Number(synthData.dayStats[si].gmv.toFixed(2));
              } else if (si === synthData.dayStats.length) {
                rLine[3] = 'Total';
                rLine[4] = synthData.totals.req;
                rLine[5] = synthData.totals.del;
                rLine[6] = synthData.totals.gmv;
              }
              sAoa.push(rLine);
            }
            var wsSynth = XLSX.utils.aoa_to_sheet(sAoa);
            wsSynth['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 4 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
            XLSX.utils.book_append_sheet(wb, wsSynth, 'Synthèse Food');
          }
        }
        XLSX.utils.book_append_sheet(wb, construireFeuilleSyntheseAm(), 'Synthèse Portefeuilles AM');

        var commRows = [['restaurant name', 'commission ca']];
        Object.entries(state.customCommissions).forEach(function (pair) { commRows.push(pair); });
        var wsComm = XLSX.utils.aoa_to_sheet(commRows);
        wsComm['!cols'] = [{ wch: 32 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, wsComm, 'Commissions');

        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_VF_Data_Offres_' + suffix + '_' + dateStr + '.xlsx');
        showToast('Classeur Excel complet exporté (<strong>' + escapeHtml(activeFilter === 'ALL' ? 'Vue Globale' : activeFilter) + '</strong>).', 'success');
      };

      window.yassirExportOffresExcel = function () {
        var list = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.offresRows));
        if (list.length === 0) return;
        var activeFilter = getEffectiveAmFilter();
        var suffix = activeFilter === 'ALL' ? 'Global' : activeFilter.replace(/\s+/g, '_');

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, construireFeuilleOffres(list), 'Offres');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Export_Offres_' + suffix + '_' + dateStr + '.xlsx');
        showToast('Fichier <strong>YASSIR_Export_Offres_' + suffix + '_' + dateStr + '.xlsx</strong> téléchargé.', 'success');
      };

      window.yassirExportActiveCsv = function () {
        var aoa = null;
        var fileName = 'export.csv';
        var activeFilter = getEffectiveAmFilter();
        var suffix = activeFilter === 'ALL' ? 'Global' : activeFilter.replace(/\s+/g, '_');

        if (state.activeTab === 'market') {
          var mList = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.marketRows));
          if (mList.length === 0) return;
          aoa = [['Portefeuille AM'].concat(TARGET_HEADERS)].concat(mList.map(function (r) { return [r.am].concat(r.cells); }));
          fileName = 'Market_VF_' + suffix + '.csv';
        } else if (state.activeTab === 'food') {
          var fList = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.foodRows));
          if (fList.length === 0) return;
          aoa = [['Portefeuille AM'].concat(TARGET_HEADERS)].concat(fList.map(function (r) { return [r.am].concat(r.cells); }));
          fileName = 'Food_VF_' + suffix + '.csv';
        } else if (state.activeTab === 'offres') {
          var oList = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.offresRows));
          if (oList.length === 0) return;
          aoa = [getOffresVisibleHeaders()].concat(oList.map(function (r) { return filtrerCellulesOffresVisibles(r.cells); }));
          fileName = 'Export_Offres_' + suffix + '.csv';
        } else if (state.activeTab === 'stat') {
          var sList = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.statRows));
          if (sList.length === 0) return;
          aoa = [STAT_HEADERS].concat(sList.map(function (r) { return r.cells; }));
          fileName = 'Export_Stat_' + suffix + '.csv';
        } else if (state.activeTab === 'portefeuilles') {
          var allowedAms = getAllowedAmListForCurrentUser();
          var amList = Object.values(state.amPortfolios).filter(function (info) {
            if (!canViewAllPortfolios() && allowedAms.indexOf(info.am) === -1) return false;
            return activeFilter === 'ALL' || info.am === activeFilter;
          });
          if (amList.length === 0) return;
          aoa = [['Portefeuille AM', 'Restaurant Name', 'Ville', 'Segment']].concat(
            amList.map(function (info) { return [info.am, info.displayName, info.ville || '', info.segment || '']; })
          );
          fileName = 'Portefeuilles_AM_' + suffix + '.csv';
        } else if (state.activeTab === 'commissions') {
          var entries = Object.entries(state.customCommissions);
          if (entries.length === 0) return;
          aoa = [['restaurant name', 'commission ca']].concat(entries);
          fileName = 'Commissions_Restaurant.csv';
        }

        var ws = XLSX.utils.aoa_to_sheet(aoa);
        var csvContent = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);

        var link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast('Fichier CSV <strong>' + fileName + '</strong> téléchargé (UTF-8).', 'success');
      };
