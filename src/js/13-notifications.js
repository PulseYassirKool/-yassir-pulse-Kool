      /* ========================================================================
         I2. CENTRE DE NOTIFICATIONS INTELLIGENTES (4 RÈGLES MÉTIER + EXPORT)
         ======================================================================== */
      var currentSmartNotifications = [];
      var activeNotifCategoryFilter = 'ALL';
      var lastDesktopNotifSignature = '';

      function diffDaysBetweenIso(isoEarlier, isoLater) {
        if (!isoEarlier || !isoLater) return null;
        var p1 = isoEarlier.split('-');
        var p2 = isoLater.split('-');
        if (p1.length !== 3 || p2.length !== 3) return null;
        var t1 = Date.UTC(parseInt(p1[0], 10), parseInt(p1[1], 10) - 1, parseInt(p1[2], 10));
        var t2 = Date.UTC(parseInt(p2[0], 10), parseInt(p2[1], 10) - 1, parseInt(p2[2], 10));
        return Math.round((t2 - t1) / 86400000);
      }

      function scheduleSmartNotificationsUpdate() {
        var sig = String(state._calcRevision || 0) + '|' + (currentBrand || 'yassir') + '|' + (currentUser ? currentUser.username : '') + '|' + getEffectiveAmFilter();
        if (sig === _notifCacheSig) return;
        if (_notifTimerId) clearTimeout(_notifTimerId);
        _notifTimerId = setTimeout(function () {
          _notifTimerId = null;
          _notifCacheSig = sig;
          calculerEtAfficherNotifications();
        }, 60);
      }

      function calculerEtAfficherNotifications() {
        var alerts = [];
        var allowedAms = getAllowedAmListForCurrentUser();
        var activeFilter = getEffectiveAmFilter();
        var isMktMode = isMarketOnlyViewer();
        var isFoodAm = isFoodOnlyAm();

        // Date de référence : maxAvailableDate de Data exp ou date du jour locale
        var refIso = state.maxAvailableDate || getTodayIsoLocal();
        var todayIso = getTodayIsoLocal();
        var refSubEl = document.getElementById('notifPanelRefDateSub');
        if (refSubEl) {
          refSubEl.textContent = 'Référence : ' + refIso + (activeFilter !== 'ALL' ? (' • ' + activeFilter) : ' • Périmètre autorisé');
        }

        // 1. Construire l'historique journalier des commandes livrées par restaurant à partir de state.rawSourceRows
        var delivByRestoAndDate = new Map();
        var lastDelivDateByResto = new Map();
        var comm100Last7DaysMap = new Map();
        var aoa = state.rawSourceRows;

        if (aoa && aoa.length > 1) {
          var headers = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
          var idxResto = headers.indexOf('restaurant name');
          var idxStatus = headers.indexOf('status');
          var idxServices = headers.indexOf('services');
          var idxOid = headers.indexOf('order id');
          var idxOrderDay = headers.indexOf('order day') !== -1 ? headers.indexOf('order day') : headers.indexOf('delivered day');
          var idxOrderTime = headers.indexOf('order time');
          var idxTotalFoodN = headers.indexOf('total food');
          var idxCouponDiscN = headers.indexOf('coupon discount');
          var idxDiscAmtN = headers.indexOf('discount amount');
          var idxProviderN = headers.indexOf('discount type provider');
          var idxAmtToRestN = headers.indexOf('amount to restaurant');

          if (idxResto !== -1 && idxStatus !== -1 && idxOrderDay !== -1) {
            for (var r = 1; r < aoa.length; r++) {
              var row = aoa[r];
              if (!row) continue;
              if (idxOid !== -1 && !estOrderIdYaf(row[idxOid])) continue;
              if (!estCommandeLivree(row[idxStatus])) continue;

              var rawResto = String(row[idxResto] || '').trim();
              var rKey = rawResto.toLowerCase();
              if (!rKey) continue;

              var srv = idxServices !== -1 ? String(row[idxServices] || '').trim().toLowerCase() : '';
              var isMktRow = srv.includes('market') || rKey.includes('mg market') || rKey.includes('market');
              if (isMktMode && !isMktRow) continue;
              if (isFoodAm && isMktRow) continue;

              var calIso = parseOrderDayToIsoDate(row[idxOrderDay]);
              if (!calIso) continue;
              var opIso = idxOrderTime !== -1 ? getOperationalIsoDate(calIso, row[idxOrderTime]) : calIso;
              if (!opIso) continue;

              if (!delivByRestoAndDate.has(rKey)) delivByRestoAndDate.set(rKey, new Map());
              var dMap = delivByRestoAndDate.get(rKey);
              dMap.set(opIso, (dMap.get(opIso) || 0) + 1);

              var prevLast = lastDelivDateByResto.get(rKey) || '';
              if (!prevLast || opIso > prevLast) lastDelivDateByResto.set(rKey, opIso);

              // Vérifier si commission = 100% sur les 1 à 7 derniers jours (0 <= diffDays <= 6 par rapport à refIso)
              var ageDays = diffDaysBetweenIso(opIso, refIso);
              if (ageDays !== null && ageDays >= 0 && ageDays <= 6) {
                var tfVal = idxTotalFoodN !== -1 ? purgerNombre(row[idxTotalFoodN]) : 0;
                var cdVal = idxCouponDiscN !== -1 ? purgerNombre(row[idxCouponDiscN]) : 0;
                var daVal = idxDiscAmtN !== -1 ? purgerNombre(row[idxDiscAmtN]) : 0;
                var prVal = idxProviderN !== -1 && row[idxProviderN] ? String(row[idxProviderN]).trim().toLowerCase() : '';
                var amtRestVal = idxAmtToRestN !== -1 ? purgerNombre(row[idxAmtToRestN]) : 0;
                var caRestVal = tfVal + cdVal + (prVal === 'admin' ? daVal : 0);

                var is100Pct = false;
                if (Object.prototype.hasOwnProperty.call(state.customCommissions, rKey)) {
                  is100Pct = Number(state.customCommissions[rKey]) >= 99.9;
                } else {
                  is100Pct = (caRestVal > 0 && amtRestVal <= 0.01);
                }

                if (is100Pct) {
                  if (!comm100Last7DaysMap.has(rKey)) {
                    comm100Last7DaysMap.set(rKey, {
                      displayName: rawResto,
                      ordersCount: 0,
                      totalCa: 0,
                      dates: new Set()
                    });
                  }
                  var c100Entry = comm100Last7DaysMap.get(rKey);
                  c100Entry.ordersCount += 1;
                  c100Entry.totalCa += caRestVal;
                  c100Entry.dates.add(opIso);
                }
              }
            }
          }
        }

        var dMinus0 = refIso;
        var dMinus1 = shiftIsoDateByDays(refIso, -1);
        var dMinus2 = shiftIsoDateByDays(refIso, -2);

        var isKoolBrandNotif = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');

        // Masquer le bouton filtre "Inactive >= 3j" en mode Kool
        var btnFilterInactiveNotif = document.querySelector('[data-notif-filter="INACTIVE_3D"]');
        if (btnFilterInactiveNotif) {
          btnFilterInactiveNotif.classList.toggle('hidden', isKoolBrandNotif);
        }
        // Masquer le bouton filtre "Comm. 100%" aux non-proprios en mode Kool
        var btnFilterComm100Notif = document.querySelector('[data-notif-filter="COMM_100"]');
        if (btnFilterComm100Notif) {
          btnFilterComm100Notif.classList.toggle('hidden', isKoolBrandNotif && !isOwnerAdmin());
        }

        // 2. Parcourir les restaurants des portefeuilles autorisés
        Object.entries(state.amPortfolios).forEach(function (pair) {
          var rKey = pair[0];
          var info = pair[1];
          if (!canViewAllPortfolios() && allowedAms.indexOf(info.am) === -1) return;
          if (activeFilter !== 'ALL' && info.am !== activeFilter) return;

          var isMktResto = rKey.includes('mg market') || rKey.includes('market');
          if (isMktMode && !isMktResto) return;
          if (isFoodAm && isMktResto) return;

          var statusVal = isKoolBrandNotif ? '' : (state.restoStatuses[rKey] || state.restoStatuses[normalizeText(rKey)] || '');
          var isInactiveStatus = !isKoolBrandNotif && /^inactive$/i.test(String(statusVal).trim());
          var lastDate = lastDelivDateByResto.get(rKey) || '';
          var dMap = delivByRestoAndDate.get(rKey);

          var c0 = dMap ? (dMap.get(dMinus0) || 0) : 0;
          var c1 = dMap ? (dMap.get(dMinus1) || 0) : 0;
          var c2 = dMap ? (dMap.get(dMinus2) || 0) : 0;
          var hasZeroLast3Days = (c0 === 0 && c1 === 0 && c2 === 0);

          // RÈGLE A : Restaurant Inactive depuis >= 3 jours (Yassir uniquement — supprimé pour Kool)
          if (!isKoolBrandNotif && isInactiveStatus && (!lastDate || diffDaysBetweenIso(lastDate, refIso) >= 3)) {
            var daysInactive = lastDate ? diffDaysBetweenIso(lastDate, refIso) : null;
            alerts.push({
              type: 'INACTIVE_3D',
              badge: 'Inactive >= 3j',
              colorClass: 'bg-slate-100 text-slate-700 border-slate-300',
              icon: 'fa-solid fa-power-off text-slate-600',
              am: info.am,
              restaurant: info.displayName,
              message: daysInactive !== null
                ? ('Le restaurant <strong>' + escapeHtml(info.displayName) + '</strong> est <strong>Inactive</strong> depuis <strong>' + daysInactive + ' jours</strong> (dernière cmd : ' + escapeHtml(lastDate) + ').')
                : ('Le restaurant <strong>' + escapeHtml(info.displayName) + '</strong> est <strong>Inactive</strong> depuis au moins 3 jours (aucune commande récente).')
            });
          } else if (hasZeroLast3Days && (aoa && aoa.length > 1)) {
            // RÈGLE B : Restaurant avec 0 commande depuis 3 jours
            var daysZero = lastDate ? diffDaysBetweenIso(lastDate, refIso) : null;
            alerts.push({
              type: 'ZERO_3D',
              badge: '0 cmd >= 3j',
              colorClass: 'bg-amber-50 text-amber-800 border-amber-200',
              icon: 'fa-solid fa-triangle-exclamation text-amber-500',
              am: info.am,
              restaurant: info.displayName,
              message: daysZero !== null
                ? ('Le restaurant <strong>' + escapeHtml(info.displayName) + '</strong> a <strong>0 commande depuis ' + daysZero + ' jours</strong> (dernière cmd : ' + escapeHtml(lastDate) + ').')
                : ('Le restaurant <strong>' + escapeHtml(info.displayName) + '</strong> a <strong>0 commande depuis 3 jours</strong> (' + escapeHtml(dMinus2) + ' -> ' + escapeHtml(dMinus0) + ').')
            });
          }

          // RÈGLE C : Drop successif depuis 3 jours (c2 > c1 > c0 sur les 3 derniers jours)
          if (dMap && c2 > c1 && c1 > c0 && c2 >= 2) {
            alerts.push({
              type: 'DROP_3D',
              badge: 'Drop 3j consécutifs',
              colorClass: 'bg-rose-50 text-[#FF2A6D] border-pink-200',
              icon: 'fa-solid fa-arrow-trend-down text-[#FF2A6D]',
              am: info.am,
              restaurant: info.displayName,
              message: 'Le restaurant <strong>' + escapeHtml(info.displayName) + '</strong> est en <strong>drop successif depuis 3 jours</strong> (' + c2 + ' -> ' + c1 + ' -> <strong>' + c0 + '</strong> cmd livrées).'
            });
          }
        });

        // 3. RÈGLE D : Fin d'offre par date (comparaison par rapport à la date de référence refIso ET la date du jour todayIso)
        var seenOfferAlerts = new Set();
        var offerRefDate = refIso || todayIso;
        (state.offreParticipationRules || []).forEach(function (rl) {
          if (!rl || !rl.endDate || !rl.restaurant) return;
          var rKey = rl.restaurant.toLowerCase();
          var portInfo = state.amPortfolios[rKey] || state.amPortfolios[normalizeText(rKey)];
          var amOwner = portInfo ? portInfo.am : (rl.am || 'Non attribué');
          var displayR = portInfo ? portInfo.displayName : toProperCase(rl.restaurant);

          if (!canViewAllPortfolios() && allowedAms.indexOf(amOwner) === -1) return;
          if (activeFilter !== 'ALL' && amOwner !== activeFilter) return;

          var isMktResto = rKey.includes('mg market') || rKey.includes('market');
          if (isMktMode && !isMktResto) return;
          if (isFoodAm && isMktResto) return;

          var daysLeftRef = diffDaysBetweenIso(offerRefDate, rl.endDate);
          var daysLeftToday = diffDaysBetweenIso(todayIso, rl.endDate);
          var daysLeft = (daysLeftRef !== null && daysLeftRef >= 0 && daysLeftRef <= 2)
            ? daysLeftRef
            : ((daysLeftToday !== null && daysLeftToday >= 0 && daysLeftToday <= 2) ? daysLeftToday : null);

          if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 2) {
            var uniqueKey = rKey + '|' + (rl.tag || '') + '|' + rl.endDate;
            if (seenOfferAlerts.has(uniqueKey)) return;
            seenOfferAlerts.add(uniqueKey);

            var delayTxt = daysLeft === 0
              ? ("se termine <strong>le " + rl.endDate + " (J-0)</strong>")
              : (daysLeft === 1 ? ("se termine <strong>demain / J-1 (" + rl.endDate + ")</strong>") : ("se termine <strong>dans 2 jours / J-2 (" + rl.endDate + ")</strong>"));

            alerts.push({
              type: 'OFFER_END',
              badge: daysLeft === 0 ? 'Fin offre J-0' : ('Fin offre J-' + daysLeft),
              colorClass: 'bg-amber-50 text-amber-900 border-amber-300',
              icon: 'fa-solid fa-hourglass-half text-amber-600',
              am: amOwner,
              restaurant: displayR,
              message: 'Le restaurant <strong>' + escapeHtml(displayR) + '</strong> : son offre (<em>' + escapeHtml(formaterLibelleOffreKool(rl)) + '</em>) ' + delayTxt + (rl.startDate ? ' (du ' + rl.startDate + ' au ' + rl.endDate + ').' : '.')
            });
          }
        });

        // 4. RÈGLE E : Restaurants avec Commission 100 % OU absents du fichier Commissions
        // En mode Kool : réservé EXCLUSIVEMENT au Propriétaire Admin (proprio)
        if (!isKoolBrandNotif || isOwnerAdmin()) {
          comm100Last7DaysMap.forEach(function (cInfo, rKey) {
            var portInfo = state.amPortfolios[rKey];
            var amOwner = portInfo ? portInfo.am : 'Non attribué';
            var displayR = portInfo ? portInfo.displayName : cInfo.displayName;

            if (!canViewAllPortfolios() && allowedAms.indexOf(amOwner) === -1) return;
            if (activeFilter !== 'ALL' && amOwner !== activeFilter) return;

            var isMktResto = rKey.includes('mg market') || rKey.includes('market');
            if (isMktMode && !isMktResto) return;
            if (isFoodAm && isMktResto) return;

            var daysCount = cInfo.dates.size;
            var sortedDates = Array.from(cInfo.dates).sort();
            var lastDateStr = sortedDates[sortedDates.length - 1] || refIso;
            var isMissingInFacture = !Object.prototype.hasOwnProperty.call(state.customCommissions, rKey) &&
                                     !Object.prototype.hasOwnProperty.call(state.customCommissions, rKey.replace(/\s+/g, ' ').trim());

            if (isKoolBrandNotif && isMissingInFacture) {
              alerts.push({
                type: 'COMM_100',
                badge: 'Sans Commission (' + daysCount + 'j)',
                colorClass: 'bg-amber-50 text-amber-900 border-amber-300',
                icon: 'fa-solid fa-circle-exclamation text-amber-600',
                am: amOwner,
                restaurant: displayR,
                message: '<strong>[Alerte Proprio]</strong> Le restaurant <strong>' + escapeHtml(displayR) + '</strong> n’a <strong>aucun taux de commission</strong> dans le fichier Commissions Kool (<strong>' + cInfo.ordersCount + ' cmd livrée(s)</strong>, GMV : <strong>' + cInfo.totalCa.toFixed(2) + ' TND</strong>, dernier : ' + lastDateStr + ').'
              });
            } else {
              var sourceNote = isMissingInFacture ? ' <em>(absent du fichier Commissions)</em>' : ' <em>(taux 100% dans Commissions)</em>';
              alerts.push({
                type: 'COMM_100',
                badge: 'Comm. 100% (' + daysCount + 'j / 7j)',
                colorClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                icon: 'fa-solid fa-percent text-[#00897B]',
                am: amOwner,
                restaurant: displayR,
                message: 'Le restaurant <strong>' + escapeHtml(displayR) + '</strong> est à <strong>100 % de commission</strong>' + sourceNote + ' sur <strong>' + cInfo.ordersCount + ' cmd livrée(s)</strong> (<strong>' + cInfo.totalCa.toFixed(2) + ' TND</strong>) durant les 7 derniers jours (dernier : ' + lastDateStr + ').'
              });
            }
          });
        }

        currentSmartNotifications = alerts;
        renderSmartNotificationsUI();
      }

      function renderSmartNotificationsUI() {
        var total = currentSmartNotifications.length;
        var cntInactive = currentSmartNotifications.filter(function (a) { return a.type === 'INACTIVE_3D'; }).length;
        var cntZero = currentSmartNotifications.filter(function (a) { return a.type === 'ZERO_3D'; }).length;
        var cntOffer = currentSmartNotifications.filter(function (a) { return a.type === 'OFFER_END'; }).length;
        var cntDrop = currentSmartNotifications.filter(function (a) { return a.type === 'DROP_3D'; }).length;
        var cntComm100 = currentSmartNotifications.filter(function (a) { return a.type === 'COMM_100'; }).length;

        var elBell = document.getElementById('notifBellBadgeCount');
        var elPanelTot = document.getElementById('notifPanelTotalCount');
        var elAll = document.getElementById('notifCntAll');
        var elIna = document.getElementById('notifCntInactive');
        var elZer = document.getElementById('notifCntZero');
        var elOff = document.getElementById('notifCntOffer');
        var elDrp = document.getElementById('notifCntDrop');
        var elC100 = document.getElementById('notifCntComm100');

        if (elBell) elBell.textContent = total;
        if (elPanelTot) elPanelTot.textContent = total;
        if (elAll) elAll.textContent = total;
        if (elIna) elIna.textContent = cntInactive;
        if (elZer) elZer.textContent = cntZero;
        if (elOff) elOff.textContent = cntOffer;
        if (elDrp) elDrp.textContent = cntDrop;
        if (elC100) elC100.textContent = cntComm100;

        var listEl = document.getElementById('yassirNotifListBody');
        if (!listEl) return;

        var filtered = activeNotifCategoryFilter === 'ALL'
          ? currentSmartNotifications
          : currentSmartNotifications.filter(function (a) { return a.type === activeNotifCategoryFilter; });

        if (filtered.length === 0) {
          listEl.innerHTML = '<div class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-check text-[#00BFA5] text-xl mb-1.5 block"></i>Aucune alerte dans cette catégorie.</div>';
          return;
        }

        listEl.innerHTML = filtered.slice(0, 150).map(function (a) {
          return '<div class="p-2.5 rounded-2xl border ' + a.colorClass + ' flex items-start gap-2.5 transition hover:shadow-xs">' +
            '<div class="w-7 h-7 rounded-xl bg-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">' +
              '<i class="' + a.icon + ' text-xs"></i>' +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center justify-between gap-1.5 mb-0.5">' +
                '<span class="text-[10px] font-extrabold uppercase tracking-wider">' + escapeHtml(a.badge) + '</span>' +
                '<span class="px-2 py-0.2 rounded-full text-[10px] font-bold bg-white/80 text-[#1A1A2E]">' + escapeHtml(a.am) + '</span>' +
              '</div>' +
              '<p class="text-[11px] leading-snug text-[#1A1A2E]">' + a.message + '</p>' +
            '</div>' +
          '</div>';
        }).join('');

        // Si les notifications bureau Windows/Mac sont autorisées, envoyer un résumé une seule fois par changement
        if ('Notification' in window && window.Notification.permission === 'granted' && total > 0) {
          var sig = currentUser ? (currentUser.username + ':' + total + ':' + cntOffer + ':' + cntDrop) : '';
          if (sig && sig !== lastDesktopNotifSignature) {
            lastDesktopNotifSignature = sig;
            try {
              new window.Notification('Yassir Pulse — ' + total + ' alerte(s)', {
                body: cntOffer + ' offre(s) finissent <= 2j • ' + cntDrop + ' drop 3j • ' + (cntZero + cntInactive) + ' inactif/0 cmd >= 3j.'
              });
            } catch (e) {}
          }
        }
      }

      window.yassirToggleNotifPanel = function (forceState) {
        var panel = document.getElementById('yassirNotifDropdown');
        if (!panel) return;
        if (typeof forceState === 'boolean') {
          if (forceState) panel.classList.remove('hidden');
          else panel.classList.add('hidden');
        } else {
          panel.classList.toggle('hidden');
        }
      };

      window.yassirSetNotifCategoryFilter = function (cat) {
        activeNotifCategoryFilter = cat;
        document.querySelectorAll('.notif-cat-btn').forEach(function (btn) {
          var isAct = btn.getAttribute('data-notif-filter') === cat;
          btn.className = isAct
            ? 'notif-cat-btn px-2.5 py-1 rounded-full bg-[#6C2BD9] text-white cursor-pointer'
            : 'notif-cat-btn px-2.5 py-1 rounded-full bg-white text-slate-600 border border-slate-200 hover:bg-[#F3EBFF] cursor-pointer';
        });
        renderSmartNotificationsUI();
      };

      window.yassirEnableDesktopNotifications = function () {
        if (!('Notification' in window)) {
          showToast('Votre navigateur ne supporte pas les notifications bureau.', 'info');
          return;
        }
        window.Notification.requestPermission().then(function (perm) {
          if (perm === 'granted') {
            showToast('Notifications bureau activées ! Vous recevrez les alertes importantes.', 'success');
            lastDesktopNotifSignature = '';
            renderSmartNotificationsUI();
          } else {
            showToast('Autorisation refusée par le navigateur.', 'info');
          }
        });
      };

      window.yassirExportNotificationsExcel = function () {
        if (!currentSmartNotifications || currentSmartNotifications.length === 0) {
          showToast('Aucune alerte à exporter.', 'info');
          return;
        }
        var aoa = [['Type Alerte', 'Portefeuille AM', 'Restaurant', "Détail de l'alerte"]];
        currentSmartNotifications.forEach(function (a) {
          var plainMsg = a.message.replace(/<[^>]+>/g, '');
          aoa.push([a.badge, a.am, a.restaurant, plainMsg]);
        });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 30 }, { wch: 65 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Alertes Operations');
        var dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'YASSIR_Alertes_' + dateStr + '.xlsx');
        showToast('Fichier <strong>YASSIR_Alertes_' + dateStr + '.xlsx</strong> téléchargé.', 'success');
      };

      document.addEventListener('click', function (ev) {
        var wrap = document.getElementById('yassirNotifWrapper');
        var panel = document.getElementById('yassirNotifDropdown');
        if (wrap && panel && !panel.classList.contains('hidden') && !wrap.contains(ev.target)) {
          panel.classList.add('hidden');
        }
      });

      function afficherTableauDonnees() {
        var panelData = document.getElementById('panelData');
        var panelSynthGlobal = document.getElementById('panelSynthGlobal');
        var panelRestoAnalytics = document.getElementById('panelRestoAnalytics');
        var panelGlobalAnalysis = document.getElementById('panelGlobalAnalysis');
        var panelRestaurantAnalysis = document.getElementById('panelRestaurantAnalysis');
        var panelPortefeuilles = document.getElementById('panelPortefeuilles');
        var panelComm = document.getElementById('panelCommissions');
        var panelParticipation = document.getElementById('panelParticipation');
        var panelKoolClients = document.getElementById('panelKoolClients');

        panelData.classList.add('hidden');
        if (panelSynthGlobal) panelSynthGlobal.classList.add('hidden');
        if (panelRestoAnalytics) panelRestoAnalytics.classList.add('hidden');
        if (panelGlobalAnalysis) panelGlobalAnalysis.classList.add('hidden');
        if (panelRestaurantAnalysis) panelRestaurantAnalysis.classList.add('hidden');
        if (panelParticipation) panelParticipation.classList.add('hidden');
        if (panelKoolClients) panelKoolClients.classList.add('hidden');
        panelPortefeuilles.classList.add('hidden');
        panelComm.classList.add('hidden');

        if (state.activeTab === 'kool_clients') {
          if (typeof currentBrand !== 'undefined' && currentBrand !== 'kool') {
            state.activeTab = 'synth_global';
            if (panelSynthGlobal) panelSynthGlobal.classList.remove('hidden');
            renderSynthGlobalPanel();
            return;
          }
          if (panelKoolClients) panelKoolClients.classList.remove('hidden');
          renderKoolClientsPanel();
          return;
        }

        if (state.activeTab === 'participation') {
          if (panelParticipation) panelParticipation.classList.remove('hidden');
          renderParticipationPanel();
          return;
        }

        if (state.activeTab === 'synth_global') {
          if (panelSynthGlobal) panelSynthGlobal.classList.remove('hidden');
          renderSynthGlobalPanel();
          return;
        }

        var panelCancAnalytics = document.getElementById('panelCancellationsAnalytics');
        if (panelCancAnalytics) panelCancAnalytics.classList.add('hidden');

        if (state.activeTab === 'resto_analytics') {
          if (panelRestoAnalytics) panelRestoAnalytics.classList.remove('hidden');
          renderRestoAnalyticsPanel();
          return;
        }

        if (state.activeTab === 'cancellations_analytics') {
          if (panelCancAnalytics) panelCancAnalytics.classList.remove('hidden');
          window.yassirRenderCancellationsPanel();
          return;
        }

        if (state.activeTab === 'global_analysis') {
          if (panelGlobalAnalysis) panelGlobalAnalysis.classList.remove('hidden');
          window.yassirRenderGlobalAnalysis();
          return;
        }

        if (state.activeTab === 'restaurant_analysis') {
          if (panelRestaurantAnalysis) panelRestaurantAnalysis.classList.remove('hidden');
          window.yassirRenderRestaurantAnalysis();
          return;
        }

        if (state.activeTab === 'portefeuilles') {
          panelPortefeuilles.classList.remove('hidden');
          renderPortefeuillesPanel();
          return;
        }

        if (state.activeTab === 'commissions') {
          panelComm.classList.remove('hidden');
          window.yassirRenderCommTable();
          return;
        }

        panelData.classList.remove('hidden');

        var emptyState = document.getElementById('emptyDataState');
        var scrollArea = document.getElementById('tableScrollArea');
        var footerInfo = document.getElementById('tableFooterInfo');
        var thead = document.getElementById('previewTableHead');
        var tbody = document.getElementById('previewTableBody');
        var colsToggleGroup = document.getElementById('colsToggleGroup');

        colsToggleGroup.classList.toggle('hidden', state.activeTab === 'offres' || state.activeTab === 'stat');

        var rawDataset = state.activeTab === 'market'
          ? state.marketRows
          : state.activeTab === 'food'
            ? state.foodRows
            : state.activeTab === 'offres'
              ? state.offresRows
              : state.statRows;

        var amDataset = filtrerParAmSelectionne(rawDataset);

        if (!amDataset || amDataset.length === 0) {
          emptyState.classList.remove('hidden');
          scrollArea.classList.add('hidden');
          footerInfo.classList.add('hidden');
          return;
        }

        emptyState.classList.add('hidden');
        scrollArea.classList.remove('hidden');
        footerInfo.classList.remove('hidden');

        var idxStatus = TARGET_HEADERS.indexOf('status');
        var statusFiltered = amDataset;
        if (state.activeTab === 'market' || state.activeTab === 'food') {
          if (state.statusFilter === 'delivered') {
            statusFiltered = amDataset.filter(function (rec) { return estCommandeLivree(rec.cells[idxStatus]); });
          } else if (state.statusFilter === 'not_delivered') {
            statusFiltered = amDataset.filter(function (rec) { return !estCommandeLivree(rec.cells[idxStatus]); });
          }
        }

        var query = state.searchQuery.trim().toLowerCase();
        var filteredRecords = query
          ? statusFiltered.filter(function (rec) {
              return rec.am.toLowerCase().includes(query) ||
                     rec.cells.some(function (cell) { return cell !== null && cell !== undefined && String(cell).toLowerCase().includes(query); });
            })
          : statusFiltered;

        var totalFiltered = filteredRecords.length;
        var totalPages = Math.max(1, Math.ceil(totalFiltered / state.pageSize));
        if (state.currentPage > totalPages) state.currentPage = totalPages;

        var startIdx = (state.currentPage - 1) * state.pageSize;
        var endIdx = Math.min(startIdx + state.pageSize, totalFiltered);
        var pageRecords = filteredRecords.slice(startIdx, endIdx);

        // Cas 1 : Onglet Stat Restaurants (VSTACK / QUERY)
        if (state.activeTab === 'stat') {
          thead.innerHTML = '<tr>' +
            '<th class="px-3 py-3 text-left bg-[#5521B5] text-white sticky left-0 z-20">#</th>' +
            STAT_HEADERS.map(function (h, idx) {
              var isMetric = idx >= 3;
              return '<th class="px-3.5 py-3 ' + (isMetric ? 'text-right bg-[#5521B5] text-[#00BFA5] border-b-2 border-[#00BFA5]' : 'text-left bg-[#6C2BD9] text-white') + ' whitespace-nowrap">' + escapeHtml(h) + '</th>';
            }).join('') +
            '</tr>';

          if (pageRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="' + (STAT_HEADERS.length + 1) + '" class="px-4 py-10 text-center text-slate-400">Aucune statistique restaurant trouvée.</td></tr>';
          } else {
            tbody.innerHTML = pageRecords.map(function (rec, rOffset) {
              var num = startIdx + rOffset + 1;
              var row = rec.cells;
              var amBadge = row[0] === 'Non attribué'
                ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">Non attribué</span>'
                : '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(row[0]) + '</span>';

              return '<tr class="hover:bg-[#F3EBFF]/40 transition-colors">' +
                '<td class="px-3 py-2 text-slate-400 font-mono bg-slate-50 sticky left-0 z-10 border-r border-slate-100">' + num + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap">' + amBadge + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-slate-600">' + escapeHtml(String(row[1] || '')) + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap font-bold text-[#1A1A2E]">' + escapeHtml(String(row[2] || '')) + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono">' + row[3] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono font-bold text-[#00897B]">' + row[4] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono bg-[#F3EBFF]/40 font-semibold">' + row[5] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono">' + row[6] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono bg-[#F3EBFF]/40">' + row[7] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono text-[#FF2A6D]">' + row[8] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono bg-[#F3EBFF]/40">' + row[9] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono font-semibold">' + Number(row[10]).toFixed(2) + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono bg-[#F3EBFF]/40">' + Number(row[11]).toFixed(2) + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono font-bold text-[#6C2BD9]">' + Number(row[12]).toFixed(2) + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono">' + row[13] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono">' + row[14] + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono">' + Number(row[15]).toFixed(2) + '</td>' +
                '<td class="px-3.5 py-2 whitespace-nowrap text-right font-mono font-extrabold bg-pink-50/70 text-[#FF2A6D]">' + row[16] + '</td>' +
                '</tr>';
            }).join('');
          }

          document.getElementById('rowsCounterText').textContent = 'Affichage de ' + (startIdx + 1) + ' à ' + endIdx + ' sur ' + totalFiltered + ' restaurant(s) (Statistiques complètes)';
          document.getElementById('pageIndicator').textContent = 'Page ' + state.currentPage + ' / ' + totalPages;
          document.getElementById('btnPrevPage').disabled = state.currentPage <= 1;
          document.getElementById('btnNextPage').disabled = state.currentPage >= totalPages;
          return;
        }

        // Cas 2 : Onglet Offres (colonne « Promo Admin » masquée en mode Kool : toujours 0)
        if (state.activeTab === 'offres') {
          var offresHeadersVisibles = getOffresVisibleHeaders();
          var offresHeadHtml = '<tr>' +
            '<th class="px-3 py-3 text-left bg-[#5521B5] text-white sticky left-0 z-20">#</th>' +
            offresHeadersVisibles.map(function (h, idx) {
              var isMetric = idx >= 3;
              return '<th class="px-4 py-3 ' + (isMetric ? 'text-right bg-[#5521B5] text-[#00BFA5] border-b-2 border-[#00BFA5]' : 'text-left bg-[#6C2BD9] text-white') + ' whitespace-nowrap">' + escapeHtml(h) + '</th>';
            }).join('') +
            '</tr>';
          thead.innerHTML = offresHeadHtml;

          if (pageRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="' + Number(offresHeadersVisibles.length + 1) + '" class="px-4 py-10 text-center text-slate-400">Aucune offre trouvée pour cette recherche.</td></tr>';
          } else {
            var offresMetricStyles = {
              3: 'px-4 py-2.5 whitespace-nowrap text-right font-mono font-extrabold bg-pink-50/70 text-[#FF2A6D]',
              4: 'px-4 py-2.5 whitespace-nowrap text-right font-mono font-bold bg-[#F3EBFF]/55 text-[#1A1A2E]',
              5: 'px-4 py-2.5 whitespace-nowrap text-right font-mono font-bold bg-[#F3EBFF]/55 text-[#00897B]',
              6: 'px-4 py-2.5 whitespace-nowrap text-right font-mono font-bold bg-[#F3EBFF]/55 text-[#6C2BD9]'
            };
            var offresVisibleMetricIdx = [3, 4, 5, 6].filter(function (oi) { return oi !== OFFRES_PROMO_ADMIN_IDX || (typeof currentBrand === 'undefined' || currentBrand !== 'kool'); });
            tbody.innerHTML = pageRecords.map(function (rec, rOffset) {
              var num = startIdx + rOffset + 1;
              var row = rec.cells;
              var amBadge = row[0] === 'Non attribué'
                ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">Non attribué</span>'
                : '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(row[0]) + '</span>';
              var metricCells = offresVisibleMetricIdx.map(function (oi) {
                return '<td class="' + offresMetricStyles[oi] + '">' + Number(row[oi] || 0) + '</td>';
              }).join('');

              return '<tr class="hover:bg-[#F3EBFF]/40 transition-colors">' +
                '<td class="px-3 py-2.5 text-slate-400 font-mono bg-slate-50 sticky left-0 z-10 border-r border-slate-100">' + num + '</td>' +
                '<td class="px-4 py-2.5 whitespace-nowrap">' + amBadge + '</td>' +
                '<td class="px-4 py-2.5 whitespace-nowrap font-semibold text-[#1A1A2E]">' + escapeHtml(String(row[1] || '')) + '</td>' +
                '<td class="px-4 py-2.5 whitespace-nowrap font-bold text-[#6C2BD9]">' + escapeHtml(String(row[2] || '')) + '</td>' +
                metricCells +
                '</tr>';
            }).join('');
          }

          var globalStats = calculerStatsPourAm('ALL');
          var currentStats = calculerStatsPourAm(getEffectiveAmFilter());
          var shareOffPct = globalStats.totalOffres > 0 ? ((currentStats.totalOffres / globalStats.totalOffres) * 100).toFixed(1) : '0.0';
          document.getElementById('rowsCounterText').textContent = 'Offres livrées : ' + currentStats.totalOffres + ' (' + shareOffPct + '% du global) • ' + currentStats.restosOffreCount + ' restaurant(s) avec offre';
          document.getElementById('pageIndicator').textContent = 'Page ' + state.currentPage + ' / ' + totalPages;
          document.getElementById('btnPrevPage').disabled = state.currentPage <= 1;
          document.getElementById('btnNextPage').disabled = state.currentPage >= totalPages;
          return;
        }

        // Cas 3 : Onglets Market VF & Food VF
        var visibleCols = state.showAllCols
          ? ['Portefeuille AM'].concat(TARGET_HEADERS)
          : KEY_HEADERS;

        thead.innerHTML = '<tr>' +
          '<th class="px-3 py-3 text-left bg-[#5521B5] text-white sticky left-0 z-20">#</th>' +
          visibleCols.map(function (h) {
            var isComputed = COMPUTED_COLS.has(h) || h === 'Portefeuille AM';
            return '<th class="px-3.5 py-3 text-left whitespace-nowrap ' + (isComputed ? 'bg-[#5521B5] text-[#00BFA5] border-b-2 border-[#00BFA5]' : 'bg-[#6C2BD9] text-white') + '">' + escapeHtml(h) + '</th>';
          }).join('') +
          '</tr>';

        if (pageRecords.length === 0) {
          tbody.innerHTML = '<tr><td colspan="' + (visibleCols.length + 1) + '" class="px-4 py-10 text-center text-slate-400">Aucune commande trouvée pour ce filtre.</td></tr>';
        } else {
          tbody.innerHTML = pageRecords.map(function (rec, rOffset) {
            var num = startIdx + rOffset + 1;
            var cellsHtml = visibleCols.map(function (h) {
              if (h === 'Portefeuille AM') {
                var badge = rec.am === 'Non attribué'
                  ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">Non attribué</span>'
                  : '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(rec.am) + '</span>';
                return '<td class="px-3.5 py-2 whitespace-nowrap bg-[#F3EBFF]/35">' + badge + '</td>';
              }

              var colIdx = TARGET_HEADERS.indexOf(h);
              var val = colIdx !== -1 ? rec.cells[colIdx] : '';
              if (val === null || val === undefined) val = '';

              if (h === 'order id' && val) {
                var oidEsc = escapeHtml(String(val));
                var hasItemsBadge = (window.koolOrderItemsByOrderId && window.koolOrderItemsByOrderId.has(String(val).trim().toLowerCase()))
                  ? '<i class="fa-solid fa-receipt text-[#00BFA5] ml-1.5" title="Voir le détail des articles"></i>'
                  : '';
                return '<td class="px-3.5 py-2 whitespace-nowrap"><button type="button" onclick="window.yassirOpenOrderItemsModal(\'' + oidEsc.replace(/'/g, "\\'") + '\')" class="font-mono font-bold text-[#6C2BD9] hover:underline cursor-pointer inline-flex items-center">' + oidEsc + hasItemsBadge + '</button></td>';
              }

              var isNumeric = DECIMAL_FORMAT_COLS.has(h) || NUMERIC_COLS.has(h);
              var isComputed = COMPUTED_COLS.has(h);
              var displayVal = typeof val === 'number' && DECIMAL_FORMAT_COLS.has(h) ? val.toFixed(2) : String(val);

              return '<td class="px-3.5 py-2 whitespace-nowrap ' + (isNumeric ? 'text-right font-mono' : '') + ' ' + (isComputed ? 'bg-[#F3EBFF]/45 font-semibold text-[#1A1A2E]' : 'text-slate-700') + '">' + escapeHtml(displayVal) + '</td>';
            }).join('');

            return '<tr class="hover:bg-[#F3EBFF]/35 transition-colors">' +
              '<td class="px-3 py-2 text-slate-400 font-mono bg-slate-50 sticky left-0 z-10 border-r border-slate-100">' + num + '</td>' +
              cellsHtml +
              '</tr>';
          }).join('');
        }

        document.getElementById('rowsCounterText').textContent = totalFiltered === 0
          ? 'Aucun résultat pour ce filtre'
          : 'Affichage de ' + (startIdx + 1) + ' à ' + endIdx + ' sur ' + totalFiltered + ' ligne(s)';
        document.getElementById('pageIndicator').textContent = 'Page ' + state.currentPage + ' / ' + totalPages;
        document.getElementById('btnPrevPage').disabled = state.currentPage <= 1;
        document.getElementById('btnNextPage').disabled = state.currentPage >= totalPages;
      }
