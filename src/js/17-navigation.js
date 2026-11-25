      /* ========================================================================
         M. NAVIGATION ONGLETS, FILTRES & PAGINATION
         ======================================================================== */
      function syncLmdSidebarActiveState(tabName) {
        var metaMap = {
          market: { title: 'Market VF (109 colonnes)', sub: 'Commandes Market filtrées et recalculées automatiquement', icon: 'fa-solid fa-basket-shopping' },
          food: { title: 'Food VF (109 colonnes)', sub: 'Commandes Food filtrées avec calcul des temps, commissions et CA', icon: 'fa-solid fa-utensils' },
          offres: { title: 'Export Offres (Commandes Livrées)', sub: 'Récapitulatif par restaurant des remises articles, promos Admin et promos Restaurant', icon: 'fa-solid fa-tags' },
          participation: { title: 'Participation des Offres', sub: 'Remise totale et partage restaurant / plateforme par restaurant, sur la période filtrée', icon: 'fa-solid fa-hand-holding-dollar' },
          stat: { title: 'Stat Restaurants (VSTACK / QUERY)', sub: 'Performance détaillée par restaurant : Requested, Delivered, Success Rate, GMV, AOV, CA', icon: 'fa-solid fa-chart-column' },
          synth_global: { title: 'Synthèse Food & Variation entre Périodes', sub: '17 KPIs ARRAYFORMULA, répartition Lundi–Dimanche et comparatif avec Data préc', icon: 'fa-solid fa-table-cells' },
          resto_analytics: { title: 'Analyse Restaurant (Top Items & Courbe Lundi–Dimanche)', sub: 'Classement des articles vendus et évolution journalière par restaurant', icon: 'fa-solid fa-store' },
          cancellations_analytics: { title: 'Analyse des Annulations (Types, % & Restaurant Rejected)', sub: 'Répartition des types d\'annulation, graphiques par jour de semaine et motifs détaillés', icon: 'fa-solid fa-ban' },
          global_analysis: { title: 'Global Analysis — Performance Hebdomadaire (Week 01 → 53)', sub: 'Tableau hebdomadaire Yassir : Reçu, Livré, GMV, CA, AOV, Variations WoW % et % Global Livré', icon: 'fa-solid fa-globe' },
          restaurant_analysis: { title: 'Restaurant Analysis — Growth & Drop Hebdomadaire', sub: 'Comparatif hebdomadaire par restaurant : Delivered vs AVG Last 4 Week, WoW, Promo, CVM, Raison & Offre', icon: 'fa-solid fa-arrow-trend-up' },
          portefeuilles: { title: 'Portefeuilles AM & Contribution au Global', sub: 'Suivi des 7 portefeuilles Account Managers et liste des restaurants attribués', icon: 'fa-solid fa-briefcase' },
          commissions: { title: 'Grille des Commissions (Restaurant par facture)', sub: 'Taux TTC personnalisés synchronisés avec Google Sheets', icon: 'fa-solid fa-percent' }
        };

        var info = metaMap[tabName] || metaMap.market;
        var titleEl = document.getElementById('activeSectionTitle');
        var subEl = document.getElementById('activeSectionSubtitle');
        var iconEl = document.getElementById('activeSectionIcon');
        if (titleEl) titleEl.textContent = info.title;
        if (subEl) subEl.textContent = info.sub;
        if (iconEl) iconEl.className = info.icon;

        document.querySelectorAll('#lmdSidebarNav .tab-btn').forEach(function (btn) {
          var isSelected = btn.getAttribute('data-tab') === tabName;
          var dot = btn.querySelector('.lmd-radio-dot');
          if (isSelected) {
            btn.classList.add('active', 'yassir-lmd-item-active');
            btn.classList.remove('text-white/80');
            btn.classList.add('text-white');
            if (dot) {
              dot.className = 'lmd-radio-dot w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shrink-0';
              dot.innerHTML = '<span class="w-2 h-2 rounded-full bg-white"></span>';
            }
            var parentGroup = btn.closest('.lmd-nav-group');
            if (parentGroup) {
              parentGroup.classList.add('yassir-lmd-group-open');
              var itemsDiv = parentGroup.querySelector('.lmd-group-items');
              var chev = parentGroup.querySelector('.lmd-group-chevron');
              if (itemsDiv) itemsDiv.classList.remove('hidden');
              if (chev) chev.className = 'lmd-group-chevron fa-solid fa-chevron-up text-[10px] text-purple-200 transition-transform';
            }
          } else {
            btn.classList.remove('active', 'yassir-lmd-item-active', 'text-white');
            btn.classList.add('text-white/80');
            if (dot) {
              dot.className = 'lmd-radio-dot w-4 h-4 rounded-full border border-white/45 flex items-center justify-center shrink-0';
              dot.innerHTML = '';
            }
          }
        });
      }

      window.yassirToggleNavGroup = function (groupKey) {
        var groupEl = document.querySelector('.lmd-nav-group[data-group="' + groupKey + '"]');
        if (!groupEl) return;
        var itemsDiv = groupEl.querySelector('.lmd-group-items');
        var chev = groupEl.querySelector('.lmd-group-chevron');
        if (!itemsDiv) return;
        var isHidden = itemsDiv.classList.contains('hidden');
        if (isHidden) {
          itemsDiv.classList.remove('hidden');
          groupEl.classList.add('yassir-lmd-group-open');
          if (chev) chev.className = 'lmd-group-chevron fa-solid fa-chevron-up text-[10px] text-purple-200 transition-transform';
        } else {
          itemsDiv.classList.add('hidden');
          groupEl.classList.remove('yassir-lmd-group-open');
          if (chev) chev.className = 'lmd-group-chevron fa-solid fa-chevron-down text-[10px] text-purple-200 transition-transform';
        }
      };

      var lmdSidebarCollapsed = false;
      window.yassirToggleSidebarCollapse = function () {
        var sb = document.getElementById('lmdSidebar');
        var icon = document.getElementById('lmdSidebarCollapseIcon');
        var searchBox = document.getElementById('lmdSidebarSearchBox');
        if (!sb) return;
        lmdSidebarCollapsed = !lmdSidebarCollapsed;
        if (lmdSidebarCollapsed) {
          sb.classList.remove('w-[275px]');
          sb.classList.add('w-[76px]');
          if (icon) icon.className = 'fa-solid fa-chevron-right';
          if (searchBox) searchBox.classList.add('hidden');
          sb.querySelectorAll('.lmd-nav-label, .lmd-radio-dot').forEach(function (el) { el.classList.add('hidden'); });
        } else {
          sb.classList.remove('w-[76px]');
          sb.classList.add('w-[275px]');
          if (icon) icon.className = 'fa-solid fa-chevron-left';
          if (searchBox) searchBox.classList.remove('hidden');
          sb.querySelectorAll('.lmd-nav-label, .lmd-radio-dot').forEach(function (el) { el.classList.remove('hidden'); });
        }
      };

      window.yassirToggleMobileSidebar = function (open) {
        var sb = document.getElementById('lmdSidebar');
        var bd = document.getElementById('lmdMobileBackdrop');
        if (!sb || !bd) return;
        var shouldOpen = (typeof open === 'boolean') ? open : sb.classList.contains('-translate-x-full');
        if (shouldOpen) {
          sb.classList.remove('-translate-x-full');
          bd.classList.remove('hidden');
        } else {
          sb.classList.add('-translate-x-full');
          bd.classList.add('hidden');
        }
      };

      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          window.yassirToggleMobileSidebar(false);
          window.yassirToggleNotifPanel(false);
        }
      });

      window.yassirFilterSidebarMenu = function (q) {
        var query = String(q || '').trim().toLowerCase();
        document.querySelectorAll('#lmdSidebarNav .lmd-nav-group').forEach(function (grp) {
          var items = grp.querySelectorAll('.lmd-group-items button');
          var anyVisible = false;
          items.forEach(function (btn) {
            if (btn.id === 'tabBtnSynthGlobal' && (!canSeeGlobalSynth() || (!isMarketOnlyViewer() && getEffectiveAmFilter() !== 'ALL'))) return;
            if (btn.id === 'tabBtnCommissions' && !isOwnerAdmin()) return;
            if (btn.id === 'tabBtnFood' && isMarketOnlyViewer()) return;
            if (btn.id === 'tabBtnMarket' && isFoodOnlyAm()) return;
            if ((btn.id === 'btnOpenAccessManager' || btn.id === 'btnSyncYassirAll' || btn.id === 'btnSyncKoolSheetsNow') && !isOwnerAdmin()) return;
            var txt = btn.textContent.toLowerCase();
            if (!query || txt.includes(query)) {
              btn.style.display = '';
              anyVisible = true;
            } else {
              btn.style.display = 'none';
            }
          });
          if (query && anyVisible) {
            var itemsDiv = grp.querySelector('.lmd-group-items');
            if (itemsDiv) itemsDiv.classList.remove('hidden');
          }
        });
      };

      window.yassirSwitchTab = function (tabName) {
        if (tabName === 'commissions' && !isOwnerAdmin()) return;
        if (tabName === 'food' && isMarketOnlyViewer()) return;
        if (tabName === 'market' && isFoodOnlyAm()) return;
        if (tabName === 'synth_global' && (!canSeeGlobalSynth() || (!isMarketOnlyViewer() && getEffectiveAmFilter() !== 'ALL'))) return;
        state.activeTab = tabName;
        state.currentPage = 1;
        syncLmdSidebarActiveState(tabName);
        window.yassirToggleMobileSidebar(false);

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
        syncLmdSidebarActiveState(state.activeTab);
        mettreAJourInterface();
      };

      window.yassirSetStatusFilter = function (mode) {
        state.statusFilter = mode;
        state.currentPage = 1;
        var btnAll = document.getElementById('btnFilterAll');
        var btnDel = document.getElementById('btnFilterDelivered');
        var btnNot = document.getElementById('btnFilterNotDelivered');

        btnAll.className = mode === 'all'
          ? 'px-3 py-1.5 rounded-full text-xs font-bold bg-[#1A1A2E] text-white shadow-sm transition cursor-pointer'
          : 'px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 hover:text-[#1A1A2E] transition cursor-pointer';
        btnDel.className = mode === 'delivered'
          ? 'px-3 py-1.5 rounded-full text-xs font-bold bg-[#00BFA5] text-[#1A1A2E] shadow-sm transition cursor-pointer'
          : 'px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 hover:text-[#00897B] transition cursor-pointer';
        btnNot.className = mode === 'not_delivered'
          ? 'px-3 py-1.5 rounded-full text-xs font-bold bg-[#FF2A6D] text-white shadow-sm transition cursor-pointer'
          : 'px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 hover:text-[#FF2A6D] transition cursor-pointer';

        afficherTableauDonnees();
      };

      window.yassirSetColsMode = function (showAll) {
        state.showAllCols = showAll;
        document.getElementById('btnColsKey').className = !showAll
          ? 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#6C2BD9] text-white shadow-sm transition cursor-pointer'
          : 'px-3.5 py-1.5 rounded-full text-xs font-bold text-[#6C2BD9] hover:text-[#5521B5] transition cursor-pointer';
        document.getElementById('btnColsAll').className = showAll
          ? 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#6C2BD9] text-white shadow-sm transition cursor-pointer'
          : 'px-3.5 py-1.5 rounded-full text-xs font-bold text-[#6C2BD9] hover:text-[#5521B5] transition cursor-pointer';
        afficherTableauDonnees();
      };

      var searchDebounceTimer = null;
      window.yassirOnSearchInput = function (val) {
        state.searchQuery = val;
        state.currentPage = 1;
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          afficherTableauDonnees();
        }, 180);
      };

      document.addEventListener('keydown', function (ev) {
        if ((ev.ctrlKey || ev.metaKey) && String(ev.key || '').toLowerCase() === 'k') {
          var sInp = document.getElementById('searchInput');
          if (sInp && !document.getElementById('appWrapper').classList.contains('hidden')) {
            ev.preventDefault();
            sInp.focus();
            sInp.select();
          }
        }
      });

      window.yassirPrevPage = function () {
        if (state.currentPage > 1) {
          state.currentPage--;
          afficherTableauDonnees();
        }
      };

      window.yassirNextPage = function () {
        state.currentPage++;
        afficherTableauDonnees();
      };
