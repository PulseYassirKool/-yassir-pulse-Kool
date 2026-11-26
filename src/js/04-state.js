      /* ========================================================================
         D. ÉTAT GLOBAL DE L'APPLICATION
         ======================================================================== */
      var state = {
        rawSourceRows: [],
        storedFilesMeta: [],
        dateStart: '',
        dateEnd: '',
        timeStart: '09:00',
        timeEndNextDay: '01:00',
        minAvailableDate: '',
        maxAvailableDate: '',
        prevSourceRows: [],
        prevDateStart: '',
        prevDateEnd: '',
        minPrevDate: '',
        maxPrevDate: '',
        customCommissions: {},
        amPortfolios: {},
        budgetByAm: {},
        budgetGlobal: 0,
        growthDropReasons: {},
        restoStatuses: {},
        crmComments: {},
        offreParticipationRules: [],
        offrePartSheetId: '',
        historical2025Rows: [],
        selectedAm: 'ALL',
        marketRows: [],
        foodRows: [],
        offresRows: [],
        statRows: [],
        activeTab: 'market',
        statusFilter: 'all',
        showAllCols: false,
        searchQuery: '',
        currentPage: 1,
        pageSize: 50
      };

      function loadInitialBudget() {
        var raw = safeGet(STORAGE_KEYS.BUDGET);
        if (raw) {
          try {
            var p = JSON.parse(raw);
            if (p && typeof p === 'object') return p;
          } catch (e) {}
        }
        return { byAm: {}, global: 0 };
      }

      function saveBudgetToStore() {
        safeSet(STORAGE_KEYS.BUDGET, JSON.stringify({
          byAm: state.budgetByAm,
          global: state.budgetGlobal
        }));
      }

      function loadInitialReasons() {
        var raw = safeGet(STORAGE_KEYS.REASONS);
        if (raw) {
          try {
            var p = JSON.parse(raw);
            if (p && typeof p === 'object') return p;
          } catch (e) {}
        }
        return {};
      }

      function saveReasonsToStore() {
        safeSet(STORAGE_KEYS.REASONS, JSON.stringify(state.growthDropReasons));
      }

      state.customCommissions = loadInitialCommissions();
      state.amPortfolios = loadInitialPortfolios();
      var _initBudget = loadInitialBudget();
      state.budgetByAm = _initBudget.byAm || {};
      state.budgetGlobal = Number(_initBudget.global || 0);
      state.growthDropReasons = loadInitialReasons();
      state.restoStatuses = (function () {
        try {
          var r = safeGet(STORAGE_KEYS.RESTO_STATUS);
          if (r) { var p = JSON.parse(r); if (p && typeof p === 'object') return p; }
        } catch (e) {}
        return {};
      })();
      state.crmComments = (function () {
        try {
          var r = safeGet(STORAGE_KEYS.CRM_COMMENTS);
          if (r) { var p = JSON.parse(r); if (p && typeof p === 'object') return p; }
        } catch (e) {}
        return {};
      })();
      function saveRestoStatusesToStore() {
        safeSet(STORAGE_KEYS.RESTO_STATUS, JSON.stringify(state.restoStatuses));
      }
      function saveCrmCommentsToStore() {
        safeSet(STORAGE_KEYS.CRM_COMMENTS, JSON.stringify(state.crmComments));
      }

      // Règles pré-chargées depuis la feuille "offre participation" (Black Friday / campagnes)
      var DEFAULT_OFFRE_PARTICIPATION_RULES = [
        { area: 'El Menzah', restaurant: 'route 66 menzah 6', cPct: 100, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Bardo', restaurant: 'route 66 bardo', cPct: 100, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Megrine', restaurant: 'route 66 megrine', cPct: 100, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Ezzahra Boumhal', restaurant: 'route 66 ezzahra', cPct: 100, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'La Marsa', restaurant: 'route 66 jardin de carthage', cPct: 100, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Ezzahra Boumhal', restaurant: 'route 66 ben arous', cPct: 100, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-01', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Mourouj', restaurant: 'tacos chaneb mourouj', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Megrine', restaurant: 'tacos chaneb megrine', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Bardo', restaurant: 'tacos chaneb bardo', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Centre ville', restaurant: 'tacos chaneb central park', cPct: 15, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'El Menzah', restaurant: 'tacos chaneb ennasr', cPct: 15, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'El Menzah', restaurant: 'tacos chaneb ariana', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Les Berges du Lac', restaurant: 'tacos chaneb aouina', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'La Marsa', restaurant: 'tacos chaneb marsa', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Nabeul', restaurant: 'tacos chaneb nabeul', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Ezzahra Boumhal', restaurant: 'tacos chaneb ezzahra', cPct: 20, tag: 'Discount', am: 'Aziza Souli', partPct: 10, startDate: '2026-11-16', endDate: '2026-11-30', periode: 'Black Friday' },
        { area: 'Mourouj', restaurant: 'tacos chaneb mourouj', cPct: 20, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'Megrine', restaurant: 'tacos chaneb megrine', cPct: 20, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'Bardo', restaurant: 'tacos chaneb bardo', cPct: 20, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'Centre ville', restaurant: 'tacos chaneb central park', cPct: 15, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'El Menzah', restaurant: 'tacos chaneb ennasr', cPct: 15, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'El Menzah', restaurant: 'tacos chaneb ariana', cPct: 20, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'Les Berges du Lac', restaurant: 'tacos chaneb aouina', cPct: 20, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'La Marsa', restaurant: 'tacos chaneb marsa', cPct: 20, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' },
        { area: 'Nabeul', restaurant: 'tacos chaneb nabeul', cPct: 20, tag: 'Pack', am: 'Aziza Souli', partPct: 0, startDate: '2026-11-01', endDate: '2026-11-15', periode: 'Black Friday' }
      ];

      state.offreParticipationRules = (function () {
        try {
          var r = safeGet(STORAGE_KEYS.OFFRE_PARTICIPATION);
          if (r) { var p = JSON.parse(r); if (Array.isArray(p) && p.length > 0) return p; }
        } catch (e) {}
        return DEFAULT_OFFRE_PARTICIPATION_RULES.slice();
      })();
      state.offrePartSheetId = safeGet(STORAGE_KEYS.OFFRE_PART_SHEET_ID) || '';

      function saveOffreParticipationToStore() {
        var key = (typeof currentBrand !== 'undefined' && currentBrand === 'kool')
          ? 'kool_vf_offre_participation_v1'
          : STORAGE_KEYS.OFFRE_PARTICIPATION;
        safeSet(key, JSON.stringify(state.offreParticipationRules));
      }

      function parsePercentNumber(val) {
        if (val === null || val === undefined || val === '') return 0;
        if (typeof val === 'number') {
          // Si Excel stocke 10% comme 0.10 (et pas 10)
          if (val > 0 && val < 1) return Number((val * 100).toFixed(4));
          return val;
        }
        var str = String(val).replace(/%/g, '').replace(/,/g, '.').trim();
        var num = parseFloat(str);
        return Number.isFinite(num) ? num : 0;
      }

      function parseOffreParticipationRows(rows) {
        if (!rows || rows.length < 2) return [];
        var headerRowIdx = 0;
        for (var sr = 0; sr < Math.min(5, rows.length); sr++) {
          var hCand = (rows[sr] || []).map(function (c) { return normalizeText(c); });
          if (hCand.some(function (h) { return h.includes('restaurant') || h.includes('partenaire') || h.includes('store') || h.includes('start') || h.includes('debut'); })) {
            headerRowIdx = sr;
            break;
          }
        }
        var headers = (rows[headerRowIdx] || []).map(function (h) { return normalizeText(h); });

        var idxArea = headers.findIndex(function (h) { return h === 'area' || h.includes('ville') || h.includes('zone'); });
        var idxResto = headers.findIndex(function (h) { return h.includes('restaurant') || h.includes('partenaire') || h.includes('store') || h.includes('enseigne') || h.includes('nom'); });
        if (idxResto === -1) idxResto = 1;
        var idxCPct = headers.findIndex(function (h) { return h === 'c %' || h === 'c%' || h.includes('remise') || h.includes('discount %') || h.includes('taux offre'); });
        var idxTag = headers.findIndex(function (h) { return h === 'tag' || h.includes('type') || h.includes('categorie') || h.includes('offre'); });
        var idxAm = headers.findIndex(function (h) { return h.includes('responsable') || h === 'am' || h.includes('account'); });
        var idxPartPct = headers.findIndex(function (h) { return h.includes('participation') || h.includes('part kool') || h.includes('part yassir'); });
        var idxDetails = headers.findIndex(function (h) { return h.includes('detail') || h.includes('libelle') || h.includes('description') || h.includes('condition'); });
        var idxStart = headers.findIndex(function (h) { return h.includes('start') || h.includes('debut') || h.includes('du') || h.includes('date debut'); });
        var idxEnd = headers.findIndex(function (h) { return h.includes('end') || h.includes('fin') || h.includes('au') || h.includes('date fin') || h.includes('expiration'); });
        var idxPeriode = headers.findIndex(function (h) { return h.includes('periode') || h.includes('campagne'); });

        var parsedRules = [];
        for (var r = headerRowIdx + 1; r < rows.length; r++) {
          var row = rows[r];
          if (!row || row.length <= idxResto) continue;
          var rName = String(row[idxResto] || '').trim();
          if (!rName || normalizeText(rName) === 'restaurant' || normalizeText(rName) === 'restaurant name') continue;

          var partPct = (idxPartPct !== -1 && idxPartPct < row.length) ? parsePercentNumber(row[idxPartPct]) : 0;
          var cPct = (idxCPct !== -1 && idxCPct < row.length) ? parsePercentNumber(row[idxCPct]) : 0;
          var tagVal = (idxTag !== -1 && idxTag < row.length) ? String(row[idxTag] || '').trim() : '';
          var areaVal = (idxArea !== -1 && idxArea < row.length) ? String(row[idxArea] || '').trim() : '';
          var amRaw = (idxAm !== -1 && idxAm < row.length) ? String(row[idxAm] || '').trim() : '';
          var amResolved = matchAgentFromText(amRaw) || amRaw;
          var detailsVal = (idxDetails !== -1 && idxDetails < row.length) ? String(row[idxDetails] || '').trim() : '';
          var sDate = (idxStart !== -1 && idxStart < row.length) ? parseOrderDayToIsoDate(row[idxStart]) : '';
          var eDate = (idxEnd !== -1 && idxEnd < row.length) ? parseOrderDayToIsoDate(row[idxEnd]) : '';
          var perVal = (idxPeriode !== -1 && idxPeriode < row.length) ? String(row[idxPeriode] || '').trim() : '';

          // Si Start Date / End Date sont dans une colonne Période sous forme "01/11/2026 - 15/11/2026"
          if ((!sDate || !eDate) && perVal) {
            var rangeMatch = perVal.match(/(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})\s*(?:->|-|au|to)\s*(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})/i);
            if (rangeMatch) {
              if (!sDate) sDate = parseOrderDayToIsoDate(rangeMatch[1]);
              if (!eDate) eDate = parseOrderDayToIsoDate(rangeMatch[2]);
            }
          }

          parsedRules.push({
            area: areaVal,
            restaurant: rName.toLowerCase(),
            restaurantNorm: normalizeText(rName),
            cPct: cPct,
            tag: tagVal,
            am: amResolved,
            partPct: partPct,
            details: detailsVal,
            startDate: sDate,
            endDate: eDate,
            periode: perVal
          });
        }
        return parsedRules;
      }

      window.yassirOnOffrePartFileChange = function (e) {
        if (!isOwnerAdmin()) return;
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = new Uint8Array(ev.target.result);
            var wb = XLSX.read(data, { type: 'array', cellDates: true });
            var sheetName = wb.SheetNames.find(function (n) { return normalizeText(n).includes('participation') || normalizeText(n).includes('offre'); }) || wb.SheetNames[0];
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
            var rules = parseOffreParticipationRows(rows);
            if (rules.length === 0) {
              showToast('Aucune ligne valide trouvée dans le fichier Offre Participation.', 'error');
              return;
            }
            state.offreParticipationRules = rules;
            saveOffreParticipationToStore();
            mettreAJourInterface();
            showToast('<strong>' + rules.length + ' règles</strong> de participation aux offres chargées depuis <strong>' + escapeHtml(file.name) + '</strong>.', 'success');
          } catch (err) {
            showToast('Erreur lecture fichier Offre Participation : ' + escapeHtml(err.message), 'error');
          }
          e.target.value = '';
        };
        reader.readAsArrayBuffer(file);
      };

      window.yassirSaveAndSyncOffrePartUrl = function () {
        if (!isOwnerAdmin()) return;
        var inp = document.getElementById('inputOffrePartSheetUrl');
        var raw = inp ? inp.value.trim() : '';
        if (raw) {
          var m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
          state.offrePartSheetId = m ? m[1] : raw;
          safeSet(STORAGE_KEYS.OFFRE_PART_SHEET_ID, state.offrePartSheetId);
        }
        window.yassirSyncOffreParticipationSheet(true);
      };

      window.yassirSyncOffreParticipationSheet = function (manualTrigger) {
        if (manualTrigger && !isOwnerAdmin() && !canViewAllPortfolios()) return;
        var sheetId = state.offrePartSheetId || LIVE_SHEETS_CONFIG.OFFRE_PARTICIPATION_SHEET_ID;
        var gid = LIVE_SHEETS_CONFIG.OFFRE_PARTICIPATION_GID || '0';
        if (!sheetId) return;
        var icon = document.getElementById('iconSyncOffrePart');
        var label = document.getElementById('labelSyncOffrePart');
        if (icon) icon.classList.add('fa-spin');
        if (label) label.textContent = 'Sync Participation...';

        return fetchGoogleWorkbookXlsx(sheetId)
          .then(function (wb) {
            var sName = wb.SheetNames[0];
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' });
            if (!rows || rows.length < 2) throw new Error('Feuille vide');
            return rows;
          })
          .catch(function () {
            return fetchGoogleSheetByGidSmart(sheetId, gid, 'Feuille 1');
          })
          .then(function (rows) {
            var rules = parseOffreParticipationRows(rows);
            if (rules.length > 0) {
              state.offreParticipationRules = rules;
              saveOffreParticipationToStore();
            }
            if (icon) icon.classList.remove('fa-spin');
            if (label) label.textContent = rules.length > 0 ? ('Participation OK (' + rules.length + ')') : 'Sync Participation Offres';
            mettreAJourInterface();
            if (manualTrigger) {
              showToast('<strong>Offre Participation synchronisée !</strong> (' + rules.length + ' règles chargées).', 'success');
            }
          })
          .catch(function () {
            if (icon) icon.classList.remove('fa-spin');
            if (label) label.textContent = 'Sync Participation Offres';
            if (manualTrigger) {
              showToast('Impossible de synchroniser la feuille Google Sheets (vérifiez le partage public en lecture).', 'error');
            }
          });
      };


      // Indexation rapide O(1) des règles Kool par restaurant + cache d'évaluation
      var _koolRulesIndex = { rulesRef: null, len: 0, map: new Map(), evalCache: new Map() };
      function getKoolRulesByRestoMap() {
        var rules = state.offreParticipationRules || [];
        if (_koolRulesIndex.rulesRef === rules && _koolRulesIndex.len === rules.length) {
          return _koolRulesIndex.map;
        }
        var m = new Map();
        for (var i = 0; i < rules.length; i++) {
          var rl = rules[i];
          if (!rl) continue;
          var r1 = (rl.restaurant || '').trim().toLowerCase();
          var r2 = rl.restaurantNorm || normalizeText(r1);
          if (r1) {
            if (!m.has(r1)) m.set(r1, []);
            m.get(r1).push(rl);
          }
          if (r2 && r2 !== r1) {
            if (!m.has(r2)) m.set(r2, []);
            m.get(r2).push(rl);
          }
        }
        _koolRulesIndex = { rulesRef: rules, len: rules.length, map: m, evalCache: new Map() };
        return m;
      }

      // Helper : vérifie si une règle d'offre Kool est "toute la carte" (non restreinte à un article/pack isolé)
      function estOffreTouteLaCarteKool(rl) {
        if (!rl) return false;
        var combined = normalizeText((rl.tag || '') + ' ' + (rl.details || '') + ' ' + (rl.periode || ''));
        if (!combined) return true;
        if (combined.includes('article') || combined.includes('pack') || combined.includes('menu specifique') || combined.includes('produit') || combined.includes('super promo')) {
          return false;
        }
        if (combined.includes('toute la carte') || combined.includes('tout le menu') || combined.includes('all menu') || combined.includes('discount')) {
          return true;
        }
        return true;
      }

      // Formate le libellé d'une règle d'offre Kool pour l'affichage (ex: "20% sur toute la carte" ou TAG)
      function formaterLibelleOffreKool(rl) {
        if (!rl) return '';
        var pctVal = rl.cPct > 0 ? rl.cPct : rl.partPct;
        var tagStr = String(rl.tag || '').trim();
        var detStr = String(rl.details || '').trim();
        if (detStr) return detStr;
        if (pctVal > 0) {
          return (estOffreTouteLaCarteKool(rl) ? (pctVal + '% sur toute la carte') : (pctVal + '% sur article')) + (tagStr ? ' (' + tagStr + ')' : '');
        }
        return tagStr || 'Offre Restaurant';
      }

      // Calcul de participation d'offre sur les articles d'une commande Kool (détails Sheet 15D9KM6G...)
      function calculerParticipationArticlesCommandeKool(orderId, articleRules) {
        if (!orderId || !window.koolOrderItemsByOrderId) return { costTnd: 0, discountTotalTnd: 0, matchedItemsCount: 0, breakdown: [] };
        var oidKey = String(orderId).trim().toLowerCase();
        var items = window.koolOrderItemsByOrderId.get(oidKey);
        if (!items || items.length === 0) return { costTnd: 0, discountTotalTnd: 0, matchedItemsCount: 0, breakdown: [] };

        var costTnd = 0;
        var discountTotalTnd = 0;
        // Remise totale de toutes les lignes remisées, règle ou non : sert au repli
        // « 100 % plateforme » de la section Participation (commandes sans règle).
        var discountAllTnd = 0;
        var matchedItemsCount = 0;
        var breakdown = [];

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var origLineTotal = (it.originalPrice > 0 ? it.originalPrice : it.unitPrice) * (it.quantity || 1);
          if (origLineTotal <= 0) continue;

          var catNorm = normalizeText(it.category);
          var artNorm = normalizeText(it.article);
          var isDiscountedItem = (it.discountPrice > 0 && it.discountPrice < (it.originalPrice || it.unitPrice)) || catNorm.includes('super promo');
          // Remise réellement accordée sur la ligne : (prix original − prix remisé) × quantité.
          var effUnitPrice = (it.discountPrice > 0 && it.discountPrice < (it.originalPrice || it.unitPrice))
            ? it.discountPrice
            : (it.unitPrice || it.originalPrice || 0);
          var lineDiscountTnd = Math.max(0, (origLineTotal - effUnitPrice * (it.quantity || 1)));
          discountAllTnd += lineDiscountTnd;

          // Chercher une règle article correspondante (par nom d'article/détail, Super Promo, ou règle article générique du restaurant)
          var appliedRule = null;
          for (var j = 0; j < articleRules.length; j++) {
            var rl = articleRules[j];
            var detNorm = normalizeText((rl.details || '') + ' ' + (rl.tag || ''));
            if (detNorm && artNorm && detNorm.includes(artNorm)) {
              appliedRule = rl;
              break;
            }
            if (catNorm.includes('super promo') && (detNorm.includes('super promo') || detNorm.includes('pack') || detNorm.includes('article'))) {
              appliedRule = rl;
              break;
            }
          }
          if (!appliedRule && isDiscountedItem && articleRules.length > 0) {
            appliedRule = articleRules[0];
          }

          if (appliedRule && appliedRule.partPct > 0 && (isDiscountedItem || appliedRule.details)) {
            var linePart = (appliedRule.partPct / 100) * origLineTotal;
            costTnd += linePart;
            discountTotalTnd += lineDiscountTnd;
            matchedItemsCount += (it.quantity || 1);
            breakdown.push({
              article: it.article,
              category: it.category,
              quantity: it.quantity || 1,
              originalTotal: origLineTotal,
              discountTnd: Number(lineDiscountTnd.toFixed(3)),
              partPct: appliedRule.partPct,
              partTnd: Number(linePart.toFixed(3))
            });
          }
        }

        return {
          costTnd: Number(costTnd.toFixed(3)),
          discountTotalTnd: Number(discountTotalTnd.toFixed(3)),
          discountAllTnd: Number(discountAllTnd.toFixed(3)),
          matchedItemsCount: matchedItemsCount,
          breakdown: breakdown
        };
      }

      // Exposé pour la section Participation (repli « 100 % plateforme » en vue
      // « Par article » quand la commande n'a pas de règle article).
      window.yassirCalculerParticipationArticlesKool = calculerParticipationArticlesCommandeKool;

      // Évaluation ultra-rapide des offres & participation Kool (Toute la carte + Offres sur articles)
      function evaluerOffreKoolPourCommande(restoName, orderDayVal, orderIdVal) {
        var rulesMap = getKoolRulesByRestoMap();
        if (rulesMap.size === 0 || !restoName) return null;
        var rawLow = String(restoName).trim().toLowerCase();
        if (!rawLow) return null;

        var orderIso = parseOrderDayToIsoDate(orderDayVal);
        var oidStr = orderIdVal ? String(orderIdVal).trim() : '';
        var cacheKey = rawLow + '|' + orderIso + '|' + oidStr;
        if (_koolRulesIndex.evalCache.has(cacheKey)) {
          return _koolRulesIndex.evalCache.get(cacheKey);
        }

        var candList = rulesMap.get(rawLow) || rulesMap.get(normalizeText(rawLow));
        if (!candList || candList.length === 0) {
          _koolRulesIndex.evalCache.set(cacheKey, null);
          return null;
        }

        var matchedTouteLaCarte = [];
        var matchedArticleRules = [];
        for (var i = 0; i < candList.length; i++) {
          var rl = candList[i];
          if (orderIso) {
            if (rl.startDate && orderIso < rl.startDate) continue;
            if (rl.endDate && orderIso > rl.endDate) continue;
          }
          if (estOffreTouteLaCarteKool(rl)) {
            matchedTouteLaCarte.push(rl);
          } else {
            matchedArticleRules.push(rl);
          }
        }

        var articleEval = (oidStr && matchedArticleRules.length > 0)
          ? calculerParticipationArticlesCommandeKool(oidStr, matchedArticleRules)
          : { costTnd: 0, discountTotalTnd: 0, matchedItemsCount: 0, breakdown: [] };

        if (matchedTouteLaCarte.length === 0 && articleEval.matchedItemsCount === 0) {
          _koolRulesIndex.evalCache.set(cacheKey, null);
          return null;
        }

        var best = matchedTouteLaCarte.length > 0 ? matchedTouteLaCarte[0] : matchedArticleRules[0];
        var searchArr = matchedTouteLaCarte.length > 0 ? matchedTouteLaCarte : matchedArticleRules;
        for (var j = 0; j < searchArr.length; j++) {
          if (searchArr[j].partPct > 0) { best = searchArr[j]; break; }
        }

        var resObj = {
          rule: best,
          allMatched: matchedTouteLaCarte.concat(matchedArticleRules),
          isPromoArticle: articleEval.matchedItemsCount > 0 ? 1 : 0,
          isPromoAdmin: 0,
          isPromoRestaurant: matchedTouteLaCarte.length > 0 ? 1 : 0,
          partPct: matchedTouteLaCarte.length > 0 ? Number(best.partPct || 0) : 0,
          articlePartTnd: articleEval.costTnd,
          articleDiscountTnd: articleEval.discountTotalTnd || 0,
          articleBreakdown: articleEval.breakdown,
          label: formaterLibelleOffreKool(best)
        };
        if (_koolRulesIndex.evalCache.size > 50000) _koolRulesIndex.evalCache.clear();
        _koolRulesIndex.evalCache.set(cacheKey, resObj);
        return resObj;
      }

      function calculerCoutParticipationOffresLivrees(deliveredRecords) {
        if (!deliveredRecords || deliveredRecords.length === 0) return 0;
        var rules = state.offreParticipationRules || [];
        if (rules.length === 0) return 0;

        // Mode Kool : participation Toute la carte (% * GMV) + participation Offres sur articles (% * Prix Original Article)
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          var idxRestoK = TARGET_HEADERS.indexOf('restaurant name');
          var idxOrderDayK = TARGET_HEADERS.indexOf('order day');
          var idxOrderIdK = TARGET_HEADERS.indexOf('order id');
          var idxGmvK = TARGET_HEADERS.indexOf('Total Food VF');
          var idxItemK = TARGET_HEADERS.indexOf('item total');
          var totalPartKool = 0;
          for (var rk = 0; rk < deliveredRecords.length; rk++) {
            var ck = deliveredRecords[rk].cells;
            var evK = evaluerOffreKoolPourCommande(ck[idxRestoK], ck[idxOrderDayK], ck[idxOrderIdK]);
            if (evK) {
              if (evK.partPct > 0) {
                var gmvValK = purgerNombre(ck[idxGmvK]) || purgerNombre(ck[idxItemK]);
                totalPartKool += (evK.partPct / 100) * gmvValK;
              }
              if (evK.articlePartTnd > 0) {
                totalPartKool += evK.articlePartTnd;
              }
            }
          }
          return Number(totalPartKool.toFixed(2));
        }
        if (!deliveredRecords || deliveredRecords.length === 0) return 0;
        var rules = state.offreParticipationRules || [];
        if (rules.length === 0) return 0;

        // Indexer les règles par nom de restaurant normalisé
        var rulesByResto = new Map();
        for (var i = 0; i < rules.length; i++) {
          var rl = rules[i];
          if (!rl.partPct || rl.partPct <= 0) continue;
          var k1 = rl.restaurant;
          var k2 = rl.restaurantNorm || normalizeText(rl.restaurant);
          if (k1) {
            if (!rulesByResto.has(k1)) rulesByResto.set(k1, []);
            rulesByResto.get(k1).push(rl);
          }
          if (k2 && k2 !== k1) {
            if (!rulesByResto.has(k2)) rulesByResto.set(k2, []);
            rulesByResto.get(k2).push(rl);
          }
        }
        if (rulesByResto.size === 0) return 0;

        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxOrderDay = TARGET_HEADERS.indexOf('order day');
        var idxItemTotal = TARGET_HEADERS.indexOf('item total');
        var idxTotalFood = TARGET_HEADERS.indexOf('Total Food');
        var idxDiscAmt = TARGET_HEADERS.indexOf('Discount Amount');
        var idxDiscType = TARGET_HEADERS.indexOf('Discount Type');
        var idxProvider = TARGET_HEADERS.indexOf('Discount Type Provider');
        var idxFoodCat = TARGET_HEADERS.indexOf('Food Category');

        var totalParticipationCostTnd = 0;

        for (var r = 0; r < deliveredRecords.length; r++) {
          var c = deliveredRecords[r].cells;
          var rawResto = String(c[idxResto] || '').trim().toLowerCase();
          if (!rawResto) continue;
          var candidateRules = rulesByResto.get(rawResto) || rulesByResto.get(normalizeText(rawResto));
          if (!candidateRules || candidateRules.length === 0) continue;

          var orderIso = parseOrderDayToIsoDate(c[idxOrderDay]);
          var dTypeLower = String(c[idxDiscType] || '').toLowerCase();
          var provLower = String(c[idxProvider] || '').toLowerCase();
          var fCatLower = String(c[idxFoodCat] || '').toLowerCase();
          var dAmt = purgerNombre(c[idxDiscAmt]);

          // Vérifier si la commande livrée bénéficie d'une offre (Discount / Pack / Super Promo)
          var hasOfferOnOrder = dAmt > 0 || /(percentage|pourcentage|pack|discount)/i.test(dTypeLower) || /super\s*promo/i.test(fCatLower);
          if (!hasOfferOnOrder) continue;

          // Trouver la règle applicable selon Start Date / End Date et TAG
          var matchedRule = null;
          for (var j = 0; j < candidateRules.length; j++) {
            var cand = candidateRules[j];
            if (orderIso) {
              if (cand.startDate && orderIso < cand.startDate) continue;
              if (cand.endDate && orderIso > cand.endDate) continue;
            }
            var tagLow = (cand.tag || '').toLowerCase();
            if (tagLow === 'pack' && !/super\s*promo/i.test(fCatLower) && !/pack/i.test(dTypeLower)) continue;
            if (tagLow === 'discount' && !/(percentage|pourcentage)/i.test(dTypeLower) && dAmt <= 0) continue;
            matchedRule = cand;
            break;
          }

          if (matchedRule && matchedRule.partPct > 0) {
            // Base de calcul : Item Total (montant brut avant remise) ou Total Food + Discount Amount
            var itemTot = purgerNombre(c[idxItemTotal]);
            var baseAmount = itemTot > 0 ? itemTot : (purgerNombre(c[idxTotalFood]) + dAmt);
            totalParticipationCostTnd += (matchedRule.partPct / 100) * baseAmount;
          }
        }

        return Number(totalParticipationCostTnd.toFixed(2));
      }

      function estOrderIdYaf(val) {
        if (val === null || val === undefined) return false;
        var s = String(val).trim();
        if (!s) return false;
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          return !/^order[\s_]*id$/i.test(s);
        }
        return /^yaf/i.test(s);
      }

      function matchAgentFromText(rawText) {
        var norm = normalizeText(rawText);
        if (!norm) return '';
        for (var i = 0; i < AM_AGENTS.length; i++) {
          var agent = AM_AGENTS[i];
          var normAgent = normalizeText(agent);
          if (norm === normAgent || norm.includes(normAgent)) return agent;
          var parts = normAgent.split(' ');
          if (parts.length >= 2 && norm.includes(parts[0]) && norm.includes(parts[1])) {
            return agent;
          }
          // Correspondance sur le prénom seul (ex: "omar", "nour", "aziza", "khouloud", "imed", "iheb", "ilyes")
          if (parts[0] && parts[0].length >= 4 && (norm === parts[0] || new RegExp('\\b' + parts[0] + '\\b').test(norm))) {
            return agent;
          }
        }
        return '';
      }

      function determinerAmPourCommande(restoName) {
        var cleanResto = String(restoName || '').trim().toLowerCase();
        if (cleanResto && Object.prototype.hasOwnProperty.call(state.amPortfolios, cleanResto)) {
          return state.amPortfolios[cleanResto].am;
        }
        return 'Non attribué';
      }

      function estCommandeLivree(statusVal) {
        return /delivered/i.test(String(statusVal || '').trim());
      }

      function purgerNombre(val) {
        if (val === null || val === undefined || val === '') return 0;
        if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
        var str = String(val).replace(/,/g, '.').replace(/\s+/g, '');
        var parsed = parseFloat(str);
        return Number.isFinite(parsed) ? parsed : 0;
      }

      // Cache des heures normalisées : les mêmes valeurs d'heure reviennent des centaines
      // de fois dans Data exp (4 appels par ligne dans le moteur) — évite regex + new Date.
      var _heureNormCache = new Map();
      function extraireObjetHeureNormalise(valeur) {
        if (valeur === null || valeur === undefined || valeur === '') return null;
        var cacheKey = (valeur instanceof Date) ? ('d:' + valeur.getTime()) : (typeof valeur === 'number' ? ('n:' + valeur) : ('s:' + String(valeur)));
        if (_heureNormCache.has(cacheKey)) return _heureNormCache.get(cacheKey);
        var res = null;
        if (valeur instanceof Date && !isNaN(valeur.getTime())) {
          res = new Date(1970, 0, 1, valeur.getHours(), valeur.getMinutes(), valeur.getSeconds(), 0);
        } else if (typeof valeur === 'number' && Number.isFinite(valeur)) {
          var fraction = valeur % 1;
          var totalSec = Math.round(Math.abs(fraction) * 86400);
          var h = Math.floor(totalSec / 3600) % 24;
          var m = Math.floor((totalSec % 3600) / 60);
          var s = totalSec % 60;
          res = new Date(1970, 0, 1, h, m, s, 0);
        } else {
          var str = String(valeur).trim();
          if (str && str.toLowerCase() !== 'n/a') {
            var idxSlash = str.lastIndexOf('/');
            if (idxSlash !== -1) str = str.substring(idxSlash + 1).trim();
            var match = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
            if (match) {
              res = new Date(1970, 0, 1, parseInt(match[1], 10), parseInt(match[2], 10), match[3] ? parseInt(match[3], 10) : 0, 0);
            }
          }
        }
        if (_heureNormCache.size > 20000) _heureNormCache.clear();
        _heureNormCache.set(cacheKey, res);
        return res;
      }

      function calculerDifferenceTemps(fin, debut) {
        if (!fin || !debut) return '';
        var diffMs = fin.getTime() - debut.getTime();
        if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
        var totalSecondes = Math.floor(diffMs / 1000);
        var heures = Math.floor(totalSecondes / 3600);
        var minutes = Math.floor((totalSecondes % 3600) / 60);
        var secondes = totalSecondes % 60;
        return String(heures).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(secondes).padStart(2, '0');
      }

      function formaterDateAffichage(val) {
        if (val === null || val === undefined || val === '') return '';
        var d = null;
        if (val instanceof Date && !isNaN(val.getTime())) {
          d = val;
        } else if (typeof val === 'number' && val > 25569) {
          d = new Date(Math.round((val - 25569) * 86400 * 1000));
        } else {
          return String(val).trim();
        }
        var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + String(d.getUTCDate()).padStart(2, '0') + ' ' + d.getUTCFullYear();
      }

      function formaterHeureAffichage(val) {
        if (val === null || val === undefined || val === '') return '';
        if (val instanceof Date || typeof val === 'number') {
          var obj = extraireObjetHeureNormalise(val);
          if (!obj) return String(val);
          return String(obj.getHours()).padStart(2, '0') + ':' + String(obj.getMinutes()).padStart(2, '0') + ':' + String(obj.getSeconds()).padStart(2, '0');
        }
        return String(val).trim();
      }
