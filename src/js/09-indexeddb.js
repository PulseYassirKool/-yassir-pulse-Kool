      /* ========================================================================
         G0. STOCKAGE PERSISTANT INDEXEDDB (CUMUL MULTI-FICHIERS 6 MOIS) & FILTRE DATES
         ======================================================================== */
      var YASSIR_IDB_CONFIG = {
        DB_NAME: 'YassirVfArchiveDB_v1',
        STORE_NAME: 'archiveStore',
        RECORD_KEY: 'cumulative_data_exp'
      };

      function openYassirArchiveDb() {
        return new Promise(function (resolve, reject) {
          if (!window.indexedDB) {
            reject(new Error('IndexedDB non supporté'));
            return;
          }
          var req = window.indexedDB.open(YASSIR_IDB_CONFIG.DB_NAME, 1);
          req.onupgradeneeded = function (ev) {
            var db = ev.target.result;
            if (!db.objectStoreNames.contains(YASSIR_IDB_CONFIG.STORE_NAME)) {
              db.createObjectStore(YASSIR_IDB_CONFIG.STORE_NAME);
            }
          };
          req.onsuccess = function (ev) { resolve(ev.target.result); };
          req.onerror = function (ev) { reject(ev.target.error || new Error('Erreur IndexedDB')); };
        });
      }

      function saveArchiveToIndexedDb() {
        if (!state.rawSourceRows || state.rawSourceRows.length < 2) return Promise.resolve();
        return openYassirArchiveDb().then(function (db) {
          return new Promise(function (resolve, reject) {
            var tx = db.transaction(YASSIR_IDB_CONFIG.STORE_NAME, 'readwrite');
            var store = tx.objectStore(YASSIR_IDB_CONFIG.STORE_NAME);
            store.put({
              rawSourceRows: state.rawSourceRows,
              storedFilesMeta: state.storedFilesMeta,
              savedAt: new Date().toISOString()
            }, getCurrentBrandIdbRecordKey());
            tx.oncomplete = function () {
              var badge = document.getElementById('badgeIndexedDbSaved');
              if (badge) badge.classList.remove('hidden');
              resolve();
            };
            tx.onerror = function (ev) { reject(ev.target.error); };
          });
        }).catch(function () {});
      }

      function getCurrentBrandIdbRecordKey() {
        return (typeof currentBrand !== 'undefined' && currentBrand === 'kool')
          ? 'kool_cumulative_data_exp'
          : YASSIR_IDB_CONFIG.RECORD_KEY;
      }

      function loadArchiveFromIndexedDb(brandOverride) {
        var b = brandOverride || (typeof currentBrand !== 'undefined' ? currentBrand : 'yassir');
        var recKey = b === 'kool' ? 'kool_cumulative_data_exp' : YASSIR_IDB_CONFIG.RECORD_KEY;
        return openYassirArchiveDb().then(function (db) {
          return new Promise(function (resolve) {
            var tx = db.transaction(YASSIR_IDB_CONFIG.STORE_NAME, 'readonly');
            var store = tx.objectStore(YASSIR_IDB_CONFIG.STORE_NAME);
            var req = store.get(recKey);
            req.onsuccess = function (ev) { resolve(ev.target.result || null); };
            req.onerror = function () { resolve(null); };
          });
        }).catch(function () { return null; });
      }

      // Fenêtre de données active : octobre, novembre et décembre. La data
      // journalière par onglet continue en décembre : sans cette extension,
      // les lignes de décembre seraient silencieusement ignorées à la fusion
      // et au chargement de l'archive. À étendre (ajouter '01', ...) quand
      // l'utilisateur passera à janvier — la purge 3 mois glissants, elle,
      // est relative à la date max et n'a pas besoin d'être touchée.
      var MOIS_PERIODE_ACTIVE = ['10', '11', '12'];
      function estDatePeriodeActive(val) {
        var iso = parseOrderDayToIsoDate(val);
        if (!iso) return false;
        var m = iso.substring(5, 7);
        return MOIS_PERIODE_ACTIVE.indexOf(m) !== -1;
      }

      // Exposé pour les tests : la fenêtre active inclut décembre (la data
      // journalière continue en décembre). Les dates futures restent ignorées
      // par parseOrderDayToIsoDate (garde préexistante) : un onglet daté de
      // décembre n'est donc lu qu'à partir de décembre.
      window.yassirEstDatePeriodeActive = estDatePeriodeActive;

      function filtrerArchivePeriodeActive(aoa, filesMeta) {
        if (!aoa || aoa.length < 2) return { aoa: aoa || [], meta: filesMeta || [] };
        var hdrs = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
        var idxDay = hdrs.indexOf('order day') !== -1 ? hdrs.indexOf('order day') : hdrs.indexOf('delivered day');
        var idxOid = hdrs.indexOf('order id');
        if (idxDay === -1) return { aoa: aoa, meta: filesMeta || [] };

        var keptMeta = [];
        var oldToNewFileIdx = new Map();
        (filesMeta || []).forEach(function (m, idx) {
          var lbl = String(m && m.name ? m.name : '').toLowerCase();
          if (lbl.includes('mai') || lbl.includes('juin') || lbl.includes('juillet') || lbl.includes('août') || lbl.includes('aout') || lbl.includes('septembre')) {
            return;
          }
          oldToNewFileIdx.set(idx, keptMeta.length);
          keptMeta.push(Object.assign({}, m, { rowsCount: 0 }));
        });

        var cleaned = [aoa[0]];
        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          if (idxOid !== -1 && !estOrderIdYaf(row[idxOid])) continue;
          if (!estDatePeriodeActive(row[idxDay])) continue;
          var oldFIdx = row.__fileSourceIdx;
          if (typeof oldFIdx === 'number' && oldToNewFileIdx.has(oldFIdx)) {
            var newFIdx = oldToNewFileIdx.get(oldFIdx);
            row.__fileSourceIdx = newFIdx;
            keptMeta[newFIdx].rowsCount += 1;
          }
          cleaned.push(row);
        }
        var finalMeta = keptMeta.filter(function (m) { return m.rowsCount > 0; });
        return { aoa: cleaned, meta: finalMeta };
      }

      function clearArchiveInIndexedDb() {
        return openYassirArchiveDb().then(function (db) {
          return new Promise(function (resolve) {
            var tx = db.transaction(YASSIR_IDB_CONFIG.STORE_NAME, 'readwrite');
            var store = tx.objectStore(YASSIR_IDB_CONFIG.STORE_NAME);
            store.delete(getCurrentBrandIdbRecordKey());
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { resolve(); };
          });
        }).catch(function () {});
      }

      function getTodayIsoLocal() {
        var now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      }

      var _parseOrderDayCache = new Map();
      function parseOrderDayToIsoDate(val) {
        if (val === null || val === undefined || val === '') return '';
        var cacheKey = (typeof val === 'string' || typeof val === 'number') ? val : null;
        if (cacheKey !== null && _parseOrderDayCache.has(cacheKey)) {
          return _parseOrderDayCache.get(cacheKey);
        }
        var todayIso = getTodayIsoLocal();
        var iso = '';

        if (val instanceof Date && !isNaN(val.getTime())) {
          var y = val.getUTCFullYear();
          var m = String(val.getUTCMonth() + 1).padStart(2, '0');
          var d = String(val.getUTCDate()).padStart(2, '0');
          iso = y + '-' + m + '-' + d;
        } else if (typeof val === 'number' && val > 25569) {
          var dt = new Date(Math.round((val - 25569) * 86400 * 1000));
          iso = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
        } else {
          var str = String(val).trim();
          if (!str) return '';

          // ISO YYYY-MM-DD...
          var isoM = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (isoM) {
            iso = isoM[1] + '-' + String(isoM[2]).padStart(2, '0') + '-' + String(isoM[3]).padStart(2, '0');
          } else {
            // DD/MM/YYYY ou MM/DD/YYYY
            var frM = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (frM) {
              var p1 = parseInt(frM[1], 10);
              var p2 = parseInt(frM[2], 10);
              var yrStr = frM[3];
              var candDdMm = (p2 >= 1 && p2 <= 12 && p1 >= 1 && p1 <= 31)
                ? (yrStr + '-' + String(p2).padStart(2, '0') + '-' + String(p1).padStart(2, '0'))
                : '';
              var candMmDd = (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 31)
                ? (yrStr + '-' + String(p1).padStart(2, '0') + '-' + String(p2).padStart(2, '0'))
                : '';

              if (candDdMm && candDdMm <= todayIso) {
                iso = candDdMm;
              } else if (candMmDd && candMmDd <= todayIso) {
                iso = candMmDd;
              } else {
                iso = candDdMm || candMmDd;
              }
            } else if (str.indexOf('Date(') === 0) {
              var gvizD = str.match(/^Date\((\d+),(\d+),(\d+)/);
              if (gvizD) {
                var gY = parseInt(gvizD[1], 10);
                var gM = parseInt(gvizD[2], 10) + 1;
                var gD = parseInt(gvizD[3], 10);
                if (gY >= 2020 && gY <= 2035) {
                  iso = gY + '-' + String(gM).padStart(2, '0') + '-' + String(gD).padStart(2, '0');
                }
              }
            } else if (/\b20\d{2}\b/.test(str)) {
              var parsed = Date.parse(str);
              if (!isNaN(parsed)) {
                var dObj = new Date(parsed);
                var yr = dObj.getFullYear();
                if (yr >= 2020 && yr <= 2035) {
                  iso = yr + '-' + String(dObj.getMonth() + 1).padStart(2, '0') + '-' + String(dObj.getDate()).padStart(2, '0');
                }
              }
            }
          }
        }

        // Ignorer toute date future au-delà d'aujourd'hui (évite les semaines futures comme Week 50)
        if (iso && iso > todayIso) {
          iso = '';
        }
        if (cacheKey !== null) {
          if (_parseOrderDayCache.size > 40000) _parseOrderDayCache.clear();
          _parseOrderDayCache.set(cacheKey, iso);
        }
        return iso;
      }

      function applyDefaultLatestDayFilter() {
        var todayIso = getTodayIsoLocal();
        state.dateStart = todayIso;
        state.dateEnd = todayIso;
        var inpStart = document.getElementById('filterDateStart');
        var inpEnd = document.getElementById('filterDateEnd');
        var selW = document.getElementById('filterWeekSelect');
        if (inpStart) inpStart.value = todayIso;
        if (inpEnd) inpEnd.value = todayIso;
        if (selW) selW.value = '';
        updateDatePresetButtonsUI('');
      }

      window.yassirClearDateFilter = function () {
        // Effacement explicite du filtre (« Reset ») : un choix manuel, lui
        // aussi — la synchro ne doit pas réappliquer la semaine par défaut.
        state.semaineChoisieManuellement = true;
        state.dateStart = '';
        state.dateEnd = '';
        var inpStart = document.getElementById('filterDateStart');
        var inpEnd = document.getElementById('filterDateEnd');
        var selW = document.getElementById('filterWeekSelect');
        if (inpStart) inpStart.value = '';
        if (inpEnd) inpEnd.value = '';
        if (selW) selW.value = '';
        updateDatePresetButtonsUI('ALL');
        executerTraitementMetier();
        showToast('Filtre de date effacé : affichage de <strong>toute la période</strong>.', 'info');
      };

      function detecterBornesDatesSource(aoa) {
        if (aoa && aoa.length > 2) {
          var trimmedAoa = purgerHistoriqueActif3Mois(aoa);
          if (trimmedAoa.length < aoa.length) {
            state.rawSourceRows = trimmedAoa;
            aoa = trimmedAoa;
          }
        }
        if (!aoa || aoa.length < 2) {
          state.minAvailableDate = '';
          state.maxAvailableDate = '';
          return;
        }
        var headers = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
        var idxOrderDay = headers.indexOf('order day');
        if (idxOrderDay === -1) idxOrderDay = headers.indexOf('delivered day');
        var idxOidCheck = headers.indexOf('order id');
        if (idxOrderDay === -1) return;

        var minIso = '';
        var maxIso = '';
        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          if (idxOidCheck !== -1 && !estOrderIdYaf(row[idxOidCheck])) continue;
          var iso = parseOrderDayToIsoDate(row[idxOrderDay]);
          if (!iso) continue;
          if (!minIso || iso < minIso) minIso = iso;
          if (!maxIso || iso > maxIso) maxIso = iso;
        }
        state.minAvailableDate = minIso;
        state.maxAvailableDate = maxIso;
      }

      function shiftIsoDateByDays(isoDate, deltaDays) {
        if (!isoDate) return '';
        var p = isoDate.split('-');
        if (p.length !== 3) return isoDate;
        var dt = new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + deltaDays));
        return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
      }

      function parseTimeStrToSeconds(timeStr, defaultSec) {
        if (!timeStr) return defaultSec;
        var parts = String(timeStr).trim().split(':');
        if (parts.length < 2) return defaultSec;
        var h = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        var s = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
        if (isNaN(h) || isNaN(m)) return defaultSec;
        return h * 3600 + m * 60 + (isNaN(s) ? 0 : s);
      }

      function getOperationalIsoDate(calendarIso, orderTimeVal) {
        if (!calendarIso) return '';
        var endNextDaySec = parseTimeStrToSeconds(state.timeEndNextDay || '01:30', 90 * 60);
        var tObj = extraireObjetHeureNormalise(orderTimeVal);
        if (!tObj) return calendarIso;

        var secOfDay = tObj.getHours() * 3600 + tObj.getMinutes() * 60 + tObj.getSeconds();
        // Entre minuit (00:00:00) et 01:30:00 -> appartient à la journée opérationnelle de la veille (J-1)
        if (secOfDay <= endNextDaySec) {
          return shiftIsoDateByDays(calendarIso, -1);
        }
        return calendarIso;
      }

      var _sourceIndexCache = {
        aoaRef: null,
        aoaLen: 0,
        firstRowRef: null,
        brand: '',
        entries: [],
        colMapping: null,
        fullCacheKey: '',
        fullMarketRows: [],
        fullFoodRows: [],
        fullOffresRows: [],
        fullStatRows: []
      };

      function getOrBuildSourceIndex(aoa) {
        var b = (typeof currentBrand !== 'undefined' ? currentBrand : 'yassir');
        if (
          _sourceIndexCache.aoaRef === aoa &&
          _sourceIndexCache.aoaLen === aoa.length &&
          _sourceIndexCache.firstRowRef === aoa[1] &&
          _sourceIndexCache.brand === b &&
          _sourceIndexCache.entries.length > 0
        ) {
          return _sourceIndexCache;
        }
        var headers = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
        var idxOrderDay = headers.indexOf('order day');
        if (idxOrderDay === -1) idxOrderDay = headers.indexOf('delivered day');
        var idxOrderTime = headers.indexOf('order time');
        var idxOidFilter = headers.indexOf('order id');

        var entries = [];
        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          if (idxOidFilter !== -1 && !estOrderIdYaf(row[idxOidFilter])) continue;
          var opIso = '';
          if (idxOrderDay !== -1) {
            var calIso = parseOrderDayToIsoDate(row[idxOrderDay]);
            if (calIso) {
              opIso = idxOrderTime !== -1 ? getOperationalIsoDate(calIso, row[idxOrderTime]) : calIso;
            }
          }
          entries.push({ row: row, opIso: opIso });
        }
        _sourceIndexCache = {
          aoaRef: aoa,
          aoaLen: aoa.length,
          firstRowRef: aoa[1],
          brand: b,
          entries: entries,
          colMapping: null,
          fullCacheKey: '',
          fullMarketRows: [],
          fullFoodRows: [],
          fullOffresRows: [],
          fullStatRows: []
        };
        return _sourceIndexCache;
      }

      function obtenirSourceAoaFiltreeParDate() {
        var aoa = state.rawSourceRows;
        if (!aoa || aoa.length < 2) return aoa;
        var idxCache = getOrBuildSourceIndex(aoa);
        var dStart = state.dateStart;
        var dEnd = state.dateEnd;
        var entries = idxCache.entries;
        var filtered = new Array(entries.length + 1);
        filtered[0] = aoa[0];
        var count = 1;
        if (!dStart && !dEnd) {
          for (var i = 0; i < entries.length; i++) {
            filtered[count++] = entries[i].row;
          }
        } else {
          for (var j = 0; j < entries.length; j++) {
            var ent = entries[j];
            var opIso = ent.opIso;
            if (!opIso) continue;
            if (dStart && opIso < dStart) continue;
            if (dEnd && opIso > dEnd) continue;
            filtered[count++] = ent.row;
          }
        }
        filtered.length = count;
        return filtered;
      }

      function mettreAJourBarreDatesEtFichiers() {
        var dateBar = document.getElementById('dateRangeFilterBar');
        var inpStart = document.getElementById('filterDateStart');
        var inpEnd = document.getElementById('filterDateEnd');
        var hintEl = document.getElementById('dateRangeBoundsHint');
        var chipsBar = document.getElementById('storedFilesChipsBar');

        var hasRows = state.rawSourceRows && state.rawSourceRows.length > 1;
        if (dateBar) {
          if (hasRows && state.minAvailableDate && state.maxAvailableDate) {
            dateBar.classList.remove('hidden');
            var todayMaxIso = getTodayIsoLocal();
            if (inpStart) {
              inpStart.min = state.minAvailableDate || '';
              inpStart.max = todayMaxIso;
              inpStart.value = state.dateStart || '';
            }
            if (inpEnd) {
              inpEnd.min = state.minAvailableDate || '';
              inpEnd.max = todayMaxIso;
              inpEnd.value = state.dateEnd || '';
            }
            if (hintEl) {
              // Fraîcheur des données près du filtre (diagnostic 2026-11-27) :
              // l'élément #dateRangeBoundsHint manquait dans index.html, ce
              // texte n'était jamais affiché.
              var fmtFR = function (iso) {
                var p = String(iso || '').split('-');
                return (p.length === 3) ? (p[2] + '/' + p[1] + '/' + p[0]) : (iso || '');
              };
              hintEl.textContent = '(Données du ' + fmtFR(state.minAvailableDate) + ' au ' + fmtFR(state.maxAvailableDate) + ')';
            }
          } else {
            dateBar.classList.add('hidden');
          }
        }

        var prevDateRow = document.getElementById('prevDateRangeFilterRow');
        var inpPrevStart = document.getElementById('filterPrevDateStart');
        var inpPrevEnd = document.getElementById('filterPrevDateEnd');
        var prevHintEl = document.getElementById('prevDateBoundsHint');
        var hasDedicatedPrev = state.prevSourceRows && state.prevSourceRows.length > 1;
        var canCompare = canSeeGlobalSynth() && (hasDedicatedPrev || hasRows);

        if (prevDateRow) {
          if (canCompare) {
            prevDateRow.classList.remove('hidden');
            var pMin = hasDedicatedPrev ? state.minPrevDate : state.minAvailableDate;
            var pMax = hasDedicatedPrev ? state.maxPrevDate : state.maxAvailableDate;
            if (inpPrevStart && pMin && pMax) {
              inpPrevStart.min = pMin;
              inpPrevStart.max = pMax;
              if (!inpPrevStart.value && hasDedicatedPrev) inpPrevStart.value = state.prevDateStart || pMin;
            }
            if (inpPrevEnd && pMin && pMax) {
              inpPrevEnd.min = pMin;
              inpPrevEnd.max = pMax;
              if (!inpPrevEnd.value && hasDedicatedPrev) inpPrevEnd.value = state.prevDateEnd || pMax;
            }
            if (prevHintEl) {
              prevHintEl.textContent = hasDedicatedPrev
                ? ('(Data préc : ' + (pMin || '?') + ' → ' + (pMax || '?') + ')')
                : '(Ou choisissez 2 dates sur l\'historique Mai–Oct)';
            }
          } else {
            prevDateRow.classList.add('hidden');
          }
        }

        if (chipsBar) {
          var canSeeSourceChips = isOwnerAdmin() || canViewAllPortfolios();
          if (canSeeSourceChips && state.storedFilesMeta && state.storedFilesMeta.length > 0) {
            var ownerCanDelete = isOwnerAdmin();
            chipsBar.classList.remove('hidden');
            chipsBar.innerHTML = state.storedFilesMeta.map(function (fMeta, idx) {
              var removeBtn = ownerCanDelete
                ? '<button type="button" data-idx="' + idx + '" onclick="window.yassirRemoveStoredFile(+this.getAttribute(\'data-idx\'))" class="text-slate-400 hover:text-[#FF2A6D] ml-0.5 cursor-pointer" title="Retirer ce fichier du cumul (Propriétaire Admin)"><i class="fa-solid fa-xmark"></i></button>'
                : '';
              return '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9] border border-purple-200" title="' + escapeHtml(fMeta.name) + ' (' + fMeta.rowsCount + ' lignes)">' +
                '<i class="fa-solid fa-file-circle-check text-[#00BFA5]"></i>' +
                '<span class="max-w-[140px] truncate">' + escapeHtml(fMeta.name) + '</span>' +
                '<span class="text-slate-400">(' + fMeta.rowsCount + ')</span>' +
                removeBtn +
              '</span>';
            }).join('');
          } else {
            chipsBar.classList.add('hidden');
            chipsBar.innerHTML = '';
          }
        }
      }

      window.yassirOnWeekSelectChange = function (val) {
        // Choix manuel : la semaine choisie ne doit jamais être écrasée par
        // la semaine par défaut réappliquée après une synchro (diagnostic
        // 2026-11-27, semaine figée). Vaut aussi quand l'utilisateur efface
        // la sélection (val vide = toute la période, choix explicite).
        state.semaineChoisieManuellement = true;
        var inpStart = document.getElementById('filterDateStart');
        var inpEnd = document.getElementById('filterDateEnd');
        if (!val) {
          state.dateStart = '';
          state.dateEnd = '';
          if (inpStart) inpStart.value = state.minAvailableDate || '';
          if (inpEnd) inpEnd.value = state.maxAvailableDate || '';
          updateDatePresetButtonsUI('ALL');
          executerTraitementMetier();
          return;
        }
        var parts = val.split('|');
        var wStart = parts[0] || '';
        var wEnd = parts[1] || '';
        var wLabel = parts[2] || '';
        state.dateStart = wStart;
        state.dateEnd = wEnd;
        if (inpStart) inpStart.value = wStart;
        if (inpEnd) inpEnd.value = wEnd;
        updateDatePresetButtonsUI('');
        scheduleExecuterTraitementMetier();
      };

      window.yassirOnPrevWeekSelectChange = function (val) {
        var inpS = document.getElementById('filterPrevDateStart');
        var inpE = document.getElementById('filterPrevDateEnd');
        if (!val) {
          window.yassirResetPrevDateFilter();
          return;
        }
        var parts = val.split('|');
        state.prevDateStart = parts[0] || '';
        state.prevDateEnd = parts[1] || '';
        if (inpS) inpS.value = state.prevDateStart;
        if (inpE) inpE.value = state.prevDateEnd;
        if (state.activeTab === 'synth_global') {
          renderSynthGlobalPanel();
        } else if (canSeeGlobalSynth() && (isMarketOnlyViewer() || getEffectiveAmFilter() === 'ALL')) {
          window.yassirSwitchTab('synth_global');
        }
      };

      window.yassirOnPrevDateRangeChange = function () {
        var inpS = document.getElementById('filterPrevDateStart');
        var inpE = document.getElementById('filterPrevDateEnd');
        var selPW = document.getElementById('filterPrevWeekSelect');
        if (selPW) selPW.value = '';
        state.prevDateStart = inpS ? inpS.value : '';
        state.prevDateEnd = inpE ? inpE.value : '';
        if (state.activeTab === 'synth_global') {
          renderSynthGlobalPanel();
        } else if ((state.prevDateStart || state.prevDateEnd) && canSeeGlobalSynth() && (isMarketOnlyViewer() || getEffectiveAmFilter() === 'ALL')) {
          window.yassirSwitchTab('synth_global');
        }
      };

      window.yassirResetPrevDateFilter = function () {
        state.prevDateStart = '';
        state.prevDateEnd = '';
        var inpS = document.getElementById('filterPrevDateStart');
        var inpE = document.getElementById('filterPrevDateEnd');
        var selPW = document.getElementById('filterPrevWeekSelect');
        var hasDedicatedPrev = state.prevSourceRows && state.prevSourceRows.length > 1;
        if (inpS) inpS.value = hasDedicatedPrev ? (state.minPrevDate || '') : '';
        if (inpE) inpE.value = hasDedicatedPrev ? (state.maxPrevDate || '') : '';
        if (selPW) selPW.value = '';
        if (state.activeTab === 'synth_global') renderSynthGlobalPanel();
      };

      var _dateFilterDebounceTimer = null;
      function scheduleExecuterTraitementMetier() {
        if (_dateFilterDebounceTimer) clearTimeout(_dateFilterDebounceTimer);
        _dateFilterDebounceTimer = null;
        executerTraitementMetier();
      }

      window.yassirOnDateRangeChange = function () {
        // Choix manuel de dates : protège contre l'écrasement par la semaine
        // par défaut après une synchro (diagnostic 2026-11-27).
        state.semaineChoisieManuellement = true;
        var inpStart = document.getElementById('filterDateStart');
        var inpEnd = document.getElementById('filterDateEnd');
        var selW = document.getElementById('filterWeekSelect');
        if (selW) selW.value = '';
        state.dateStart = inpStart ? inpStart.value : '';
        state.dateEnd = inpEnd ? inpEnd.value : '';
        state.timeStart = '09:00';
        state.timeEndNextDay = '01:00';
        updateDatePresetButtonsUI('');
        scheduleExecuterTraitementMetier();
      };

      function updateDatePresetButtonsUI(activePreset) {
        var map = {
          ALL: 'btnDatePresetAll',
          LAST_7: 'btnDatePreset7',
          LAST_14: 'btnDatePreset14',
          LAST_30: 'btnDatePreset30',
          LAST_90: 'btnDatePreset90'
        };
        Object.keys(map).forEach(function (k) {
          var btn = document.getElementById(map[k]);
          if (!btn) return;
          btn.className = (k === activePreset)
            ? 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#6C2BD9] text-white transition cursor-pointer'
            : 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F8F9FC] text-slate-600 border border-purple-200 hover:bg-[#F3EBFF] transition cursor-pointer';
        });
      }

      window.yassirApplyDatePreset = function (preset) {
        if (!state.maxAvailableDate || !state.minAvailableDate) return;
        // Choix manuel (préréglage Tout / 7j / 14j / 30j / 3 mois) : protège
        // contre l'écrasement par la semaine par défaut après une synchro.
        state.semaineChoisieManuellement = true;
        var inpStart = document.getElementById('filterDateStart');
        var inpEnd = document.getElementById('filterDateEnd');
        var selW = document.getElementById('filterWeekSelect');
        if (selW) selW.value = '';

        if (preset === 'ALL') {
          state.dateStart = '';
          state.dateEnd = '';
          if (inpStart) inpStart.value = state.minAvailableDate;
          if (inpEnd) inpEnd.value = state.maxAvailableDate;
        } else {
          var daysBack = preset === 'LAST_7' ? 6 : (preset === 'LAST_14' ? 13 : (preset === 'LAST_30' ? 29 : 89));
          var parts = state.maxAvailableDate.split('-');
          var endDt = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
          var startDt = new Date(endDt.getTime() - daysBack * 86400 * 1000);
          var startIso = startDt.getUTCFullYear() + '-' + String(startDt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(startDt.getUTCDate()).padStart(2, '0');
          if (startIso < state.minAvailableDate) startIso = state.minAvailableDate;

          state.dateStart = startIso;
          state.dateEnd = state.maxAvailableDate;
          if (inpStart) inpStart.value = startIso;
          if (inpEnd) inpEnd.value = state.maxAvailableDate;
        }

        updateDatePresetButtonsUI(preset);
        executerTraitementMetier();
      };

      function fusionnerNouveauFichierDansArchive(fileName, newAoa) {
        if (!newAoa || newAoa.length < 2) return 0;
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          newAoa = filterOutMarketRowsForKool(normaliserLignesDataKool(newAoa));
          if (!newAoa || newAoa.length < 2) return 0;
        }
        var newHeaders = newAoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim() : ''; });

        if (!state.rawSourceRows || state.rawSourceRows.length < 2) {
          state.rawSourceRows = [newHeaders];
          state.storedFilesMeta = [];
        }

        var baseHeaders = state.rawSourceRows[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim() : ''; });
        var baseHeadersLower = baseHeaders.map(function (h) { return h.toLowerCase(); });
        var idxBaseOrderId = baseHeadersLower.indexOf('order id');
        var idxNewOrderId = newHeaders.map(function (h) { return h.toLowerCase(); }).indexOf('order id');

        // Si le nouveau fichier est déjà traité (109 colonnes avec Total Food VF) et que l'archive actuelle n'avait pas Total Food VF, réinitialiser l'en-tête sur le format traité
        var newHeadersLower = newHeaders.map(function (h) { return h.toLowerCase(); });
        var newIsTreated = newHeadersLower.indexOf('total food vf') !== -1 && newHeadersLower.indexOf('à payer réduits') !== -1;
        var baseIsTreated = baseHeadersLower.indexOf('total food vf') !== -1 && baseHeadersLower.indexOf('à payer réduits') !== -1;
        if (newIsTreated && !baseIsTreated) {
          state.rawSourceRows = [newHeaders];
          state.storedFilesMeta = [];
          baseHeaders = newHeaders.slice();
          baseHeadersLower = newHeadersLower.slice();
          idxBaseOrderId = idxNewOrderId;
        }

        var existingOrderRowIdxMap = new Map();
        if (idxBaseOrderId !== -1) {
          for (var r = 1; r < state.rawSourceRows.length; r++) {
            var oid = String(state.rawSourceRows[r][idxBaseOrderId] || '').trim();
            if (oid) existingOrderRowIdxMap.set(oid, r);
          }
        }

        // Mapper les colonnes du nouveau fichier vers l'en-tête de base en respectant l'ordre des doublons
        var baseHeadersClean = baseHeaders.map(function (bh) { return bh.toLowerCase().replace(/[_\s]+/g, ' ').trim(); });
        var newHeadersClean = newHeaders.map(function (nh) { return nh.toLowerCase().replace(/[_\s]+/g, ' ').trim(); });
        var usedNewIndices = new Set();
        var colMap = baseHeadersClean.map(function (bhClean) {
          for (var idxN = 0; idxN < newHeadersClean.length; idxN++) {
            if (newHeadersClean[idxN] === bhClean && !usedNewIndices.has(idxN)) {
              usedNewIndices.add(idxN);
              return idxN;
            }
          }
          return newHeadersClean.indexOf(bhClean);
        });

        var addedCount = 0;
        for (var nr = 1; nr < newAoa.length; nr++) {
          var sRow = newAoa[nr];
          if (!sRow || sRow.every(function (c) { return c === null || c === undefined || String(c).trim() === ''; })) continue;

          var newOid = idxNewOrderId !== -1 ? String(sRow[idxNewOrderId] || '').trim() : '';
          if (idxNewOrderId !== -1 && !estOrderIdYaf(newOid)) {
            continue;
          }
          if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
            var idxNewSrv = newHeadersClean.indexOf('services');
            var idxNewRest = newHeadersClean.indexOf('restaurant name');
            var srvK = idxNewSrv !== -1 ? String(sRow[idxNewSrv] || '').toLowerCase() : '';
            var restK = idxNewRest !== -1 ? String(sRow[idxNewRest] || '').toLowerCase() : '';
            if (srvK.includes('market') || restK.includes('mg market') || restK.includes('market')) {
              continue;
            }
          }
          var idxNewOrderDay = newHeadersClean.indexOf('order day') !== -1 ? newHeadersClean.indexOf('order day') : newHeadersClean.indexOf('delivered day');
          if (idxNewOrderDay !== -1 && !estDatePeriodeActive(sRow[idxNewOrderDay])) {
            continue;
          }

          var alignedRow = new Array(baseHeaders.length).fill('');
          for (var c = 0; c < baseHeaders.length; c++) {
            var srcIdx = colMap[c];
            if (srcIdx !== -1 && srcIdx < sRow.length) {
              alignedRow[c] = sRow[srcIdx];
            }
          }

          if (newOid && existingOrderRowIdxMap.has(newOid)) {
            var existIdx = existingOrderRowIdxMap.get(newOid);
            alignedRow.__fileSourceIdx = state.rawSourceRows[existIdx].__fileSourceIdx;
            state.rawSourceRows[existIdx] = alignedRow;
            addedCount++;
          } else {
            if (newOid) existingOrderRowIdxMap.set(newOid, state.rawSourceRows.length);
            alignedRow.__fileSourceIdx = state.storedFilesMeta.length;
            state.rawSourceRows.push(alignedRow);
            addedCount++;
          }
        }

        // Remplacer ou ajouter la métadonnée du fichier
        var existingMetaIdx = state.storedFilesMeta.findIndex(function (m) { return m.name === fileName; });
        if (existingMetaIdx !== -1) {
          state.storedFilesMeta[existingMetaIdx].rowsCount += addedCount;
        } else {
          state.storedFilesMeta.push({
            name: fileName,
            rowsCount: addedCount,
            addedAt: new Date().toISOString()
          });
        }

        return addedCount;
      }

      window.yassirRemoveStoredFile = function (fileIdx) {
        if (!isOwnerAdmin()) return;
        var meta = state.storedFilesMeta[fileIdx];
        if (!meta) return;
        // Supprimer les lignes associées à ce fichier et réindexer
        var filteredRows = [state.rawSourceRows[0]];
        for (var r = 1; r < state.rawSourceRows.length; r++) {
          var row = state.rawSourceRows[r];
          var srcIdx = row.__fileSourceIdx;
          if (srcIdx === fileIdx) continue;
          if (typeof srcIdx === 'number' && srcIdx > fileIdx) {
            row.__fileSourceIdx = srcIdx - 1;
          }
          filteredRows.push(row);
        }
        state.storedFilesMeta.splice(fileIdx, 1);

        if (filteredRows.length <= 1 || state.storedFilesMeta.length === 0) {
          window.yassirResetAll();
          return;
        }

        state.rawSourceRows = filteredRows;
        state.dateStart = '';
        state.dateEnd = '';
        detecterBornesDatesSource(state.rawSourceRows);
        saveArchiveToIndexedDb();
        executerTraitementMetier();
        showToast('Fichier <strong>' + escapeHtml(meta.name) + '</strong> retiré de la base enregistrée.', 'info');
      };

      /* ========================================================================
         G1. OPTIONS DE SEMAINES GÉNÉRÉES EN JAVASCRIPT (audit 2026-11-27, item 6)
         ========================================================================
         Les options S01…S53 étaient écrites en dur dans index.html pour la
         seule année 2026 : à partir du 4 janvier 2027, plus aucune semaine
         valide dans les filtres. Les options sont désormais générées ici,
         en semaines ISO (le lundi de la semaine 1 est celui du 4 janvier),
         pour l'année précédente, l'année en cours et l'année suivante —
         le filtre fonctionne donc en janvier 2027 et après, sans retouche.
         Format identique à l'ancien (valeur « AAAA-MM-JJ|AAAA-MM-JJ|SNN »,
         libellé « SNN (JJ/MM → JJ/MM) ») : les semaines 2026 générées
         sont strictement identiques aux anciennes options en dur.
         ======================================================================== */
      function _pad2Semaines(n) { return (n < 10 ? '0' : '') + n; }
      function _formatDateISO(d) { return d.getFullYear() + '-' + _pad2Semaines(d.getMonth() + 1) + '-' + _pad2Semaines(d.getDate()); }
      function _formatDateFR(d) { return _pad2Semaines(d.getDate()) + '/' + _pad2Semaines(d.getMonth() + 1); }
      // Lundi de la semaine ISO n de l'année a (le 4 janvier est toujours en semaine 1).
      function _lundiSemaineISO(annee, semaine) {
        var d = new Date(annee, 0, 4);
        var decalage = (d.getDay() + 6) % 7; // 0 = lundi
        d.setDate(d.getDate() - decalage + (semaine - 1) * 7);
        return d;
      }
      // Nombre de semaines ISO d'une année (52 ou 53) : le 28 décembre est
      // toujours dans la dernière semaine ISO de l'année.
      function _nombreSemainesISO(annee) {
        var d = new Date(annee, 11, 28);
        var jour = (d.getDay() + 6) % 7;
        var jeudi = new Date(d);
        jeudi.setDate(d.getDate() - jour + 3);
        var premierJeudi = new Date(jeudi.getFullYear(), 0, 4);
        var j2 = (premierJeudi.getDay() + 6) % 7;
        premierJeudi.setDate(premierJeudi.getDate() - j2 + 3);
        return 1 + Math.round((jeudi - premierJeudi) / (7 * 86400000));
      }
      window.yassirGenererOptionsSemaines = function () {
        var anneeCourante = new Date().getFullYear();
        var annees = [anneeCourante - 1, anneeCourante, anneeCourante + 1];
        var html = '<option value="">Semaine...</option>';
        annees.forEach(function (annee) {
          var nb = _nombreSemainesISO(annee);
          for (var s = 1; s <= nb; s++) {
            var debut = _lundiSemaineISO(annee, s);
            var fin = new Date(debut);
            fin.setDate(fin.getDate() + 6);
            var label = 'S' + _pad2Semaines(s);
            html += '<option value="' + _formatDateISO(debut) + '|' + _formatDateISO(fin) + '|' + label + '">' + label + ' (' + _formatDateFR(debut) + ' → ' + _formatDateFR(fin) + ')</option>';
          }
        });
        ['filterWeekSelect', 'filterPrevWeekSelect'].forEach(function (id) {
          var sel = document.getElementById(id);
          if (sel) sel.innerHTML = html;
        });
      };
      // Remplissage au chargement : le bundle s'exécute après l'analyse du
      // HTML (script module différé), les sélecteurs existent déjà.
      window.yassirGenererOptionsSemaines();
