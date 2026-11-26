      /* ========================================================================
         O2. ONGLET ANALYSE RESTAURANT : TOP ITEMS VENDUS + COURBE LUNDI-DIMANCHE
         ======================================================================== */
      var selectedAnalyticsRestoKey = '';
      var restoWeeklyChartInstance = null;
      var currentRestoTopItemsList = [];
      // Message affiché quand le Top est vide faute de détails articles pour la période
      // (ex. feuille « détails articles » Kool = octobre uniquement) : sinon l'utilisateur
      // croit que le restaurant n'a rien vendu. Vide quand le Top n'est pas dans ce cas.
      var restoTopEmptyCoverageNote = '';

      // Cache de la liste des restaurants : le calcul rescanne toutes les commandes
      // (marketRows + foodRows) et était refait 3 fois par rendu du panneau + à chaque
      // frappe dans la recherche. La liste ne change qu'avec les données (révision).
      var _analyticsRestoListCache = { key: '', list: [] };
      function getAnalyticsRestoListCacheKey() {
        return String(state._calcRevision || 0) + '|' +
          (typeof currentBrand !== 'undefined' ? currentBrand : 'yassir') + '|' +
          getEffectiveAmFilter() + '|' +
          (currentUser ? currentUser.username + ':' + currentUser.role : '') + '|' +
          Object.keys(state.amPortfolios || {}).length + '|' +
          (state.marketRows ? state.marketRows.length : 0) + '|' +
          (state.foodRows ? state.foodRows.length : 0);
      }

      var restoListZeroFilterMode = 'all';

      window.yassirSetRestoListZeroFilter = function (mode) {
        restoListZeroFilterMode = mode;
        var bAll = document.getElementById('btnRestoListFilterAll');
        var bAct = document.getElementById('btnRestoListFilterActive');
        var bZero = document.getElementById('btnRestoListFilterZero');
        var bZeroOrder = document.getElementById('btnRestoListFilterZeroOrder');
        if (bAll) bAll.className = mode === 'all' ? 'px-2.5 py-1 rounded-full bg-[#6C2BD9] text-white cursor-pointer' : 'px-2.5 py-1 rounded-full text-slate-600 hover:text-[#6C2BD9] cursor-pointer';
        if (bAct) bAct.className = mode === 'active' ? 'px-2.5 py-1 rounded-full bg-[#00BFA5] text-[#1A1A2E] cursor-pointer' : 'px-2.5 py-1 rounded-full text-slate-600 hover:text-[#00897B] cursor-pointer';
        if (bZero) bZero.className = mode === 'zero' ? 'px-2.5 py-1 rounded-full bg-[#FF2A6D] text-white cursor-pointer' : 'px-2.5 py-1 rounded-full text-slate-600 hover:text-[#FF2A6D] cursor-pointer';
        if (bZeroOrder) bZeroOrder.className = mode === 'zero_order' ? 'px-2.5 py-1 rounded-full bg-[#FF2A6D] text-white cursor-pointer' : 'px-2.5 py-1 rounded-full text-slate-600 hover:text-[#FF2A6D] cursor-pointer';
        var filterInput = document.getElementById('searchRestoSelectInput');
        window.yassirFilterRestoDropdown(filterInput ? filterInput.value : '');
      };

      function getAvailableRestaurantsForAnalytics() {
        var cacheKey = getAnalyticsRestoListCacheKey();
        if (_analyticsRestoListCache.key === cacheKey && _analyticsRestoListCache.list.length > 0) {
          return _analyticsRestoListCache.list;
        }
        var allowedAms = getAllowedAmListForCurrentUser();
        var activeAm = getEffectiveAmFilter();
        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxGmv = TARGET_HEADERS.indexOf('Total Food VF');
        var idxArea = TARGET_HEADERS.indexOf('Area');

        var map = new Map();

        // 1. Restaurants issus des portefeuilles autorisés (inclus même avec 0 commande livrée)
        Object.entries(state.amPortfolios).forEach(function (pair) {
          var key = pair[0];
          var info = pair[1];
          if (!canViewAllPortfolios() && allowedAms.indexOf(info.am) === -1) return;
          if (activeAm !== 'ALL' && info.am !== activeAm) return;
          map.set(key, {
            key: key,
            name: info.displayName,
            am: info.am,
            ville: info.ville || '',
            orderCount: 0,
            deliveredCount: 0,
            gmvSum: 0
          });
        });

        // 2. Comptage des commandes reçues, livrées et GMV dans Data exp
        var allRecords = state.marketRows.concat(state.foodRows);
        allRecords.forEach(function (rec) {
          if (!canViewAllPortfolios() && allowedAms.indexOf(rec.am) === -1) return;
          if (activeAm !== 'ALL' && rec.am !== activeAm) return;
          var rName = String(rec.cells[idxResto] || '').trim();
          var rKey = rName.toLowerCase();
          if (!rKey) return;
          if (!map.has(rKey)) {
            map.set(rKey, {
              key: rKey,
              name: rName,
              am: rec.am,
              ville: String(rec.cells[idxArea] || '').trim(),
              orderCount: 0,
              deliveredCount: 0,
              gmvSum: 0
            });
          }
          var entry = map.get(rKey);
          if (!entry.ville && rec.cells[idxArea]) entry.ville = String(rec.cells[idxArea]).trim();
          entry.orderCount++;
          if (estCommandeLivree(rec.cells[idxStatus])) {
            entry.deliveredCount++;
            entry.gmvSum += purgerNombre(rec.cells[idxGmv]);
          }
        });

        var sortedList = Array.from(map.values()).sort(function (a, b) {
          return (b.deliveredCount - a.deliveredCount) || (b.orderCount - a.orderCount) || a.name.localeCompare(b.name, 'fr');
        });
        _analyticsRestoListCache = { key: getAnalyticsRestoListCacheKey(), list: sortedList };
        return sortedList;
      }

      function getFilteredRestoOrdersList(filterText) {
        var q = String(filterText || '').trim().toLowerCase();
        return getAvailableRestaurantsForAnalytics().filter(function (item) {
          if (restoListZeroFilterMode === 'active' && item.deliveredCount <= 0) return false;
          if (restoListZeroFilterMode === 'zero' && item.deliveredCount > 0) return false;
          if (restoListZeroFilterMode === 'zero_order' && item.orderCount > 0) return false;
          if (!q) return true;
          return item.name.toLowerCase().includes(q) ||
                 item.am.toLowerCase().includes(q) ||
                 (item.ville && item.ville.toLowerCase().includes(q));
        });
      }

      window.yassirFilterRestoDropdown = function (filterText) {
        var bZeroOrder = document.getElementById('btnRestoListFilterZeroOrder');
        if (bZeroOrder) {
          if (canSeeZeroOrdersStats()) bZeroOrder.classList.remove('hidden');
          else bZeroOrder.classList.add('hidden');
        }
        var select = document.getElementById('selectRestoAnalytics');
        var list = getFilteredRestoOrdersList(filterText);

        if (select) {
          var optionsHtml = '<option value="">-- Choisissez un restaurant (' + list.length + ') --</option>';
          list.forEach(function (item) {
            var selAttr = (item.key === selectedAnalyticsRestoKey) ? ' selected' : '';
            var suffix = ' (' + item.deliveredCount + ' livrées / ' + item.orderCount + ' reçues)';
            optionsHtml += '<option value="' + escapeHtml(item.key) + '"' + selAttr + '>' + escapeHtml(item.name) + ' — ' + escapeHtml(item.am) + suffix + '</option>';
          });
          select.innerHTML = optionsHtml;
        }

        var badge = document.getElementById('restoListTotalBadge');
        if (badge) badge.textContent = list.length;

        var tbody = document.getElementById('restoOrdersSummaryListBody');
        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">Aucun restaurant trouvé pour ce filtre.</td></tr>';
          } else {
            tbody.innerHTML = list.map(function (item) {
              var isSelected = item.key === selectedAnalyticsRestoKey;
              var delivBadge = item.deliveredCount > 0
                ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#E0F7F4] text-[#00897B]">' + item.deliveredCount + '</span>'
                : '<span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-50 text-[#FF2A6D]">0</span>';

              return '<tr data-resto-key="' + escapeHtml(item.key) + '" onclick="window.yassirOnSelectRestoAnalytics(this.getAttribute(\'data-resto-key\'))" class="cursor-pointer transition-colors ' +
                (isSelected ? 'bg-[#F3EBFF] font-bold' : 'hover:bg-[#F8F9FC]') + '">' +
                '<td class="px-3.5 py-2 font-bold text-[#1A1A2E]">' + escapeHtml(item.name) + '</td>' +
                '<td class="px-3.5 py-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(item.am) + '</span></td>' +
                '<td class="px-3.5 py-2 text-slate-500">' + escapeHtml(item.ville || '-') + '</td>' +
                '<td class="px-3.5 py-2 text-right font-mono">' + item.orderCount + '</td>' +
                '<td class="px-3.5 py-2 text-right font-mono">' + delivBadge + '</td>' +
                '<td class="px-3.5 py-2 text-right font-mono font-semibold text-[#6C2BD9]">' + item.gmvSum.toFixed(2) + '</td>' +
                '<td class="px-3.5 py-2 text-right">' +
                  '<button type="button" class="px-2.5 py-1 rounded-full text-[10px] font-bold ' + (isSelected ? 'bg-[#FF2A6D] text-white' : 'bg-[#F3EBFF] text-[#6C2BD9] hover:bg-purple-200') + '">' +
                  (isSelected ? 'Sélectionné' : 'Analyser') + '</button>' +
                '</td>' +
              '</tr>';
            }).join('');
          }
        }
      };

      window.yassirExportRestoOrdersListExcel = function () {
        var filterInput = document.getElementById('searchRestoSelectInput');
        var list = getFilteredRestoOrdersList(filterInput ? filterInput.value : '');
        if (list.length === 0) {
          showToast('Aucun restaurant à exporter dans la liste.', 'info');
          return;
        }
        var activeFilter = getEffectiveAmFilter();
        var suffix = activeFilter === 'ALL' ? 'Global' : activeFilter.replace(/\s+/g, '_');
        var aoa = [['Restaurant', 'Portefeuille AM', 'Ville / Zone', 'Commandes Reçues', 'Commandes Livrées', 'GMV Livrées (TND)']];
        list.forEach(function (item) {
          aoa.push([
            item.name,
            item.am,
            item.ville || '',
            item.orderCount,
            item.deliveredCount,
            Number(item.gmvSum.toFixed(2))
          ]);
        });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Restaurants Commandes');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Liste_Restaurants_Commandes_' + suffix + '_' + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : YASSIR_Liste_Restaurants_Commandes_' + suffix + '_' + dateStr + '.xlsx');
        showToast('Liste des <strong>' + list.length + ' restaurant(s)</strong> exportée en Excel (.xlsx).', 'success');
      };

      window.yassirOnSelectRestoAnalytics = function (restoKey) {
        selectedAnalyticsRestoKey = String(restoKey || '').toLowerCase();
        renderRestoAnalyticsPanel();
      };

      function getFrenchWeekdayIndexFromOrderDay(orderDayVal) {
        // Retourne 0 = Lundi, 1 = Mardi, ..., 6 = Dimanche (ou -1 si inconnu)
        if (!orderDayVal) return -1;
        var str = String(orderDayVal).trim();
        if (!str) return -1;

        // 1. Format "Mon Nov 16 2026" ou nom de jour en anglais/français
        var lower = str.toLowerCase();
        if (lower.startsWith('mon') || lower.startsWith('lun')) return 0;
        if (lower.startsWith('tue') || lower.startsWith('mar')) return 1;
        if (lower.startsWith('wed') || lower.startsWith('mer')) return 2;
        if (lower.startsWith('thu') || lower.startsWith('jeu')) return 3;
        if (lower.startsWith('fri') || lower.startsWith('ven')) return 4;
        if (lower.startsWith('sat') || lower.startsWith('sam')) return 5;
        if (lower.startsWith('sun') || lower.startsWith('dim')) return 6;

        // 2. Tentative de parsing Date standard (YYYY-MM-DD ou DD/MM/YYYY)
        var d = null;
        var slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (slashMatch) {
          d = new Date(parseInt(slashMatch[3], 10), parseInt(slashMatch[2], 10) - 1, parseInt(slashMatch[1], 10));
        } else {
          var parsed = Date.parse(str);
          if (!isNaN(parsed)) d = new Date(parsed);
        }

        if (d && !isNaN(d.getTime())) {
          var jsDay = d.getDay(); // 0 = Dimanche, 1 = Lundi ... 6 = Samedi
          return jsDay === 0 ? 6 : (jsDay - 1);
        }
        return -1;
      }

      function parseFoodItemsFromCell(rawFoodItemCell) {
        // Parse des formats courants Yassir :
        // Ex: "2 x Burger Classic, 1 x Frites" ou "Burger Classic (2) | Coca Cola (1)" ou "Pizza Margherita, Tacos Poulet"
        var str = String(rawFoodItemCell || '').trim();
        if (!str || str.toLowerCase() === 'n/a') return [];

        var parts = str.split(/[,|\n;]+/);
        var parsedItems = [];

        parts.forEach(function (part) {
          var token = part.trim();
          if (!token) return;

          var qty = 1;
          var itemName = token;

          // Cas A : "2 x Nom Article" ou "2x Nom Article"
          var mPrefix = token.match(/^(\d+)\s*[xX×]\s*(.+)$/);
          if (mPrefix) {
            qty = parseInt(mPrefix[1], 10) || 1;
            itemName = mPrefix[2].trim();
          } else {
            // Cas B : "Nom Article x2" ou "Nom Article (2)"
            var mSuffix = token.match(/^(.+?)\s*(?:\(\s*(\d+)\s*\)|[xX×]\s*(\d+))$/);
            if (mSuffix) {
              itemName = mSuffix[1].trim();
              qty = parseInt(mSuffix[2] || mSuffix[3], 10) || 1;
            }
          }

          if (itemName) {
            parsedItems.push({ name: itemName, qty: qty });
          }
        });

        return parsedItems;
      }

      function renderRestoAnalyticsPanel() {
        var filterInput = document.getElementById('searchRestoSelectInput');
        window.yassirFilterRestoDropdown(filterInput ? filterInput.value : '');

        var emptyState = document.getElementById('restoAnalyticsEmptyState');
        var contentBox = document.getElementById('restoAnalyticsContent');
        var kpisBox = document.getElementById('restoAnalyticsKpis');
        var amBadge = document.getElementById('restoAnalyticsAmBadge');
        var btnExport = document.getElementById('btnExportRestoItemsCsv');

        var availList = getAvailableRestaurantsForAnalytics();
        if (!selectedAnalyticsRestoKey && availList.length > 0) {
          selectedAnalyticsRestoKey = availList[0].key;
          var selEl = document.getElementById('selectRestoAnalytics');
          if (selEl) selEl.value = selectedAnalyticsRestoKey;
        }

        if (!selectedAnalyticsRestoKey) {
          emptyState.classList.remove('hidden');
          contentBox.classList.add('hidden');
          kpisBox.classList.add('hidden');
          amBadge.classList.add('hidden');
          btnExport.disabled = true;
          return;
        }

        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxGmv = TARGET_HEADERS.indexOf('Total Food VF');
        var idxOrderDay = TARGET_HEADERS.indexOf('order day');
        var idxFoodItem = TARGET_HEADERS.indexOf('Food Item');

        var allRecords = state.marketRows.concat(state.foodRows);
        var restoOrders = allRecords.filter(function (rec) {
          return String(rec.cells[idxResto] || '').trim().toLowerCase() === selectedAnalyticsRestoKey;
        });

        var cfgInfo = state.amPortfolios[selectedAnalyticsRestoKey];
        var amLabel = cfgInfo ? cfgInfo.am : (restoOrders[0] ? restoOrders[0].am : 'Non attribué');
        amBadge.textContent = 'Portefeuille AM : ' + amLabel;
        amBadge.classList.remove('hidden');

        // Afficher l'analyse complète même si le restaurant a 0 commande livrée ou 0 commande reçue

        emptyState.classList.add('hidden');
        contentBox.classList.remove('hidden');
        kpisBox.classList.remove('hidden');

        var deliveredOrders = restoOrders.filter(function (rec) {
          return estCommandeLivree(rec.cells[idxStatus]);
        });

        // 1. Calcul des ventes Lundi (0) -> Dimanche (6)
        var dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
        var dayDeliveredCounts = [0, 0, 0, 0, 0, 0, 0];
        var dayGmvSums = [0, 0, 0, 0, 0, 0, 0];

        var totalGmv = 0;
        var itemsMap = new Map();
        var totalItemsQty = 0;

        deliveredOrders.forEach(function (rec) {
          var c = rec.cells;
          var gmvVal = purgerNombre(c[idxGmv]);
          totalGmv += gmvVal;

          var dayIdx = getFrenchWeekdayIndexFromOrderDay(c[idxOrderDay]);
          if (dayIdx >= 0 && dayIdx <= 6) {
            dayDeliveredCounts[dayIdx] += 1;
            dayGmvSums[dayIdx] += gmvVal;
          }

          var oidRecLow = String(c[TARGET_HEADERS.indexOf('order id')] || '').trim().toLowerCase();
          var detailedItems = (window.koolOrderItemsByOrderId && oidRecLow)
            ? window.koolOrderItemsByOrderId.get(oidRecLow)
            : null;

          if (detailedItems && detailedItems.length > 0) {
            detailedItems.forEach(function (dIt) {
              var k = (dIt.article + '|' + dIt.type).toLowerCase();
              if (!itemsMap.has(k)) {
                itemsMap.set(k, {
                  name: dIt.article,
                  category: dIt.category || '',
                  type: dIt.type || 'Food',
                  qty: 0,
                  revenue: 0,
                  discountedQty: 0,
                  ordersCount: 0
                });
              }
              var entry = itemsMap.get(k);
              var q = dIt.quantity || 1;
              var effPrice = (dIt.discountPrice > 0 && dIt.discountPrice < (dIt.originalPrice || dIt.unitPrice))
                ? dIt.discountPrice
                : (dIt.unitPrice || dIt.originalPrice || 0);
              entry.qty += q;
              entry.revenue += effPrice * q;
              if (dIt.discountPrice > 0 && dIt.discountPrice < (dIt.originalPrice || dIt.unitPrice)) {
                entry.discountedQty += q;
              }
              entry.ordersCount += 1;
              totalItemsQty += q;
            });
          } else {
            var rawItems = parseFoodItemsFromCell(c[idxFoodItem]);
            rawItems.forEach(function (it) {
              var k = it.name.toLowerCase();
              if (!itemsMap.has(k)) {
                itemsMap.set(k, {
                  name: it.name,
                  category: '',
                  type: 'Food',
                  qty: 0,
                  revenue: 0,
                  discountedQty: 0,
                  ordersCount: 0
                });
              }
              var entry = itemsMap.get(k);
              entry.qty += it.qty;
              entry.ordersCount += 1;
              totalItemsQty += it.qty;
            });
          }
        });

        // Message ciblé quand le Top est vide faute de détails articles pour la période
        // (commandes livrées présentes mais aucune ligne d'article les concernant).
        restoTopEmptyCoverageNote = '';
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool' && deliveredOrders.length > 0 && itemsMap.size === 0) {
          if (!window.koolOrderItemsByOrderId || window.koolOrderItemsByOrderId.size === 0) {
            restoTopEmptyCoverageNote = 'Aucun détail article chargé : faites un « Sync Kool » pour charger la feuille des détails articles.';
          } else {
            var covMax = window.koolOrderItemsMaxDate || '';
            restoTopEmptyCoverageNote = covMax
              ? 'Aucun détail article pour cette période : la feuille « détails articles » Kool s’arrête au ' + covMax.split('-').reverse().join('/') + '. Ajoutez les lignes manquantes pour voir le Top.'
              : 'Aucun détail article pour cette période : la feuille « détails articles » Kool ne couvre pas ces commandes.';
          }
        }

        // 2. Mise à jour des 4 KPIs du restaurant
        var aovVal = deliveredOrders.length > 0 ? (totalGmv / deliveredOrders.length) : 0;
        document.getElementById('raKpiDelivered').textContent = deliveredOrders.length.toLocaleString('fr-FR');
        document.getElementById('raKpiRequested').textContent = 'sur ' + restoOrders.length.toLocaleString('fr-FR') + ' reçues';
        document.getElementById('raKpiGmv').textContent = totalGmv.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TND';
        document.getElementById('raKpiAov').textContent = 'Panier moyen : ' + aovVal.toFixed(2) + ' TND';
        document.getElementById('raKpiTotalItemsQty').textContent = totalItemsQty.toLocaleString('fr-FR');
        document.getElementById('raKpiUniqueItems').textContent = itemsMap.size + ' article(s) distinct(s)';

        var bestDayIdx = 0;
        for (var d = 1; d < 7; d++) {
          if (dayDeliveredCounts[d] > dayDeliveredCounts[bestDayIdx] ||
              (dayDeliveredCounts[d] === dayDeliveredCounts[bestDayIdx] && dayGmvSums[d] > dayGmvSums[bestDayIdx])) {
            bestDayIdx = d;
          }
        }
        if (deliveredOrders.length > 0) {
          document.getElementById('raKpiBestDay').textContent = dayNames[bestDayIdx];
          document.getElementById('raKpiBestDaySub').textContent = dayDeliveredCounts[bestDayIdx] + ' cmd • ' + dayGmvSums[bestDayIdx].toFixed(2) + ' TND';
        } else {
          document.getElementById('raKpiBestDay').textContent = '-';
          document.getElementById('raKpiBestDaySub').textContent = 'Aucune commande livrée';
        }

        // 3. Mise à jour du mini-tableau Lundi -> Dimanche
        var miniBody = document.getElementById('restoWeeklyMiniTableBody');
        if (miniBody) {
          miniBody.innerHTML =
            '<tr><td class="px-3 py-2 font-sans font-bold text-[#00897B]">Cmd Livrées</td>' +
            dayDeliveredCounts.map(function (cnt) { return '<td class="px-3 py-2 text-right font-bold text-[#1A1A2E]">' + cnt + '</td>'; }).join('') +
            '</tr>' +
            '<tr class="bg-[#F8F9FC]"><td class="px-3 py-2 font-sans font-bold text-[#6C2BD9]">GMV (TND)</td>' +
            dayGmvSums.map(function (val) { return '<td class="px-3 py-2 text-right font-semibold text-[#6C2BD9]">' + val.toFixed(2) + '</td>'; }).join('') +
            '</tr>';
        }

        // 4. Dessin de la courbe Chart.js (Lundi -> Dimanche, double axe Commandes Livrées & GMV)
        var canvas = document.getElementById('restoWeeklyChartCanvas');
        if (canvas && typeof Chart !== 'undefined') {
          if (restoWeeklyChartInstance) {
            restoWeeklyChartInstance.destroy();
          }
          var ctx = canvas.getContext('2d');
          restoWeeklyChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
              labels: dayNames,
              datasets: [
                {
                  label: 'Commandes livrées',
                  data: dayDeliveredCounts,
                  borderColor: '#00BFA5',
                  backgroundColor: 'rgba(0, 191, 165, 0.16)',
                  borderWidth: 3,
                  pointBackgroundColor: '#00BFA5',
                  pointRadius: 5,
                  tension: 0.35,
                  fill: true,
                  yAxisID: 'yOrders'
                },
                {
                  label: 'GMV (TND)',
                  data: dayGmvSums.map(function (v) { return Number(v.toFixed(2)); }),
                  borderColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#FFD100' : '#6C2BD9',
                  backgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? 'rgba(255, 209, 0, 0.10)' : 'rgba(108, 43, 217, 0.10)',
                  borderWidth: 3,
                  pointBackgroundColor: (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? '#111111' : '#FF2A6D',
                  pointRadius: 5,
                  tension: 0.35,
                  fill: false,
                  yAxisID: 'yGmv'
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { display: false },
                tooltip: {
                  backgroundColor: '#1E0B36',
                  titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
                  bodyFont: { family: 'Plus Jakarta Sans' },
                  padding: 10,
                  cornerRadius: 10
                }
              },
              scales: {
                yOrders: {
                  type: 'linear',
                  position: 'left',
                  beginAtZero: true,
                  ticks: { precision: 0, color: window.yassirCouleurGraphique('#00897B'), font: { weight: 'bold', size: 11 } },
                  grid: { color: window.yassirCouleurGraphique('#F3EBFF') },
                  title: { display: true, text: 'Commandes livrées', color: window.yassirCouleurGraphique('#00897B'), font: { size: 11, weight: 'bold' } }
                },
                yGmv: {
                  type: 'linear',
                  position: 'right',
                  beginAtZero: true,
                  ticks: { color: window.yassirCouleurGraphique('#6C2BD9'), font: { weight: 'bold', size: 11 } },
                  grid: { drawOnChartArea: false },
                  title: { display: true, text: 'GMV (TND)', color: window.yassirCouleurGraphique('#6C2BD9'), font: { size: 11, weight: 'bold' } }
                },
                x: {
                  ticks: { color: window.yassirCouleurGraphique('#1A1A2E'), font: { weight: 'bold', size: 11 } },
                  grid: { display: false }
                }
              }
            }
          });
        }

        // 5. Tri des articles vendus du Top au Moins vendu
        currentRestoTopItemsList = Array.from(itemsMap.values()).sort(function (a, b) {
          return (b.qty - a.qty) || (b.ordersCount - a.ordersCount) || a.name.localeCompare(b.name, 'fr');
        });

        btnExport.disabled = currentRestoTopItemsList.length === 0;
        window.yassirRenderRestoItemsTable();
      }

      window.yassirRenderRestoItemsTable = function () {
        var tbody = document.getElementById('restoTopItemsTableBody');
        var badge = document.getElementById('restoItemsCountBadge');
        var searchEl = document.getElementById('searchRestoItemInput');
        var typeSel = document.getElementById('filterRestoItemTypeSelect');
        if (!tbody) return;

        var q = searchEl ? searchEl.value.trim().toLowerCase() : '';
        var typeFilter = typeSel ? typeSel.value : 'ALL';

        var filtered = currentRestoTopItemsList.filter(function (it) {
          if (typeFilter === 'FOOD' && String(it.type || '').toLowerCase() === 'extra') return false;
          if (typeFilter === 'EXTRA' && String(it.type || '').toLowerCase() !== 'extra') return false;
          if (q) {
            var matchN = it.name.toLowerCase().includes(q) || (it.category && it.category.toLowerCase().includes(q));
            if (!matchN) return false;
          }
          return true;
        });

        var totalQtyAll = filtered.reduce(function (acc, it) { return acc + it.qty; }, 0);

        if (badge) {
          badge.textContent = filtered.length + ' article(s)';
        }

        if (filtered.length === 0) {
          var emptyMsg = (currentRestoTopItemsList.length === 0 && restoTopEmptyCoverageNote)
            ? restoTopEmptyCoverageNote
            : 'Aucun article trouvé pour ce restaurant.';
          tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">' + escapeHtml(emptyMsg) + '</td></tr>';
          return;
        }

        tbody.innerHTML = filtered.map(function (it, idx) {
          var rank = idx + 1;
          var pct = totalQtyAll > 0 ? ((it.qty / totalQtyAll) * 100).toFixed(1) : '0.0';
          var rankBadge = rank === 1
            ? '<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#FF2A6D] text-white font-extrabold text-[10px]">1</span>'
            : rank === 2
              ? '<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#6C2BD9] text-white font-extrabold text-[10px]">2</span>'
              : rank === 3
                ? '<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#00BFA5] text-[#1A1A2E] font-extrabold text-[10px]">3</span>'
                : '<span class="text-slate-400 font-mono font-bold text-[11px]">' + rank + '</span>';

          var isExtra = String(it.type || '').toLowerCase() === 'extra';
          var typeTag = isExtra
            ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-500">Extra</span>'
            : '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-[#00897B]">Food</span>';
          var catLine = it.category
            ? '<div class="text-[10px] text-slate-400 truncate">' + typeTag + ' ' + escapeHtml(it.category) + '</div>'
            : '<div class="text-[10px] text-slate-400">' + typeTag + '</div>';
          var promoTag = it.discountedQty > 0
            ? ' <span class="px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-rose-50 text-[#FF2A6D]">-' + it.discountedQty + ' promo</span>'
            : '';

          return '<tr class="hover:bg-[#F3EBFF]/40 transition-colors">' +
            '<td class="px-2.5 py-2 text-center">' + rankBadge + '</td>' +
            '<td class="px-2.5 py-2"><div class="font-bold text-[#1A1A2E]">' + escapeHtml(it.name) + promoTag + '</div>' + catLine + '</td>' +
            '<td class="px-2.5 py-2 text-right font-mono font-extrabold text-[#6C2BD9]">' + it.qty + '</td>' +
            '<td class="px-2.5 py-2 text-right font-mono font-bold text-[#1A1A2E]">' + (it.revenue > 0 ? it.revenue.toFixed(2) : '-') + '</td>' +
            '<td class="px-2.5 py-2 text-right font-mono text-slate-500">' + pct + '%</td>' +
          '</tr>';
        }).join('');
      };

      window.yassirCloseOrderItemsModal = function () {
        var m = document.getElementById('orderItemsDetailModal');
        if (m) m.classList.add('hidden');
      };

      window.yassirOpenOrderItemsModal = function (orderId) {
        var modal = document.getElementById('orderItemsDetailModal');
        var titleEl = document.getElementById('orderDetailModalTitle');
        var subEl = document.getElementById('orderDetailModalSub');
        var sumBar = document.getElementById('orderDetailSummaryBar');
        var tbody = document.getElementById('orderDetailModalTableBody');
        if (!modal || !tbody) return;

        var oidStr = String(orderId || '').trim();
        var oidLow = oidStr.toLowerCase();

        // Chercher la commande correspondante dans foodRows / marketRows
        var idxOid = TARGET_HEADERS.indexOf('order id');
        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxDay = TARGET_HEADERS.indexOf('order day');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxGmv = TARGET_HEADERS.indexOf('Total Food VF');
        var idxDiscAmt = TARGET_HEADERS.indexOf('Discount Amount');
        var idxItemTot = TARGET_HEADERS.indexOf('item total');
        var idxTotalFood = TARGET_HEADERS.indexOf('Total Food');
        var idxFoodItem = TARGET_HEADERS.indexOf('Food Item');

        var matchedRec = null;
        var allRecs = state.foodRows.concat(state.marketRows);
        for (var i = 0; i < allRecs.length; i++) {
          if (String(allRecs[i].cells[idxOid] || '').trim().toLowerCase() === oidLow) {
            matchedRec = allRecs[i];
            break;
          }
        }

        var restoName = matchedRec ? String(matchedRec.cells[idxResto] || '') : '';
        var orderDay = matchedRec ? String(matchedRec.cells[idxDay] || '') : '';
        var statusStr = matchedRec ? String(matchedRec.cells[idxStatus] || '') : '';
        var gmvVal = matchedRec ? purgerNombre(matchedRec.cells[idxGmv]) : 0;

        var items = (window.koolOrderItemsByOrderId && window.koolOrderItemsByOrderId.get(oidLow)) || [];
        if (items.length > 0 && !restoName) restoName = items[0].restaurant || '';
        if (items.length > 0 && !orderDay) orderDay = items[0].date || '';

        if (titleEl) titleEl.textContent = 'Commande #' + oidStr + (restoName ? ' • ' + restoName : '');
        if (subEl) subEl.textContent = (orderDay ? 'Date : ' + orderDay + ' • ' : '') + (statusStr ? 'Statut : ' + statusStr : 'Détail des articles');

        var evOffer = (typeof currentBrand !== 'undefined' && currentBrand === 'kool' && restoName)
          ? evaluerOffreKoolPourCommande(restoName, orderDay, oidStr)
          : null;

        var partByArticleMap = new Map();
        if (evOffer && evOffer.articleBreakdown) {
          evOffer.articleBreakdown.forEach(function (b) {
            partByArticleMap.set(b.article.toLowerCase(), b.partTnd);
          });
        }

        var totalOrig = 0;
        var totalEff = 0;
        var totalPartArt = evOffer ? (evOffer.articlePartTnd || 0) : 0;
        // Part. restaurant « Toute la carte » : remise réelle − part plateforme
        // (partPct points du brut avant remise, plafonnée à la remise).
        var totalPartMenu = 0;
        if (evOffer && evOffer.isPromoRestaurant && matchedRec) {
          var dAmtOrd = purgerNombre(matchedRec.cells[idxDiscAmt]);
          var brutOrd = purgerNombre(matchedRec.cells[idxItemTot]);
          if (!(brutOrd > 0)) brutOrd = (purgerNombre(matchedRec.cells[idxTotalFood]) || 0) + dAmtOrd;
          var partPlatOrd = Math.min((evOffer.partPct / 100) * brutOrd, dAmtOrd);
          totalPartMenu = Math.max(0, dAmtOrd - partPlatOrd);
        }

        items.forEach(function (it) {
          var q = it.quantity || 1;
          var oP = (it.originalPrice > 0 ? it.originalPrice : it.unitPrice) * q;
          var eP = ((it.discountPrice > 0 && it.discountPrice < (it.originalPrice || it.unitPrice)) ? it.discountPrice : (it.unitPrice || it.originalPrice || 0)) * q;
          totalOrig += oP;
          totalEff += eP;
        });

        if (sumBar) {
          sumBar.innerHTML =
            '<div><span class="text-slate-400 block">GMV Commande</span><strong class="text-sm text-[#1A1A2E] font-mono">' + (gmvVal || totalEff).toFixed(2) + ' TND</strong></div>' +
            '<div><span class="text-slate-400 block">Articles / Extras</span><strong class="text-sm text-[#6C2BD9] font-mono">' + items.length + ' ligne(s)</strong></div>' +
            '<div><span class="text-slate-400 block">Part. Offre Article</span><strong class="text-sm text-[#FF2A6D] font-mono">' + totalPartArt.toFixed(2) + ' TND</strong></div>' +
            '<div><span class="text-slate-400 block">Part. Toute la Carte</span><strong class="text-sm text-[#00897B] font-mono">' + totalPartMenu.toFixed(2) + ' TND</strong></div>';
        }

        if (items.length === 0) {
          var fallbackTxt = matchedRec ? String(matchedRec.cells[idxFoodItem] || '') : '';
          tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-6 text-center text-slate-500">' +
            (fallbackTxt ? ('Articles : <strong>' + escapeHtml(fallbackTxt) + '</strong>') : 'Aucun détail ligne-à-ligne trouvé pour cette commande.') +
            '</td></tr>';
        } else {
          tbody.innerHTML = items.map(function (it) {
            var isExtra = String(it.type || '').toLowerCase() === 'extra';
            var typeBadge = isExtra
              ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">Extra</span>'
              : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-[#00897B]">Food</span>';
            var partTnd = partByArticleMap.get(it.article.toLowerCase()) || 0;
            return '<tr class="hover:bg-[#F8F9FC]">' +
              '<td class="px-3 py-2 whitespace-nowrap">' + typeBadge + '</td>' +
              '<td class="px-3 py-2 text-slate-600">' + escapeHtml(it.category || '-') + '</td>' +
              '<td class="px-3 py-2 font-bold text-[#1A1A2E]">' + escapeHtml(it.article) + '</td>' +
              '<td class="px-3 py-2 text-right font-mono font-bold">' + it.quantity + '</td>' +
              '<td class="px-3 py-2 text-right font-mono">' + it.unitPrice.toFixed(2) + '</td>' +
              '<td class="px-3 py-2 text-right font-mono font-bold text-[#FF2A6D]">' + (it.discountPrice > 0 ? it.discountPrice.toFixed(2) : '-') + '</td>' +
              '<td class="px-3 py-2 text-right font-mono">' + it.originalPrice.toFixed(2) + '</td>' +
              '<td class="px-3 py-2 text-right font-mono font-extrabold text-[#6C2BD9]">' + (partTnd > 0 ? partTnd.toFixed(2) + ' TND' : '-') + '</td>' +
            '</tr>';
          }).join('');
        }

        modal.classList.remove('hidden');
      };

      window.yassirExportSelectedRestoItemsCsv = function () {
        if (!selectedAnalyticsRestoKey || currentRestoTopItemsList.length === 0) return;
        var totalQtyAll = currentRestoTopItemsList.reduce(function (acc, it) { return acc + it.qty; }, 0);
        var aoa = [['Rang', 'Restaurant', 'Type', 'Catégorie', 'Article', 'Quantité vendue', 'CA (TND)', 'Qté en promo', 'Part (%)']];
        currentRestoTopItemsList.forEach(function (it, idx) {
          var pct = totalQtyAll > 0 ? Number(((it.qty / totalQtyAll) * 100).toFixed(2)) : 0;
          aoa.push([idx + 1, selectedAnalyticsRestoKey, it.type || 'Food', it.category || '', it.name, it.qty, Number((it.revenue || 0).toFixed(2)), it.discountedQty || 0, pct]);
        });

        var ws = XLSX.utils.aoa_to_sheet(aoa);
        var csvContent = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'Top_Items_' + selectedAnalyticsRestoKey.replace(/\s+/g, '_') + '.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        window.yassirJournaliser('export', 'Export CSV : Top_Items_' + selectedAnalyticsRestoKey.replace(/\s+/g, '_') + '.csv');
        showToast('Classement Top Items exporté en CSV.', 'success');
      };
