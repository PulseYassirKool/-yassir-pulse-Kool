      /* ========================================================================
         O1. SYNCHRONISATION TEMPS RÉEL GOOGLE SHEETS (FETCH + JSONP SANS BLOCAGE CORS)
         ======================================================================== */
      var LIVE_SHEETS_CONFIG = {"PORTFOLIOS_SHEET_ID": "", "PORTFOLIOS_MASTER_GIDS": [], "PORTFOLIOS_TABS": [], "COMMISSIONS_SHEET_ID": "", "COMMISSIONS_TAB": "", "COMMISSIONS_GID": "", "BUDGET_SHEET_ID": "", "BUDGET_GID": "", "BUDGET_TAB": "", "RESTO_STATUS_SHEET_ID": "", "RESTO_STATUS_GID": "", "OFFRE_PARTICIPATION_SHEET_ID": "", "OFFRE_PARTICIPATION_GID": "", "HISTORICAL_2025_SHEET_ID": "", "HISTORICAL_2025_GID": "", "HISTORICAL_MONTHS": []}; // rempli après connexion (GET /api/bootstrap)

      // ==================================================================
      // LECTURE DES FEUILLES VIA LE WORKER (G3 suite) — plus aucune lecture
      // directe de Google Sheets depuis le front (ni CSV/gviz, ni JSONP, ni
      // téléchargement XLSX du classeur). Le Worker lit les feuilles avec le
      // compte de service, filtre par rôle/AM et renvoie les lignes paginées :
      //   GET /api/sheets/:source?brand=yassir|kool&page=0&pageSize=5000&fresh=0|1
      // Réponse : { rows: [ligne d'en-têtes, ...lignes de la page], totalPages, ... }.
      // Les lignes sont déjà alignées sur l'ordre des en-têtes par le Worker,
      // et les onglets valides sont déjà fusionnés (dédupliqués par N° commande).
      // Retourne [en-têtes, ...toutes les lignes] comme les anciens lecteurs.
      // opts : { brand: 'yassir'|'kool', fresh: bool, pageSize } — fresh=1
      // seulement pour la synchro manuelle du proprio (le serveur l'ignore
      // pour les autres rôles) ; la synchro automatique ne passe jamais fresh=1.
      // ==================================================================
      var SHEETS_PAGE_SIZE = 10000; // maximum accepté par /api/sheets/:source
      function yassirLireFeuilleViaApi(source, opts) {
        var o = opts || {};
        var brand = o.brand === 'kool' ? 'kool' : 'yassir';
        var fresh = o.fresh ? 1 : 0;
        // Grosses sources : tranches (plan gratuit) au lieu des pages.
        // Les petites sources gardent le chemin historique (pages + cache KV).
        var BIG_SOURCES = { 'data-oct': 1, 'data-nov': 1, 'data-kool': 1, 'details-kool': 1 };
        if (BIG_SOURCES[source]) return yassirLireFeuilleViaApiTranches(source, opts);
        var pageSize = o.pageSize || SHEETS_PAGE_SIZE;
        var allRows = null; // [en-têtes, ...lignes] — en-têtes de la 1re page
        var page = 0;
        function lirePage() {
          // Correctif 2026-11-27 (sync partielle 4/6 + détails Kool à 0) :
          // fresh=1 force le Worker à TOUT relire depuis Google Sheets et à
          // réécrire tout le cache KV. Il ne doit être passé qu'à la 1re page :
          // le passer à chaque page faisait recharger la source entière à
          // chaque page (5× pour Novembre, 16× pour les 150 000 détails Kool),
          // ce qui dépassait le plafond CPU / sous-requêtes du Worker gratuit
          // et faisait échouer la lecture (erreur silencieuse → []).
          // Les pages suivantes relisent le cache écrit par la page 0.
          var freshParam = (page === 0) ? fresh : 0;
          // Reprise quota (2026-11-28) : un 429 sur le chemin historique
          // (rafale de début de synchro) attend la fin de la fenêtre
          // (60 s) puis réessaie — sans elle, la source tombait en échec
          // immédiat (ex. Offre Participation → règles de secours). La
          // pause est aussi notée pour les tranches, mises en pause.
          function appelerPage(attempt) {
            return PulseAuth.call('GET', '/api/sheets/' + encodeURIComponent(source) +
              '?brand=' + brand + '&page=' + page + '&pageSize=' + pageSize + '&fresh=' + freshParam)
              .catch(function (err) {
                if (err && err.status === 429 && attempt < 2) {
                  if (typeof window.yassirNoterQuotaGoogle === 'function') window.yassirNoterQuotaGoogle();
                  var waitMs = (typeof yassirQuotaWaitMs === 'function') ? yassirQuotaWaitMs() : 60000;
                  return new Promise(function (r) { setTimeout(r, waitMs); })
                    .then(function () { return appelerPage(attempt + 1); });
                }
                throw err;
              });
          }
          return appelerPage(0)
            .then(function (data) {
              var rows = (data && Array.isArray(data.rows)) ? data.rows : [];
              var totalPages = (data && typeof data.totalPages === 'number') ? data.totalPages : 0;
              if (allRows === null) {
                allRows = rows.slice();
              } else if (rows.length > 0) {
                // Chaque page répète la ligne d'en-têtes : on ne la garde qu'une fois.
                allRows = allRows.concat(rows.slice(1));
              }
              page += 1;
              if (page < totalPages) return lirePage();
              return allRows || [];
            });
        }
        return lirePage();
      }
      window.yassirLireFeuilleViaApi = yassirLireFeuilleViaApi;

      // ---------- Chargement par tranches (plan gratuit : 10 ms CPU / invocation) ----------
      // Le chargement complet d'une grosse source dépasse de 100x le plafond
      // gratuit (data-nov ~1 070 ms CPU, details-kool ~1 200 ms). Une tranche
      // ne lit qu'une plage limitée et ne coûte que quelques ms (mesuré avec
      // le vrai code Worker et les vraies données, /tmp/proto) :
      //   data-oct / data-nov (106 colonnes) : 500 lignes (~5,5 ms) ;
      //   data-kool (33 colonnes) : 1 000 lignes (~4,3 ms) ;
      //   details-kool (10 colonnes) : 1 000 lignes (~1,5 ms).
      // Les feuilles sont en ordre anti-chronologique (plus récent d'abord) :
      // les premières tranches apportent les semaines récentes.
      // Le Worker ne fait ni déduplication ni alignement ici : le front s'en
      // charge (fusion par nom d'en-tête + déduplication par N° commande ;
      // détails : déduplication commande|article dans indexKoolOrderItemsRows).
      // Débit bridé à 1 tranche / 2 s (quota Sheets API : 60 lectures/min
      // par COMPTE — le compte de service est un seul compte — c'est lui
      // qui plafonne, pas les 300/min par projet). Le correctif « 2/s »
      // du 2026-11-28 ~12:35 visait les 300/min et restait à ~240 lectures
      // /min : la sync Kool de 12:47 a encore échoué (details-kool 502,
      // Commissions/Offres à 0 — le quota se vide en cours de synchro et
      // les sources qui arrivent après prennent le 429).
      // Le Worker met en cache les en-têtes par onglet (TTL 10 min) : une
      // tranche coûte 1 seule lecture (au lieu de 2 : sonde + tranche).
      // Tranches grosses = moins d'appels = moins de quota : data-oct/nov
      // 1 000 lignes, data-kool/détails 2 000 (plafond Worker). À 2 s,
      // une synchro Kool complète (~200 tranches) prend ~7 min pour
      // ~30 lectures/min. Correctif 2026-11-28 (details-kool en 502 à
      // chaque synchro) : à 1,5 s, la 1re minute frôlait 57 lectures
      // (rafale historique ~17 lectures en parallèle au démarrage +
      // ~40 tranches/min) — sans marge, le moindre isolate froid
      // (sonde = +1 lecture) faisait tomber le quota, et le front
      // réessayait après 2 s/5 s, toujours dans la même fenêtre de 60 s.
      // Désormais : 2 s/tranche (~30/min, 1re minute ~47 lectures) et,
      // sur 429, pause globale jusqu'à la fin de la fenêtre (60 s) puis
      // reprise — la synchro finit, plus lentement, au lieu d'échouer.
      // (Les tailles avaient été divisées par deux le 2026-11-28 par
      // prudence CPU — mauvaise piste : les échecs étaient le quota, pas
      // la taille ; les mesures locales donnent ~1,5-5,5 ms / 1 000 lignes.)
      // Une tranche en échec est réessayée : 429 (quota) → 4 reprises
      // avec attente de la fenêtre (60 s, via la file) ; autre erreur →
      // 2 reprises AVEC ATTENTE (2 s puis 5 s). La lecture est
      // idempotente, et un réessai immédiat ne fait qu'aggraver un 429.
      var SLICE_SIZES = { 'data-oct': 1000, 'data-nov': 1000, 'data-kool': 2000, 'details-kool': 2000 };
      var SLICE_MAX_RETRIES = 2;
      var SLICE_MAX_RETRIES_QUOTA = 4; // 429 : plus de reprises, la fenêtre est de 60 s
      var SLICE_MIN_INTERVAL_MS = 2000;
      var SLICE_RETRY_DELAYS_MS = [2000, 5000];
      // Fenêtre de quota Google (60 lectures/min/compte) : après un 429, on
      // attend sa fin avant tout nouvel appel (tranches comme historique).
      var SLICE_QUOTA_WAIT_MS = 60000;
      var _sliceLastCallMs = 0;
      var _sliceQueue = Promise.resolve();
      var _sliceQuotaBlockedUntil = 0; // horodatage : aucun appel tranche avant cette heure
      function yassirQuotaWaitMs() {
        // Crochet de test : la fenêtre de quota (60 s) est ramenée à
        // quelques ms par les tests (window.__PULSE_SLICE_QUOTA_WAIT_MS__),
        // sans quoi un test de reprise 429 durerait des minutes.
        try {
          var ov = Number(window.__PULSE_SLICE_QUOTA_WAIT_MS__);
          if (Number.isFinite(ov) && ov >= 0) return ov;
        } catch (e) {}
        return SLICE_QUOTA_WAIT_MS;
      }
      function yassirNoterQuotaGoogle() {
        // Un 429 vient d'être reçu : bloquer les appels jusqu'à la fin de la
        // fenêtre de quota, pour ne pas brûler le quota en réessais immédiats.
        _sliceQuotaBlockedUntil = Date.now() + yassirQuotaWaitMs();
      }
      function yassirAttendreQuotaGoogle() {
        var wait = Math.max(0, _sliceQuotaBlockedUntil - Date.now());
        return wait > 0 ? new Promise(function (r) { setTimeout(r, wait); }) : Promise.resolve();
      }
      window.yassirNoterQuotaGoogle = yassirNoterQuotaGoogle;
      function yassirAppelerTranche(url) {
        // File d'attente globale : au plus une tranche toutes les 2 s,
        // même quand deux synchros (Yassir + Kool) tournent en parallèle.
        // Sur 429, la file attend la fin de la fenêtre de quota (60 s)
        // avant le prochain appel — toutes les sources sont mises en pause.
        var task = _sliceQueue.then(function () {
          return yassirAttendreQuotaGoogle();
        }).then(function () {
          var now = Date.now();
          var wait = _sliceLastCallMs ? Math.max(0, SLICE_MIN_INTERVAL_MS - (now - _sliceLastCallMs)) : 0;
          _sliceLastCallMs = now + wait;
          return wait > 0 ? new Promise(function (r) { setTimeout(r, wait); }) : Promise.resolve();
        }).then(function () {
          return PulseAuth.call('GET', url);
        }).catch(function (err) {
          // 429 (quota Google) : noter le blocage pour que les tranches
          // suivantes attendent la fin de la fenêtre au lieu de brûler
          // le quota. Les autres erreurs passent telles quelles.
          if (err && err.status === 429) yassirNoterQuotaGoogle();
          throw err;
        });
        _sliceQueue = task.catch(function () {});
        return task;
      }
      // Fraîcheur d'une source (synchro auto seulement) : ne pas relire une
      // grosse source synchronisée il y a moins de 30 min — l'archive
      // IndexedDB fait foi entre-temps.
      var SLICE_FRESH_MINUTES = 30;
      function yassirSliceSyncRecente(source, brand) {
        try {
          var ts = Number(window.localStorage.getItem('yassir_slice_sync_' + source + '_' + brand) || 0);
          return ts > 0 && (Date.now() - ts) < SLICE_FRESH_MINUTES * 60000;
        } catch (e) { return false; }
      }
      function yassirNoterSliceSync(source, brand) {
        try { window.localStorage.setItem('yassir_slice_sync_' + source + '_' + brand, String(Date.now())); } catch (e) {}
      }
      window.yassirSliceSyncRecente = yassirSliceSyncRecente;
      function yassirAlignerLignesSurEnTetes(rows, fromHeaders, toHeaders) {
        // Aligne les lignes d'un onglet sur les en-têtes de référence (par
        // nom normalisé) — les onglets ont les mêmes colonnes, mais pas
        // toujours dans le même ordre.
        var norm = function (h) { return normalizeText(h).replace(/[_\-]+/g, ' ').trim(); };
        var from = (fromHeaders || []).map(norm);
        var to = (toHeaders || []).map(norm);
        var used = {};
        var colMap = to.map(function (th) {
          for (var i = 0; i < from.length; i++) {
            if (from[i] === th && !used[i]) { used[i] = true; return i; }
          }
          return from.indexOf(th);
        });
        return rows.map(function (row) {
          var out = new Array(to.length).fill('');
          for (var c = 0; c < to.length; c++) {
            var s = colMap[c];
            if (s !== -1 && s < row.length && row[s] !== null && row[s] !== undefined) out[c] = row[s];
          }
          return out;
        });
      }
      // opts : { brand, fresh, onProgress(source, tab, slice, done, lignes),
      //   onFirstSlices(rows) } — onFirstSlices est appelé après 2 tranches
      //   (données récentes déjà là) pour un premier rendu rapide.
      function yassirLireFeuilleViaApiTranches(source, opts) {
        var o = opts || {};
        var brand = o.brand === 'kool' ? 'kool' : 'yassir';
        var sliceSize = SLICE_SIZES[source] || 500;
        var onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
        var onFirstSlices = typeof o.onFirstSlices === 'function' ? o.onFirstSlices : null;
        var allRows = null; // [en-têtes de référence, ...lignes alignées]
        var refHeaders = null;
        var firstSlicesDone = false;
        function callSlice(tab, slice, attempt) {
          return yassirAppelerTranche('/api/sheets/' + encodeURIComponent(source) +
            '?brand=' + brand + '&tab=' + encodeURIComponent(tab) +
            '&slice=' + slice + '&sliceSize=' + sliceSize)
            .catch(function (err) {
              // 429 (quota Google) : la file attend déjà la fin de la
              // fenêtre (60 s) — on réessaie sans délai supplémentaire,
              // avec plus de reprises (un 429 ne se résout pas en 2 s).
              // Les autres erreurs gardent les reprises courtes (2 s, 5 s).
              var isQuota = err && err.status === 429;
              var maxRetries = isQuota ? SLICE_MAX_RETRIES_QUOTA : SLICE_MAX_RETRIES;
              if (attempt < maxRetries) {
                if (isQuota) return callSlice(tab, slice, attempt + 1);
                var delay = SLICE_RETRY_DELAYS_MS[attempt] || 5000;
                return new Promise(function (r) { setTimeout(r, delay); })
                  .then(function () { return callSlice(tab, slice, attempt + 1); });
              }
              throw err;
            });
        }
        function lireOnglet(tab) {
          var slice = 0;
          function lireTranche() {
            return callSlice(tab, slice, 0).then(function (data) {
              if (!data || data.skipped) return false; // onglet ignoré
              var rows = Array.isArray(data.rows) ? data.rows : [];
              var headers = Array.isArray(data.headers) ? data.headers : [];
              if (allRows === null) {
                refHeaders = headers;
                allRows = [headers].concat(rows);
              } else if (rows.length > 0) {
                allRows = allRows.concat(yassirAlignerLignesSurEnTetes(rows, headers, refHeaders));
              }
              if (onProgress) onProgress(source, tab, slice, !!data.done, allRows.length - 1);
              slice += 1;
              if (!firstSlicesDone && slice >= 2 && onFirstSlices) {
                firstSlicesDone = true;
                onFirstSlices(allRows);
              }
              // Garde-fous (bug vu en test le 2026-11-28 : la route Worker ne
              // transmettait pas `slice`, la réponse historique n'avait pas
              // de champ `done` et la boucle tournait indéfiniment) :
              // on ne continue QUE si le Worker dit explicitement done=false,
              // et jamais au-delà de 2000 tranches par onglet (la plus grosse
              // source en demande ~300). Une réponse sans `done` s'arrête ici
              // avec les lignes déjà reçues, jamais en boucle.
              if (data.done !== false) return true;
              if (slice >= 2000) return true;
              return lireTranche();
            });
          }
          return lireTranche();
        }
        // La liste des onglets (?tabs=1) n'avait AUCUNE reprise : un 429
        // dessus faisait échouer la source entière immédiatement. Même
        // reprise que les tranches (429 : attente de la fenêtre, 60 s).
        function callTabs(attempt) {
          return yassirAppelerTranche('/api/sheets/' + encodeURIComponent(source) +
            '?brand=' + brand + '&tabs=1')
            .catch(function (err) {
              var isQuota = err && err.status === 429;
              var maxRetries = isQuota ? SLICE_MAX_RETRIES_QUOTA : SLICE_MAX_RETRIES;
              if (attempt < maxRetries) {
                if (isQuota) return callTabs(attempt + 1);
                var delay = SLICE_RETRY_DELAYS_MS[attempt] || 5000;
                return new Promise(function (r) { setTimeout(r, delay); })
                  .then(function () { return callTabs(attempt + 1); });
              }
              throw err;
            });
        }
        return callTabs(0)
          .then(function (t) {
            var tabs = (t && Array.isArray(t.tabs)) ? t.tabs : [];
            if (tabs.length === 0) return [];
            var failedTabs = [];
            var seq = Promise.resolve();
            tabs.forEach(function (tab) {
              seq = seq.then(function () {
                // Un onglet en échec (tranche en échec après reprises) ne
                // doit pas faire perdre les autres onglets : on le saute
                // et on continue (synchro partielle plutôt que vide).
                return lireOnglet(tab).catch(function (err) {
                  failedTabs.push(tab);
                  try { console.warn('[Sync] onglet ignoré après échec : ' + tab, err && err.message ? err.message : err); } catch (e) {}
                  return false;
                });
              });
            });
            return seq.then(function () {
              yassirNoterSliceSync(source, brand);
              try { window.yassirLastSliceFailedTabs = failedTabs.slice(); } catch (e) {}
              return allRows || [];
            });
          });
      }
      window.yassirLireFeuilleViaApiTranches = yassirLireFeuilleViaApiTranches;

      function isKnownSegmentLabel(val) {
        var n = normalizeText(val);
        return n === 'top performer' || n === 'long tail' || n === 'high potentiel' || n === 'high potential' ||
               n === 'new' || n === 'dormant' || n === 'jamais actif' || n === 'inactive' || n === 'active';
      }

      function isKnownCityLabel(val) {
        var n = normalizeText(val);
        if (!n) return false;
        var cities = [
          'sousse', 'tunis', 'el menzah', 'menzah', 'les berges du lac', 'berges du lac', 'lac',
          'la marsa', 'marsa', 'bardo', 'bizerte', 'monastir', 'sfax', 'nabeul', 'hammamet',
          'hammamet nord', 'mourouj', 'ezzahra', 'ezzahra boumhal', 'boumhal', 'manouba',
          'kairouan', 'megrine', 'le kram', 'kram', 'en nekhilet', 'centre ville', 'borj cedria',
          'hammam lif', 'ariana', 'ben arous', 'gabes', 'gafsa', 'la nouvelle medina', 'mall of sousse'
        ];
        return cities.indexOf(n) !== -1;
      }

      // Colonne APP (Yassir / Kool) : détectée par son en-tête normalisé 'app'.
      // Quand la colonne est absente (anciens classeurs), toutes les lignes sont gardées.
      function trouverColonneApp(ligneEnTete) {
        if (!ligneEnTete) return -1;
        var hdr = ligneEnTete.map(function (c) { return normalizeText(c); });
        return hdr.indexOf('app');
      }
      function ligneEstDeLaMarque(row, idxApp, marqueDemandee) {
        if (!marqueDemandee || idxApp === -1) return true;
        if (!row || idxApp >= row.length) return true;
        var v = normalizeText(row[idxApp]);
        if (!v) return true; // APP vide → gardée (compatibilité anciens classeurs)
        return v === normalizeText(marqueDemandee);
      }

      function extraireRestaurantsDepuisLignesSheet(rows, defaultAmName, targetMap, brandFilter) {
        if (!rows || rows.length === 0) return 0;
        var count = 0;

        var restHeaders = ['restaurant name', 'restaurant', 'nom du restaurant', 'nom restaurant', 'store name', 'store', 'enseigne', 'partenaire', 'nom', 'compte', 'etablissement', 'établissement'];
        var villeHeaders = ['ville', 'area', 'zone', 'city', 'region', 'région'];
        var segHeaders = ['segment', 'categorie', 'catégorie', 'tier', 'type'];
        var amHeaders = ['am', 'portefeuille am', 'account manager', 'commercial', 'portefeuille', 'responsable'];

        // Scanner les 10 premières lignes non vides pour trouver la ligne d'en-tête (même s'il y a un titre ou des lignes vides au-dessus)
        var headerRowIdx = -1;
        var idxRest = -1;
        var idxVille = -1;
        var idxSeg = -1;
        var idxAmCol = -1;

        var maxScan = Math.min(rows.length, 12);
        for (var sr = 0; sr < maxScan; sr++) {
          var candRow = rows[sr];
          if (!candRow || !Array.isArray(candRow)) continue;
          var candLower = candRow.map(function (c) { return normalizeText(c); });
          var fRest = -1, fVille = -1, fSeg = -1, fAm = -1;

          for (var i = 0; i < restHeaders.length; i++) {
            var p = candLower.indexOf(normalizeText(restHeaders[i]));
            if (p !== -1) { fRest = p; break; }
          }
          for (var j = 0; j < villeHeaders.length; j++) {
            var pv = candLower.indexOf(normalizeText(villeHeaders[j]));
            if (pv !== -1) { fVille = pv; break; }
          }
          for (var k = 0; k < segHeaders.length; k++) {
            var ps = candLower.indexOf(normalizeText(segHeaders[k]));
            if (ps !== -1) { fSeg = ps; break; }
          }
          for (var m = 0; m < amHeaders.length; m++) {
            var pa = candLower.indexOf(normalizeText(amHeaders[m]));
            if (pa !== -1) { fAm = pa; break; }
          }

          // Cas où les colonnes portent directement les noms des AMs côte à côte (ex: Col A = Aziza, Col B = Khouloud...)
          var multiAmColsCount = 0;
          for (var mc = 0; mc < candRow.length; mc++) {
            if (matchAgentFromText(candRow[mc])) multiAmColsCount++;
          }

          if (fRest !== -1 || fVille !== -1 || fSeg !== -1 || fAm !== -1 || multiAmColsCount >= 2) {
            headerRowIdx = sr;
            idxRest = fRest;
            idxVille = fVille;
            idxSeg = fSeg;
            idxAmCol = fAm;
            if (multiAmColsCount >= 2 && fRest === -1) {
              idxAmCol = 999; // marqueur multi-colonnes AM
            }
            break;
          }
        }

        var startRow = (headerRowIdx !== -1) ? (headerRowIdx + 1) : 0;

        // Colonne APP (Yassir / Kool) détectée sur la ligne d'en-tête, si elle existe.
        var idxApp = (headerRowIdx !== -1) ? trouverColonneApp(rows[headerRowIdx]) : -1;

        for (var r = startRow; r < rows.length; r++) {
          var row = rows[r];
          if (!row || !Array.isArray(row)) continue;

          // Filtre par marque (classeur fusionné) : ne garder que les lignes APP = marque demandée.
          if (!ligneEstDeLaMarque(row, idxApp, brandFilter)) continue;

          // Cas multi-AM côte à côte en colonnes
          if (idxAmCol === 999 && headerRowIdx !== -1) {
            var hdrRow = rows[headerRowIdx];
            for (var c = 0; c < hdrRow.length; c++) {
              var colAm = matchAgentFromText(hdrRow[c]);
              if (!colAm) continue;
              var cellRest = row[c] !== undefined ? String(row[c]).trim() : '';
              if (!cellRest) continue;
              var lc = cellRest.toLowerCase();
              if (lc === 'restaurant name' || lc === 'restaurant' || lc.startsWith('sous-total') || lc.startsWith('total')) continue;
              targetMap[lc] = {
                am: colAm,
                displayName: cellRest,
                ville: '',
                segment: ''
              };
              count++;
            }
            continue;
          }

          var rName = '';
          var villeVal = '';
          var segVal = '';
          var rowAm = defaultAmName;

          if (idxAmCol !== -1 && idxAmCol < row.length && row[idxAmCol] !== undefined) {
            var matchedRowAm = matchAgentFromText(String(row[idxAmCol]));
            if (matchedRowAm) rowAm = matchedRowAm;
          }
          if (!rowAm) continue;

          if (idxRest !== -1) {
            rName = (idxRest < row.length && row[idxRest] !== undefined) ? String(row[idxRest]).trim() : '';
            villeVal = (idxVille !== -1 && idxVille < row.length && row[idxVille] !== undefined) ? String(row[idxVille]).trim() : '';
            segVal = (idxSeg !== -1 && idxSeg < row.length && row[idxSeg] !== undefined) ? String(row[idxSeg]).trim() : '';
          } else {
            // Aucun en-tête explicite : inspecter intelligemment les cellules non vides de la ligne !
            var nonEmptyCols = [];
            for (var colI = 0; colI < row.length; colI++) {
              var cellStr = row[colI] !== undefined && row[colI] !== null ? String(row[colI]).trim() : '';
              if (cellStr) nonEmptyCols.push({ idx: colI, val: cellStr });
            }
            if (nonEmptyCols.length === 0) continue;

            if (nonEmptyCols.length === 1) {
              rName = nonEmptyCols[0].val;
            } else {
              // Classer chaque cellule non vide : Segment, Ville, AM, ou Restaurant Name
              var restCandidates = [];
              for (var nc = 0; nc < nonEmptyCols.length; nc++) {
                var item = nonEmptyCols[nc];
                if (isKnownSegmentLabel(item.val)) {
                  if (!segVal) segVal = item.val;
                } else if (isKnownCityLabel(item.val)) {
                  if (!villeVal) villeVal = item.val;
                } else if (matchAgentFromText(item.val) && !defaultAmName) {
                  rowAm = matchAgentFromText(item.val);
                } else {
                  restCandidates.push(item.val);
                }
              }
              if (restCandidates.length > 0) {
                // Si Col 2 (index 2) fait partie des candidats (format Ville | Segment | Restaurant), le privilégier, sinon prendre le premier candidat
                rName = restCandidates[restCandidates.length - 1];
              }
            }
          }

          if (!rName) continue;
          var lowerName = rName.toLowerCase();
          var lowerSeg = segVal.toLowerCase();
          if (
            lowerName === 'restaurant name' ||
            lowerName === 'restaurant' ||
            lowerName === 'nom du restaurant' ||
            lowerName === 'nom' ||
            lowerSeg.startsWith('sous-total') ||
            lowerSeg.startsWith('total portefeuille') ||
            lowerName.startsWith('sous-total') ||
            lowerName.startsWith('total ') ||
            /^portefeuille/i.test(rName)
          ) continue;

          targetMap[lowerName] = {
            am: rowAm,
            displayName: rName,
            ville: villeVal,
            segment: segVal
          };
          count++;
        }
        return count;
      }
      window.yassirExtraireRestaurantsDepuisLignesSheet = extraireRestaurantsDepuisLignesSheet;

      // Lecture d'une feuille Commissions : colonnes détectées par en-tête
      // (restaurant + taux) ; la colonne APP (Yassir / Kool) filtre par marque
      // quand elle est présente. Sans en-tête, lecture positionnelle (col 0 = nom,
      // col 1 = taux) comme l'ancien classeur Kool.
      function parseCommissionRows(rows, brandFilter) {
        var map = {};
        var count = 0;
        if (!rows || rows.length < 2) return { map: map, count: 0 };
        var hdr = rows[0].map(function (h) { return normalizeText(h); });
        var idxRest = hdr.findIndex(function (h) { return h.includes('restaurant') || h.includes('partenaire') || h.includes('nom') || h.includes('store'); });
        var idxRate = hdr.findIndex(function (h) { return h.includes('commission') || h.includes('taux') || h.includes('%') || h.includes('facture'); });
        var idxApp = hdr.indexOf('app');
        var startR = (idxRest !== -1 || idxRate !== -1) ? 1 : 0;
        if (idxRest === -1) idxRest = 0;
        if (idxRate === -1) idxRate = 1;
        for (var c = startR; c < rows.length; c++) {
          var cRow = rows[c];
          if (!cRow || cRow[idxRest] === undefined || cRow[idxRate] === undefined) continue;
          if (!ligneEstDeLaMarque(cRow, idxApp, brandFilter)) continue;
          var cName = String(cRow[idxRest]).replace(/[‎‏‪-‮]/g, '').trim().toLowerCase();
          var rawRateVal = cRow[idxRate];
          // Même règle que parsePercentNumber (correctif partPct b9c9f708) :
          // une valeur entre 0 et 1 est une fraction — la feuille écrit
          // « 0,238 » pour 23,8 %. La synchro Kool lit la feuille en CSV
          // (chaînes) : sans ce ×100, « 0,238 » était lu 0,238 point au
          // lieu de 23,8. Les nombres XLSX (Yassir) passent par le même
          // chemin : 0.238 (nombre) vaut aussi 23,8, comme avant.
          var cRate = purgerNombre(String(rawRateVal).replace(/%|[‎‏‪-‮]/g, ''));
          if (cRate > 0 && cRate < 1) cRate = Number((cRate * 100).toFixed(4));
          if (cName && cName !== 'restaurant' && cName !== 'restaurant name' && !isNaN(cRate) && cRate > 0) {
            map[cName] = cRate;
            count++;
          }
        }
        return { map: map, count: count };
      }
      window.yassirParseCommissionRows = parseCommissionRows;

      // Lecture des commissions depuis la VRAIE feuille Google Sheets (audit
      // item 4) : l'ancien « Restaurer grille Sheet » rechargeait l'instantané
      // figé du KV (bootstrap), pas la feuille. Renvoie { ok, count, map } ;
      // en échec, ok=false et la grille actuelle doit être conservée (jamais
      // vidée par l'appelant).
      // Lecture des commissions via le Worker (G3 suite) : GET
      // /api/sheets/commissions — le Worker filtre déjà par marque et par
      // rôle/AM. Renvoie { ok, count, map } ; en échec, ok=false et la grille
      // actuelle doit être conservée (jamais vidée par l'appelant).
      // fresh : true pour une relecture manuelle (bouton « Recharger »,
      // proprio uniquement — le serveur ignore fresh pour les autres rôles).
      function lireCommissionsDepuisFeuille(brand, fresh) {
        var isKool = brand === 'kool';
        var brandFilter = isKool ? 'Kool' : 'Yassir';
        return yassirLireFeuilleViaApi('commissions', { brand: isKool ? 'kool' : 'yassir', fresh: !!fresh })
          .then(function (rows) {
            if (!rows || rows.length < 2) throw new Error('Feuille Commissions vide');
            var parsed = parseCommissionRows(rows, brandFilter);
            if (parsed.count === 0) throw new Error('Aucune commission lue');
            return { ok: true, count: parsed.count, map: parsed.map };
          })
          .catch(function () { return { ok: false, count: 0, map: {} }; });
      }
      window.yassirLireCommissionsDepuisFeuille = lireCommissionsDepuisFeuille;

      window.yassirSyncHistoricalSheets = function (manualTrigger) {
        if (manualTrigger && !isOwnerAdmin() && !canViewAllPortfolios()) return;
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          if (manualTrigger) return window.yassirSyncKoolSheets(true);
          return Promise.resolve();
        }
        var icon = document.getElementById('iconSyncHistSheets');
        var label = document.getElementById('labelSyncHistSheets');
        if (icon) {
          icon.className = 'fa-solid fa-arrows-rotate fa-spin';
        }
        if (label) label.textContent = 'Chargement Oct–Nov...';

        if (manualTrigger) {
          showToast('Synchronisation des mois <strong>Octobre & Novembre</strong> depuis Google Sheets...', 'info');
        }

        // Data Yassir octobre + novembre via le Worker (G3 suite) :
        // sources data-oct / data-nov — le Worker lit déjà tous les onglets
        // valides du classeur et déduplique par N° commande. Les libellés
        // restent ceux de la configuration (ex. « Octobre (Google Sheets) »),
        // un seul index __fileSourceIdx par mois.
        var moisConfig = LIVE_SHEETS_CONFIG.HISTORICAL_MONTHS || [];
        var mois = [
          { source: 'data-oct', label: (moisConfig[0] && moisConfig[0].label) || 'Octobre (Google Sheets)' },
          { source: 'data-nov', label: (moisConfig[1] && moisConfig[1].label) || 'Novembre (Google Sheets)' }
        ];
        var promises = mois.map(function (m) {
          // Synchro auto : source déjà synchronisée il y a moins de 30 min —
          // on la saute (l'archive IndexedDB fait foi), sans la compter en échec.
          if (!manualTrigger && yassirSliceSyncRecente(m.source, 'yassir')) {
            return Promise.resolve({ label: m.label, rows: [], ok: true, skipped: true });
          }
          return yassirLireFeuilleViaApi(m.source, { brand: 'yassir', fresh: !!(manualTrigger && isOwnerAdmin()) })
            .then(function (rows) {
              return { label: m.label, rows: rows, ok: true };
            })
            .catch(function (err) {
              return { label: m.label, rows: [], ok: false, error: err && err.message ? err.message : 'Erreur' };
            });
        });

        return Promise.all(promises).then(function (results) {
          var loadedMonths = [];
          var failedMonths = [];
          var totalAddedRows = 0;

          results.forEach(function (res) {
            if (res.skipped) {
              loadedMonths.push(res.label.replace(' (Google Sheets)', '') + ' (à jour)');
              return;
            }
            if (res.ok && res.rows && res.rows.length > 1) {
              // Si ce mois est déjà présent dans storedFilesMeta, on le met à jour proprement
              var existingIdx = state.storedFilesMeta.findIndex(function (m) { return m.name === res.label; });
              if (existingIdx !== -1 && state.rawSourceRows && state.rawSourceRows.length > 1) {
                var cleanedRows = [state.rawSourceRows[0]];
                for (var r = 1; r < state.rawSourceRows.length; r++) {
                  var row = state.rawSourceRows[r];
                  if (row.__fileSourceIdx === existingIdx) continue;
                  if (typeof row.__fileSourceIdx === 'number' && row.__fileSourceIdx > existingIdx) {
                    row.__fileSourceIdx = row.__fileSourceIdx - 1;
                  }
                  cleanedRows.push(row);
                }
                state.rawSourceRows = cleanedRows;
                state.storedFilesMeta.splice(existingIdx, 1);
              }

              var added = fusionnerNouveauFichierDansArchive(res.label, res.rows);
              totalAddedRows += added;
              loadedMonths.push(res.label.replace(' (Google Sheets)', '') + ' (' + (res.rows.length - 1) + ')');
            } else {
              failedMonths.push(res.label.replace(' (Google Sheets)', ''));
            }
          });

          if (icon) {
            icon.className = 'fa-solid fa-cloud-arrow-down';
          }

          if (loadedMonths.length > 0) {
            detecterBornesDatesSource(state.rawSourceRows);
            // Semaine par défaut sur les données fraîches (diagnostic
            // 2026-11-27) : sans choix manuel, la semaine suit la date max.
            reappliquerSemaineParDefautApresSynchro();
            // La semaine appliquée doit être persistée dans le cache de la
            // marque active, sinon une bascule de marque restaure l'ancienne
            // semaine (ou aucune) au lieu de celle qui vient d'être appliquée.
            saveCurrentStateToBrandCache('yassir');
            if (!state.dateStart && !state.dateEnd) {
              updateDatePresetButtonsUI('ALL');
            } else {
              updateDatePresetButtonsUI('');
            }

            var totalRowsInBase = Math.max(0, state.rawSourceRows.length - 1);
            var nbFiles = state.storedFilesMeta.length;
            document.getElementById('mainFileName').textContent = nbFiles + ' source(s) • ' + totalRowsInBase.toLocaleString('fr-FR') + ' commandes';
            document.getElementById('mainFileName').title = state.storedFilesMeta.map(function (m) { return m.name; }).join(', ');
            document.getElementById('mainFileSub').textContent = state.minAvailableDate && state.maxAvailableDate
              ? ('Période globale : ' + state.minAvailableDate + ' → ' + state.maxAvailableDate)
              : 'Base cloud synchronisée';
            document.getElementById('badgeSourceStatus').textContent = nbFiles + ' source(s)';
            document.getElementById('badgeSourceStatus').className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#E0F7F4] text-[#00897B]';
            if (isOwnerAdmin()) document.getElementById('btnResetAll').classList.remove('hidden');

            if (label) label.textContent = 'Mai–Nov OK (' + loadedMonths.length + '/7)';

            saveArchiveToIndexedDb();
            executerTraitementMetier();
            if (state.activeTab === 'global_analysis') window.yassirRenderGlobalAnalysis();
            if (state.activeTab === 'restaurant_analysis') window.yassirRenderRestaurantAnalysis();

            if (manualTrigger || totalAddedRows > 0) {
              var msg = '<strong>Historique Google Sheets synchronisé !</strong><br/>' +
                        '• Mois chargés : <strong>' + escapeHtml(loadedMonths.join(', ')) + '</strong>.<br/>' +
                        '• Base totale : <strong>' + totalRowsInBase.toLocaleString('fr-FR') + '</strong> commandes.';
              if (failedMonths.length > 0) {
                msg += '<br/><span class="text-[#FF2A6D]">Non accessibles pour le moment : ' + escapeHtml(failedMonths.join(', ')) + '</span>';
              }
              showToast(msg, 'success');
            }
          } else {
            if (label) label.textContent = 'Sync Mai–Nov';
            if (manualTrigger) {
              showToast(
                'Impossible de lire l’historique Octobre & Novembre via le serveur. Réessayez plus tard.',
                'error'
              );
            }
          }
          noterStatutSynchro('Octobre & Novembre', loadedMonths.length > 0 && failedMonths.length === 0);
        });
      };

      function matchAgentFirstOrFullName(rawText) {
        var exact = matchAgentFromText(rawText);
        if (exact) return exact;
        var norm = normalizeText(rawText);
        if (!norm) return '';
        var firstNameMap = {
          'aziza': 'Aziza Souli',
          'khouloud': 'Khouloud Harbaoui',
          'omar': 'Omar Beldi',
          'imed': 'Imed Fourati',
          'nour': 'Nour Ali',
          'iheb': 'Iheb Dachraoui',
          'ilyes': 'Ilyes kammoun',
          'ilyas': 'Ilyes kammoun',
          'eya': 'Eya Majdoub'
        };
        var keys = Object.keys(firstNameMap);
        for (var i = 0; i < keys.length; i++) {
          var fn = keys[i];
          if (norm === fn || norm.startsWith(fn + ' ') || norm.endsWith(' ' + fn) || norm.indexOf(' ' + fn + ' ') !== -1) {
            return firstNameMap[fn];
          }
        }
        return '';
      }

      // Lecture de l'onglet Budget : les lignes sont séparées par colonne APP
      // (Yassir / Kool). Une ligne sans APP (ou colonne APP absente) est traitée
      // comme Yassir (compatibilité avec l'ancien classeur Budget Yassir seul).
      // Retour : { yassir: {am: budget}, kool: {am: budget}, global: number }.
      function parseBudgetRowsParMarque(rows) {
        var parsedYassir = {};
        var parsedKool = {};
        var explicitGlobal = 0;
        // Colonne APP : cherchée dans les 5 premières lignes (ligne d'en-tête).
        var idxApp = -1;
        for (var hr = 0; hr < Math.min(5, rows.length); hr++) {
          var hdrRow = rows[hr] || [];
          for (var hc = 0; hc < hdrRow.length; hc++) {
            if (normalizeText(hdrRow[hc]) === 'app') { idxApp = hc; break; }
          }
          if (idxApp !== -1) break;
        }
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r];
          if (!row || row.length === 0) continue;
          var rowBrand = 'yassir';
          if (idxApp !== -1 && idxApp < row.length && normalizeText(row[idxApp]) === 'kool') {
            rowBrand = 'kool';
          }
          var matchedAm = '';
          var isGlobalRow = false;
          var numericValues = [];
          for (var c = 0; c < row.length; c++) {
            var cellStr = String(row[c] !== null && row[c] !== undefined ? row[c] : '').trim();
            if (!cellStr) continue;
            var low = cellStr.toLowerCase();
            if (low === 'global' || low === 'total' || low === 'budget global' || low === 'total budget' || low.includes('budget global')) {
              isGlobalRow = true;
            }
            if (!matchedAm) {
              var ag = matchAgentFirstOrFullName(cellStr);
              if (ag) matchedAm = ag;
            }
            var cleanedNumStr = cellStr
              .replace(/tnd|dt|€|\$|%/gi, '')
              .replace(/[\s\u00A0\u202F]/g, '')
              .replace(/,/g, '.');
            if (/^-?\d+(\.\d+)?$/.test(cleanedNumStr)) {
              var num = parseFloat(cleanedNumStr);
              if (Number.isFinite(num) && num > 0) {
                numericValues.push(num);
              }
            }
          }
          if (matchedAm && numericValues.length > 0) {
            if (rowBrand === 'kool') parsedKool[matchedAm] = numericValues[0];
            else parsedYassir[matchedAm] = numericValues[0];
          } else if (isGlobalRow && numericValues.length > 0) {
            explicitGlobal = numericValues[0];
          }
        }
        return { yassir: parsedYassir, kool: parsedKool, global: explicitGlobal };
      }
      window.yassirParseBudgetRowsParMarque = parseBudgetRowsParMarque;

      window.yassirSyncBudgetSheet = function (manualTrigger) {
        if (manualTrigger && !isOwnerAdmin() && !canViewAllPortfolios()) return;
        var icon = document.getElementById('iconSyncBudget');
        var label = document.getElementById('labelSyncBudget');
        if (icon) icon.classList.add('fa-spin');
        if (label) label.textContent = 'Sync Budget...';

        // Budget via le Worker (G3 suite) : la feuille est partagée entre les
        // deux marques (colonne APP) — on lit les deux marques et on fusionne
        // les lignes (mêmes en-têtes). Une marque en échec ne casse pas l'autre.
        var freshBudget = !!(manualTrigger && isOwnerAdmin());
        var budgetYassir = yassirLireFeuilleViaApi('budget', { brand: 'yassir', fresh: freshBudget }).catch(function () { return []; });
        var budgetKool = yassirLireFeuilleViaApi('budget', { brand: 'kool', fresh: freshBudget }).catch(function () { return []; });
        return Promise.all([budgetYassir, budgetKool])
          .then(function (pages) {
            var rows = [];
            pages.forEach(function (r) {
              if (!r || r.length === 0) return;
              if (rows.length === 0) rows = r.slice();
              else rows = rows.concat(r.slice(1)); // en-têtes répétés
            });
            if (!rows || rows.length === 0) throw new Error('Feuille Budget vide');
            var split = parseBudgetRowsParMarque(rows);
            if (Object.keys(split.yassir).length === 0 && Object.keys(split.kool).length === 0) {
              throw new Error('Aucune ligne AM reconnue dans la feuille Budget');
            }

            // Stockage par marque (motif brandArchives) : la carte Yassir garde
            // l'ancienne clé de stockage, la carte Kool a sa propre clé.
            var sumYassirBudget = Object.values(split.yassir).reduce(function (a, v) { return a + (Number(v) || 0); }, 0);
            safeSet(STORAGE_KEYS.BUDGET, JSON.stringify({ byAm: split.yassir, global: sumYassirBudget }));
            saveKoolBudgetToStore(split.kool);
            brandArchives.yassir.budgetByAm = split.yassir;
            brandArchives.kool.budgetByAm = split.kool;
            state.budgetByAm = (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? split.kool : split.yassir;
            state.budgetGlobal = Object.values(state.budgetByAm).reduce(function (a, v) { return a + (Number(v) || 0); }, 0);

            if (icon) icon.classList.remove('fa-spin');
            if (label) {
              var now = new Date();
              var hh = String(now.getHours()).padStart(2, '0');
              var mm = String(now.getMinutes()).padStart(2, '0');
              label.textContent = 'Budget OK (' + hh + ':' + mm + ')';
            }

            mettreAJourInterface();
            noterStatutSynchro('Budget', true);
            if (manualTrigger) {
              showToast(
                '<strong>Budgets AM synchronisés !</strong> (' + Object.keys(state.budgetByAm).length + ' AM configurés).',
                'success'
              );
            }
          })
          .catch(function (err) {
            noterStatutSynchro('Budget', false);
            if (icon) icon.classList.remove('fa-spin');
            if (label) label.textContent = 'Sync Budget';
            if (manualTrigger) {
              showToast(
                '<strong>Budget non accessible pour le moment :</strong> la lecture via le serveur a échoué (ou saisissez les budgets manuellement ci-dessous).',
                'error'
              );
            }
          });
      };

      window.yassirSaveManualBudgets = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!isOwnerAdmin()) return false;
        var parsedByAm = {};
        var sum = 0;
        AM_AGENTS.forEach(function (am) {
          var inp = document.getElementById('budgetInput_' + am.replace(/\s+/g, '_'));
          if (inp) {
            var val = purgerNombre(inp.value);
            if (val > 0) {
              parsedByAm[am] = Number(val.toFixed(2));
              sum += parsedByAm[am];
            }
          }
        });
        state.budgetByAm = parsedByAm;
        state.budgetGlobal = sum;
        saveBudgetToStore();
        mettreAJourInterface();
        showToast('<strong>Budgets AM enregistrés !</strong> (' + Object.keys(parsedByAm).length + ' AM configurés).', 'success');
        return false;
      };

      // Statut de la dernière synchro par source (audit 2026-11-27, item 10c) :
      // chaque synchro note ici son résultat (true = OK, false = échec) pour que
      // le pied de page affiche un statut honnête au lieu d'un succès inconditionnel.
      var _statutSynchroParSource = {};
      function noterStatutSynchro(nom, ok) {
        _statutSynchroParSource[nom] = !!ok;
      }
      window.yassirStatutSynchroParSource = function () { return Object.assign({}, _statutSynchroParSource); };
      window.yassirNoterStatutSynchro = noterStatutSynchro;

      window.yassirSyncAllFromGoogleSheets = function (manualTrigger) {
        if (manualTrigger && !isOwnerAdmin() && !canViewAllPortfolios()) return;
        if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
          if (manualTrigger) return window.yassirSyncKoolSheets(true);
          return Promise.resolve();
        }
        var icon = document.getElementById('iconSyncSheets');
        var label = document.getElementById('labelSyncSheets');
        if (icon) icon.classList.add('fa-spin');
        if (label) label.textContent = 'Synchronisation...';

        // 1. Portefeuilles Yassir via le Worker (G3 suite) : source
        // 'portfolios' — le Worker lit déjà tous les onglets AM du classeur
        // fusionné, filtre par marque (colonne APP) et par rôle/AM, et ajoute
        // la colonne AM. L'extracteur ne fait plus que transformer les lignes
        // en carte { restaurant -> { am, ville, segment } }.
        var portfoliosPromise = yassirLireFeuilleViaApi('portfolios', { brand: 'yassir', fresh: !!(manualTrigger && isOwnerAdmin()) })
          .then(function (rows) {
            var map = {};
            var added = extraireRestaurantsDepuisLignesSheet(rows, '', map, 'Yassir');
            if (added === 0 || Object.keys(map).length === 0) {
              throw new Error('Aucun restaurant extrait depuis la feuille Portefeuilles');
            }
            var detailsByAm = {};
            Object.keys(map).forEach(function (k) {
              var a = map[k].am || '';
              detailsByAm[a] = (detailsByAm[a] || 0) + 1;
            });
            var details = Object.keys(detailsByAm).map(function (a) { return a + ' (' + detailsByAm[a] + ')'; });
            return { ok: true, map: map, details: details };
          })
          .catch(function () {
            return { ok: false, map: {}, details: [] };
          });

        // 2. Synchronisation stricte des Commissions Yassir depuis la feuille
        // (même lecteur que le bouton « Recharger depuis Google Sheets »).
        var commPromise = lireCommissionsDepuisFeuille('Yassir', !!(manualTrigger && isOwnerAdmin()));

        return Promise.all([portfoliosPromise, commPromise]).then(function (results) {
          var pResult = results[0];
          var commResult = results[1];

          var anyPortfolioSuccess = false;
          var syncedTabsDetails = [];

          if (pResult && pResult.ok && pResult.map && Object.keys(pResult.map).length > 0) {
            anyPortfolioSuccess = true;
            syncedTabsDetails = pResult.details || [];
            // Ne garder EXCLUSIVEMENT que la liste synchronisée depuis Google Sheets (aucune liste par défaut ajoutée)
            state.amPortfolios = pResult.map;
            savePortfoliosToStore();
          }

          var updatedCommCount = 0;
          if (commResult.ok && commResult.count > 0) {
            var freshComm = commResult.map;
            updatedCommCount = commResult.count;
            safeSet(STORAGE_KEYS.COMMISSIONS, JSON.stringify(freshComm));
            brandArchives.yassir.customCommissions = Object.assign({}, freshComm);
            if (currentBrand === 'yassir') {
              state.customCommissions = Object.assign({}, freshComm);
            }
          }

          noterStatutSynchro('Portefeuilles & Comm.', anyPortfolioSuccess || updatedCommCount > 0);

          if (icon) icon.classList.remove('fa-spin');
          if (label) {
            var now = new Date();
            var hh = String(now.getHours()).padStart(2, '0');
            var mm = String(now.getMinutes()).padStart(2, '0');
            label.textContent = (anyPortfolioSuccess || updatedCommCount > 0) ? ('Sync OK (' + hh + ':' + mm + ')') : 'Sync Sheets Live';
          }

          if (state.rawSourceRows && state.rawSourceRows.length > 1) {
            executerTraitementMetier();
          } else {
            mettreAJourInterface();
          }

          if (manualTrigger) {
            if (anyPortfolioSuccess || updatedCommCount > 0) {
              showToast(
                '<strong>Synchronisation Google Sheets réussie !</strong><br/>' +
                '• Portefeuilles AM : <strong>' + Object.keys(state.amPortfolios).length + '</strong> restaurants (' + (syncedTabsDetails.join(', ') || 'à jour') + ').<br/>' +
                '• Commissions : <strong>' + Object.keys(state.customCommissions).length + '</strong> taux TTC à jour.',
                'success'
              );
            } else {
              showToast(
                'Accès aux feuilles impossible pour le moment (lecture via le serveur en échec). Réessayez plus tard.',
                'error'
              );
            }
          }
        });
      };

      // Un seul bouton « Sync Yassir » : enchaîne les 6 synchros Yassir séquentiellement.
      // Les 6 fonctions sont appelées avec manualTrigger=false (silencieuses : pas de toast
      // individuel) ; le bouton unique affiche la progression puis un résumé. Chaque fonction
      // retourne désormais sa promesse, ce qui permet d'attendre sa fin réelle avant de
      // passer à la suivante (évite les écritures concurrentes dans IndexedDB/localStorage).
      window.yassirSyncYassirAll = function () {
        if (!isOwnerAdmin()) return;
        if (window._yassirSyncAllRunning) return;
        window._yassirSyncAllRunning = true;
        var icon = document.getElementById('iconSyncYassirAll');
        var label = document.getElementById('labelSyncYassirAll');
        var steps = [
          { name: 'Portefeuilles & Comm.', fn: window.yassirSyncAllFromGoogleSheets },
          { name: 'Octobre & Novembre', fn: window.yassirSyncHistoricalSheets },
          { name: 'Budget', fn: window.yassirSyncBudgetSheet },
          { name: 'Statut Active/Inactive', fn: window.yassirSyncRestoStatusSheet },
          { name: 'Participation Offres', fn: window.yassirSyncOffreParticipationSheet },
          { name: 'Données 2025 (YoY)', fn: window.yassirSync2025Sheet }
        ];
        var failed = [];
        var i = 0;
        if (icon) icon.classList.add('fa-spin');
        function setLabel(txt) { if (label) label.textContent = txt; }
        function next() {
          if (i >= steps.length) {
            window._yassirSyncAllRunning = false;
            if (icon) icon.classList.remove('fa-spin');
            var now = new Date();
            var hh = String(now.getHours()).padStart(2, '0');
            var mm = String(now.getMinutes()).padStart(2, '0');
            if (failed.length === 0) {
              setLabel('Yassir OK (' + hh + ':' + mm + ')');
              if (typeof window.yassirEffacerEchecSynchro === 'function') window.yassirEffacerEchecSynchro('yassir');
              showToast('<strong>Synchronisation Yassir terminée !</strong> (6/6 : Portefeuilles & Comm., Octobre & Novembre, Budget, Statut, Participation Offres, Données 2025).', 'success');
            } else {
              setLabel('Yassir partiel (' + (steps.length - failed.length) + '/6)');
              if (typeof window.yassirEnregistrerEchecSynchro === 'function') window.yassirEnregistrerEchecSynchro('yassir', failed.join(', '));
              showToast('<strong>Synchronisation Yassir partielle :</strong> en échec : ' + failed.join(', ') + '.', 'error');
            }
            return;
          }
          var step = steps[i];
          setLabel('Sync Yassir… (' + (i + 1) + '/6)');
          var done;
          try {
            done = Promise.resolve(step.fn(false));
          } catch (err) {
            done = Promise.reject(err);
          }
          i++;
          done.then(function () { next(); }, function () { failed.push(step.name); next(); });
        }
        next();
      };
