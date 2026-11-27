      /* ========================================================================
         O2-BIS. ONGLET ANNULATIONS (TYPES %, GRAPHE, JOUR SEMAINE, RESTAURANT REJECTED & RAISONS)
         ======================================================================== */
      var cancTypesChartInstance = null;
      var cancWeeklyChartInstance = null;
      var cancTypeFilterMode = 'ALL';
      var cancReasonFilterMode = 'ALL';
      var currentFilteredCancRecords = [];
      var currentCancTypesSummary = [];
      var currentCancReasonsSummary = [];

      window.yassirSetCancTypeFilter = function (mode) {
        cancTypeFilterMode = mode || 'ALL';
        var btnAll = document.getElementById('btnCancFilterAll');
        var btnRej = document.getElementById('btnCancFilterRestoRej');
        if (btnAll) {
          btnAll.className = cancTypeFilterMode === 'ALL'
            ? 'px-3 py-1 rounded-full bg-[#1A1A2E] text-white cursor-pointer'
            : 'px-3 py-1 rounded-full text-slate-600 hover:text-[#1A1A2E] cursor-pointer';
        }
        if (btnRej) {
          btnRej.className = cancTypeFilterMode === 'RESTAURANT_REJECTED'
            ? 'px-3 py-1 rounded-full bg-[#FF2A6D] text-white cursor-pointer'
            : 'px-3 py-1 rounded-full text-slate-600 hover:text-[#FF2A6D] cursor-pointer';
        }
        window.yassirRenderCancellationsDetailTable();
      };

      window.yassirSetCancReasonFilter = function (reasonVal) {
        cancReasonFilterMode = reasonVal || 'ALL';
        var sel = document.getElementById('cancReasonDropdownFilter');
        if (sel) sel.value = cancReasonFilterMode;
        window.yassirRenderCancellationsDetailTable();
      };

      window.yassirRenderCancellationsPanel = function () {
        // I2 : graphique demandé avant l'arrivée de Chart.js — il sera redessiné quand les libs seront là.
        if (!window.Chart) window.__yassirChartsManquants = true;
        var emptyEl = document.getElementById('cancEmptyState');
        var contentEl = document.getElementById('cancContentWrapper');
        var btnExport = document.getElementById('btnExportCancXlsx');
        var scopeSel = document.getElementById('cancServiceScopeSelect');
        if (!emptyEl || !contentEl) return;

        var scopeMode = scopeSel ? scopeSel.value : 'ALL';
        var rawBase = scopeMode === 'FOOD'
          ? state.foodRows
          : (scopeMode === 'MARKET' ? state.marketRows : state.marketRows.concat(state.foodRows));

        var amOrders = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(rawBase));
        if (!amOrders || amOrders.length === 0) {
          emptyEl.classList.remove('hidden');
          contentEl.classList.add('hidden');
          if (btnExport) btnExport.disabled = true;
          return;
        }

        var idxOrderId = TARGET_HEADERS.indexOf('order id');
        var idxOrderDay = TARGET_HEADERS.indexOf('order day');
        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxCancelledBy = TARGET_HEADERS.indexOf('Cancelled BY');
        var idxReasonVF = TARGET_HEADERS.indexOf('cancellation reason VF');
        var idxReasonRaw = TARGET_HEADERS.indexOf('cancellation reason');

        var totalReq = amOrders.length;
        var totalDeliv = 0;
        var cancRecords = [];
        var typeMap = new Map();
        var reasonMap = new Map();

        var dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
        var dayStats = dayNames.map(function (d) { return { day: d, req: 0, canc: 0, restoRej: 0 }; });

        amOrders.forEach(function (rec) {
          var c = rec.cells;
          var dIdx = getFrenchWeekdayIndexFromOrderDay(c[idxOrderDay]);
          if (dIdx >= 0 && dIdx <= 6) dayStats[dIdx].req += 1;

          var rawStatus = String(c[idxStatus] || '').trim();
          var stLower = rawStatus.toLowerCase();
          if (stLower.includes('delivered')) {
            totalDeliv += 1;
            return;
          }

          var cancBy = String(c[idxCancelledBy] || '').trim();
          var reasonStr = String(c[idxReasonVF] || c[idxReasonRaw] || '').trim() || 'Non spécifiée';
          var typeLabel = rawStatus || (cancBy ? ('Cancelled by ' + cancBy) : 'Autre annulation');
          var isRestoRej = stLower.includes('restaurant rejected') || (stLower.includes('reject') && stLower.includes('restaurant')) || cancBy.toLowerCase() === 'restaurant' || isRestaurantRejectedReason(reasonStr);
          if (isRestoRej && !stLower.includes('restaurant rejected')) {
            typeLabel = 'Restaurant Rejected';
          }

          if (!typeMap.has(typeLabel)) {
            typeMap.set(typeLabel, { type: typeLabel, count: 0, isRestoRej: isRestoRej });
          }
          typeMap.get(typeLabel).count += 1;

          reasonMap.set(reasonStr, (reasonMap.get(reasonStr) || 0) + 1);

          if (dIdx >= 0 && dIdx <= 6) {
            dayStats[dIdx].canc += 1;
            if (isRestoRej) dayStats[dIdx].restoRej += 1;
          }

          cancRecords.push({
            orderId: String(c[idxOrderId] || '').trim(),
            orderDay: String(c[idxOrderDay] || '').trim(),
            resto: String(c[idxResto] || '').trim(),
            am: rec.am || 'Non attribué',
            type: typeLabel,
            isRestoRej: isRestoRej,
            reason: reasonStr
          });
        });

        currentFilteredCancRecords = cancRecords;

        if (cancRecords.length === 0) {
          emptyEl.classList.remove('hidden');
          contentEl.classList.add('hidden');
          if (btnExport) btnExport.disabled = true;
          return;
        }

        emptyEl.classList.add('hidden');
        contentEl.classList.remove('hidden');
        if (btnExport) btnExport.disabled = false;

        var totalCanc = cancRecords.length;
        var restoRejCount = cancRecords.filter(function (x) { return x.isRestoRej; }).length;
        var globalCancRate = totalReq > 0 ? ((totalCanc / totalReq) * 100).toFixed(2) : '0.00';
        var restoRejShareCanc = totalCanc > 0 ? ((restoRejCount / totalCanc) * 100).toFixed(1) : '0.0';
        var restoRejShareReq = totalReq > 0 ? ((restoRejCount / totalReq) * 100).toFixed(2) : '0.00';

        var peakDayObj = dayStats.reduce(function (best, cur) { return cur.canc > best.canc ? cur : best; }, dayStats[0]);

        document.getElementById('cancKpiTotalReq').textContent = totalReq.toLocaleString('fr-FR');
        document.getElementById('cancKpiDeliveredSub').textContent = 'Livrées : ' + totalDeliv.toLocaleString('fr-FR');
        document.getElementById('cancKpiTotalCanc').textContent = totalCanc.toLocaleString('fr-FR');
        document.getElementById('cancKpiGlobalRate').textContent = 'Taux d\'annulation : ' + globalCancRate + '%';
        document.getElementById('cancKpiRestoRej').textContent = restoRejCount.toLocaleString('fr-FR');
        document.getElementById('cancKpiRestoRejShare').textContent = restoRejShareCanc + '% des annulations • ' + restoRejShareReq + '% des reçues';
        document.getElementById('cancKpiPeakDay').textContent = peakDayObj.canc > 0 ? peakDayObj.day : '-';
        document.getElementById('cancKpiPeakDaySub').textContent = peakDayObj.canc + ' annulation(s) (dont ' + peakDayObj.restoRej + ' Resto Rej.)';

        // 1. Tableau Types d'annulation
        var typesArr = Array.from(typeMap.values()).sort(function (a, b) { return b.count - a.count; });
        currentCancTypesSummary = typesArr.map(function (t) {
          return {
            type: t.type,
            count: t.count,
            pctOfCanc: totalCanc > 0 ? ((t.count / totalCanc) * 100) : 0,
            pctOfReq: totalReq > 0 ? ((t.count / totalReq) * 100) : 0,
            isRestoRej: t.isRestoRej
          };
        });

        var typesTbody = document.getElementById('cancTypesTableBody');
        if (typesTbody) {
          typesTbody.innerHTML = currentCancTypesSummary.map(function (t) {
            var badgeClass = t.isRestoRej
              ? 'bg-rose-100 text-[#FF2A6D] font-extrabold'
              : 'bg-[#F3EBFF] text-[#6C2BD9] font-bold';
            return '<tr data-action="set-canc-type" data-key="' + escapeHtml(t.type) + '" class="hover:bg-[#F3EBFF]/45 cursor-pointer transition">' +
              '<td class="px-3.5 py-2.5"><span class="px-2.5 py-0.5 rounded-full text-[11px] ' + badgeClass + '">' + escapeHtml(t.type) + '</span></td>' +
              '<td class="px-3.5 py-2.5 text-right font-mono font-extrabold text-[#1A1A2E]">' + t.count + '</td>' +
              '<td class="px-3.5 py-2.5 text-right font-mono font-bold text-[#FF2A6D]">' + t.pctOfCanc.toFixed(1) + '%</td>' +
              '<td class="px-3.5 py-2.5 text-right font-mono text-slate-600">' + t.pctOfReq.toFixed(2) + '%</td>' +
            '</tr>';
          }).join('');
        }

        // 2. Graphe Doughnut Types d'annulation
        var typesCanvas = document.getElementById('cancTypesChartCanvas');
        if (typesCanvas && window.Chart) {
          if (cancTypesChartInstance) cancTypesChartInstance.destroy();
          var palette = ['#FF2A6D', '#6C2BD9', '#F59E0B', '#00BFA5', '#3B82F6', '#8B5CF6', '#EC4899'];
          cancTypesChartInstance = new Chart(typesCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
              labels: currentCancTypesSummary.map(function (t) { return t.type + ' (' + t.pctOfCanc.toFixed(1) + '%)'; }),
              datasets: [{
                data: currentCancTypesSummary.map(function (t) { return t.count; }),
                backgroundColor: currentCancTypesSummary.map(function (_, i) { return palette[i % palette.length]; }),
                borderWidth: 2,
                borderColor: '#ffffff'
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } }
              }
            }
          });
        }

        // 3. Graphe & Tableau par Jour de Semaine (Lundi -> Dimanche)
        var weeklyCanvas = document.getElementById('cancWeeklyChartCanvas');
        if (weeklyCanvas && window.Chart) {
          if (cancWeeklyChartInstance) cancWeeklyChartInstance.destroy();
          cancWeeklyChartInstance = new Chart(weeklyCanvas.getContext('2d'), {
            type: 'bar',
            data: {
              labels: dayStats.map(function (d) { return d.day; }),
              datasets: [
                {
                  label: 'Total Annulées',
                  data: dayStats.map(function (d) { return d.canc; }),
                  backgroundColor: 'rgba(108, 43, 217, 0.82)',
                  borderRadius: 6
                },
                {
                  label: 'Restaurant Rejected',
                  data: dayStats.map(function (d) { return d.restoRej; }),
                  backgroundColor: 'rgba(255, 42, 109, 0.88)',
                  borderRadius: 6
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
              },
              plugins: {
                legend: { position: 'top' }
              }
            }
          });
        }

        var weeklyTbody = document.getElementById('cancWeeklyTableBody');
        if (weeklyTbody) {
          weeklyTbody.innerHTML =
            '<tr><td class="px-3 py-2 font-bold text-[#1A1A2E]">Total Annulées</td>' +
              dayStats.map(function (d) { return '<td class="px-3 py-2 text-right font-bold text-[#6C2BD9]">' + d.canc + '</td>'; }).join('') +
            '</tr>' +
            '<tr><td class="px-3 py-2 font-bold text-[#FF2A6D]">Restaurant Rejected</td>' +
              dayStats.map(function (d) { return '<td class="px-3 py-2 text-right font-bold text-[#FF2A6D]">' + d.restoRej + '</td>'; }).join('') +
            '</tr>' +
            '<tr><td class="px-3 py-2 font-semibold text-slate-600">% Annulation / Reçues</td>' +
              dayStats.map(function (d) {
                var rate = d.req > 0 ? ((d.canc / d.req) * 100).toFixed(1) + '%' : '0.0%';
                return '<td class="px-3 py-2 text-right text-slate-600">' + rate + '</td>';
              }).join('') +
            '</tr>';
        }

        // 4. Raisons d'annulation
        currentCancReasonsSummary = Array.from(reasonMap.entries())
          .map(function (pair) {
            return {
              reason: pair[0],
              count: pair[1],
              pct: totalCanc > 0 ? ((pair[1] / totalCanc) * 100) : 0
            };
          })
          .sort(function (a, b) { return b.count - a.count; });

        var reasonsTbody = document.getElementById('cancReasonsTableBody');
        if (reasonsTbody) {
          reasonsTbody.innerHTML = currentCancReasonsSummary.map(function (r) {
            return '<tr data-action="set-canc-reason" data-key="' + escapeHtml(r.reason) + '" class="hover:bg-rose-50/60 cursor-pointer">' +
              '<td class="px-3 py-2 font-semibold text-[#1A1A2E]">' + escapeHtml(r.reason) + '</td>' +
              '<td class="px-3 py-2 text-right font-mono font-bold text-[#FF2A6D]">' + r.count + '</td>' +
              '<td class="px-3 py-2 text-right font-mono text-slate-600">' + r.pct.toFixed(1) + '%</td>' +
            '</tr>';
          }).join('');
        }

        var reasonDrop = document.getElementById('cancReasonDropdownFilter');
        if (reasonDrop) {
          reasonDrop.innerHTML = '<option value="ALL">Toutes les raisons (' + currentCancReasonsSummary.length + ')</option>' +
            currentCancReasonsSummary.map(function (r) {
              return '<option value="' + escapeHtml(r.reason) + '"' + (cancReasonFilterMode === r.reason ? ' selected' : '') + '>' + escapeHtml(r.reason) + ' (' + r.count + ')</option>';
            }).join('');
        }

        window.yassirRenderCancellationsDetailTable();
      };

      window.yassirRenderCancellationsDetailTable = function () {
        var tbody = document.getElementById('cancDetailsTableBody');
        if (!tbody) return;
        var qEl = document.getElementById('searchCancDetailInput');
        var q = qEl ? qEl.value.trim().toLowerCase() : '';

        var filtered = currentFilteredCancRecords.filter(function (rec) {
          if (cancTypeFilterMode === 'RESTAURANT_REJECTED' && !rec.isRestoRej) return false;
          if (cancTypeFilterMode !== 'ALL' && cancTypeFilterMode !== 'RESTAURANT_REJECTED' && rec.type !== cancTypeFilterMode) return false;
          if (cancReasonFilterMode !== 'ALL' && rec.reason !== cancReasonFilterMode) return false;
          if (q) {
            return rec.resto.toLowerCase().includes(q) ||
                   rec.orderId.toLowerCase().includes(q) ||
                   rec.reason.toLowerCase().includes(q) ||
                   rec.am.toLowerCase().includes(q) ||
                   rec.type.toLowerCase().includes(q);
          }
          return true;
        });

        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">Aucune commande annulée ne correspond à ce filtre.</td></tr>';
          return;
        }

        tbody.innerHTML = filtered.slice(0, 300).map(function (rec) {
          var typeBadge = rec.isRestoRej
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-[#FF2A6D]">' + escapeHtml(rec.type) + '</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(rec.type) + '</span>';
          return '<tr class="hover:bg-[#F8F9FC]">' +
            '<td class="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">' + escapeHtml(rec.orderId) + '</td>' +
            '<td class="px-3 py-2 text-slate-500 whitespace-nowrap">' + escapeHtml(rec.orderDay) + '</td>' +
            '<td class="px-3 py-2 font-bold text-[#1A1A2E] whitespace-nowrap">' + escapeHtml(rec.resto) + '</td>' +
            '<td class="px-3 py-2 text-slate-600 whitespace-nowrap">' + escapeHtml(rec.am) + '</td>' +
            '<td class="px-3 py-2 whitespace-nowrap">' + typeBadge + '</td>' +
            '<td class="px-3 py-2 text-slate-700">' + escapeHtml(rec.reason) + '</td>' +
          '</tr>';
        }).join('');
      };

      window.yassirExportCancellationsExcel = async function () {
        if (!currentFilteredCancRecords || currentFilteredCancRecords.length === 0) return;
        if (!(await window.yassirAttendreLibsLourdes())) return;
        var wb = XLSX.utils.book_new();

        var typesAoa = [['Type Annulation', 'Nombre', '% Annulations', '% Total Reçues']].concat(
          currentCancTypesSummary.map(function (t) {
            return [t.type, t.count, t.pctOfCanc.toFixed(2) + '%', t.pctOfReq.toFixed(2) + '%'];
          })
        );
        var wsT = XLSX.utils.aoa_to_sheet(typesAoa);
        wsT['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, wsT, 'Types Annulation');

        var reasonsAoa = [['Raison Annulation', 'Nombre', '% Annulations']].concat(
          currentCancReasonsSummary.map(function (r) {
            return [r.reason, r.count, r.pct.toFixed(2) + '%'];
          })
        );
        var wsR = XLSX.utils.aoa_to_sheet(reasonsAoa);
        wsR['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, wsR, 'Raisons Annulation');

        var detAoa = [['Order ID', 'Order Day', 'Restaurant', 'Portefeuille AM', 'Type Annulation', 'Raison']].concat(
          currentFilteredCancRecords.map(function (rec) {
            return [rec.orderId, rec.orderDay, rec.resto, rec.am, rec.type, rec.reason];
          })
        );
        var wsD = XLSX.utils.aoa_to_sheet(detAoa);
        wsD['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 28 }, { wch: 20 }, { wch: 24 }, { wch: 36 }];
        XLSX.utils.book_append_sheet(wb, wsD, 'Détail Commandes');

        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Analyse_Annulations_' + dateStr + '.xlsx');
        window.yassirJournaliser('export', 'Export Excel : YASSIR_Analyse_Annulations_' + dateStr + '.xlsx');
        showToast('Analyse des annulations téléchargée en Excel (.xlsx).', 'success');
      };

      window.yassirToggleFullscreen = function () {
        var docEl = document.documentElement;
        var isFull = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
        if (!isFull) {
          var req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
          if (req) {
            req.call(docEl).catch(function () {
              window.open(window.location.href, '_blank');
            });
          } else {
            window.open(window.location.href, '_blank');
          }
        } else {
          var exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
          if (exit) exit.call(document);
        }
      };

      function updateFullscreenButtonUI() {
        var isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
        var icon = document.getElementById('iconFullscreen');
        var label = document.getElementById('labelFullscreen');
        if (icon) icon.className = isFull ? 'fa-solid fa-compress text-[#FF2A6D]' : 'fa-solid fa-expand text-[#00BFA5]';
        if (label) label.textContent = isFull ? 'Quitter plein écran' : 'Plein écran';
      }

      document.addEventListener('fullscreenchange', updateFullscreenButtonUI);
      document.addEventListener('webkitfullscreenchange', updateFullscreenButtonUI);
