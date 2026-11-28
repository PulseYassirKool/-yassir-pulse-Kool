      /* ========================================================================
         Z. GESTION MULTI-MARQUE : YASSIR <-> KOOL (DESIGN, DATA & COMMISSIONS)
         ======================================================================== */
      var currentBrand = safeGet('yassir_kool_active_brand_v1') || 'yassir';

      var KOOL_SHEETS_CONFIG = {"DATA_SHEET_ID": "", "DATA_GID": "", "COMMISSION_SHEET_ID": "", "COMMISSION_TAB": "", "COMMISSION_ALT_TABS": [], "COMMISSION_GID": "", "PORTFOLIOS_SHEET_ID": "", "PORTFOLIOS_GID": "", "OFFRE_PARTICIPATION_SHEET_ID": "", "OFFRE_PARTICIPATION_GID": "", "ORDER_ITEMS_SHEET_ID": "", "ORDER_ITEMS_GID": "", "BUDGET_SHEET_ID": "", "BUDGET_GID": "", "HISTORICAL_2025_SHEET_ID": "", "HISTORICAL_2025_GID": ""}; // rempli après connexion (GET /api/bootstrap)

      window.koolOrderItemsByOrderId = new Map();
      window.koolOrderItemsByResto = new Map();
      window.koolOrderItemsRawCount = 0;


      // ========================================================================
      // OPTIMISATIONS PERFORMANCE : 3 MOIS GLISSANTS, SEMAINE ACTIVE & FILTRE EXTRA 0 DT
      // ========================================================================
      function filtrerLignesArticlesKoolSansExtraZero(rows) {
        if (!rows || rows.length < 2) return rows || [];
        var hdr = (rows[0] || []).map(function (h) { return normalizeText(h).replace(/[_\-]+/g, ' ').trim(); });
        var idxType = hdr.findIndex(function (h) { return h === 'type'; });
        if (idxType === -1) idxType = 9;
        var idxUnit = hdr.findIndex(function (h) { return h.includes('unit'); });
        if (idxUnit === -1) idxUnit = 6;
        var idxDisc = hdr.findIndex(function (h) { return h.includes('discount'); });
        if (idxDisc === -1) idxDisc = 7;
        var idxOrig = hdr.findIndex(function (h) { return h.includes('original'); });
        if (idxOrig === -1) idxOrig = 8;

        var filtered = [rows[0]];
        var skippedZeroExtras = 0;
        for (var r = 1; r < rows.length; r++) {
          var row = rows[r];
          if (!row) continue;
          var typeVal = normalizeText(row[idxType]);
          var unitVal = purgerNombre(row[idxUnit]);
          var discVal = purgerNombre(row[idxDisc]);
          var origVal = purgerNombre(row[idxOrig]);
          if (typeVal.includes('extra') && unitVal === 0 && discVal === 0 && origVal === 0) {
            skippedZeroExtras++;
            continue;
          }
          filtered.push(row);
        }
        window.koolOrderItemsSkippedZeroExtras = skippedZeroExtras;
        return filtered;
      }

      function purgerHistoriqueActif3Mois(aoa) {
        if (!aoa || aoa.length < 2) return aoa;
        var hdrs = aoa[0].map(function (h) { return h !== null && h !== undefined ? String(h).trim().toLowerCase() : ''; });
        var idxDay = hdrs.indexOf('order day') !== -1 ? hdrs.indexOf('order day') : hdrs.indexOf('delivered day');
        if (idxDay === -1) return aoa;

        var maxIso = '';
        var parsedDates = new Array(aoa.length);
        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row) continue;
          var iso = parseOrderDayToIsoDate(row[idxDay]);
          parsedDates[r] = iso;
          if (iso && (!maxIso || iso > maxIso)) maxIso = iso;
        }
        if (!maxIso) return aoa;

        var parts = maxIso.split('-');
        var maxDt = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
        var cutoffDt = new Date(maxDt.getTime() - 90 * 86400 * 1000);
        var cutoffIso = cutoffDt.getUTCFullYear() + '-' + String(cutoffDt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(cutoffDt.getUTCDate()).padStart(2, '0');

        var kept = [aoa[0]];
        for (var k = 1; k < aoa.length; k++) {
          if (!aoa[k]) continue;
          var dIso = parsedDates[k];
          if (!dIso || dIso >= cutoffIso) {
            kept.push(aoa[k]);
          }
        }
        return kept;
      }

      function appliquerFiltreSemaineRapideParDefaut() {
        if (!state.maxAvailableDate || !state.minAvailableDate) return;
        if (state.dateStart || state.dateEnd) return;
        var inpStart = document.getElementById('filterDateStart');
        var inpEnd = document.getElementById('filterDateEnd');
        var selW = document.getElementById('filterWeekSelect');
        if (selW) {
          for (var i = 1; i < selW.options.length; i++) {
            var optVal = selW.options[i].value;
            if (!optVal) continue;
            var p = optVal.split('|');
            if (p.length >= 2 && state.maxAvailableDate >= p[0] && state.maxAvailableDate <= p[1]) {
              selW.value = optVal;
              state.dateStart = p[0];
              state.dateEnd = p[1];
              if (inpStart) inpStart.value = p[0];
              if (inpEnd) inpEnd.value = p[1];
              updateDatePresetButtonsUI('');
              return;
            }
          }
        }
        var parts = state.maxAvailableDate.split('-');
        var endDt = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
        var startDt = new Date(endDt.getTime() - 6 * 86400 * 1000);
        var startIso = startDt.getUTCFullYear() + '-' + String(startDt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(startDt.getUTCDate()).padStart(2, '0');
        if (startIso < state.minAvailableDate) startIso = state.minAvailableDate;
        state.dateStart = startIso;
        state.dateEnd = state.maxAvailableDate;
        if (inpStart) inpStart.value = startIso;
        if (inpEnd) inpEnd.value = state.maxAvailableDate;
        updateDatePresetButtonsUI('LAST_7');
      }

      // Après une synchro de données réussie, la semaine par défaut doit
      // suivre les données fraîches (diagnostic 2026-11-27 : cache jusqu'au
      // 22 nov. → filtre resté W47 alors que les données fraîches allaient
      // jusqu'au 26 nov., W48). Sans choix manuel, on repart de la semaine
      // contenant la date max. Un choix manuel (semaine, plage, préréglage
      // ou Reset) n'est JAMAIS écrasé.
      function reappliquerSemaineParDefautApresSynchro() {
        if (state.semaineChoisieManuellement) return;
        state.dateStart = '';
        state.dateEnd = '';
        appliquerFiltreSemaineRapideParDefaut();
        mettreAJourBarreDatesEtFichiers();
      }

      function indexKoolOrderItemsRows(rows) {
        var byOrder = new Map();
        var byResto = new Map();
        if (!rows || rows.length < 2) {
          window.koolOrderItemsByOrderId = byOrder;
          window.koolOrderItemsByResto = byResto;
          window.koolOrderItemsRawCount = 0;
          window.koolOrderItemsMinDate = '';
          window.koolOrderItemsMaxDate = '';
          return 0;
        }
        var hdr = (rows[0] || []).map(function (h) { return normalizeText(h).replace(/[_\-]+/g, ' ').trim(); });
        var idxOid = hdr.findIndex(function (h) { return h === 'order id' || h.includes('order'); });
        if (idxOid === -1) idxOid = 0;
        var idxDate = hdr.findIndex(function (h) { return h === 'date' || h.includes('day'); });
        if (idxDate === -1) idxDate = 1;
        var idxResto = hdr.findIndex(function (h) { return h.includes('restaurant') || h.includes('store'); });
        if (idxResto === -1) idxResto = 2;
        var idxCat = hdr.findIndex(function (h) { return h.includes('category') || h.includes('categorie'); });
        if (idxCat === -1) idxCat = 3;
        var idxArt = hdr.findIndex(function (h) { return h.includes('article') || h.includes('item'); });
        if (idxArt === -1) idxArt = 4;
        var idxQty = hdr.findIndex(function (h) { return h.includes('quant') || h === 'qty'; });
        if (idxQty === -1) idxQty = 5;
        var idxUnit = hdr.findIndex(function (h) { return h.includes('unit'); });
        if (idxUnit === -1) idxUnit = 6;
        var idxDisc = hdr.findIndex(function (h) { return h.includes('discount'); });
        if (idxDisc === -1) idxDisc = 7;
        var idxOrig = hdr.findIndex(function (h) { return h.includes('original'); });
        if (idxOrig === -1) idxOrig = 8;
        var idxType = hdr.findIndex(function (h) { return h === 'type'; });
        if (idxType === -1) idxType = 9;

        var totalLines = 0;
        var minDateIso = '';
        var maxDateIso = '';
        // Déduplication commande|article (le Worker ne la fait plus sur le
        // chemin par tranches) : même normalisation que côté serveur.
        var _seenOrderArticle = new Set();
        for (var r = 1; r < rows.length; r++) {
          var row = rows[r];
          if (!row) continue;
          var oid = String(row[idxOid] || '').trim();
          var art = String(row[idxArt] || '').trim();
          if (!oid && !art) continue;
          var _dedupeKey = normalizeText(oid) + '|' + normalizeText(art);
          if (_seenOrderArticle.has(_dedupeKey)) continue;
          _seenOrderArticle.add(_dedupeKey);
          var oidLow = oid.toLowerCase();
          var restoStr = String(row[idxResto] || '').trim();
          var restoLow = restoStr.toLowerCase();
          var catStr = String(row[idxCat] || '').trim();
          var qtyVal = purgerNombre(row[idxQty]) || 1;
          var unitVal = purgerNombre(row[idxUnit]);
          var discVal = purgerNombre(row[idxDisc]);
          var origVal = purgerNombre(row[idxOrig]) || unitVal;
          var typeStr = String(row[idxType] || 'Food').trim() || 'Food';

          // Ignorer les suppléments Extra à 0 DT (réduit la mémoire et le stockage de 50 à 70 %)
          if (normalizeText(typeStr).includes('extra') && unitVal === 0 && discVal === 0 && origVal === 0) {
            continue;
          }
          var dateStr = String(row[idxDate] || '').trim();
          // Couverture temporelle des détails articles (ex. octobre uniquement) :
          // sert à expliquer un Top vide sur une période non couverte.
          if (dateStr) {
            var dIso = parseOrderDayToIsoDate(dateStr);
            if (dIso) {
              if (!minDateIso || dIso < minDateIso) minDateIso = dIso;
              if (!maxDateIso || dIso > maxDateIso) maxDateIso = dIso;
            }
          }

          var entry = {
            orderId: oid,
            date: dateStr,
            restaurant: restoStr,
            category: catStr,
            article: art,
            quantity: qtyVal,
            unitPrice: unitVal,
            discountPrice: discVal,
            originalPrice: origVal,
            type: typeStr
          };

          if (oidLow) {
            if (!byOrder.has(oidLow)) byOrder.set(oidLow, []);
            byOrder.get(oidLow).push(entry);
          }
          if (restoLow) {
            if (!byResto.has(restoLow)) byResto.set(restoLow, []);
            byResto.get(restoLow).push(entry);
          }
          totalLines++;
        }
        window.koolOrderItemsByOrderId = byOrder;
        window.koolOrderItemsByResto = byResto;
        window.koolOrderItemsRawCount = totalLines;
        window.koolOrderItemsMinDate = minDateIso;
        window.koolOrderItemsMaxDate = maxDateIso;
        if (typeof _koolRulesIndex !== 'undefined') _koolRulesIndex.evalCache.clear();
        return totalLines;
      }

      (function restoreKoolOrderItemsFromStore() {
        try {
          var rawItems = safeGet('kool_vf_order_items_v1');
          if (rawItems) {
            var parsed = JSON.parse(rawItems);
            if (Array.isArray(parsed) && parsed.length > 1) {
              indexKoolOrderItemsRows(parsed);
            }
          }
        } catch (e) {}
      })();

      var brandArchives = {
        yassir: {
          rawSourceRows: [],
          storedFilesMeta: [],
          prevSourceRows: [],
          marketRows: [],
          foodRows: [],
          offresRows: [],
          statRows: [],
          customCommissions: null,
          amPortfolios: null,
          offreParticipationRules: null,
          budgetByAm: {},
          dateStart: '',
          dateEnd: '',
          minAvailableDate: '',
          maxAvailableDate: '',
          initialized: false
        },
        kool: {
          rawSourceRows: [],
          storedFilesMeta: [],
          prevSourceRows: [],
          marketRows: [],
          foodRows: [],
          offresRows: [],
          statRows: [],
          customCommissions: null,
          amPortfolios: null,
          offreParticipationRules: null,
          bogofRules: null,
          budgetByAm: {},
          dateStart: '',
          dateEnd: '',
          minAvailableDate: '',
          maxAvailableDate: '',
          initialized: false,
          syncedFromSheet: false
        }
      };

      function loadKoolStoredPortfolios() {
        var raw = safeGet('kool_vf_am_portfolios_v1');
        if (raw) {
          try {
            var p = JSON.parse(raw);
            if (p && typeof p === 'object' && Object.keys(p).length > 0) return p;
          } catch (e) {}
        }
        return {};
      }

      function loadKoolStoredOffreParticipation() {
        var raw = safeGet('kool_vf_offre_participation_v1');
        if (raw) {
          try {
            var p = JSON.parse(raw);
            if (Array.isArray(p) && p.length > 0) return p;
          } catch (e) {}
        }
        return [];
      }

      // Règles Bogof Kool (onglet « Bogof » du classeur unique) : même clé de
      // stockage que les règles « Offre Participation », en parallèle.
      function loadKoolStoredBogof() {
        var raw = safeGet('kool_vf_bogof_v1');
        if (raw) {
          try {
            var p = JSON.parse(raw);
            if (Array.isArray(p) && p.length > 0) return p;
          } catch (e) {}
        }
        return [];
      }

      function loadKoolStoredCommissions() {
        var raw = safeGet('kool_vf_commissions_v1');
        if (raw) {
          try {
            var p = JSON.parse(raw);
            if (p && typeof p === 'object' && Object.keys(p).length > 0) return p;
          } catch (e) {}
        }
        return {};
      }

      // Budgets Kool (onglet Budget du classeur fusionné, lignes APP = Kool) :
      // clé de stockage séparée, parallèle à STORAGE_KEYS.BUDGET (Yassir).
      var KOOL_BUDGET_STORAGE_KEY = 'kool_vf_budget_v1';
      function loadKoolStoredBudget() {
        var raw = safeGet(KOOL_BUDGET_STORAGE_KEY);
        if (raw) {
          try {
            var p = JSON.parse(raw);
            if (p && typeof p === 'object') return p;
          } catch (e) {}
        }
        return { byAm: {}, global: 0 };
      }
      function saveKoolBudgetToStore(byAm) {
        var map = byAm || {};
        var sum = Object.values(map).reduce(function (a, v) { return a + (Number(v) || 0); }, 0);
        safeSet(KOOL_BUDGET_STORAGE_KEY, JSON.stringify({ byAm: map, global: sum }));
      }

      function saveCurrentStateToBrandCache(brandKey) {
        var b = brandArchives[brandKey];
        if (!b) return;
        b.rawSourceRows = state.rawSourceRows || [];
        b.storedFilesMeta = state.storedFilesMeta || [];
        b.prevSourceRows = state.prevSourceRows || [];
        b.marketRows = state.marketRows || [];
        b.foodRows = state.foodRows || [];
        b.offresRows = state.offresRows || [];
        b.statRows = state.statRows || [];
        b.customCommissions = state.customCommissions || {};
        b.amPortfolios = state.amPortfolios || {};
        b.offreParticipationRules = state.offreParticipationRules || [];
        b.budgetByAm = state.budgetByAm || {};
        b.dateStart = state.dateStart || '';
        b.dateEnd = state.dateEnd || '';
        b.minAvailableDate = state.minAvailableDate || '';
        b.maxAvailableDate = state.maxAvailableDate || '';
        b.initialized = true;
      }

      function restoreBrandCacheToState(brandKey) {
        var b = brandArchives[brandKey];
        if (!b) return;
        state.rawSourceRows = b.rawSourceRows || [];
        state.storedFilesMeta = b.storedFilesMeta || [];
        state.prevSourceRows = b.prevSourceRows || [];
        state.marketRows = b.marketRows || [];
        state.foodRows = b.foodRows || [];
        state.offresRows = b.offresRows || [];
        state.statRows = b.statRows || [];
        if (b.customCommissions && Object.keys(b.customCommissions).length > 0) {
          state.customCommissions = b.customCommissions;
        } else if (brandKey === 'kool') {
          state.customCommissions = loadKoolStoredCommissions();
        } else {
          state.customCommissions = loadInitialCommissions();
        }
        if (b.amPortfolios && Object.keys(b.amPortfolios).length > 0) {
          state.amPortfolios = b.amPortfolios;
        } else if (brandKey === 'kool') {
          state.amPortfolios = loadKoolStoredPortfolios();
        } else {
          state.amPortfolios = loadInitialPortfolios();
        }
        if (b.offreParticipationRules && b.offreParticipationRules.length > 0) {
          state.offreParticipationRules = b.offreParticipationRules;
          state.offreRulesSource = 'feuille';
        } else if (brandKey === 'kool') {
          state.offreParticipationRules = loadKoolStoredOffreParticipation();
          if (state.offreParticipationRules.length === 0) {
            state.offreParticipationRules = getDefaultOffreParticipationRules();
            state.offreRulesSource = 'secours';
          } else {
            state.offreRulesSource = 'feuille';
          }
        } else {
          try {
            var rY = safeGet(STORAGE_KEYS.OFFRE_PARTICIPATION);
            state.offreParticipationRules = rY ? JSON.parse(rY) : getDefaultOffreParticipationRules();
            state.offreRulesSource = (rY && state.offreParticipationRules.length > 0) ? 'feuille' : 'secours';
          } catch (e) {
            state.offreParticipationRules = getDefaultOffreParticipationRules();
            state.offreRulesSource = 'secours';
          }
        }
        // Règles Bogof Kool : archive de marque, sinon localStorage.
        if (brandKey === 'kool') {
          state.bogofRules = (b.bogofRules && b.bogofRules.length > 0) ? b.bogofRules : loadKoolStoredBogof();
        } else {
          state.bogofRules = [];
        }
        // Budgets par marque : la carte de la marque active (Kool = lignes APP Kool
        // de l'onglet Budget, Yassir = lignes APP Yassir / sans APP).
        if (b.budgetByAm && Object.keys(b.budgetByAm).length > 0) {
          state.budgetByAm = b.budgetByAm;
        } else if (brandKey === 'kool') {
          state.budgetByAm = loadKoolStoredBudget().byAm || {};
        } else {
          state.budgetByAm = loadInitialBudget().byAm || {};
        }
        // Budget global de la marque active = somme de ses budgets par AM (scope
        // « Global » des alertes budget et de la carte « Reste Budget »).
        state.budgetGlobal = Object.values(state.budgetByAm).reduce(function (a, v) { return a + (Number(v) || 0); }, 0);
        state.dateStart = b.dateStart || '';
        state.dateEnd = b.dateEnd || '';
        state.minAvailableDate = b.minAvailableDate || '';
        state.maxAvailableDate = b.maxAvailableDate || '';
        state.currentPage = 1;
      }

      // Lecture seule du cache de marque (diagnostic / tests) : dates
      // mémorisées pour une marque, sans toucher à l'état courant.
      window.yassirGetDatesCacheMarque = function (brandKey) {
        var b = brandArchives[brandKey === 'kool' ? 'kool' : 'yassir'];
        if (!b) return { dateStart: '', dateEnd: '' };
        return { dateStart: b.dateStart || '', dateEnd: b.dateEnd || '' };
      };

      function applyBrandVisualTheme(brandKey) {
        var isKool = brandKey === 'kool';
        if (isKool) {
          document.body.classList.add('brand-kool');
          document.title = 'Kool Pulse — Pilotage Opérations & Portefeuilles';
          var favElK = document.getElementById('appFavicon');
          if (favElK) favElK.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23FFD100' stroke='%23111111' stroke-width='3'/%3E%3Ctext x='32' y='45' font-family='Arial,sans-serif' font-weight='900' font-size='38' text-anchor='middle' fill='%23111111'%3EK%3C/text%3E%3C/svg%3E";
        } else {
          document.body.classList.remove('brand-kool');
          document.title = 'Yassir Pulse — Pilotage Opérations & Portefeuilles';
          var favElY = document.getElementById('appFavicon');
          if (favElY) favElY.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%236C2BD9'/%3E%3Cpath d='M38 12h12L32 37l-7-9 13-16z' fill='%23fff'/%3E%3Cpath d='M14 12h12l11 16c1.6 2.2 1.6 5.2 0 7.4L25 52H13l12-17c.8-1.1.8-2.6 0-3.7L14 12z' fill='%23FF2A6D'/%3E%3C/svg%3E";
        }

        var lBtnY = document.getElementById('loginBrandBtnYassir');
        var lBtnK = document.getElementById('loginBrandBtnKool');
        var lLogoY = document.getElementById('loginLogoContainerYassir');
        var lLogoK = document.getElementById('loginLogoContainerKool');
        var lBadge = document.getElementById('loginBrandPulseBadge');
        if (lBtnY && lBtnK) {
          if (isKool) {
            lBtnY.className = 'flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-extrabold text-xs bg-white text-slate-600 border border-slate-200 transition cursor-pointer';
            lBtnK.className = 'flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-extrabold text-xs bg-[#FFD100] text-[#111111] ring-2 ring-[#111111] shadow-sm transition cursor-pointer';
          } else {
            lBtnY.className = 'flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-extrabold text-xs bg-[#6C2BD9] text-white shadow-sm transition cursor-pointer';
            lBtnK.className = 'flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-extrabold text-xs bg-white text-[#111111] hover:bg-[#FEF9C3] border border-transparent transition cursor-pointer';
          }
        }
        if (lLogoY) lLogoY.classList.toggle('hidden', isKool);
        if (lLogoK) lLogoK.classList.toggle('hidden', !isKool);
        if (lBadge) lBadge.textContent = isKool ? 'Kool Pulse • Opérations' : 'Yassir Pulse • Opérations';

        var sBtnY = document.getElementById('sidebarLogoBtnYassir');
        var sBtnK = document.getElementById('sidebarLogoBtnKool');
        if (sBtnY && sBtnK) {
          if (isKool) {
            sBtnY.className = 'p-1.5 rounded-xl bg-white/10 opacity-60 hover:opacity-100 transition cursor-pointer flex items-center justify-center';
            sBtnK.className = 'p-1 rounded-xl bg-[#FFD100] ring-2 ring-white shadow-md transition cursor-pointer flex items-center justify-center';
          } else {
            sBtnY.className = 'p-1.5 rounded-xl bg-white/15 ring-2 ring-white transition cursor-pointer flex items-center justify-center';
            sBtnK.className = 'p-1 rounded-xl bg-[#FFD100] opacity-80 hover:opacity-100 transition cursor-pointer flex items-center justify-center shadow-sm';
          }
        }

        var tBtnY = document.getElementById('topBrandBtnYassir');
        var tBtnK = document.getElementById('topBrandBtnKool');
        var hTitle = document.getElementById('headerBrandAppTitle');
        var hVer = document.getElementById('headerBrandVersionBadge');
        if (tBtnY && tBtnK) {
          if (isKool) {
            tBtnY.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-[#6C2BD9]/75 text-white opacity-75 hover:opacity-100 transition cursor-pointer';
            tBtnK.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-[#FFD100] text-[#111111] ring-2 ring-[#111111] shadow-xs transition cursor-pointer';
          } else {
            tBtnY.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-[#6C2BD9] text-white ring-2 ring-[#FF2A6D] shadow-xs transition cursor-pointer';
            tBtnK.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#FFD100] text-[#111111] border border-[#111111]/20 opacity-80 hover:opacity-100 transition cursor-pointer';
          }
        }
        if (hTitle) hTitle.textContent = isKool ? 'Kool Pulse' : 'Yassir Pulse';
        if (hVer) hVer.textContent = isKool ? 'Kool Edition' : 'v2.0';
        var netBadge = document.getElementById('kpiNetBrandBadge');
        if (netBadge) netBadge.textContent = isKool ? 'Net Kool' : 'Net Yassir';
        var footPulse = document.getElementById('footerBrandPulseName');
        if (footPulse) footPulse.textContent = isKool ? 'Kool Pulse' : 'Yassir Pulse';

        // Masquer ou afficher l'option Eya Majdoub dans les sélecteurs d'AM selon la marque
        ['selectAmAgent', 'selectImportTargetAm', 'editRestoAm'].forEach(function (selId) {
          var sel = document.getElementById(selId);
          if (!sel) return;
          for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === 'Eya Majdoub') {
              sel.options[i].hidden = isKool;
              sel.options[i].disabled = isKool;
            }
          }
        });

        var zeroStSel = document.getElementById('zeroOrdersStatusFilterSelect');
        if (zeroStSel) {
          zeroStSel.classList.toggle('hidden', isKool);
          if (isKool) zeroStSel.value = 'ALL';
        }

        // Onglet « Clients Kool » (Nouveaux vs Retours vs Réactivés) : Kool uniquement.
        var koolCliBtn = document.getElementById('tabBtnKoolClients');
        if (koolCliBtn) koolCliBtn.classList.toggle('hidden', !isKool);
        if (!isKool && state.activeTab === 'kool_clients') state.activeTab = 'synth_global';

        var mainFileSub = document.getElementById('mainFileSub');
        var totalRowsInBase = Math.max(0, (state.rawSourceRows ? state.rawSourceRows.length - 1 : 0));
        var nbFiles = state.storedFilesMeta ? state.storedFilesMeta.length : 0;
        if (totalRowsInBase > 0) {
          document.getElementById('mainFileName').textContent = nbFiles + ' source(s) • ' + totalRowsInBase.toLocaleString('fr-FR') + ' commandes (' + (isKool ? 'Kool' : 'Yassir') + ')';
          if (mainFileSub) {
            mainFileSub.textContent = state.minAvailableDate && state.maxAvailableDate
              ? ('Période globale : ' + state.minAvailableDate + ' → ' + state.maxAvailableDate)
              : (isKool ? 'Base Kool synchronisée' : 'Base Yassir synchronisée');
          }
          document.getElementById('badgeSourceStatus').textContent = nbFiles + ' source(s)';
          document.getElementById('badgeSourceStatus').className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#E0F7F4] text-[#00897B]';
        } else {
          document.getElementById('mainFileName').textContent = isKool
            ? 'Données Kool (Data Octobre & Novembre) ou importer fichier'
            : 'Ajouter 1 ou plusieurs fichiers Data exp (cumul auto)';
          if (mainFileSub) {
            mainFileSub.textContent = isKool
              ? 'Source Google Sheets Kool • Feuilles Data Octobre, Novembre & Commission'
              : 'Unlimited Data • Filtre strict Order ID commençant par YAF-';
          }
          document.getElementById('badgeSourceStatus').textContent = 'En attente';
          document.getElementById('badgeSourceStatus').className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600';
        }
      }

      function filterOutMarketRowsForKool(rows) {
        if (!rows || rows.length < 2) return rows || [];
        var hdr = rows[0].map(function (h) { return normalizeText(h); });
        var idxSrv = hdr.indexOf('services');
        var idxRest = hdr.findIndex(function (h) { return h.includes('restaurant'); });
        var out = [rows[0]];
        for (var r = 1; r < rows.length; r++) {
          var row = rows[r];
          if (!row) continue;
          var srv = idxSrv !== -1 ? String(row[idxSrv] || '').toLowerCase() : '';
          var rName = idxRest !== -1 ? String(row[idxRest] || '').toLowerCase() : '';
          if (srv.includes('market') || rName.includes('mg market') || rName.includes('market')) continue;
          out.push(row);
        }
        return out;
      }


      // Classification exacte des raisons d'annulation "Restaurant Rejected"
      var _rejReasonCache = new Map();
      function isRestaurantRejectedReason(reasonText) {
        if (!reasonText) return false;
        var rawKey = String(reasonText);
        if (_rejReasonCache.has(rawKey)) return _rejReasonCache.get(rawKey);
        var rNorm = normalizeText(rawKey);
        var matched = false;
        if (rNorm) {
          var exactKeywords = [
            'probleme de prix',
            'pblm de prix',
            'article manquant',
            'probleme sunmi',
            'pblm sunmi',
            'sunmi',
            'probleme resto',
            'pblm resto',
            'resto ferme',
            'restaurant ferme',
            'article indispo',
            'article indisponible',
            "retard d'acceptation",
            'retard acceptation',
            'retard d acceptation',
            'surcharge',
            'restaur',
            'rejet',
            'rupture',
            'ferm',
            'indispon',
            'refus'
          ];
          for (var i = 0; i < exactKeywords.length; i++) {
            if (rNorm.indexOf(exactKeywords[i]) !== -1) { matched = true; break; }
          }
        }
        if (_rejReasonCache.size > 20000) _rejReasonCache.clear();
        _rejReasonCache.set(rawKey, matched);
        return matched;
      }

      // Normaliseur exact des colonnes Data Kool (A=Annulé oui/non, C=Raison annulation, D=Date, E=N° commande, G=Restaurant, J=Montant HT livraison, K=Frais livraison (<5 DT => à payer réduit), L=Remise, GMV = J + L)
      function normaliserLignesDataKool(rawRows) {
        if (!rawRows || rawRows.length < 2) return rawRows || [];

        // Trouver la ligne d'en-tête réelle (parmi les 5 premières lignes non vides)
        var headerRowIdx = 0;
        for (var sr = 0; sr < Math.min(5, rawRows.length); sr++) {
          var nonEmpty = (rawRows[sr] || []).filter(function (c) { return String(c || '').trim() !== ''; }).length;
          if (nonEmpty >= 4) { headerRowIdx = sr; break; }
        }

        var rawHeaders = (rawRows[headerRowIdx] || []).map(function (h) {
          return String(h !== null && h !== undefined ? h : '').trim();
        });
        var normHeaders = rawHeaders.map(function (h) {
          return normalizeText(h).replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
        });

        // Si le fichier est déjà au format standard 109 colonnes (ex: fichier déjà exporté)
        var hasStandardCols = normHeaders.indexOf('order id') !== -1 &&
                              normHeaders.indexOf('restaurant name') !== -1 &&
                              normHeaders.indexOf('order day') !== -1 &&
                              normHeaders.indexOf('total food vf') !== -1;
        if (hasStandardCols) {
          return rawRows.slice(headerRowIdx);
        }

        // Indices fixes selon votre structure exacte Data Kool :
        // A = 0 (si "oui" => annulé, sinon => Delivered)
        // C = 2 (Raison d'annulation)
        // D = 3 (Date)
        // E = 4 (N° commande)
        // F = 5 (ID Client)
        // G = 6 (Restaurant)
        // J = 9 (Montant Hors Frais De Livraison)
        // K = 10 (Frais De Livraison : si < 5 DT => calculé en tant que à payer réduit = 5 - K)
        // L = 11 (Remise)
        // AG = 32 (New Client : 1 = nouveau client, 0 = ancien client)
        // GMV = J + L
        // AB = 27 (Polygone Client : zone de livraison du client, ex. Menzah, Marsa)
        var COL_A_ANNULE = 0;
        var COL_C_RAISON = 2;
        var COL_D_DATE = 3;
        var COL_E_NUM_CMD = 4;
        var COL_G_RESTO = 6;
        var COL_J_MONTANT_HORS_LIV = 9;
        var COL_K_FRAIS_LIV = 10;
        var COL_L_REMISE = 11;
        // « ID Client », « New Client » et « Polygone Client » : résolus par nom
        // d'en-tête, repli sur l'indice fixe (F = 5, AG = 32, AB = 27) si l'en-tête
        // est introuvable.
        var COL_F_ID_CLIENT = normHeaders.indexOf('id client') !== -1 ? normHeaders.indexOf('id client') : 5;
        var COL_AG_NEW_CLIENT = normHeaders.indexOf('new client') !== -1 ? normHeaders.indexOf('new client') : 32;
        var COL_AB_POLYGONE = normHeaders.indexOf('polygone client') !== -1 ? normHeaders.indexOf('polygone client') : 27;

        var mappedAoa = [TARGET_HEADERS.slice()];
        var idxMap = {};
        TARGET_HEADERS.forEach(function (h, idx) { idxMap[h] = idx; });

        for (var r = headerRowIdx + 1; r < rawRows.length; r++) {
          var sRow = rawRows[r];
          if (!sRow || sRow.every(function (v) { return v === null || v === undefined || String(v).trim() === ''; })) continue;

          // Ignorer les lignes de totaux
          var firstNonEmpty = '';
          for (var k = 0; k < sRow.length; k++) {
            if (sRow[k] !== null && sRow[k] !== undefined && String(sRow[k]).trim() !== '') {
              firstNonEmpty = String(sRow[k]).trim().toLowerCase();
              break;
            }
          }
          if (firstNonEmpty === 'total' || firstNonEmpty.indexOf('sous-total') === 0 || firstNonEmpty.indexOf('total ') === 0) continue;

          var outRow = new Array(TARGET_HEADERS.length).fill('');

          // Colonne E (4) : N° commande
          var oidVal = (sRow.length > COL_E_NUM_CMD && sRow[COL_E_NUM_CMD] !== undefined && String(sRow[COL_E_NUM_CMD]).trim() !== '')
            ? String(sRow[COL_E_NUM_CMD]).trim()
            : ('KOOL-' + r);
          if (/^(n[°o]?\s*commande|order[\s_]*id)$/i.test(oidVal)) continue;
          outRow[idxMap['order id']] = oidVal;

          // Colonne D (3) : Date (et heure si incluse dans la cellule)
          var rawDateVal = sRow.length > COL_D_DATE ? sRow[COL_D_DATE] : '';
          outRow[idxMap['order day']] = rawDateVal;
          if (rawDateVal instanceof Date && !isNaN(rawDateVal.getTime())) {
            outRow[idxMap['order time']] = rawDateVal;
          } else if (typeof rawDateVal === 'string' && /\d{1,2}:\d{2}/.test(rawDateVal)) {
            outRow[idxMap['order time']] = rawDateVal;
          }

          // Colonne G (6) : Restaurant
          var rNameVal = (sRow.length > COL_G_RESTO && sRow[COL_G_RESTO] !== undefined)
            ? String(sRow[COL_G_RESTO]).trim()
            : '';
          outRow[idxMap['restaurant name']] = rNameVal;

          // Ville / Area automatique depuis le portefeuille Kool si disponible
          var rKeyLow = rNameVal.toLowerCase();
          if (rKeyLow && state.amPortfolios && state.amPortfolios[rKeyLow] && state.amPortfolios[rKeyLow].ville) {
            outRow[idxMap['city']] = state.amPortfolios[rKeyLow].ville;
            outRow[idxMap['Area']] = state.amPortfolios[rKeyLow].ville;
          }

          // Colonne A (0) : Si "oui" => annulé (Restaurant Rejected / Cancelled), sinon => Delivered
          var colAVal = (sRow.length > COL_A_ANNULE && sRow[COL_A_ANNULE] !== undefined)
            ? normalizeText(String(sRow[COL_A_ANNULE]))
            : '';
          var raisonVal = (sRow.length > COL_C_RAISON && sRow[COL_C_RAISON] !== undefined)
            ? String(sRow[COL_C_RAISON]).trim()
            : '';

          var isAnnule = (colAVal === 'oui' || colAVal === 'yes' || colAVal === '1' || colAVal === 'true' || colAVal === 'vrai');
          if (isAnnule) {
            if (isRestaurantRejectedReason(raisonVal)) {
              outRow[idxMap['status']] = 'Restaurant Rejected';
            } else {
              outRow[idxMap['status']] = 'Cancelled';
            }
          } else {
            outRow[idxMap['status']] = 'Delivered';
          }

          // Colonne C (2) : Raison d'annulation
          outRow[idxMap['cancellation reason']] = raisonVal;
          outRow[idxMap['cancellation reason VF']] = raisonVal;

          // Service Food uniquement (jamais Market pour Kool)
          outRow[idxMap['services']] = 'Food';

          // Colonne J (9) : Montant Hors Frais De Livraison = montant payé (net de remise).
          // Colonne L (11) : Remise accordée. Vérifié sur les données : Montant Total = J + K,
          // donc la remise n'est pas déduite de J : le brut vaut J + L.
          // GMV Brut (item total) = J + L ; GMV After (Total Food VF) = J.
          var montantJ = sRow.length > COL_J_MONTANT_HORS_LIV ? purgerNombre(sRow[COL_J_MONTANT_HORS_LIV]) : 0;
          var remiseL = sRow.length > COL_L_REMISE ? purgerNombre(sRow[COL_L_REMISE]) : 0;

          outRow[idxMap['item total']] = montantJ + remiseL;
          outRow[idxMap['item total.1']] = montantJ + remiseL;
          outRow[idxMap['Total Food']] = montantJ;
          outRow[idxMap['Total Food.1']] = montantJ + remiseL;
          outRow[idxMap['Total Food VF']] = montantJ;
          outRow[idxMap['Discount Amount']] = remiseL;

          // Colonne K (10) : Frais De Livraison
          // Si K < 5 DT => calculé en tant que à payer réduit (différence 5 - K, et original delivery amount = 5, delivery amount = K)
          var fraisLivK = sRow.length > COL_K_FRAIS_LIV ? purgerNombre(sRow[COL_K_FRAIS_LIV]) : 0;
          if (fraisLivK < 5) {
            var aPayerRedK = Number((5 - fraisLivK).toFixed(3));
            outRow[idxMap['original delivery amount']] = 5;
            outRow[idxMap['delivery amount']] = fraisLivK;
            outRow[idxMap['à payer réduits']] = aPayerRedK;
          } else {
            outRow[idxMap['original delivery amount']] = fraisLivK;
            outRow[idxMap['delivery amount']] = fraisLivK;
            outRow[idxMap['à payer réduits']] = 0;
          }

          // Colonne F (5) : ID Client — identifiant du client (Nouveaux / Retours / Réactivés).
          var idClientVal = (sRow.length > COL_F_ID_CLIENT && sRow[COL_F_ID_CLIENT] !== undefined && sRow[COL_F_ID_CLIENT] !== null)
            ? String(sRow[COL_F_ID_CLIENT]).trim()
            : '';
          outRow[idxMap['customer id']] = idClientVal;

          // Colonne AG (32) : New Client (1 = nouveau client, 0 = ancien client).
          var newClientRaw = sRow.length > COL_AG_NEW_CLIENT ? sRow[COL_AG_NEW_CLIENT] : '';
          var newClientTxt = normalizeText(String(newClientRaw === null || newClientRaw === undefined ? '' : newClientRaw));
          var newClientVal = (newClientTxt === '1' || newClientTxt === 'oui' || newClientTxt === 'yes' || newClientTxt === 'true' || newClientTxt === 'vrai')
            ? 1
            : ((newClientTxt === '0' || newClientTxt === 'non' || newClientTxt === 'no' || newClientTxt === 'false' || newClientTxt === 'faux') ? 0 : '');
          outRow[idxMap['new client']] = newClientVal;

          // Colonne AB (27) : Polygone Client — zone de livraison du client
          // (ex. Menzah, Marsa). Chaîne nettoyée, vide si absente.
          var polygoneVal = (sRow.length > COL_AB_POLYGONE && sRow[COL_AB_POLYGONE] !== undefined && sRow[COL_AB_POLYGONE] !== null)
            ? String(sRow[COL_AB_POLYGONE]).trim()
            : '';
          outRow[idxMap['polygone client']] = polygoneVal;

          mappedAoa.push(outRow);
        }

        return mappedAoa;
      }

      window.yassirSyncKoolSheets = function (manualTrigger) {
        // Synchro Kool manuelle réservée au Propriétaire Admin (le bouton est
        // masqué pour les autres comptes). La synchro automatique en arrière-plan
        // (manualTrigger=false) reste ouverte à tous pour afficher les données.
        if (manualTrigger && !isOwnerAdmin()) {
          showToast('La synchronisation Kool est réservée au Propriétaire Admin.', 'error');
          return;
        }
        // Correctif 2026-11-28 (Data Kool effacée, « Kool OK (0 cmd) ») : une
        // synchro auto (au chargement / bascule de marque) + un clic manuel
        // faisaient tourner DEUX synchros en parallèle et dépassaient le quota
        // Google (60 lectures/min) → 429 → sources vides. On refuse la 2e.
        if (window.yassirSyncKoolEnCours) {
          showToast('Synchronisation Kool déjà en cours…', 'info');
          return;
        }
        window.yassirSyncKoolEnCours = true;
        var icon = document.getElementById('iconSyncKoolSheets');
        var label = document.getElementById('labelSyncKoolSheets');
        if (icon) icon.classList.add('fa-spin');
        if (label) label.textContent = 'Sync Kool...';

        if (manualTrigger) {
          showToast('Synchronisation complète <strong>Kool</strong> (Data Octobre & Novembre, Commissions, Portefeuilles & Offre Participation)...', 'info');
        }

        // Lectures via le Worker (G3 suite) : chaque source est lue par
        // /api/sheets/:source, déjà filtrée par marque et par rôle/AM, tous
        // onglets fusionnés et dédupliqués côté serveur. fresh=1 seulement
        // pour la synchro manuelle du proprio (la synchro automatique ne
        // passe jamais fresh=1).
        var freshKool = !!(manualTrigger && isOwnerAdmin());

        // 1. Data Kool (tous les onglets, fusionnés côté Worker).
        // Synchro auto : source déjà synchronisée il y a moins de 30 min —
        // on la saute (l'archive IndexedDB fait foi), sans la compter en échec.
        // (Correctif 2026-11-28 : on mémorise le saut pour ne pas confondre
        // « sautée par récence » et « en échec » dans le statut final.)
        var dataSkippedByRecency = (!manualTrigger && window.yassirSliceSyncRecente && window.yassirSliceSyncRecente('data-kool', 'kool'));
        var pData = dataSkippedByRecency
          ? Promise.resolve([])
          : yassirLireFeuilleViaApi('data-kool', { brand: 'kool', fresh: freshKool })
            .catch(function () { return []; });

        // 2. Commission Kool (onglet « Commissions », filtre APP = Kool).
        var pComm = yassirLireFeuilleViaApi('commissions', { brand: 'kool', fresh: freshKool })
          .catch(function () { return []; });

        // 3. Portefeuille Kool (un onglet par AM, filtre APP = Kool ; sans Eya).
        var pPortfolios = yassirLireFeuilleViaApi('portfolios', { brand: 'kool', fresh: freshKool })
          .then(function (rows) {
            var tmpMap = {};
            extraireRestaurantsDepuisLignesSheet(rows, '', tmpMap, 'Kool');
            Object.keys(tmpMap).forEach(function (k) {
              if (tmpMap[k].am === 'Eya Majdoub') delete tmpMap[k];
            });
            return tmpMap;
          })
          .catch(function () { return {}; });

        // 4. Offre participation Kool (onglet « Offre Participation »).
        var pOffrePart = yassirLireFeuilleViaApi('offres', { brand: 'kool', fresh: freshKool })
          .catch(function () { return []; });

        // 4b. Bogof Kool (onglet « Bogof » du classeur unique).
        var pBogof = yassirLireFeuilleViaApi('bogof', { brand: 'kool', fresh: freshKool })
          .catch(function () { return []; });

        // 5. Détails des commandes Kool (Articles, Catégories, Quantités, Prix).
        var pOrderItems = (!manualTrigger && window.yassirSliceSyncRecente && window.yassirSliceSyncRecente('details-kool', 'kool'))
          ? Promise.resolve([])
          : yassirLireFeuilleViaApi('details-kool', { brand: 'kool', fresh: freshKool })
            .catch(function () { return []; });

        // 6. Données 2025 Kool (onglet « 2025 Kool » du classeur fusionné, gid=14) :
        // lues en parallèle et stockées par marque (state.historical2025RowsKool).
        var pHist2025Kool = Promise.resolve().then(function () {
          if (typeof window.yassirSync2025KoolSheet !== 'function') return 0;
          return window.yassirSync2025KoolSheet(false);
        }).catch(function () { return 0; });

        return Promise.all([pData, pComm, pPortfolios, pOffrePart, pBogof, pOrderItems, pHist2025Kool]).then(function (results) {
          if (icon) icon.classList.remove('fa-spin');

          var rawDataRows = results[0];
          var commRows = results[1];
          var koolPortfoliosMap = results[2] || {};
          var offrePartRows = results[3];
          var bogofRows = results[4];
          var orderItemsRows = results[5];
          var hist2025KoolCount = results[6] || 0;

          var orderItemsCount = 0;
          if (orderItemsRows && orderItemsRows.length > 1) {
            var lightOrderItemsRows = filtrerLignesArticlesKoolSansExtraZero(orderItemsRows);
            orderItemsCount = indexKoolOrderItemsRows(lightOrderItemsRows);
            try { safeSet('kool_vf_order_items_v1', JSON.stringify(lightOrderItemsRows)); } catch (e) {}
          }

          // A. Commissions Kool (filtre colonne APP = Kool)
          var parsedKoolComm = parseCommissionRows(commRows, 'Kool');
          var koolCommMap = parsedKoolComm.map;
          var commCount = parsedKoolComm.count;
          if (commCount > 0) {
            safeSet('kool_vf_commissions_v1', JSON.stringify(koolCommMap));
            brandArchives.kool.customCommissions = Object.assign({}, koolCommMap);
          }

          // B. Portefeuilles Kool (sans Eya Majdoub)
          var portCount = Object.keys(koolPortfoliosMap).length;
          if (portCount > 0) {
            safeSet('kool_vf_am_portfolios_v1', JSON.stringify(koolPortfoliosMap));
            brandArchives.kool.amPortfolios = Object.assign({}, koolPortfoliosMap);
          }

          // C. Offre Participation Kool
          var koolOffreRules = (offrePartRows && offrePartRows.length > 1) ? parseOffreParticipationRows(offrePartRows, 'Kool') : [];
          if (koolOffreRules.length > 0) {
            safeSet('kool_vf_offre_participation_v1', JSON.stringify(koolOffreRules));
            brandArchives.kool.offreParticipationRules = koolOffreRules.slice();
          }

          // C2. Bogof Kool (onglet « Bogof ») : participation telle quelle
          // (« Participation 2ème article », DT) ; la date vient de la ligne détail.
          var koolBogofRules = (bogofRows && bogofRows.length > 1 && typeof parseBogofRows === 'function') ? parseBogofRows(bogofRows) : [];
          if (koolBogofRules.length > 0) {
            safeSet('kool_vf_bogof_v1', JSON.stringify(koolBogofRules));
            brandArchives.kool.bogofRules = koolBogofRules.slice();
          }

          // D. Data Kool (onglet unique Octobre & Novembre, colonnes adaptées dynamiquement)
          var wasBrand = currentBrand;
          if (wasBrand !== 'kool') {
            saveCurrentStateToBrandCache(wasBrand);
            currentBrand = 'kool';
            restoreBrandCacheToState('kool');
          } else {
            if (commCount > 0) state.customCommissions = Object.assign({}, koolCommMap);
            if (portCount > 0) state.amPortfolios = Object.assign({}, koolPortfoliosMap);
            if (koolOffreRules.length > 0) state.offreParticipationRules = koolOffreRules.slice();
            if (koolBogofRules.length > 0) state.bogofRules = koolBogofRules.slice();
          }

          // Purger toute éventuelle source Yassir de l'archive Kool
          if (state.storedFilesMeta && state.storedFilesMeta.length > 0 && state.rawSourceRows && state.rawSourceRows.length > 1) {
            var hasYassirLeak = state.storedFilesMeta.some(function (m) {
              var nLow = String(m.name || '').toLowerCase();
              return nLow.includes('google sheets') && !nLow.includes('kool');
            });
            if (hasYassirLeak) {
              state.rawSourceRows = [];
              state.storedFilesMeta = [];
            }
          }

          var addedDataCount = 0;
          if (rawDataRows && rawDataRows.length > 1) {
            var normalizedData = filterOutMarketRowsForKool(normaliserLignesDataKool(rawDataRows));
            // Correctif 2026-11-28 (Data Kool effacée) : on ne retire les
            // anciennes lignes Data que si les nouvelles sont non vides.
            // Sinon (normalisation vide), on garde l'ancien cache tel quel.
            if (normalizedData && normalizedData.length > 1) {
            var sheetLabel = 'Data Kool (Octobre & Novembre)';
            var existingIdx = state.storedFilesMeta.findIndex(function (m) { return m.name === sheetLabel; });
            if (existingIdx !== -1 && state.rawSourceRows && state.rawSourceRows.length > 1) {
              var cleaned = [state.rawSourceRows[0]];
              for (var r = 1; r < state.rawSourceRows.length; r++) {
                var row = state.rawSourceRows[r];
                if (row.__fileSourceIdx === existingIdx) continue;
                if (typeof row.__fileSourceIdx === 'number' && row.__fileSourceIdx > existingIdx) {
                  row.__fileSourceIdx = row.__fileSourceIdx - 1;
                }
                cleaned.push(row);
              }
              state.rawSourceRows = cleaned;
              state.storedFilesMeta.splice(existingIdx, 1);
            }
            addedDataCount = fusionnerNouveauFichierDansArchive(sheetLabel, normalizedData);
            if (addedDataCount > 0) {
              detecterBornesDatesSource(state.rawSourceRows);
              saveArchiveToIndexedDb();
              brandArchives.kool.syncedFromSheet = true;
            }
            }
          }
          saveCurrentStateToBrandCache('kool');
          // Les lignes calculées (market/food/offres/stat) datent d'avant cette synchro :
          // on les invalide pour que la prochaine bascule vers Kool recalcule le moteur
          // sur les données fraîches au lieu de réafficher les anciennes.
          brandArchives.kool.marketRows = [];
          brandArchives.kool.foodRows = [];
          brandArchives.kool.offresRows = [];
          brandArchives.kool.statRows = [];

          if (wasBrand !== 'kool') {
            // Synchro en arrière-plan (marque active = Yassir) : la semaine
            // en cache pour Kool est périmée — on l'efface pour ne pas
            // restaurer une vieille semaine à la prochaine bascule. La
            // semaine par défaut sera appliquée à la bascule / synchro active.
            if (!state.semaineChoisieManuellement) {
              brandArchives.kool.dateStart = '';
              brandArchives.kool.dateEnd = '';
            }
            currentBrand = wasBrand;
            restoreBrandCacheToState(wasBrand);
          } else {
            applyBrandVisualTheme('kool');
            if (state.rawSourceRows && state.rawSourceRows.length > 1) {
              reappliquerSemaineParDefautApresSynchro();
              // La semaine appliquée doit être persistée dans le cache de la
              // marque active, sinon une bascule de marque restaure l'ancienne
              // semaine (ou aucune) au lieu de celle qui vient d'être appliquée.
              saveCurrentStateToBrandCache('kool');
              executerTraitementMetier();
            } else {
              mettreAJourInterface();
            }
          }

          // Correctif 2026-11-28 (Data Kool effacée, « Kool OK (0 cmd) ») :
          // le libellé montrait les lignes AJOUTÉES par cette synchro, pas le
          // total présent — « 0 cmd » alors que l'archive a 113 184 lignes est
          // trompeur, et un 0 ne doit jamais compter comme un succès. On
          // affiche le TOTAL présent dans le cache Kool, et on ne dit « OK »
          // que si des données sont réellement là.
          var koolArchiveRows = (brandArchives.kool && brandArchives.kool.rawSourceRows) || [];
          var totalDataRows = (koolArchiveRows.length > 1) ? (koolArchiveRows.length - 1) : 0;
          // Data tentée mais en échec (ni sautée par récence, ni lue) ?
          var dataFailed = !dataSkippedByRecency && !(rawDataRows && rawDataRows.length > 1);

          if (label) {
            label.textContent = (totalDataRows > 0)
              ? ('Kool OK (' + totalDataRows + ' cmd)')
              : 'Sync Kool (Oct, Nov & Comm.)';
          }

          // Échec ou réussite de la synchro Kool : enregistré pour l'alerte
          // « Synchro en échec » (épinglée tant que la synchro ne réussit pas).
          var koolSyncOk = addedDataCount > 0 || commCount > 0 || portCount > 0 || koolOffreRules.length > 0;
          // Une Data tentée mais en échec, sans aucune donnée en cache, n'est
          // PAS un succès : on signale l'échec au lieu d'afficher « OK ».
          if (dataFailed && totalDataRows === 0) koolSyncOk = false;
          noterStatutSynchro('Kool', koolSyncOk);
          if (typeof window.yassirEffacerEchecSynchro === 'function' && typeof window.yassirEnregistrerEchecSynchro === 'function') {
            if (koolSyncOk) window.yassirEffacerEchecSynchro('kool');
            else window.yassirEnregistrerEchecSynchro('kool', 'feuilles illisibles');
          }

          if (manualTrigger) {
            if (koolSyncOk) {
              showToast(
                '<strong>Synchronisation Kool réussie !</strong><br/>' +
                '• Data Oct & Nov : <strong>' + totalDataRows + '</strong> commandes.<br/>' +
                '• Commissions Kool : <strong>' + commCount + '</strong> taux.<br/>' +
                '• Portefeuilles Kool : <strong>' + portCount + '</strong> restos • Offres : <strong>' + koolOffreRules.length + '</strong> règles • Bogof : <strong>' + koolBogofRules.length + '</strong> règles • Détails articles : <strong>' + orderItemsCount + '</strong> lignes.' +
                (hist2025KoolCount > 0 ? '<br/>• Données 2025 Kool : <strong>' + hist2025KoolCount + '</strong> lignes.' : ''),
                'success'
              );
            } else {
              showToast(
                'Impossible de lire les feuilles Kool via le serveur. Réessayez plus tard.',
                'error'
              );
            }
          }
          // Fin de synchro : on libère le drapeau anti-parallèle.
          window.yassirSyncKoolEnCours = false;
        }).catch(function (err) {
          window.yassirSyncKoolEnCours = false;
          try { console.error('[Sync Kool] erreur inattendue :', err); } catch (e) {}
        });
      };

      window.yassirSwitchBrand = function (targetBrand) {
        var nextBrand = (targetBrand === 'kool') ? 'kool' : 'yassir';
        if (nextBrand === currentBrand && brandArchives[nextBrand].initialized) {
          applyBrandVisualTheme(nextBrand);
          return;
        }

        saveCurrentStateToBrandCache(currentBrand);

        currentBrand = nextBrand;
        safeSet('yassir_kool_active_brand_v1', currentBrand);
        if (!currentUser) { applyBrandVisualTheme(currentBrand); return; }
        restoreBrandCacheToState(currentBrand);
        applyBrandVisualTheme(currentBrand);
        state._calcRevision = (state._calcRevision || 0) + 1;
        _amStatsCache.clear();
        _notifCacheSig = '';

        // 1. Affichage immédiat (0 ms) si les données de cette marque sont déjà en mémoire
        if (state.marketRows.length > 0 || state.foodRows.length > 0) {
          mettreAJourBarreDatesEtFichiers();
          mettreAJourInterface();
          return;
        } else if (state.rawSourceRows && state.rawSourceRows.length > 1) {
          executerTraitementMetier();
          saveCurrentStateToBrandCache(currentBrand);
          return;
        } else {
          mettreAJourBarreDatesEtFichiers();
          mettreAJourInterface();
        }

        // 2. Sinon, charger depuis IndexedDB en arrière-plan
        loadArchiveFromIndexedDb(currentBrand).then(function (archive) {
          if (archive && archive.rawSourceRows && archive.rawSourceRows.length > 1 && (!state.rawSourceRows || state.rawSourceRows.length <= 1)) {
            state.rawSourceRows = (currentBrand === 'kool') ? filterOutMarketRowsForKool(archive.rawSourceRows) : archive.rawSourceRows;
            state.storedFilesMeta = Array.isArray(archive.storedFilesMeta) ? archive.storedFilesMeta : [];
            detecterBornesDatesSource(state.rawSourceRows);
            appliquerFiltreSemaineRapideParDefaut();
            executerTraitementMetier();
            saveCurrentStateToBrandCache(currentBrand);
          }

          if (currentBrand === 'kool' && !brandArchives.kool.syncedFromSheet) {
            // Chargement automatique (silencieux) : la synchro manuelle est réservée au propriétaire.
            window.yassirSyncKoolSheets(false);
          }
        });
      };

      // Synchros lancées à la connexion (audit 2026-11-27, item 10b/10c) : UNIQUEMENT
      // la marque active — en mode Yassir, la synchro Kool résolvait immédiatement
      // (gaspillage) ; en mode Kool, les 6 synchros Yassir tournaient pour rien.
      // Le Budget est partagé (filtre APP) : il est synchronisé dans les deux marques.
      // Le pied de page affiche le statut par source (OK / échec) au lieu d'un
      // succès inconditionnel ; une source en échec déclenche aussi un toast.
      window.yassirSyncConnexion = function () {
        var syncsConnexion = (typeof currentBrand !== 'undefined' && currentBrand === 'kool')
          ? [
            { nom: 'Kool', fn: window.yassirSyncKoolSheets },
            { nom: 'Budget', fn: window.yassirSyncBudgetSheet }
          ]
          : [
            { nom: 'Portefeuilles & Comm.', fn: window.yassirSyncAllFromGoogleSheets },
            { nom: 'Octobre & Novembre', fn: window.yassirSyncHistoricalSheets },
            { nom: 'Budget', fn: window.yassirSyncBudgetSheet },
            { nom: 'Statut Active/Inactive', fn: window.yassirSyncRestoStatusSheet },
            { nom: 'Participation Offres', fn: window.yassirSyncOffreParticipationSheet },
            { nom: 'Données 2025 (YoY)', fn: window.yassirSync2025Sheet }
          ];
        return Promise.allSettled(syncsConnexion.map(function (s) {
          try { return Promise.resolve(s.fn(false)); } catch (e) { return Promise.reject(e); }
        })).then(function () {
          var footLbl = document.getElementById('footerLastSyncLabel');
          if (!footLbl) return;
          var statuts = (typeof window.yassirStatutSynchroParSource === 'function') ? window.yassirStatutSynchroParSource() : {};
          var noms = syncsConnexion.map(function (s) { return s.nom; });
          var echecs = noms.filter(function (n) { return !statuts[n]; });
          var okCount = noms.length - echecs.length;
          var nowStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          if (echecs.length === 0) {
            footLbl.textContent = 'Données synchronisées à ' + nowStr + ' (' + okCount + '/' + noms.length + ' sources OK)';
          } else {
            footLbl.textContent = 'Sync partielle à ' + nowStr + ' : ' + okCount + '/' + noms.length + ' OK — en échec : ' + echecs.join(', ');
            showToast('<strong>Synchronisation partielle :</strong> en échec : ' + escapeHtml(echecs.join(', ')) + '. Réessayez plus tard.', 'error');
          }
        });
      };

      var _backgroundLoadStarted = false;
      function startBackgroundDataLoadAfterLogin() {
        if (_backgroundLoadStarted) return;
        _backgroundLoadStarted = true;

        setTimeout(function () {
          // Restauration automatique des fichiers enregistrés dans IndexedDB (cloisonnés par marque Yassir / Kool)
          loadArchiveFromIndexedDb(currentBrand).then(function (archive) {
            if (archive && archive.rawSourceRows && archive.rawSourceRows.length > 1) {
              var _filteredOctNov = (currentBrand === 'kool')
                ? {
                    aoa: filterOutMarketRowsForKool(archive.rawSourceRows),
                    meta: (Array.isArray(archive.storedFilesMeta) ? archive.storedFilesMeta : []).filter(function (m) {
                      return !String(m.name || '').toLowerCase().includes('google sheets') || String(m.name || '').toLowerCase().includes('kool');
                    })
                  }
                : filtrerArchivePeriodeActive(
                    archive.rawSourceRows,
                    Array.isArray(archive.storedFilesMeta) ? archive.storedFilesMeta : []
                  );
              state.rawSourceRows = _filteredOctNov.aoa;
              state.storedFilesMeta = _filteredOctNov.meta;
              if (state.rawSourceRows.length > 1) {
                saveArchiveToIndexedDb();
              } else {
                clearArchiveInIndexedDb();
                return;
              }
              detecterBornesDatesSource(state.rawSourceRows);
              state.dateStart = '';
              state.dateEnd = '';
              updateDatePresetButtonsUI('ALL');

              var totalRowsInBase = Math.max(0, state.rawSourceRows.length - 1);
              var nbFiles = state.storedFilesMeta.length || 1;
              document.getElementById('mainFileName').textContent = nbFiles + ' fichier(s) enregistré(s) • ' + totalRowsInBase.toLocaleString('fr-FR') + ' commandes';
              document.getElementById('mainFileSub').textContent = state.minAvailableDate && state.maxAvailableDate
                ? ('Période globale : ' + state.minAvailableDate + ' → ' + state.maxAvailableDate)
                : 'Base enregistrée restaurée';
              document.getElementById('badgeSourceStatus').textContent = nbFiles + ' fichier(s)';
              document.getElementById('badgeSourceStatus').className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#E0F7F4] text-[#00897B]';
              var badgeIdb = document.getElementById('badgeIndexedDbSaved');
              if (badgeIdb) badgeIdb.classList.remove('hidden');
              if (isOwnerAdmin()) document.getElementById('btnResetAll').classList.remove('hidden');

              executerTraitementMetier();
            }
          }).catch(function () {});

          // Synchronisation en direct avec Google Sheets (marque active seulement).
          window.yassirSyncConnexion();
        }, 80);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
      } else {
        initApp();
      }
