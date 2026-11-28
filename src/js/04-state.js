      /* ========================================================================
         D. ÉTAT GLOBAL DE L'APPLICATION
         ======================================================================== */
      var state = {
        rawSourceRows: [],
        storedFilesMeta: [],
        dateStart: '',
        dateEnd: '',
        // Choix manuel de la période (semaine, plage ou préréglage) : tant
        // qu'il est vrai, une synchro ne réapplique jamais la semaine par
        // défaut (diagnostic 2026-11-27, semaine figée). Remis à zéro à la
        // connexion (nouvelle session) ; en mémoire uniquement.
        semaineChoisieManuellement: false,
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
        // Règles Bogof Kool (onglet « Bogof » du classeur unique) : la
        // participation est une somme en DT (« Participation 2ème article »),
        // jamais un % ; la date vient de la ligne détail, jamais de la feuille.
        bogofRules: [],
        offrePartSheetId: '',
        historical2025Rows: [],
        historical2025RowsKool: [],
        selectedAm: 'ALL',
        polygonFilter: null,
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
        var payload = JSON.stringify({
          byAm: state.budgetByAm,
          global: state.budgetGlobal
        });
        // Stockage par marque : la saisie manuelle (ou la synchro) écrit dans la
        // clé de la marque active, comme le fait la synchro Budget.
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          safeSet(KOOL_BUDGET_STORAGE_KEY, payload);
          if (typeof brandArchives !== 'undefined' && brandArchives.kool) brandArchives.kool.budgetByAm = state.budgetByAm || {};
        } else {
          safeSet(STORAGE_KEYS.BUDGET, payload);
          if (typeof brandArchives !== 'undefined' && brandArchives.yassir) brandArchives.yassir.budgetByAm = state.budgetByAm || {};
        }
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

      // Règles de secours « Offre Participation » (audit 2026-11-27, item 5b) :
      // elles ne sont PLUS dans le dépôt public — elles arrivent par /api/bootstrap
      // (clé KV `config`, champ `defaultOffreRules`) et sont lues ici via
      // window.__PULSE_DEFAULT_OFFRE_RULES__ (rempli dans applyBootstrap, 02b-auth.js).
      // ATTENTION : ce sont d'anciennes règles Black Friday, EXPIRÉES le 30 novembre
      // 2026 — elles ne servent que de repli quand la synchro de la feuille a échoué
      // ou n'a jamais eu lieu ; l'utilisateur doit fournir les règles actuelles
      // dans la feuille Google Sheets « Offre Participation ».
      function getDefaultOffreParticipationRules() {
        var rules = (typeof window !== 'undefined' && Array.isArray(window.__PULSE_DEFAULT_OFFRE_RULES__))
          ? window.__PULSE_DEFAULT_OFFRE_RULES__
          : [];
        return rules.slice();
      }
      window.yassirGetDefaultOffreParticipationRules = getDefaultOffreParticipationRules;

      state.offreParticipationRules = (function () {
        try {
          var r = safeGet(STORAGE_KEYS.OFFRE_PARTICIPATION);
          if (r) { var p = JSON.parse(r); if (Array.isArray(p) && p.length > 0) return p; }
        } catch (e) {}
        return getDefaultOffreParticipationRules();
      })();
      // Origine des règles en cours : 'feuille' (synchro réussie, règles stockées
      // localement) ou 'secours' (repli ci-dessus). Sert au bandeau d'avertissement
      // du panneau Participation.
      state.offreRulesSource = (function () {
        try {
          var r = safeGet(STORAGE_KEYS.OFFRE_PARTICIPATION);
          if (r) { var p = JSON.parse(r); if (Array.isArray(p) && p.length > 0) return 'feuille'; }
        } catch (e) {}
        return 'secours';
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
        if (!Number.isFinite(num)) return 0;
        // Même règle que pour les nombres : une valeur entre 0 et 1 est une
        // fraction. La synchro Kool lit la feuille en CSV (chaînes) et la
        // feuille écrit « 0,1 » pour 10 % : sans ce ×100, « 0,1 » était lu
        // 0,1 point au lieu de 10 (diagnostic 2026-11-27 : plateforme W47
        // affichée 37,08 TND au lieu de 3 707,65 TND).
        if (num > 0 && num < 1) return Number((num * 100).toFixed(4));
        return num;
      }
      window.yassirParsePercentNumber = parsePercentNumber;

      function parseOffreParticipationRows(rows, brandFilter) {
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

        // Colonne APP (Yassir / Kool) : filtre par marque quand elle est présente.
        var idxApp = headers.indexOf('app');

        var idxArea = headers.findIndex(function (h) { return h === 'area' || h.includes('ville') || h.includes('zone'); });
        var idxResto = headers.findIndex(function (h) { return h.includes('restaurant') || h.includes('partenaire') || h.includes('store') || h.includes('enseigne') || h.includes('nom'); });
        if (idxResto === -1) idxResto = 1;
        var idxCPct = headers.findIndex(function (h) { return h === 'c %' || h === 'c%' || h.includes('remise') || h.includes('discount %') || h.includes('taux offre'); });
        var idxTag = headers.findIndex(function (h) { return h === 'tag' || h.includes('type') || h.includes('categorie') || h.includes('offre'); });
        var idxAm = headers.findIndex(function (h) { return h.includes('responsable') || h === 'am' || h.includes('account'); });
        var idxPartPct = headers.findIndex(function (h) { return h.includes('participation') || h.includes('part kool') || h.includes('part yassir'); });
        var idxDetails = headers.findIndex(function (h) { return h.includes('detail') || h.includes('libelle') || h.includes('description') || h.includes('condition'); });
        var idxStart = headers.findIndex(function (h) { return h.includes('start') || h.includes('debut') || h.includes('du') || h.includes('date debut'); });
        var idxEnd = headers.findIndex(function (h) { return h.includes('end') || h.includes('fin') || h.includes('date fin') || h.includes('expiration'); });
        var idxPeriode = headers.findIndex(function (h) { return h.includes('periode') || h.includes('campagne'); });

        var parsedRules = [];
        for (var r = headerRowIdx + 1; r < rows.length; r++) {
          var row = rows[r];
          if (!row || row.length <= idxResto) continue;
          var rName = String(row[idxResto] || '').trim();
          if (!rName || normalizeText(rName) === 'restaurant' || normalizeText(rName) === 'restaurant name') continue;
          // Filtre par marque (classeur fusionné) : ne garder que les règles APP = marque demandée.
          if (brandFilter && idxApp !== -1 && idxApp < row.length) {
            var appVal = normalizeText(row[idxApp]);
            if (appVal && appVal !== normalizeText(brandFilter)) continue;
          }

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
      window.yassirParseOffreParticipationRows = parseOffreParticipationRows;

      // ---------------------------------------------------------------------------
      // Règles Bogof Kool (onglet « Bogof » du classeur unique, offres
      // buy-one-get-one). Colonnes : Area, Restaurant, Responsable AM, C%,
      // C% Globale, Article, Prix article, 2ème Article (prix),
      // Participation 2ème article, Spécificité, Détails de l'offre,
      // Start Date, End Date, Période.
      // RÈGLE 1 (utilisateur, 2026-11-28) : la participation est prise TELLE QUELLE
      // depuis « Participation 2ème article » (DT) — jamais calculée ni dérivée
      // (ni moitié du prix, ni % : purgerNombre, PAS parsePercentNumber).
      // RÈGLE 2 : la date NE vient PAS de cette feuille — elle est dans la ligne
      // détail (Catégorie « Buy 1 Get 1 Free ») ; Start/End sont lues mais ne
      // servent JAMAIS à filtrer.
      // ---------------------------------------------------------------------------
      function parseBogofRows(rows) {
        if (!Array.isArray(rows) || rows.length === 0) return [];
        var hi = -1;
        for (var h = 0; h < Math.min(rows.length, 5); h++) {
          var hs = (rows[h] || []).map(function (c) { return normalizeText(c); });
          if (hs.some(function (x) { return x.includes('restaurant'); }) && hs.some(function (x) { return x.includes('article'); })) { hi = h; break; }
        }
        if (hi === -1) return [];
        var headers = (rows[hi] || []).map(function (c) { return normalizeText(c); });
        function findCol(pred, exact) {
          var idx = -1;
          for (var i = 0; i < headers.length; i++) {
            if (pred(headers[i], i)) { idx = i; if (exact) break; }
          }
          return idx;
        }
        var ci = {
          area: findCol(function (h) { return h === 'area'; }, true),
          resto: findCol(function (h) { return h === 'restaurant' || h === 'restaurant name'; }, true),
          am: findCol(function (h) { return h.includes('responsable') || h === 'am' || h.includes('account manager'); }, true),
          cPct: findCol(function (h) { return h === 'c %' || h === 'c%'; }, true),
          article: findCol(function (h) { return h === 'article'; }, true),
          prixArticle: findCol(function (h) { return h === 'prix article'; }, true),
          prix2eme: findCol(function (h) { return h.includes('2eme article'); }, true),
          // « Participation 2ème article » : chercher d'abord l'en-tête complet,
          // sinon le premier en-tête « participation » (la feuille n'a qu'une
          // colonne de participation).
          participation: findCol(function (h) { return h.includes('participation 2eme article'); }, true),
          details: findCol(function (h) { return h.includes('details de l'); }, true),
          startDate: findCol(function (h) { return h.includes('start date'); }, true),
          endDate: findCol(function (h) { return h.includes('end date'); }, true)
        };
        if (ci.participation === -1) ci.participation = findCol(function (h) { return h.includes('participation'); }, true);
        if (ci.resto === -1 || ci.article === -1 || ci.participation === -1) return [];
        var rules = [];
        for (var i = hi + 1; i < rows.length; i++) {
          var row = rows[i] || [];
          var name = String(row[ci.resto] || '').trim();
          var article = String(row[ci.article] || '').trim();
          if (!name || !article) continue;
          var part = purgerNombre(row[ci.participation]);
          if (!(part > 0)) continue; // sans participation, la règle ne sert à rien
          rules.push({
            area: ci.area >= 0 ? String(row[ci.area] || '').trim() : '',
            restaurant: name,
            restaurantNorm: normalizeText(name),
            am: ci.am >= 0 ? (matchAgentFromText(String(row[ci.am] || '')) || String(row[ci.am] || '').trim()) : '',
            cPct: ci.cPct >= 0 ? parsePercentNumber(row[ci.cPct]) : 0,
            article: article,
            articleNorm: normalizeNomArticle(article),
            prixArticle: ci.prixArticle >= 0 ? purgerNombre(row[ci.prixArticle]) : 0,
            prix2emeArticle: ci.prix2eme >= 0 ? purgerNombre(row[ci.prix2eme]) : 0,
            participation2eme: part,
            details: ci.details >= 0 ? String(row[ci.details] || '').trim() : '',
            startDate: ci.startDate >= 0 ? parseOrderDayToIsoDate(row[ci.startDate]) : '',
            endDate: ci.endDate >= 0 ? parseOrderDayToIsoDate(row[ci.endDate]) : ''
          });
        }
        return rules;
      }
      if (typeof window !== 'undefined') window.yassirParseBogofRows = parseBogofRows;

      // Index des règles Bogof par restaurant (normalisé), reconstruit quand le
      // tableau change — même motif que getKoolRulesByRestoMap.
      var _bogofRulesIndex = { rulesRef: null, len: 0, map: new Map() };
      // Référence des règles Bogof vue par l'évaluateur : quand elle change,
      // le cache d'évaluation Kool est invalidé (voir evaluerOffreKoolPourCommande).
      var _bogofEvalRef = null;
      var _bogofEvalLen = 0;
      function getBogofRulesByRestoMap() {
        var rules = state.bogofRules || [];
        if (_bogofRulesIndex.rulesRef === rules && _bogofRulesIndex.len === rules.length) return _bogofRulesIndex.map;
        var m = new Map();
        rules.forEach(function (r) {
          var k = String(r.restaurant || '').trim().toLowerCase();
          if (!k) return;
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(r);
          var kn = normalizeText(r.restaurant || '');
          if (kn && kn !== k) {
            if (!m.has(kn)) m.set(kn, []);
            m.get(kn).push(r);
          }
        });
        _bogofRulesIndex = { rulesRef: rules, len: rules.length, map: m };
        return m;
      }

      window.yassirOnOffrePartFileChange = async function (e) {
        if (!isOwnerAdmin()) return;
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!(await window.yassirAttendreLibsLourdes())) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = new Uint8Array(ev.target.result);
            var wb = XLSX.read(data, { type: 'array', cellDates: true });
            var sheetName = wb.SheetNames.find(function (n) { return normalizeText(n).includes('participation') || normalizeText(n).includes('offre'); }) || wb.SheetNames[0];
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
            var rules = parseOffreParticipationRows(rows, (typeof currentBrand !== 'undefined' ? currentBrand : ''));
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
        // Offre Participation via le Worker (G3 suite) : source 'offres' —
        // le Worker lit l'onglet, filtre par marque (colonne APP) et par
        // rôle/AM ; le parseur refiltre par marque comme avant. La marque
        // lue est la marque active (règles Yassir en mode Yassir, Kool en
        // mode Kool). L'ancien choix d'un classeur par URL
        // (state.offrePartSheetId) ne change plus la source : le Worker ne
        // lit que les classeurs de sa configuration.
        var brandOffres = (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? 'kool' : 'yassir';
        var brandLabelOffres = brandOffres === 'kool' ? 'Kool' : 'Yassir';
        var icon = document.getElementById('iconSyncOffrePart');
        var label = document.getElementById('labelSyncOffrePart');
        if (icon) icon.classList.add('fa-spin');
        if (label) label.textContent = 'Sync Participation...';

        return yassirLireFeuilleViaApi('offres', { brand: brandOffres, fresh: !!(manualTrigger && isOwnerAdmin()) })
          .then(function (rows) {
            var rules = parseOffreParticipationRows(rows, brandLabelOffres);
            if (rules.length > 0) {
              state.offreParticipationRules = rules;
              state.offreRulesSource = 'feuille';
              saveOffreParticipationToStore();
            }
            noterStatutSynchro('Participation Offres', rules.length > 0);
            if (icon) icon.classList.remove('fa-spin');
            if (label) label.textContent = rules.length > 0 ? ('Participation OK (' + rules.length + ')') : 'Sync Participation Offres';
            mettreAJourInterface();
            if (manualTrigger) {
              showToast('<strong>Offre Participation synchronisée !</strong> (' + rules.length + ' règles chargées).', 'success');
            }
          })
          .catch(function () {
            noterStatutSynchro('Participation Offres', false);
            if (icon) icon.classList.remove('fa-spin');
            if (label) label.textContent = 'Sync Participation Offres';
            if (manualTrigger) {
              showToast('Impossible de synchroniser la feuille Offre Participation via le serveur. Réessayez plus tard.', 'error');
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
        if (combined.includes('article') || combined.includes('pack') || combined.includes('bogof') || combined.includes('menu specifique') || combined.includes('produit') || combined.includes('super promo')) {
          return false;
        }
        if (combined.includes('toute la carte') || combined.includes('tout le menu') || combined.includes('all menu') || combined.includes('discount')) {
          return true;
        }
        return true;
      }
      window.yassirEstOffreTouteLaCarteKool = estOffreTouteLaCarteKool;

      // Formate le libellé d'une règle d'offre Kool pour l'affichage (ex: "20% sur toute la carte" ou TAG)
      function formaterLibelleOffreKool(rl) {
        if (!rl) return '';
        // Le libellé porte sur le TAUX de remise (cPct). partPct est la participation
        // de la plateforme (points du taux), pas le taux de remise : ne pas l'utiliser ici.
        var pctVal = rl.cPct > 0 ? rl.cPct : 0;
        var tagStr = String(rl.tag || '').trim();
        var detStr = String(rl.details || '').trim();
        if (detStr) return detStr;
        if (pctVal > 0) {
          return (estOffreTouteLaCarteKool(rl) ? (pctVal + '% sur toute la carte') : (pctVal + '% sur article')) + (tagStr ? ' (' + tagStr + ')' : '');
        }
        return tagStr || 'Offre Restaurant';
      }

      // Calcul de participation d'offre sur les articles d'une commande Kool (détails Sheet 15D9KM6G...)
      function calculerParticipationArticlesCommandeKool(orderId, articleRules, bogofRules) {
        if (!orderId || !window.koolOrderItemsByOrderId) return { costTnd: 0, discountTotalTnd: 0, matchedItemsCount: 0, breakdown: [], unattributedTnd: 0, unattributedCount: 0, unattributedBreakdown: [] };
        var oidKey = String(orderId).trim().toLowerCase();
        var items = window.koolOrderItemsByOrderId.get(oidKey);
        if (!items || items.length === 0) return { costTnd: 0, discountTotalTnd: 0, matchedItemsCount: 0, breakdown: [], unattributedTnd: 0, unattributedCount: 0, unattributedBreakdown: [] };
        var bogofRulesList = Array.isArray(bogofRules) ? bogofRules : (state.bogofRules || []);

        var costTnd = 0;
        var discountTotalTnd = 0;
        var matchedItemsCount = 0;
        var breakdown = [];
        var unattributedTnd = 0;
        var unattributedCount = 0;
        var unattributedBreakdown = [];

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var origLineTotal = (it.originalPrice > 0 ? it.originalPrice : it.unitPrice) * (it.quantity || 1);
          if (origLineTotal <= 0) continue;

          var catNorm = normalizeText(it.category);
          var artNorm = normalizeNomArticle(it.article);
          var isDiscountedItem = (it.discountPrice > 0 && it.discountPrice < (it.originalPrice || it.unitPrice)) || catNorm.includes('super promo');
          // Remise réellement accordée sur la ligne : (prix original − prix remisé) × quantité.
          var effUnitPrice = (it.discountPrice > 0 && it.discountPrice < (it.originalPrice || it.unitPrice))
            ? it.discountPrice
            : (it.unitPrice || it.originalPrice || 0);
          var lineDiscountTnd = Math.max(0, (origLineTotal - effUnitPrice * (it.quantity || 1)));

          // BOGOF Kool (onglet « Bogof ») : la ligne détail porte
          // Catégorie = « Buy 1 Get 1 Free » ; on matche l'article (+ restaurant)
          // avec la feuille Bogof. La participation est la valeur TELLE QUELLE
          // de « Participation 2ème article » (DT), jamais calculée ; la date
          // vient de la ligne détail elle-même, jamais de la feuille Bogof.
          // La remise de la ligne = prix original − prix payé (0 quand le
          // 2ème article est offert — Discount Price = 0 ne veut PAS dire
          // « pas de remise » ici). Split (interprétation énoncée à
          // l'utilisateur, non confirmée explicitement) : plateforme =
          // participation, restaurant = remise − participation.
          var bogofRule = null;
          if (bogofRulesList.length > 0 && (catNorm.includes('buy 1 get 1') || catNorm.includes('bogof')) && artNorm) {
            var restoLow = String(it.restaurant || '').trim().toLowerCase();
            for (var jB = 0; jB < bogofRulesList.length; jB++) {
              var rb = bogofRulesList[jB];
              var rbResto = String(rb.restaurant || '').trim().toLowerCase();
              if (rbResto && restoLow && rbResto !== restoLow) continue;
              var rbArt = rb.articleNorm || normalizeNomArticle(rb.article || '');
              if (artNorm === rbArt || rbArt.includes(artNorm)) { bogofRule = rb; break; }
            }
          }
          if (bogofRule) {
            var paidUnit = (it.discountPrice > 0) ? it.discountPrice : 0; // 0 = 2ème article offert
            var bogofDiscount = Math.max(0, origLineTotal - paidUnit * (it.quantity || 1));
            var partPlateformeBogof = Math.min(bogofRule.participation2eme * (it.quantity || 1), bogofDiscount);
            var partRestoBogof = Math.max(0, bogofDiscount - partPlateformeBogof);
            costTnd += partRestoBogof;
            discountTotalTnd += bogofDiscount;
            matchedItemsCount += (it.quantity || 1);
            breakdown.push({
              article: it.article,
              category: it.category,
              quantity: it.quantity || 1,
              originalTotal: origLineTotal,
              discountTnd: Number(bogofDiscount.toFixed(3)),
              partPct: 0,
              partTnd: Number(partRestoBogof.toFixed(3)),
              bogof: true,
              participationTnd: Number(partPlateformeBogof.toFixed(3))
            });
            continue;
          }

          // Correspondance EXACTE (audit 2026-11-27, item 5a) : le nom de l'article
          // normalisé doit être ÉGAL au libellé de la règle (détails + tag), jamais
          // une sous-chaîne, et JAMAIS de repli sur la première règle. Un article
          // remisé sans règle correspondante reste « non attribué » : compté à part
          // (unattributedTnd / unattributedCount), jamais rattaché silencieusement
          // à une autre règle.
          var appliedRule = null;
          for (var j = 0; j < articleRules.length; j++) {
            var rl = articleRules[j];
            var detDetailsNorm = normalizeNomArticle(rl.details || '');
            var detTagNorm = normalizeNomArticle(rl.tag || '');
            if (artNorm && (artNorm === detDetailsNorm || artNorm === detTagNorm)) {
              appliedRule = rl;
              break;
            }
            if (normalizeNomArticle(catNorm) === 'super promo'
              && (detDetailsNorm === 'super promo' || detTagNorm === 'super promo'
                || detDetailsNorm === 'pack' || detTagNorm === 'pack')) {
              appliedRule = rl;
              break;
            }
          }
          // Passe 2 — assouplissement Pack/BOGOF (décision utilisateur
          // 2026-11-27) : les libellés de règles sont des phrases (« 1 Makloub
          // viande hachée achetée 20 dt = 1 makloub offerte… ») jamais égales
          // au nom de l'article — en octobre, 0 TND rattaché, 100 %
          // « non attribué ». Pour une règle Pack/BOGOF, on rattache l'article
          // quand son nom normalisé est CONTENU dans le libellé normalisé de
          // la règle (détails ou tag). La passe 1 exacte reste la règle pour
          // tout le reste ; jamais de repli sur la première règle : sans
          // rattachement, l'article reste « non attribué ». La garde artNorm
          // non vide est obligatoire (''.includes() est toujours vrai).
          if (!appliedRule && artNorm) {
            for (var j2 = 0; j2 < articleRules.length; j2++) {
              var rl2 = articleRules[j2];
              var det2 = normalizeNomArticle(rl2.details || '');
              var tag2 = normalizeNomArticle(rl2.tag || '');
              if ((det2.includes('pack') || det2.includes('bogof') || tag2.includes('pack') || tag2.includes('bogof'))
                && (det2.includes(artNorm) || tag2.includes(artNorm))) {
                appliedRule = rl2;
                break;
              }
            }
          }
          if (!appliedRule && isDiscountedItem && lineDiscountTnd > 0) {
            unattributedTnd += lineDiscountTnd;
            unattributedCount += (it.quantity || 1);
            unattributedBreakdown.push({
              article: it.article,
              category: it.category,
              quantity: it.quantity || 1,
              originalTotal: origLineTotal,
              discountTnd: Number(lineDiscountTnd.toFixed(3))
            });
          }

          // Règle corrigée (2026-11-26) : partPct = points du taux de l'offre pris en
          // charge par la PLATEFORME, calculés sur le brut de la ligne (prix original
          // × quantité). Le restaurant prend le reste de la remise réelle de la ligne.
          // Une règle à 0 % (ou vide) compte aussi : le restaurant prend toute la remise.
          if (appliedRule && (isDiscountedItem || appliedRule.details)) {
            var partPlateformeLigne = (appliedRule.partPct / 100) * origLineTotal;
            var linePart = Math.max(0, lineDiscountTnd - partPlateformeLigne);
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
          matchedItemsCount: matchedItemsCount,
          breakdown: breakdown,
          unattributedTnd: Number(unattributedTnd.toFixed(3)),
          unattributedCount: unattributedCount,
          unattributedBreakdown: unattributedBreakdown
        };
      }

      // Normalisation stricte pour la comparaison exacte des noms d'articles
      // (audit 2026-11-27, item 5a) : minuscules, accents retirés, espaces
      // multiples réduits à un seul espace.
      function normalizeNomArticle(s) {
        return normalizeText(s).replace(/\s+/g, ' ').trim();
      }

      // Exposé pour la section Participation (vue « Par article » Kool) et les tests.
      window.yassirCalculerParticipationArticlesKool = calculerParticipationArticlesCommandeKool;
      // Exposé pour les tests : règles Bogof Kool chargées (onglet « Bogof »).
      window.yassirGetBogofRules = function () { return state.bogofRules || []; };
      // Exposé pour les tests (audit 2026-11-27, item 5c).
      window.yassirPurgerNombre = purgerNombre;

      // Évaluation ultra-rapide des offres & participation Kool (Toute la carte + Offres sur articles)
      function evaluerOffreKoolPourCommande(restoName, orderDayVal, orderIdVal) {
        var rulesMap = getKoolRulesByRestoMap();
        var bogofMap = getBogofRulesByRestoMap();
        // Les règles Bogof seules suffisent (une commande BOGOF sans règle
        // « Offre Participation » doit quand même être évaluée).
        if ((rulesMap.size === 0 && bogofMap.size === 0) || !restoName) return null;
        var rawLow = String(restoName).trim().toLowerCase();
        if (!rawLow) return null;
        // Les règles Bogof ont changé (nouvelle synchro) : le cache d'évaluation
        // ne tient pas compte des règles, il faut l'invalider.
        if (_bogofEvalRef !== _bogofRulesIndex.rulesRef || _bogofEvalLen !== _bogofRulesIndex.len) {
          _bogofEvalRef = _bogofRulesIndex.rulesRef;
          _bogofEvalLen = _bogofRulesIndex.len;
          _koolRulesIndex.evalCache.clear();
        }

        var orderIso = parseOrderDayToIsoDate(orderDayVal);
        var oidStr = orderIdVal ? String(orderIdVal).trim() : '';
        var cacheKey = rawLow + '|' + orderIso + '|' + oidStr;
        if (_koolRulesIndex.evalCache.has(cacheKey)) {
          return _koolRulesIndex.evalCache.get(cacheKey);
        }

        var candList = rulesMap.get(rawLow) || rulesMap.get(normalizeText(rawLow));
        var bogofList = bogofMap.get(rawLow) || bogofMap.get(normalizeText(rawLow)) || [];
        if ((!candList || candList.length === 0) && bogofList.length === 0) {
          _koolRulesIndex.evalCache.set(cacheKey, null);
          return null;
        }

        var matchedTouteLaCarte = [];
        var matchedArticleRules = [];
        for (var i = 0; candList && i < candList.length; i++) {
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

        var articleEval = (oidStr && (matchedArticleRules.length > 0 || bogofList.length > 0))
          ? calculerParticipationArticlesCommandeKool(oidStr, matchedArticleRules, bogofList)
          : { costTnd: 0, discountTotalTnd: 0, matchedItemsCount: 0, breakdown: [] };

        if (matchedTouteLaCarte.length === 0 && articleEval.matchedItemsCount === 0) {
          _koolRulesIndex.evalCache.set(cacheKey, null);
          return null;
        }

        // Première règle applicable : partPct = 0 est une valeur définie (le restaurant
        // prend toute l'offre), pas une absence de participation — pas de préférence
        // pour les règles à partPct > 0.
        var best = matchedTouteLaCarte.length > 0 ? matchedTouteLaCarte[0] : matchedArticleRules[0];
        // BOGOF sans règle « Offre Participation » : libellé depuis la ligne
        // détail matchée (la règle Bogof n'a pas de libellé d'offre).
        var bogofLabel = '';
        if (!best) {
          for (var bI = 0; bI < articleEval.breakdown.length; bI++) {
            if (articleEval.breakdown[bI].bogof) { bogofLabel = 'BOGOF — ' + articleEval.breakdown[bI].article; break; }
          }
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
          articleUnattributedTnd: articleEval.unattributedTnd || 0,
          articleUnattributedCount: articleEval.unattributedCount || 0,
          label: formaterLibelleOffreKool(best) || bogofLabel
        };
        if (_koolRulesIndex.evalCache.size > 50000) _koolRulesIndex.evalCache.clear();
        _koolRulesIndex.evalCache.set(cacheKey, resObj);
        return resObj;
      }

      function calculerCoutParticipationOffresLivrees(deliveredRecords) {
        if (!deliveredRecords || deliveredRecords.length === 0) return 0;
        var rules = state.offreParticipationRules || [];
        // Les règles Bogof seules suffisent : une commande BOGOF compte dans
        // le budget même si la feuille « Offre Participation » est vide.
        if (rules.length === 0 && (state.bogofRules || []).length === 0) return 0;

        // Règles comptables (2026-11-26) : pour Kool, seules les offres de la feuille
        // « Offre Participation » comptent — sans règle, la commande est exclue
        // (coût 0, voir la branche Kool : evK null → rien n'est ajouté). Pour Yassir,
        // une offre sans règle est comptée à 100 % à la charge du restaurant : le
        // coût restaurant vaut alors la remise entière D (voir le « else » ci-dessous).
        // Mode Kool : participation Toute la carte (% * GMV) + participation Offres sur articles (% * Prix Original Article)
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          var idxRestoK = TARGET_HEADERS.indexOf('restaurant name');
          var idxOrderDayK = TARGET_HEADERS.indexOf('order day');
          var idxOrderIdK = TARGET_HEADERS.indexOf('order id');
          var idxGmvK = TARGET_HEADERS.indexOf('Total Food VF');
          var idxItemK = TARGET_HEADERS.indexOf('item total');
          var idxDiscAmtK = TARGET_HEADERS.indexOf('Discount Amount');
          var totalPartKool = 0;
          for (var rk = 0; rk < deliveredRecords.length; rk++) {
            var ck = deliveredRecords[rk].cells;
            var evK = evaluerOffreKoolPourCommande(ck[idxRestoK], ck[idxOrderDayK], ck[idxOrderIdK]);
            if (evK) {
              var dAmtK = purgerNombre(ck[idxDiscAmtK]);
              if (evK.isPromoRestaurant) {
                // Coût restaurant « Toute la carte » : remise réelle − part plateforme.
                // Base = BRUT avant remise : item total (J + L) ; sinon Total Food VF (J, net) + remise (L).
                var brutValK = purgerNombre(ck[idxItemK]);
                if (!(brutValK > 0)) brutValK = (purgerNombre(ck[idxGmvK]) || 0) + dAmtK;
                var partPlatK = Math.min((evK.partPct / 100) * brutValK, dAmtK);
                totalPartKool += Math.max(0, dAmtK - partPlatK);
              }
              if (evK.isPromoArticle) {
                totalPartKool += evK.articlePartTnd;
              }
            }
          }
          return Number(totalPartKool.toFixed(2));
        }
        if (!deliveredRecords || deliveredRecords.length === 0) return 0;
        var rules = state.offreParticipationRules || [];
        if (rules.length === 0) return 0;

        // Indexer les règles par nom de restaurant normalisé. Une règle à partPct 0
        // (ou vide) est une règle valide : le restaurant prend toute la remise.
        var rulesByResto = new Map();
        for (var i = 0; i < rules.length; i++) {
          var rl = rules[i];
          if (!rl) continue;
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
          // Pas de « continue » ici : sans aucune règle pour ce restaurant, l'offre
          // est quand même à 100 % à la charge du restaurant (repli Yassir, voir ci-dessous).

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
          if (candidateRules && candidateRules.length > 0) {
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
          }

          if (matchedRule) {
            // Base de calcul : Item Total (montant brut avant remise) ou Total Food + Discount Amount.
            // La plateforme prend partPct points du taux, calculés sur le brut ;
            // le coût restaurant = remise réelle − part plateforme (borné à 0).
            var itemTot = purgerNombre(c[idxItemTotal]);
            var baseAmount = itemTot > 0 ? itemTot : (purgerNombre(c[idxTotalFood]) + dAmt);
            var partPlatY = Math.min((matchedRule.partPct / 100) * baseAmount, dAmt);
            totalParticipationCostTnd += Math.max(0, dAmt - partPlatY);
          } else {
            // Repli Yassir (règle 2026-11-26) : offre sans règle → 100 % à la charge
            // du restaurant (la remise entière est un coût restaurant).
            totalParticipationCostTnd += dAmt;
          }
        }

        return Number(totalParticipationCostTnd.toFixed(2));
      }

      // Exposés pour les tests (même motif que yassirCalculerParticipationArticlesKool) :
      // coût de participation restaurant et commandes livrées du périmètre courant.
      window.yassirCalculerCoutParticipationOffresLivrees = calculerCoutParticipationOffresLivrees;
      window.yassirGetDeliveredRecords = function () {
        var idxStatus = TARGET_HEADERS.indexOf('status');
        return state.marketRows.concat(state.foodRows).filter(function (rec) { return estCommandeLivree(rec.cells[idxStatus]); });
      };

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

      // Lecture explicite selon le format (audit 2026-11-27, item 5c) : le séparateur
      // décimal est le DERNIER séparateur de la chaîne — « 1,234.50 » → 1234.50,
      // « 1.234,50 » → 1234.50, « 1 234,50 » → 1234.50 ; les autres séparateurs
      // (milliers, espaces) sont supprimés. Nombres simples inchangés.
      function purgerNombre(val) {
        if (val === null || val === undefined || val === '') return 0;
        if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
        // Un objet Date (ancien import XLSX avec cellDates:true) n'est jamais
        // un montant : il venait d'une cellule date dans une colonne montant.
        if (val instanceof Date) return 0;
        var str = String(val).replace(/\s+/g, '');
        if (!str) return 0;
        // Garde anti-date (2026-11-27, bug CA/GMV : CA semaine 48 à
        // −76 618 611,24 TND) : les colonnes montant de Data Yassir contiennent
        // des cellules date (format « d.m »). Une chaîne qui ressemble à une
        // date COMPLÈTE ne doit jamais être sommée comme un montant :
        // « 31.05.2026 » valait 3 105,20 et « 2026-11-26 » valait 2 026.
        // « 31.5 » (jour.mois sans année) reste ambigu et n'est pas rejeté :
        // c'est aussi un montant plausible, et le Worker le renvoie tel quel.
        if (/^\d{4}[-/](0?[1-9]|1[0-2])[-/]([0-2]?[0-9]|3[01])/.test(str) ||
            /^([0-2]?[0-9]|3[01])[./](0?[1-9]|1[0-2])[./]\d{2,4}/.test(str)) return 0;
        var lastComma = str.lastIndexOf(',');
        var lastDot = str.lastIndexOf('.');
        var decPos = Math.max(lastComma, lastDot);
        if (decPos === -1) {
          var entier = parseFloat(str.replace(/[^0-9\-+]/g, ''));
          return Number.isFinite(entier) ? entier : 0;
        }
        var partieEntiere = str.slice(0, decPos).replace(/[^0-9\-+]/g, '');
        var partieDecimale = str.slice(decPos + 1).replace(/[^0-9]/g, '');
        var parsed = parseFloat(partieEntiere + '.' + partieDecimale);
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
