      /* ========================================================================
         I. MISE À JOUR DE L'INTERFACE, BARRE AM, KPIs & TABLEAUX
         ======================================================================== */
      window.yassirSelectAmFilter = function (amName) {
        if (!currentUser) return;
        if (!canViewAllPortfolios() && amName !== 'ALL' && amName !== currentUser.amName) {
          return;
        }
        if (state.selectedAm === amName) return;
        state.selectedAm = amName;
        state.currentPage = 1;
        window._amTableShowAll = false;
        mettreAJourInterface();
      };

      function renderAmFilterPills() {
        var container = document.getElementById('amQuickFilterPills');
        if (!container) return;

        var activeFilter = getEffectiveAmFilter();
        var allowedAms = getAllowedAmListForCurrentUser();

        var isAll = activeFilter === 'ALL';
        var html = '<button type="button" onclick="window.yassirSelectAmFilter(\'ALL\')" class="px-2.5 py-1 rounded-full text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ' +
          (isAll ? 'bg-[#6C2BD9] text-white shadow-2xs' : 'bg-[#F8F9FC] text-[#1A1A2E] border border-purple-200 hover:bg-[#F3EBFF]') + '">' +
          '<i class="fa-solid fa-globe text-[10px]"></i><span>Global</span></button>';

        var restoCountsByAm = {};
        Object.values(state.amPortfolios).forEach(function (info) {
          if (info && info.am) restoCountsByAm[info.am] = (restoCountsByAm[info.am] || 0) + 1;
        });

        allowedAms.forEach(function (am) {
          var selected = activeFilter === am;
          var countRestos = restoCountsByAm[am] || 0;

          html += '<button type="button" onclick="window.yassirSelectAmFilter(\'' + escapeHtml(am) + '\')" class="px-2.5 py-1 rounded-full text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ' +
            (selected ? 'bg-[#FF2A6D] text-white shadow-2xs' : 'bg-white text-[#1A1A2E] border border-purple-200 hover:bg-[#F3EBFF]') + '">' +
            '<span>' + escapeHtml(am) + '</span>' +
            '<span class="px-1.5 rounded-full text-[9px] ' + (selected ? 'bg-white/25 text-white' : 'bg-[#F3EBFF] text-[#6C2BD9]') + '">' + countRestos + '</span>' +
            '</button>';
        });

        container.innerHTML = html;

        var statusBadge = document.getElementById('activeAmStatusBadge');
        if (isAll) {
          statusBadge.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#6C2BD9] text-white';
          statusBadge.innerHTML = '<i class="fa-solid fa-globe text-[10px]"></i><span>Global</span>';
        } else {
          statusBadge.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FF2A6D] text-white';
          statusBadge.innerHTML = '<i class="fa-solid fa-filter text-[10px]"></i><span>' + escapeHtml(activeFilter) + '</span>';
        }
      }

      function mettreAJourInterface() {
        renderAmFilterPills();

        var globalStats = calculerStatsPourAm('ALL');
        var activeFilter = getEffectiveAmFilter();
        var currentStats = activeFilter === 'ALL' ? globalStats : calculerStatsPourAm(activeFilter);

        var isKoolBrand = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        var isMktOnly = !isKoolBrand && isMarketOnlyViewer();
        var isFoodAmOnly = isFoodOnlyAm() || isKoolBrand;
        var tabBtnMarketEl = document.getElementById('tabBtnMarket');
        var kpiMarketBoxEl = document.getElementById('kpiMarketCardBox');
        var tabBtnFoodEl = document.getElementById('tabBtnFood');
        var kpiFoodBoxEl = document.getElementById('kpiFoodCardBox');

        if (tabBtnMarketEl) {
          if (isFoodAmOnly) {
            tabBtnMarketEl.classList.add('hidden');
            if (state.activeTab === 'market') {
              state.activeTab = 'food';
              syncLmdSidebarActiveState('food');
            }
          } else {
            tabBtnMarketEl.classList.remove('hidden');
          }
        }
        if (kpiMarketBoxEl) {
          if (isFoodAmOnly) kpiMarketBoxEl.classList.add('hidden');
          else kpiMarketBoxEl.classList.remove('hidden');
        }

        if (isKoolBrand && state.selectedAm === 'Eya Majdoub') {
          state.selectedAm = 'ALL';
        }

        if (tabBtnFoodEl) {
          if (isMktOnly) {
            tabBtnFoodEl.classList.add('hidden');
            if (state.activeTab === 'food') {
              state.activeTab = 'market';
              syncLmdSidebarActiveState('market');
            }
          } else {
            tabBtnFoodEl.classList.remove('hidden');
          }
        }
        if (kpiFoodBoxEl) {
          if (isMktOnly) kpiFoodBoxEl.classList.add('hidden');
          else kpiFoodBoxEl.classList.remove('hidden');
        }

        var cancScopeEl = document.getElementById('cancServiceScopeSelect');
        if (cancScopeEl) {
          if (isMktOnly) {
            cancScopeEl.value = 'MARKET';
            cancScopeEl.disabled = true;
          } else if (isFoodAmOnly) {
            cancScopeEl.value = 'FOOD';
            cancScopeEl.disabled = true;
          } else {
            cancScopeEl.disabled = false;
          }
        }
        var gaScopeEl = document.getElementById('globalAnalysisServiceScope');
        if (gaScopeEl) {
          if (isMktOnly) {
            gaScopeEl.innerHTML = '<option value="MARKET_ONLY" selected>Market VF uniquement</option>';
            gaScopeEl.disabled = true;
          } else if (isFoodAmOnly) {
            gaScopeEl.innerHTML = '<option value="FOOD" selected>Food VF uniquement</option>';
            gaScopeEl.disabled = true;
          } else {
            if (gaScopeEl.options.length === 1) {
              gaScopeEl.innerHTML = '<option value="FOOD">Food VF uniquement</option><option value="ALL">Tous services (Food + Market)</option>';
            }
            gaScopeEl.disabled = false;
          }
        }

        var tabLabelSynthEl = document.getElementById('tabLabelSynthGlobal');
        if (tabLabelSynthEl) {
          tabLabelSynthEl.textContent = isMktOnly ? 'Synthèse Market & Var.' : 'Synthèse Food & Var.';
        }

        var tabBtnSynth = document.getElementById('tabBtnSynthGlobal');
        var showSynthGlobalTab = canSeeGlobalSynth() && (isMktOnly || activeFilter === 'ALL');
        if (tabBtnSynth) {
          if (showSynthGlobalTab) {
            tabBtnSynth.classList.remove('hidden');
          } else {
            tabBtnSynth.classList.add('hidden');
            if (state.activeTab === 'synth_global') {
              state.activeTab = 'market';
              syncLmdSidebarActiveState('market');
            }
          }
        }

        var hasGlobalData = globalStats.totalRecues > 0;
        var kpiSection = document.getElementById('kpiSection');
        if (hasGlobalData) {
          kpiSection.classList.remove('hidden');
        } else {
          kpiSection.classList.add('hidden');
        }

        var totalAutres = currentStats.totalRecues - currentStats.totalLivrees;
        var deliveryPct = currentStats.totalRecues > 0 ? ((currentStats.totalLivrees / currentStats.totalRecues) * 100).toFixed(1) : '0.0';

        var shareDeliveredGlobalPct = globalStats.totalLivrees > 0
          ? ((currentStats.totalLivrees / globalStats.totalLivrees) * 100).toFixed(1)
          : '0.0';

        var shareOffresGlobalPct = globalStats.totalOffres > 0
          ? ((currentStats.totalOffres / globalStats.totalOffres) * 100).toFixed(1)
          : '0.0';

        document.getElementById('kpiTitleTotal').textContent = activeFilter === 'ALL' ? 'Total Reçues (Global)' : 'Reçues (' + activeFilter + ')';
        document.getElementById('kpiTotalOrders').textContent = currentStats.totalRecues.toLocaleString('fr-FR');
        document.getElementById('kpiDeliveryRateBadge').textContent = shareDeliveredGlobalPct + '% du global livré';
        document.getElementById('kpiDeliveredSplit').textContent = 'Livrées : ' + currentStats.totalLivrees.toLocaleString('fr-FR') + ' | Autres : ' + totalAutres.toLocaleString('fr-FR');
        document.getElementById('kpiShareDeliveredGlobal').textContent = 'Livrées / Global Livrées : ' + shareDeliveredGlobalPct + '% (' + currentStats.totalLivrees + '/' + globalStats.totalLivrees + ')';

        document.getElementById('kpiMarketOrders').textContent = currentStats.marketRecues.toLocaleString('fr-FR');
        document.getElementById('kpiMarketShare').textContent = 'Livrées : ' + currentStats.marketLivrees.toLocaleString('fr-FR') + ' | Reçues : ' + currentStats.marketRecues.toLocaleString('fr-FR');

        document.getElementById('kpiFoodOrders').textContent = currentStats.foodRecues.toLocaleString('fr-FR');
        document.getElementById('kpiFoodShare').textContent = 'Livrées : ' + currentStats.foodLivrees.toLocaleString('fr-FR') + ' | Reçues : ' + currentStats.foodRecues.toLocaleString('fr-FR');

        document.getElementById('kpiOffresTotal').textContent = currentStats.totalOffres.toLocaleString('fr-FR');
        document.getElementById('kpiOffresGlobalShareBadge').textContent = shareOffresGlobalPct + '% du global';
        document.getElementById('kpiOffresRestos').textContent = currentStats.restosOffreCount.toLocaleString('fr-FR') + ' restaurant(s) avec offre';
        document.getElementById('kpiOffresShareDetail').textContent = 'Offres Livrées / Global : ' + shareOffresGlobalPct + '% (' + currentStats.totalOffres + '/' + globalStats.totalOffres + ')';

        document.getElementById('kpiTotalCa').textContent = currentStats.caLivrees.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TND';
        document.getElementById('kpiCaBreakdown').textContent = 'Total reçues : ' + currentStats.caRecues.toFixed(2) + ' TND';

        // Mise à jour de l'encart Profil AM (LR/LG & Budget du AM uniquement, sans Global)
        var profileScopeAm = (currentUser && currentUser.role === 'am' && currentUser.amName)
          ? currentUser.amName
          : activeFilter;
        var profCardEl = document.getElementById('lmdProfileBudgetCard');
        if (profCardEl) {
          if (profileScopeAm && profileScopeAm !== 'ALL') {
            profCardEl.classList.remove('hidden');
            var profStats = calculerStatsPourAm(profileScopeAm);
            var pctLrVsBudgetAm = profStats.budgetTnd > 0
              ? ((profStats.lrLgTnd / profStats.budgetTnd) * 100).toFixed(1)
              : '0.0';
            var pctOfferVsBudgetAm = profStats.budgetTnd > 0
              ? ((profStats.offerPartTnd / profStats.budgetTnd) * 100).toFixed(1)
              : '0.0';
            var pctTotalVsBudgetAm = profStats.budgetTnd > 0
              ? ((profStats.totalBudgetUsedTnd / profStats.budgetTnd) * 100).toFixed(1)
              : '0.0';

            var elProfLr = document.getElementById('profileLrLgTnd');
            var elProfOp = document.getElementById('profileOfferPartTnd');
            var elProfBud = document.getElementById('profileBudgetTnd');
            var elProfBudPct = document.getElementById('profileLrLgVsBudgetAmPct');
            var elProfRem = document.getElementById('profileRemainingBudgetTnd');
            if (elProfLr) elProfLr.textContent = profStats.lrLgTnd.toFixed(2) + ' TND (' + pctLrVsBudgetAm + '%)';
            if (elProfOp) elProfOp.textContent = profStats.offerPartTnd.toFixed(2) + ' TND (' + pctOfferVsBudgetAm + '%)';
            if (elProfBud) elProfBud.textContent = profStats.budgetTnd.toFixed(2) + ' TND';
            if (elProfBudPct) elProfBudPct.textContent = pctTotalVsBudgetAm + '%';
            var elProfBar = document.getElementById('profileBudgetProgressBar');
            if (elProfBar) {
              var numPct = parseFloat(pctTotalVsBudgetAm) || 0;
              elProfBar.style.width = Math.min(100, Math.max(0, numPct)) + '%';
              elProfBar.className = numPct >= 95
                ? 'h-full rounded-full bg-[#FF2A6D] transition-all duration-500'
                : (numPct >= 75 ? 'h-full rounded-full bg-amber-400 transition-all duration-500' : 'h-full rounded-full bg-[#00BFA5] transition-all duration-500');
            }
            if (elProfRem) {
              elProfRem.textContent = profStats.remainingBudgetTnd.toFixed(2) + ' TND';
              elProfRem.className = profStats.remainingBudgetTnd >= 0
                ? 'text-[#00BFA5] font-extrabold font-mono'
                : 'text-[#FF2A6D] bg-white px-1.5 py-0.2 rounded-full font-extrabold font-mono';
            }
          } else {
            profCardEl.classList.add('hidden');
          }
        }

        var commCount = Object.keys(state.customCommissions).length;
        var visibleRestosCount = 0;
        var allowedAms = getAllowedAmListForCurrentUser();
        Object.values(state.amPortfolios).forEach(function (info) {
          if (canViewAllPortfolios() || allowedAms.indexOf(info.am) !== -1) visibleRestosCount++;
        });

        var filteredStatList = filtrerParAmSelectionne(state.statRows);

        document.getElementById('tabCountMarket').textContent = currentStats.marketRecues;
        document.getElementById('tabCountFood').textContent = currentStats.foodRecues;
        document.getElementById('tabCountOffres').textContent = currentStats.totalOffres;
        document.getElementById('tabCountStat').textContent = filteredStatList.length;
        var elCancCnt = document.getElementById('tabCountCancellations');
        if (elCancCnt) {
          var idxStCanc = TARGET_HEADERS.indexOf('status');
          var amAllOrders = filtrerParAmSelectionne(state.marketRows.concat(state.foodRows));
          var totalCancOrders = amAllOrders.filter(function (rec) {
            var s = String(rec.cells[idxStCanc] || '').trim().toLowerCase();
            return s && !s.includes('delivered');
          }).length;
          elCancCnt.textContent = totalCancOrders;
        }
        document.getElementById('tabCountAm').textContent = visibleRestosCount;
        document.getElementById('tabCountComm').textContent = commCount;
        document.getElementById('badgeCommCount').textContent = commCount + ' taux chargé' + (commCount > 1 ? 's' : '');

        document.getElementById('btnExportStatXlsx').disabled = !hasGlobalData;
        document.getElementById('btnExportXlsx').disabled = !hasGlobalData;
        document.getElementById('btnExportOffresXlsx').disabled = state.offresRows.length === 0;

        var activeDatasetCount = state.activeTab === 'market'
          ? currentStats.marketRecues
          : state.activeTab === 'food'
            ? currentStats.foodRecues
            : state.activeTab === 'offres'
              ? filtrerParAmSelectionne(state.offresRows).length
              : state.activeTab === 'stat'
                ? filteredStatList.length
                : state.activeTab === 'portefeuilles'
                  ? visibleRestosCount
                  : commCount;
        document.getElementById('btnExportActiveCsv').disabled = activeDatasetCount === 0;

        afficherTableauDonnees();
        scheduleSmartNotificationsUpdate();
      }
