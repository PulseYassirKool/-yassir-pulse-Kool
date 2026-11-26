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

      // Cache du nombre d'annulations du badge : le calcul concatène marketRows +
      // foodRows et rescanne tout à chaque mise à jour de l'interface. Le nombre ne
      // change qu'avec les données (révision) ou le filtre AM effectif.
      var _cancCountCache = { key: '', count: 0 };

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

      // --- Filtre Polygone Client (Kool uniquement) : menu déroulant multi-sélection ---
      // État en mémoire uniquement, comme le filtre AM (state.polygonFilter, vide = tous).
      var _polygonMenuOpen = false;

      function renderPolygonFilter() {
        var row = document.getElementById('polygonFilterRow');
        if (!row) return;
        var isKool = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        row.classList.toggle('hidden', !isKool);
        if (!isKool) return;
        var sel = getEffectivePolygonFilter();
        var listed = getDistinctPolygones();
        var labelEl = document.getElementById('polygonFilterBtnLabel');
        if (labelEl) {
          labelEl.textContent = sel.length === 0 ? 'Polygone : Tous'
            : sel.length === 1 ? ('Polygone : ' + sel[0])
            : ('Polygone : ' + sel.length + ' sélectionnés');
        }
        var countEl = document.getElementById('polygonFilterCount');
        if (countEl) {
          countEl.textContent = listed.length > 0
            ? (listed.length + ' polygone' + (listed.length > 1 ? 's' : '') + ' dans les données')
            : 'aucun polygone dans les données chargées';
        }
        var isSel = function (p) {
          return sel.some(function (s) { return String(s).trim().toLowerCase() === String(p).trim().toLowerCase(); });
        };
        var allBox = document.getElementById('polygonCheckAll');
        if (allBox) {
          // « Tous » est coché quand le filtre est inactif (vide = tous) ou quand
          // tous les polygones listés sont sélectionnés.
          allBox.checked = sel.length === 0 || listed.every(isSel);
        }
        var listEl = document.getElementById('polygonCheckList');
        if (listEl) {
          if (listed.length === 0) {
            listEl.innerHTML = '<p class="px-2 py-1.5 text-[11px] text-slate-400">Aucun polygone dans les données chargées — écrivez-en un ci-dessous.</p>';
          } else {
            listEl.innerHTML = listed.map(function (p) {
              // Filtre inactif (vide) = tous inclus : les cases sont cochées.
              var checked = sel.length === 0 || isSel(p);
              return '<label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#F3EBFF] cursor-pointer text-xs text-[#1A1A2E]">' +
                '<input type="checkbox" data-poly="' + escapeHtml(p) + '" ' + (checked ? 'checked' : '') + ' onchange="window.yassirTogglePolygon(this)" class="accent-[#6C2BD9]" />' +
                '<span>' + escapeHtml(p) + '</span></label>';
            }).join('');
          }
        }
        var menu = document.getElementById('polygonFilterMenu');
        if (menu) menu.classList.toggle('hidden', !_polygonMenuOpen);
      }

      window.yassirTogglePolygonMenu = function () {
        _polygonMenuOpen = !_polygonMenuOpen;
        var menu = document.getElementById('polygonFilterMenu');
        if (menu) menu.classList.toggle('hidden', !_polygonMenuOpen);
      };

      // Cocher / décocher un polygone. Si le filtre était inactif (tous), on
      // matérialise d'abord la sélection complète puis on retire celui-ci.
      window.yassirTogglePolygon = function (cb) {
        var name = (cb && cb.dataset) ? String(cb.dataset.poly || '').trim() : '';
        if (!name) return;
        var norm = name.toLowerCase();
        var sel = getEffectivePolygonFilter();
        var findIdx = function (arr) {
          for (var i = 0; i < arr.length; i++) {
            if (String(arr[i]).trim().toLowerCase() === norm) return i;
          }
          return -1;
        };
        if (sel.length === 0) {
          sel = getDistinctPolygones().slice();
          var k = findIdx(sel);
          if (k !== -1) sel.splice(k, 1);
        } else {
          var idx = findIdx(sel);
          if (idx !== -1) sel.splice(idx, 1);
          else sel.push(name);
        }
        window.yassirSetPolygonFilter(sel);
      };

      // « Tous les polygones » : coché = filtre inactif (tous) ; décoché = filtre
      // actif avec tous les polygones listés sélectionnés (on peut ensuite en
      // retirer un par un).
      window.yassirToggleAllPolygones = function (checked) {
        window.yassirSetPolygonFilter(checked ? [] : getDistinctPolygones().slice());
      };

      // Saisie manuelle : tape un nom de polygone (même absent des données) et
      // l'ajoute à la sélection. Si le filtre était inactif, la saisie crée une
      // sélection sur ce seul polygone.
      window.yassirAddPolygonManually = function () {
        var inp = document.getElementById('polygonManualInput');
        if (!inp) return;
        var name = inp.value.trim();
        if (!name) return;
        var sel = getEffectivePolygonFilter();
        var norm = name.toLowerCase();
        var exists = sel.some(function (s) { return String(s).trim().toLowerCase() === norm; });
        if (!exists) {
          if (sel.length === 0) sel = [name];
          else sel.push(name);
          window.yassirSetPolygonFilter(sel);
        }
        inp.value = '';
      };

      window.yassirClearPolygonFilter = function () {
        window.yassirSetPolygonFilter([]);
      };

      // Fermer le menu quand on clique ailleurs (même mécanisme que le menu des notifications).
      document.addEventListener('click', function (ev) {
        var wrap = document.getElementById('polygonFilterWrapper');
        var menu = document.getElementById('polygonFilterMenu');
        if (wrap && menu && !menu.classList.contains('hidden') && !wrap.contains(ev.target)) {
          _polygonMenuOpen = false;
          menu.classList.add('hidden');
        }
      });

      function mettreAJourInterface() {
        renderAmFilterPills();
        renderPolygonFilter();

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

        var filteredStatList = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.statRows));

        document.getElementById('tabCountMarket').textContent = currentStats.marketRecues;
        document.getElementById('tabCountFood').textContent = currentStats.foodRecues;
        document.getElementById('tabCountOffres').textContent = currentStats.totalOffres;
        document.getElementById('tabCountStat').textContent = filteredStatList.length;
        var elCancCnt = document.getElementById('tabCountCancellations');
        if (elCancCnt) {
          var cancCacheKey = String(state._calcRevision || 0) + '|' +
            (typeof currentBrand !== 'undefined' ? currentBrand : 'yassir') + '|' +
            getEffectiveAmFilter() + '|' + getPolygonFilterKey() + '|' +
            (state.marketRows ? state.marketRows.length : 0) + '|' +
            (state.foodRows ? state.foodRows.length : 0);
          if (_cancCountCache.key !== cancCacheKey) {
            var idxStCanc = TARGET_HEADERS.indexOf('status');
            var amAllOrders = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.marketRows.concat(state.foodRows)));
            _cancCountCache = {
              key: cancCacheKey,
              count: amAllOrders.filter(function (rec) {
                var s = String(rec.cells[idxStCanc] || '').trim().toLowerCase();
                return s && !s.includes('delivered');
              }).length
            };
          }
          elCancCnt.textContent = _cancCountCache.count;
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
              ? filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.offresRows)).length
              : state.activeTab === 'stat'
                ? filteredStatList.length
                : state.activeTab === 'portefeuilles'
                  ? visibleRestosCount
                  : commCount;
        document.getElementById('btnExportActiveCsv').disabled = activeDatasetCount === 0;

        afficherTableauDonnees();
        scheduleSmartNotificationsUpdate();
      }
