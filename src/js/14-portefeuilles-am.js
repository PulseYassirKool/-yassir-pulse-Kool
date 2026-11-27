      /* ========================================================================
         J. ONGLET PORTEFEUILLES AM (CARTES CONTRIBUTION % + CRUD OWNER ADMIN)
         ======================================================================== */
      var amTableZeroOrderFilter = 'all';

      window.yassirSetAmZeroFilter = function (mode) {
        amTableZeroOrderFilter = mode;
        var bAll = document.getElementById('btnAmFilterAllRestos');
        var bAct = document.getElementById('btnAmFilterActiveRestos');
        var bZero = document.getElementById('btnAmFilterZeroRestos');
        var lblExport = document.getElementById('btnExportAmFilteredLabel');

        if (bAll) bAll.className = mode === 'all' ? 'px-3 py-1 rounded-full bg-[#6C2BD9] text-white transition cursor-pointer' : 'px-3 py-1 rounded-full text-slate-600 hover:text-[#6C2BD9] transition cursor-pointer';
        if (bAct) bAct.className = mode === 'active' ? 'px-3 py-1 rounded-full bg-[#00BFA5] text-[#1A1A2E] transition cursor-pointer' : 'px-3 py-1 rounded-full text-slate-600 hover:text-[#00897B] transition cursor-pointer';
        if (bZero) bZero.className = mode === 'zero' ? 'px-3 py-1 rounded-full bg-[#FF2A6D] text-white transition cursor-pointer' : 'px-3 py-1 rounded-full text-slate-600 hover:text-[#FF2A6D] transition cursor-pointer';
        if (lblExport) {
          lblExport.textContent = mode === 'zero' ? 'Télécharger 0 commande (.xlsx)' : 'Télécharger liste (.xlsx)';
        }
        window.yassirRenderAmTable();
      };

      window.yassirFilterAmZeroByCard = function (event, amName) {
        if (event && event.stopPropagation) event.stopPropagation();
        if (!canSeeZeroOrdersStats()) return;
        state.selectedAm = amName;
        amTableZeroOrderFilter = 'zero';
        mettreAJourInterface();
        var bAll = document.getElementById('btnAmFilterAllRestos');
        var bAct = document.getElementById('btnAmFilterActiveRestos');
        var bZero = document.getElementById('btnAmFilterZeroRestos');
        var lblExport = document.getElementById('btnExportAmFilteredLabel');
        if (bAll) bAll.className = 'px-3 py-1 rounded-full text-slate-600 hover:text-[#6C2BD9] transition cursor-pointer';
        if (bAct) bAct.className = 'px-3 py-1 rounded-full text-slate-600 hover:text-[#00897B] transition cursor-pointer';
        if (bZero) bZero.className = 'px-3 py-1 rounded-full bg-[#FF2A6D] text-white transition cursor-pointer';
        if (lblExport) lblExport.textContent = 'Télécharger 0 commande (.xlsx)';
      };

      function getFilteredAmPortfolioEntries() {
        var searchInput = document.getElementById('searchAmRestoInput');
        var q = searchInput ? searchInput.value.trim().toLowerCase() : '';
        var activeFilter = getEffectiveAmFilter();
        var allowedAms = getAllowedAmListForCurrentUser();
        var showZeroStats = canSeeZeroOrdersStats();

        var revTagAm = String(state._calcRevision || 0) + '|' + (currentBrand || 'yassir');
        if (_orderCountsMapCache.rev !== revTagAm) {
          var idxResto = TARGET_HEADERS.indexOf('restaurant name');
          var idxStatus = TARGET_HEADERS.indexOf('status');
          var m = new Map();
          var lists = [state.marketRows, state.foodRows];
          for (var li = 0; li < lists.length; li++) {
            var arr = lists[li];
            for (var ri = 0; ri < arr.length; ri++) {
              var rec = arr[ri];
              var rKey = String(rec.cells[idxResto] || '').trim().toLowerCase();
              if (!rKey) continue;
              var item = m.get(rKey);
              if (!item) { item = { req: 0, deliv: 0 }; m.set(rKey, item); }
              item.req++;
              if (estCommandeLivree(rec.cells[idxStatus])) item.deliv++;
            }
          }
          _orderCountsMapCache = { rev: revTagAm, map: m };
        }
        var orderCountsMap = _orderCountsMapCache.map;

        var zeroCountForScope = 0;
        var list = [];

        Object.entries(state.amPortfolios).forEach(function (pair) {
          var key = pair[0];
          var info = pair[1];
          if (!canViewAllPortfolios() && allowedAms.indexOf(info.am) === -1) return;
          if (activeFilter !== 'ALL' && info.am !== activeFilter) return;

          var counts = orderCountsMap.get(key) || { req: 0, deliv: 0 };
          if (counts.req === 0) zeroCountForScope++;

          if (showZeroStats) {
            if (amTableZeroOrderFilter === 'zero' && counts.req > 0) return;
            if (amTableZeroOrderFilter === 'active' && counts.req === 0) return;
          }

          if (q) {
            var matchQ = info.displayName.toLowerCase().includes(q) ||
                         info.am.toLowerCase().includes(q) ||
                         (info.ville && info.ville.toLowerCase().includes(q)) ||
                         (info.segment && info.segment.toLowerCase().includes(q));
            if (!matchQ) return;
          }

          list.push({
            key: key,
            info: info,
            req: counts.req,
            deliv: counts.deliv
          });
        });

        list.sort(function (a, b) {
          return a.info.am.localeCompare(b.info.am, 'fr') || a.info.displayName.localeCompare(b.info.displayName, 'fr');
        });

        return { entries: list, zeroCountForScope: zeroCountForScope };
      }

      window.yassirExportAmPortfoliosExcel = async function () {
        var res = getFilteredAmPortfolioEntries();
        if (!res.entries || res.entries.length === 0) {
          showToast('Aucun restaurant à exporter pour ce filtre.', 'info');
          return;
        }
        if (!(await window.yassirAttendreLibsLourdes())) return;
        var activeFilter = getEffectiveAmFilter();
        var suffix = activeFilter === 'ALL' ? 'Global' : activeFilter.replace(/\s+/g, '_');
        var modeSuffix = (canSeeZeroOrdersStats() && amTableZeroOrderFilter === 'zero') ? '_0_Commande' : '';

        var aoa = [['Restaurant Name', 'Portefeuille AM', 'Ville / Zone', 'Segment', 'Commandes Reçues', 'Commandes Livrées']];
        res.entries.forEach(function (item) {
          aoa.push([
            item.info.displayName,
            item.info.am,
            item.info.ville || '',
            item.info.segment || '',
            item.req,
            item.deliv
          ]);
        });

        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, ws, modeSuffix ? 'Restos 0 Commande' : 'Portefeuilles AM');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Portefeuilles_' + suffix + modeSuffix + '_' + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : YASSIR_Portefeuilles_' + suffix + modeSuffix + '_' + dateStr + '.xlsx');
        showToast('Fichier Excel téléchargé (<strong>' + res.entries.length + ' restaurant(s)</strong>).', 'success');
      };

      function renderPortefeuillesPanel() {
        var grid = document.getElementById('amSummaryCardsGrid');
        if (!grid) return;

        var globalStats = calculerStatsPourAm('ALL');
        var activeFilter = getEffectiveAmFilter();
        var allowedAms = getAllowedAmListForCurrentUser();
        var showZeroStats = canSeeZeroOrdersStats();
        var btnSyncBCard = document.getElementById('btnSyncBudgetPortfolioCard');
        var ownerBudgetSec = document.getElementById('ownerBudgetEditorSection');
        if (btnSyncBCard) {
          if (isOwnerAdmin()) btnSyncBCard.classList.remove('hidden');
          else btnSyncBCard.classList.add('hidden');
        }
        if (ownerBudgetSec) {
          if (isOwnerAdmin()) {
            ownerBudgetSec.classList.remove('hidden');
            AM_AGENTS.forEach(function (am) {
              var inp = document.getElementById('budgetInput_' + am.replace(/\s+/g, '_'));
              if (inp) inp.value = state.budgetByAm[am] ? state.budgetByAm[am] : '';
            });
            var cntOpBadge = document.getElementById('offrePartRulesCountBadge');
            if (cntOpBadge) cntOpBadge.textContent = (state.offreParticipationRules || []).length;
            var inpOpUrl = document.getElementById('inputOffrePartSheetUrl');
            if (inpOpUrl && state.offrePartSheetId && !inpOpUrl.value) inpOpUrl.value = state.offrePartSheetId;
          } else {
            ownerBudgetSec.classList.add('hidden');
          }
        }

        grid.innerHTML = allowedAms.map(function (am) {
          var st = calculerStatsPourAm(am);
          var isSelected = activeFilter === am;
          var pctLivreesGlobal = globalStats.totalLivrees > 0
            ? ((st.totalLivrees / globalStats.totalLivrees) * 100).toFixed(1)
            : '0.0';
          var pctOffresGlobal = globalStats.totalOffres > 0
            ? ((st.totalOffres / globalStats.totalOffres) * 100).toFixed(1)
            : '0.0';
          var pctLgGlobal = globalStats.livraisonGratuiteCount > 0
            ? ((st.livraisonGratuiteCount / globalStats.livraisonGratuiteCount) * 100).toFixed(1)
            : '0.0';
          var pctLrLgVsBudgetAm = st.budgetTnd > 0
            ? ((st.lrLgTnd / st.budgetTnd) * 100).toFixed(1)
            : '0.0';
          var pctOfferPartVsBudgetAm = st.budgetTnd > 0
            ? ((st.offerPartTnd / st.budgetTnd) * 100).toFixed(1)
            : '0.0';
          var pctTotalBudgetUsed = st.budgetTnd > 0
            ? ((st.totalBudgetUsedTnd / st.budgetTnd) * 100).toFixed(1)
            : '0.0';

          var zeroOrdersBlock = showZeroStats
            ? '<div class="col-span-2 mt-1 pt-1.5 border-t border-dashed border-rose-200 flex items-center justify-between">' +
                '<span class="text-slate-500 font-semibold"><i class="fa-solid fa-circle-exclamation text-[#FF2A6D] mr-1"></i>Restos 0 commande</span>' +
                '<button type="button" data-action="filter-am-zero" data-key="' + escapeHtml(am) + '" class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-50 hover:bg-[#FF2A6D] text-[#FF2A6D] hover:text-white transition cursor-pointer" title="Cliquer pour filtrer et télécharger les restaurants 0 commande de ' + escapeHtml(am) + '">' +
                  st.zeroOrdersRestosCount + ' / ' + st.assignedRestosCount +
                '</button>' +
              '</div>'
            : '';

          return '<div data-action="select-am-filter" data-key="' + escapeHtml(am) + '" class="rounded-2xl p-4 border transition cursor-pointer ' +
            (isSelected ? 'bg-[#F3EBFF] border-[#6C2BD9] ring-2 ring-[#6C2BD9]/30 shadow-md' : 'bg-white border-purple-100 hover:border-[#6C2BD9]/50 shadow-sm') + '">' +
            '<div class="flex items-center justify-between mb-2">' +
              '<span class="text-xs font-extrabold text-[#1A1A2E] truncate">' + escapeHtml(am) + '</span>' +
              '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#6C2BD9]/10 text-[#6C2BD9]">' + st.assignedRestosCount + ' restos</span>' +
            '</div>' +
            '<div class="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-purple-100/80">' +
              '<div><span class="text-slate-400 block">Reçues / Livrées</span><strong class="text-[#1A1A2E]">' + st.totalRecues + ' / ' + st.totalLivrees + '</strong></div>' +
              '<div class="text-right"><span class="text-slate-400 block">% Livrées / Global Livrées</span><strong class="text-[#00897B] text-xs">' + pctLivreesGlobal + ' %</strong></div>' +
              '<div><span class="text-slate-400 block">Offres Livrées</span><strong class="text-[#FF2A6D]">' + st.totalOffres + ' (' + st.restosOffreCount + ' r.)</strong></div>' +
              '<div class="text-right"><span class="text-slate-400 block">% Offres / Global Livrées</span><strong class="text-[#FF2A6D] text-xs">' + pctOffresGlobal + ' %</strong></div>' +
              '<div class="pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">Livraison Gratuite (Livrées)</span><strong class="text-[#00897B] font-mono">' + st.livraisonGratuiteCount + ' cmd</strong></div>' +
              '<div class="text-right pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">% LG / Global Livrées</span><strong class="text-[#00897B] text-xs">' + pctLgGlobal + ' %</strong></div>' +
              '<div class="pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">LR & LG (Livrées)</span><strong class="text-[#6C2BD9] font-mono">' + st.lrLgTnd.toFixed(2) + ' TND (' + pctLrLgVsBudgetAm + '%)</strong></div>' +
              '<div class="text-right pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">Part. Offres (Livrées)</span><strong class="text-[#FF2A6D] font-mono">' + st.offerPartTnd.toFixed(2) + ' TND (' + pctOfferPartVsBudgetAm + '%)</strong></div>' +
              '<div class="pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">Budget AM (TND)</span><strong class="text-[#1A1A2E] font-mono">' + st.budgetTnd.toFixed(2) + ' TND</strong></div>' +
              '<div class="text-right pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">Reste Budget (TND)</span><strong class="' + (st.remainingBudgetTnd >= 0 ? 'text-[#00897B]' : 'text-[#FF2A6D]') + ' font-mono font-extrabold">' + st.remainingBudgetTnd.toFixed(2) + ' TND</strong></div>' +
              '<div class="col-span-2 bg-[#F3EBFF]/60 px-2.5 py-1.5 rounded-xl space-y-1">' +
                '<div class="flex items-center justify-between"><span class="text-slate-600 font-semibold">% Budget Utilisé (LR/LG + Offres)</span><strong class="' + (Number(pctTotalBudgetUsed) >= 95 ? 'text-[#FF2A6D]' : (Number(pctTotalBudgetUsed) >= 75 ? 'text-amber-600' : 'text-[#00897B]')) + ' text-xs font-extrabold">' + pctTotalBudgetUsed + ' %</strong></div>' +
                '<div class="w-full h-1.5 rounded-full bg-purple-200/70 overflow-hidden"><div class="h-full rounded-full transition-all duration-500 ' + (Number(pctTotalBudgetUsed) >= 95 ? 'bg-[#FF2A6D]' : (Number(pctTotalBudgetUsed) >= 75 ? 'bg-amber-500' : 'bg-[#00BFA5]')) + '" style="width:' + Math.min(100, Math.max(0, Number(pctTotalBudgetUsed))) + '%"></div></div>' +
              '</div>' +
              zeroOrdersBlock +
            '</div>' +
          '</div>';
        }).join('');

        window.yassirRenderAmTable();
      };

      window.yassirFilterAmZeroByCard = function (event, amName) {
        if (event && event.stopPropagation) event.stopPropagation();
        if (!canSeeZeroOrdersStats()) return;
        state.selectedAm = amName;
        amTableZeroOrderFilter = 'zero';
        mettreAJourInterface();
        var bAll = document.getElementById('btnAmFilterAllRestos');
        var bAct = document.getElementById('btnAmFilterActiveRestos');
        var bZero = document.getElementById('btnAmFilterZeroRestos');
        var lblExport = document.getElementById('btnExportAmFilteredLabel');
        if (bAll) bAll.className = 'px-3 py-1 rounded-full text-slate-600 hover:text-[#6C2BD9] transition cursor-pointer';
        if (bAct) bAct.className = 'px-3 py-1 rounded-full text-slate-600 hover:text-[#00897B] transition cursor-pointer';
        if (bZero) bZero.className = 'px-3 py-1 rounded-full bg-[#FF2A6D] text-white transition cursor-pointer';
        if (lblExport) lblExport.textContent = 'Télécharger 0 commande (.xlsx)';
      };

      function getFilteredAmPortfolioEntries() {
        var searchInput = document.getElementById('searchAmRestoInput');
        var q = searchInput ? searchInput.value.trim().toLowerCase() : '';
        var activeFilter = getEffectiveAmFilter();
        var allowedAms = getAllowedAmListForCurrentUser();
        var showZeroStats = canSeeZeroOrdersStats();

        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var orderCountsMap = new Map();
        state.marketRows.concat(state.foodRows).forEach(function (rec) {
          var rKey = String(rec.cells[idxResto] || '').trim().toLowerCase();
          if (!rKey) return;
          if (!orderCountsMap.has(rKey)) orderCountsMap.set(rKey, { req: 0, deliv: 0 });
          var item = orderCountsMap.get(rKey);
          item.req++;
          if (estCommandeLivree(rec.cells[idxStatus])) item.deliv++;
        });

        var zeroCountForScope = 0;
        var list = [];

        Object.entries(state.amPortfolios).forEach(function (pair) {
          var key = pair[0];
          var info = pair[1];
          if (!canViewAllPortfolios() && allowedAms.indexOf(info.am) === -1) return;
          if (activeFilter !== 'ALL' && info.am !== activeFilter) return;

          var counts = orderCountsMap.get(key) || { req: 0, deliv: 0 };
          if (counts.req === 0) zeroCountForScope++;

          if (showZeroStats) {
            if (amTableZeroOrderFilter === 'zero' && counts.req > 0) return;
            if (amTableZeroOrderFilter === 'active' && counts.req === 0) return;
          }

          if (q) {
            var matchQ = info.displayName.toLowerCase().includes(q) ||
                         info.am.toLowerCase().includes(q) ||
                         (info.ville && info.ville.toLowerCase().includes(q)) ||
                         (info.segment && info.segment.toLowerCase().includes(q));
            if (!matchQ) return;
          }

          list.push({
            key: key,
            info: info,
            req: counts.req,
            deliv: counts.deliv
          });
        });

        list.sort(function (a, b) {
          return a.info.am.localeCompare(b.info.am, 'fr') || a.info.displayName.localeCompare(b.info.displayName, 'fr');
        });

        return { entries: list, zeroCountForScope: zeroCountForScope };
      }

      window.yassirExportAmPortfoliosExcel = async function () {
        var res = getFilteredAmPortfolioEntries();
        if (!res.entries || res.entries.length === 0) {
          showToast('Aucun restaurant à exporter pour ce filtre.', 'info');
          return;
        }
        if (!(await window.yassirAttendreLibsLourdes())) return;
        var activeFilter = getEffectiveAmFilter();
        var suffix = activeFilter === 'ALL' ? 'Global' : activeFilter.replace(/\s+/g, '_');
        var modeSuffix = (canSeeZeroOrdersStats() && amTableZeroOrderFilter === 'zero') ? '_0_Commande' : '';

        var aoa = [['Restaurant Name', 'Portefeuille AM', 'Ville / Zone', 'Segment', 'Commandes Reçues', 'Commandes Livrées']];
        res.entries.forEach(function (item) {
          aoa.push([
            item.info.displayName,
            item.info.am,
            item.info.ville || '',
            item.info.segment || '',
            item.req,
            item.deliv
          ]);
        });

        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, ws, modeSuffix ? 'Restos 0 Commande' : 'Portefeuilles AM');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Portefeuilles_' + suffix + modeSuffix + '_' + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : YASSIR_Portefeuilles_' + suffix + modeSuffix + '_' + dateStr + '.xlsx');
        showToast('Fichier Excel téléchargé (<strong>' + res.entries.length + ' restaurant(s)</strong>).', 'success');
      };

      function renderPortefeuillesPanel() {
        var grid = document.getElementById('amSummaryCardsGrid');
        if (!grid) return;

        var globalStats = calculerStatsPourAm('ALL');
        var activeFilter = getEffectiveAmFilter();
        var allowedAms = getAllowedAmListForCurrentUser();
        var showZeroStats = canSeeZeroOrdersStats();
        var btnSyncBCard = document.getElementById('btnSyncBudgetPortfolioCard');
        var ownerBudgetSec = document.getElementById('ownerBudgetEditorSection');
        if (btnSyncBCard) {
          if (isOwnerAdmin()) btnSyncBCard.classList.remove('hidden');
          else btnSyncBCard.classList.add('hidden');
        }
        if (ownerBudgetSec) {
          if (isOwnerAdmin()) {
            ownerBudgetSec.classList.remove('hidden');
            AM_AGENTS.forEach(function (am) {
              var inp = document.getElementById('budgetInput_' + am.replace(/\s+/g, '_'));
              if (inp) inp.value = state.budgetByAm[am] ? state.budgetByAm[am] : '';
            });
            var cntOpBadge = document.getElementById('offrePartRulesCountBadge');
            if (cntOpBadge) cntOpBadge.textContent = (state.offreParticipationRules || []).length;
            var inpOpUrl = document.getElementById('inputOffrePartSheetUrl');
            if (inpOpUrl && state.offrePartSheetId && !inpOpUrl.value) inpOpUrl.value = state.offrePartSheetId;
          } else {
            ownerBudgetSec.classList.add('hidden');
          }
        }

        grid.innerHTML = allowedAms.map(function (am) {
          var st = calculerStatsPourAm(am);
          var isSelected = activeFilter === am;
          var pctLivreesGlobal = globalStats.totalLivrees > 0
            ? ((st.totalLivrees / globalStats.totalLivrees) * 100).toFixed(1)
            : '0.0';
          var pctOffresGlobal = globalStats.totalOffres > 0
            ? ((st.totalOffres / globalStats.totalOffres) * 100).toFixed(1)
            : '0.0';
          var pctLrLgVsBudgetAm = st.budgetTnd > 0
            ? ((st.lrLgTnd / st.budgetTnd) * 100).toFixed(1)
            : '0.0';
          var pctOfferPartVsBudgetAm = st.budgetTnd > 0
            ? ((st.offerPartTnd / st.budgetTnd) * 100).toFixed(1)
            : '0.0';
          var pctTotalBudgetUsed = st.budgetTnd > 0
            ? ((st.totalBudgetUsedTnd / st.budgetTnd) * 100).toFixed(1)
            : '0.0';

          var zeroOrdersBlock = showZeroStats
            ? '<div class="col-span-2 mt-1 pt-1.5 border-t border-dashed border-rose-200 flex items-center justify-between">' +
                '<span class="text-slate-500 font-semibold"><i class="fa-solid fa-circle-exclamation text-[#FF2A6D] mr-1"></i>Restos 0 commande</span>' +
                '<button type="button" data-action="filter-am-zero" data-key="' + escapeHtml(am) + '" class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-50 hover:bg-[#FF2A6D] text-[#FF2A6D] hover:text-white transition cursor-pointer" title="Cliquer pour filtrer et télécharger les restaurants 0 commande de ' + escapeHtml(am) + '">' +
                  st.zeroOrdersRestosCount + ' / ' + st.assignedRestosCount +
                '</button>' +
              '</div>'
            : '';

          return '<div data-action="select-am-filter" data-key="' + escapeHtml(am) + '" class="rounded-2xl p-4 border transition cursor-pointer ' +
            (isSelected ? 'bg-[#F3EBFF] border-[#6C2BD9] ring-2 ring-[#6C2BD9]/30 shadow-md' : 'bg-white border-purple-100 hover:border-[#6C2BD9]/50 shadow-sm') + '">' +
            '<div class="flex items-center justify-between mb-2">' +
              '<span class="text-xs font-extrabold text-[#1A1A2E] truncate">' + escapeHtml(am) + '</span>' +
              '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#6C2BD9]/10 text-[#6C2BD9]">' + st.assignedRestosCount + ' restos</span>' +
            '</div>' +
            '<div class="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-purple-100/80">' +
              '<div><span class="text-slate-400 block">Reçues / Livrées</span><strong class="text-[#1A1A2E]">' + st.totalRecues + ' / ' + st.totalLivrees + '</strong></div>' +
              '<div class="text-right"><span class="text-slate-400 block">% Livrées / Global</span><strong class="text-[#00897B] text-xs">' + pctLivreesGlobal + ' %</strong></div>' +
              '<div><span class="text-slate-400 block">Offres Livrées</span><strong class="text-[#FF2A6D]">' + st.totalOffres + ' (' + st.restosOffreCount + ' r.)</strong></div>' +
              '<div class="text-right"><span class="text-slate-400 block">% Offres / Global</span><strong class="text-[#FF2A6D] text-xs">' + pctOffresGlobal + ' %</strong></div>' +
              '<div class="pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">LR & LG (Livrées)</span><strong class="text-[#6C2BD9] font-mono">' + st.lrLgTnd.toFixed(2) + ' TND (' + pctLrLgVsBudgetAm + '%)</strong></div>' +
              '<div class="text-right pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">Part. Offres (Livrées)</span><strong class="text-[#FF2A6D] font-mono">' + st.offerPartTnd.toFixed(2) + ' TND (' + pctOfferPartVsBudgetAm + '%)</strong></div>' +
              '<div class="pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">Budget AM (TND)</span><strong class="text-[#1A1A2E] font-mono">' + st.budgetTnd.toFixed(2) + ' TND</strong></div>' +
              '<div class="text-right pt-1 border-t border-purple-100/70"><span class="text-slate-400 block">Reste Budget (TND)</span><strong class="' + (st.remainingBudgetTnd >= 0 ? 'text-[#00897B]' : 'text-[#FF2A6D]') + ' font-mono font-extrabold">' + st.remainingBudgetTnd.toFixed(2) + ' TND</strong></div>' +
              '<div class="col-span-2 bg-[#F3EBFF]/60 px-2.5 py-1.5 rounded-xl space-y-1">' +
                '<div class="flex items-center justify-between"><span class="text-slate-600 font-semibold">% Budget Utilisé (LR/LG + Offres)</span><strong class="' + (Number(pctTotalBudgetUsed) >= 95 ? 'text-[#FF2A6D]' : (Number(pctTotalBudgetUsed) >= 75 ? 'text-amber-600' : 'text-[#00897B]')) + ' text-xs font-extrabold">' + pctTotalBudgetUsed + ' %</strong></div>' +
                '<div class="w-full h-1.5 rounded-full bg-purple-200/70 overflow-hidden"><div class="h-full rounded-full transition-all duration-500 ' + (Number(pctTotalBudgetUsed) >= 95 ? 'bg-[#FF2A6D]' : (Number(pctTotalBudgetUsed) >= 75 ? 'bg-amber-500' : 'bg-[#00BFA5]')) + '" style="width:' + Math.min(100, Math.max(0, Number(pctTotalBudgetUsed))) + '%"></div></div>' +
              '</div>' +
              zeroOrdersBlock +
            '</div>' +
          '</div>';
        }).join('');

        window.yassirRenderAmTable();
      }

      window.yassirRenderAmTable = function () {
        var tbody = document.getElementById('amMappingTableBody');
        var counterEl = document.getElementById('amMappingCounterText');
        var filterGroup = document.getElementById('amZeroOrderFilterGroup');
        var zeroBadgeCount = document.getElementById('amZeroOrderBadgeCount');
        var thOrdersCol = document.getElementById('thAmOrdersCol');
        if (!tbody) return;

        var ownerAdmin = isOwnerAdmin();
        var showZeroStats = canSeeZeroOrdersStats();

        if (filterGroup) {
          if (showZeroStats) filterGroup.classList.remove('hidden');
          else filterGroup.classList.add('hidden');
        }
        if (thOrdersCol) {
          if (showZeroStats) thOrdersCol.classList.remove('hidden');
          else thOrdersCol.classList.add('hidden');
        }

        var res = getFilteredAmPortfolioEntries();
        var entries = res.entries;
        if (zeroBadgeCount) zeroBadgeCount.textContent = res.zeroCountForScope;

        var displayLimit = window._amTableShowAll ? entries.length : 120;
        if (counterEl) {
          counterEl.textContent = entries.length + ' restaurant(s)';
        }

        var colSpanCount = 4 + (showZeroStats ? 1 : 0) + (ownerAdmin ? 1 : 0);

        if (entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="' + colSpanCount + '" class="px-4 py-8 text-center text-slate-400">Aucun restaurant trouvé pour ce filtre.</td></tr>';
          return;
        }

        var rowsHtml = entries.slice(0, displayLimit).map(function (item) {
          var key = item.key;
          var info = item.info;
          var ordersCell = showZeroStats
            ? '<td class="px-4 py-2 text-right font-mono whitespace-nowrap">' +
                (item.req === 0
                  ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-50 text-[#FF2A6D]">0 / 0</span>'
                  : '<span class="font-bold text-[#1A1A2E]">' + item.req + '</span> / <span class="font-bold text-[#00897B]">' + item.deliv + '</span>') +
              '</td>'
            : '';

          var actionsCell = ownerAdmin
            ? '<td class="px-4 py-2 text-right whitespace-nowrap">' +
                '<button type="button" data-action="open-edit-resto" data-key="' + escapeHtml(key) + '" class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F3EBFF] hover:bg-purple-200 text-[#6C2BD9] transition cursor-pointer mr-1"><i class="fa-solid fa-pen mr-1"></i>Modifier</button>' +
                '<button type="button" data-action="remove-resto" data-key="' + escapeHtml(key) + '" class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 hover:bg-rose-100 text-[#FF2A6D] transition cursor-pointer"><i class="fa-solid fa-trash-can"></i></button>' +
              '</td>'
            : '';

          return '<tr class="hover:bg-[#F8F9FC]">' +
            '<td class="px-4 py-2 font-bold text-[#1A1A2E]">' + escapeHtml(info.displayName) + '</td>' +
            '<td class="px-4 py-2"><span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(info.am) + '</span></td>' +
            '<td class="px-4 py-2 text-slate-600">' + escapeHtml(info.ville || '-') + '</td>' +
            '<td class="px-4 py-2 text-slate-600">' + escapeHtml(info.segment || '-') + '</td>' +
            ordersCell +
            actionsCell +
          '</tr>';
        }).join('');
        if (!window._amTableShowAll && entries.length > displayLimit) {
          rowsHtml += '<tr><td colspan="' + colSpanCount + '" class="px-4 py-2.5 text-center bg-[#F8F9FC]"><button type="button" onclick="window._amTableShowAll=true;window.yassirRenderAmTable();" class="px-3.5 py-1 rounded-full text-xs font-bold bg-[#6C2BD9] text-white cursor-pointer">Afficher les ' + (entries.length - displayLimit) + ' autres restaurants</button></td></tr>';
        }
        tbody.innerHTML = rowsHtml;
      };

      window.yassirAddRestoToAm = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!isOwnerAdmin()) return false;

        var nameVal = document.getElementById('inputAmRestName').value.trim();
        var amVal = document.getElementById('selectAmAgent').value;
        var villeVal = document.getElementById('inputAmRestVille').value.trim();
        var segmentVal = document.getElementById('selectAmRestSegment').value;
        if (!nameVal || !amVal) return false;

        state.amPortfolios[nameVal.toLowerCase()] = {
          am: amVal,
          displayName: nameVal,
          ville: villeVal,
          segment: segmentVal
        };
        savePortfoliosToStore();

        document.getElementById('inputAmRestName').value = '';
        document.getElementById('inputAmRestVille').value = '';

        executerTraitementMetier();
        showToast('<strong>' + escapeHtml(nameVal) + '</strong> attribué à <strong>' + escapeHtml(amVal) + '</strong>.', 'success');
        return false;
      };

      window.yassirOpenEditRestoModal = function (key) {
        if (!isOwnerAdmin()) return;
        var info = state.amPortfolios[key];
        if (!info) return;

        document.getElementById('editRestoOriginalKey').value = key;
        document.getElementById('editRestoName').value = info.displayName;
        document.getElementById('editRestoAm').value = info.am;
        document.getElementById('editRestoVille').value = info.ville || '';
        document.getElementById('editRestoSegment').value = info.segment || '';

        document.getElementById('editRestoModal').classList.remove('hidden');
      };

      window.yassirCloseEditRestoModal = function () {
        document.getElementById('editRestoModal').classList.add('hidden');
      };

      window.yassirSubmitEditResto = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!isOwnerAdmin()) return false;

        var oldKey = document.getElementById('editRestoOriginalKey').value;
        var newName = document.getElementById('editRestoName').value.trim();
        var newAm = document.getElementById('editRestoAm').value;
        var newVille = document.getElementById('editRestoVille').value.trim();
        var newSegment = document.getElementById('editRestoSegment').value;

        if (!newName || !newAm) return false;

        if (oldKey && oldKey !== newName.toLowerCase()) {
          delete state.amPortfolios[oldKey];
        }

        state.amPortfolios[newName.toLowerCase()] = {
          am: newAm,
          displayName: newName,
          ville: newVille,
          segment: newSegment
        };
        savePortfoliosToStore();
        window.yassirCloseEditRestoModal();
        executerTraitementMetier();
        showToast('Restaurant <strong>' + escapeHtml(newName) + '</strong> mis à jour (' + escapeHtml(newAm) + ').', 'success');
        return false;
      };

      window.yassirRemoveRestoFromAm = function (key) {
        if (!isOwnerAdmin()) return;
        var info = state.amPortfolios[key];
        if (!info) return;
        delete state.amPortfolios[key];
        savePortfoliosToStore();
        executerTraitementMetier();
        showToast('Restaurant <strong>' + escapeHtml(info.displayName) + '</strong> retiré du portefeuille.', 'info');
      };

      window.yassirOnAmFileChange = async function (e) {
        if (!isOwnerAdmin()) return;
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!(await window.yassirAttendreLibsLourdes())) return;
        var targetMode = document.getElementById('selectImportTargetAm').value;

        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = new Uint8Array(ev.target.result);
            var wb = XLSX.read(data, { type: 'array' });
            var addedCount = 0;

            wb.SheetNames.forEach(function (sheetName) {
              var resolvedAm = targetMode === 'AUTO' ? matchAgentFromText(sheetName) : targetMode;
              if (!resolvedAm && wb.SheetNames.length === 1 && targetMode !== 'AUTO') {
                resolvedAm = targetMode;
              }

              var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
              if (!rows || rows.length === 0) return;

              // Import dans les portefeuilles de la marque ACTIVE : on filtre par la
              // colonne APP quand elle existe (classeur fusionné) ; sans colonne APP,
              // toutes les lignes sont gardées (anciens fichiers).
              addedCount += extraireRestaurantsDepuisLignesSheet(rows, resolvedAm, state.amPortfolios, (typeof currentBrand !== 'undefined' ? currentBrand : ''));
            });

            savePortfoliosToStore();
            executerTraitementMetier();
            showToast('<strong>' + addedCount + ' restaurant(s)</strong> importé(s) et attribué(s) depuis <strong>' + escapeHtml(file.name) + '</strong>.', 'success');
          } catch (err) {
            showToast('Erreur lecture fichier portefeuille : ' + escapeHtml(err.message), 'error');
          }
          e.target.value = '';
        };
        reader.readAsArrayBuffer(file);
      };
