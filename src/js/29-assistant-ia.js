      /* ========================================================================
         29. ASSISTANT IA (Gemini) DANS LE SITE
         - Le front possède déjà les données (rawSourceRows après synchro) :
           il calcule un résumé compact — jamais de lignes brutes — et
           l'envoie avec chaque question à POST /api/assistant. Le Worker
           appelle Gemini avec la clé secrète GEMINI_API_KEY (jamais exposée
           au front) et renvoie la réponse.
         - Bouton flottant (micro) en bas à droite, visible après connexion
           uniquement. Panneau de chat : texte + micro (Web Speech API,
           fr-FR, gratuit navigateur) + lecture vocale de la réponse quand
           la question a été parlée.
         - Les messages sont insérés en textContent (jamais innerHTML) : une
           réponse de Gemini ne peut pas injecter de HTML dans la page.
         - Le contexte ne contient que des agrégats du périmètre de
           l'utilisateur (les données reçues sont déjà filtrées par AM côté
           serveur) : restaurants demandés en détail, top 10, totaux par AM,
           budgets, participation des 2 dernières semaines.
         ======================================================================== */

      var ASSISTANT_JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
      var ASSISTANT_MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

      function assistantIsoDepuisDateUTC(d) {
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      }
      function assistantAujourdhuiISO(nowMs) {
        var d = new Date(nowMs || Date.now());
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
      function assistantIsoMoinsJours(iso, n) {
        var p = String(iso).split('-');
        var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
        d.setUTCDate(d.getUTCDate() - n);
        return assistantIsoDepuisDateUTC(d);
      }
      // Semaine ISO d'une date : { cle: '2026-S48', lundi: '2026-11-23', dimanche: '2026-11-29' }.
      function assistantSemaineISO(isoDateStr) {
        var p = String(isoDateStr || '').split('-');
        if (p.length !== 3) return { cle: '', lundi: '', dimanche: '' };
        var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
        var dayNum = dt.getUTCDay() || 7;
        var lundi = new Date(dt); lundi.setUTCDate(dt.getUTCDate() - (dayNum - 1));
        var dimanche = new Date(dt); dimanche.setUTCDate(dt.getUTCDate() + (7 - dayNum));
        var jeudi = new Date(dt); jeudi.setUTCDate(dt.getUTCDate() + (4 - dayNum));
        var annee = jeudi.getUTCFullYear();
        var debutAnnee = new Date(Date.UTC(annee, 0, 1));
        var sem = Math.ceil((((jeudi - debutAnnee) / 86400000) + 1) / 7);
        return { cle: annee + '-S' + String(sem).padStart(2, '0'), lundi: assistantIsoDepuisDateUTC(lundi), dimanche: assistantIsoDepuisDateUTC(dimanche) };
      }
      function assistantNomJour(iso) {
        var p = String(iso).split('-');
        var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
        return ASSISTANT_JOURS_FR[d.getUTCDay()] || '';
      }
      function assistantFormaterMontant(n) {
        return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
      }
      function assistantFormaterDateFR(iso) {
        var p = String(iso).split('-');
        if (p.length !== 3) return String(iso);
        return (+p[2]) + ' ' + ASSISTANT_MOIS_FR[(+p[1]) - 1] + ' ' + p[0];
      }

      // Mapping des colonnes utiles dans les lignes brutes (rawSourceRows).
      // Le moteur a déjà calculé colMapping (TARGET_HEADERS -> indice source)
      // : on le réutilise quand il existe, sinon on lit les en-têtes bruts.
      function assistantMappingColonnes(aoa, colMapping) {
        var map = { resto: -1, status: -1, jour: -1, itemTotal: -1, totalFood: -1, couponDiscount: -1, couponAdmin: -1, couponRestaurant: -1, discountAmount: -1 };
        if (colMapping) {
          var pick = function (nom) { var v = colMapping[nom]; return (typeof v === 'number' && v >= 0) ? v : -1; };
          map.resto = pick('restaurant name');
          map.status = pick('status');
          map.jour = pick('order day');
          map.itemTotal = pick('item total');
          map.totalFood = pick('Total Food');
          map.couponDiscount = pick('coupon discount');
          map.couponAdmin = pick('coupon admin');
          map.couponRestaurant = pick('coupon restaurant');
          map.discountAmount = pick('Discount Amount');
          if (map.resto !== -1 && map.status !== -1) return map;
        }
        var headers = (aoa[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
        var find = function (noms) {
          for (var i = 0; i < noms.length; i++) {
            var ix = headers.indexOf(noms[i]);
            if (ix !== -1) return ix;
          }
          return -1;
        };
        map.resto = find(['restaurant name']);
        map.status = find(['status']);
        map.jour = find(['order day']);
        map.itemTotal = find(['item total']);
        map.totalFood = find(['total food']);
        map.couponDiscount = find(['coupon discount']);
        map.couponAdmin = find(['coupon admin']);
        map.couponRestaurant = find(['coupon restaurant']);
        map.discountAmount = find(['discount amount']);
        return map;
      }

      // CA (GMV) d'une ligne brute : même formule que le moteur
      // (Total Food + coupons pour Yassir ; Total Food seul pour Kool).
      function assistantCaLigne(row, map, isKool) {
        var tf = map.totalFood !== -1 ? purgerNombre(row[map.totalFood]) : 0;
        if (isKool) return tf;
        var coupon = Math.max(
          (map.couponAdmin !== -1 ? purgerNombre(row[map.couponAdmin]) : 0) + (map.couponRestaurant !== -1 ? purgerNombre(row[map.couponRestaurant]) : 0),
          map.couponDiscount !== -1 ? purgerNombre(row[map.couponDiscount]) : 0
        );
        return tf + coupon;
      }

      // Trouve les restaurants (noms normalisés) mentionnés dans la question :
      // nom complet en sous-chaîne, sinon un mot du nom (>= 4 lettres) présent
      // dans la question. « Babke » retrouve « Babke Kebab Sousse ». La
      // ponctuation est ignorée (« Babke, » = « Babke »).
      function yassirAssistantTrouverRestaurants(question, nomsNormalises) {
        var nettoyer = function (s) { return normalizeText(s || '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); };
        var q = nettoyer(question);
        if (!q || !nomsNormalises || nomsNormalises.length === 0) return [];
        var motsQ = q.split(/\s+/);
        var scored = [];
        for (var i = 0; i < nomsNormalises.length; i++) {
          var nom = nettoyer(nomsNormalises[i]);
          if (!nom) continue;
          var score = 0;
          if (q.indexOf(nom) !== -1) {
            score = 100 + nom.length;
          } else {
            var mots = nom.split(' ');
            for (var j = 0; j < mots.length; j++) {
              var m = mots[j];
              if (m.length >= 4 && motsQ.indexOf(m) !== -1) score = Math.max(score, m.length);
            }
          }
          if (score > 0) scored.push({ nom: nomsNormalises[i], score: score });
        }
        scored.sort(function (a, b) { return b.score - a.score; });
        return scored.slice(0, 3).map(function (s) { return s.nom; });
      }
      window.yassirAssistantTrouverRestaurants = yassirAssistantTrouverRestaurants;

      // Construit le résumé compact envoyé avec chaque question. Fenêtre :
      // jours = 14 derniers jours, semaines = 5 dernières semaines.
      // nowMs (optionnel, défaut Date.now()) sert aux tests.
      function yassirConstruireContexteAssistant(question, nowMs) {
        var brand = (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? 'Kool' : 'Yassir';
        var isKool = brand === 'Kool';
        var auj = assistantAujourdhuiISO(nowMs);
        var semCourante = assistantSemaineISO(auj);
        var semPrecedente = assistantSemaineISO(assistantIsoMoinsJours(auj, 7));
        var roleTxt = (typeof currentUser !== 'undefined' && currentUser)
          ? (currentUser.role === 'owner' ? 'propriétaire (tout voir)' : (currentUser.role === 'viewer_all' ? 'lecture seule (tout voir)' : ('AM ' + (currentUser.amName || currentUser.displayName || ''))))
          : 'non connecté';
        var lignes = [];
        lignes.push('Marque : ' + brand + '. Aujourd\'hui : ' + assistantNomJour(auj) + ' ' + assistantFormaterDateFR(auj) + '.');
        lignes.push('Semaine en cours : ' + semCourante.cle + ' (' + assistantFormaterDateFR(semCourante.lundi) + ' → ' + assistantFormaterDateFR(semCourante.dimanche) + '). Semaine précédente : ' + semPrecedente.cle + ' (' + assistantFormaterDateFR(semPrecedente.lundi) + ' → ' + assistantFormaterDateFR(semPrecedente.dimanche) + ').');
        lignes.push('Périmètre : ' + roleTxt + '. Données : 14 derniers jours (par jour) et 5 dernières semaines (par semaine). Montants en TND. CA = GMV des commandes livrées.');
        var aoa = state.rawSourceRows;
        if (!aoa || aoa.length < 2) {
          lignes.push('AUCUNE DONNÉE SYNCHRONISÉE : dis à l\'utilisateur de faire une synchronisation (bouton « Sync ' + brand + ' ») puis de reposer sa question.');
          return lignes.join('\n');
        }
        var idxCache = null;
        try { idxCache = getOrBuildSourceIndex(aoa); } catch (e) { idxCache = null; }
        var map = assistantMappingColonnes(aoa, idxCache ? idxCache.colMapping : null);
        if (map.resto === -1 || map.status === -1) {
          lignes.push('DONNÉES ILLISIBLES : les colonnes restaurant / statut sont introuvables dans les données synchronisées.');
          return lignes.join('\n');
        }
        var joursFen = {};
        for (var dj = 0; dj < 14; dj++) joursFen[assistantIsoMoinsJours(auj, dj)] = true;
        var semsFen = {};
        for (var sw = 0; sw < 5; sw++) semsFen[assistantSemaineISO(assistantIsoMoinsJours(auj, sw * 7)).cle] = true;

        var parResto = {};
        var parAm = {};
        var globalJours = {};
        var globalSemaines = {};
        var livreesSemaines = { courante: [], precedente: [] }; // pour la participation
        var idxRestoTH = TARGET_HEADERS.indexOf('restaurant name');
        var idxJourTH = TARGET_HEADERS.indexOf('order day');
        var idxItemTH = TARGET_HEADERS.indexOf('item total');
        var idxTotalFoodTH = TARGET_HEADERS.indexOf('Total Food');
        var idxDiscAmtTH = TARGET_HEADERS.indexOf('Discount Amount');
        var idxDiscTypeTH = TARGET_HEADERS.indexOf('Discount Type');
        var idxProviderTH = TARGET_HEADERS.indexOf('Discount Type Provider');
        var idxFoodCatTH = TARGET_HEADERS.indexOf('Food Category');
        var entries = idxCache ? idxCache.entries : null;
        var itererLignes = function (cb) {
          if (entries && entries.length > 0) {
            for (var e = 0; e < entries.length; e++) cb(entries[e].row, entries[e].opIso);
          } else {
            for (var r = 1; r < aoa.length; r++) {
              var raw = aoa[r];
              if (!raw) continue;
              var iso = map.jour !== -1 ? parseOrderDayToIsoDate(raw[map.jour]) : '';
              cb(raw, iso);
            }
          }
        };
        itererLignes(function (row, opIso) {
          if (!opIso) return;
          var semCle = assistantSemaineISO(opIso).cle;
          if (!joursFen[opIso] && !semsFen[semCle]) return;
          var restoRaw = map.resto !== -1 ? String(row[map.resto] || '').trim() : '';
          if (!restoRaw) return;
          var restoNorm = normalizeText(restoRaw);
          var livre = estCommandeLivree(map.status !== -1 ? row[map.status] : '');
          var ca = livre ? assistantCaLigne(row, map, isKool) : 0;
          var am = '';
          try { am = determinerAmPourCommande(restoRaw); } catch (e) { am = ''; }
          var agg = parResto[restoNorm];
          if (!agg) { agg = parResto[restoNorm] = { nom: restoRaw, am: am, jours: {}, semaines: {} }; }
          if (joursFen[opIso]) {
            var aj = agg.jours[opIso] || (agg.jours[opIso] = { rec: 0, liv: 0, ca: 0 });
            aj.rec += 1; if (livre) { aj.liv += 1; aj.ca += ca; }
            var gj = globalJours[opIso] || (globalJours[opIso] = { rec: 0, liv: 0, ca: 0 });
            gj.rec += 1; if (livre) { gj.liv += 1; gj.ca += ca; }
          }
          if (semsFen[semCle]) {
            var as = agg.semaines[semCle] || (agg.semaines[semCle] = { rec: 0, liv: 0, ca: 0 });
            as.rec += 1; if (livre) { as.liv += 1; as.ca += ca; }
            var gs = globalSemaines[semCle] || (globalSemaines[semCle] = { rec: 0, liv: 0, ca: 0 });
            gs.rec += 1; if (livre) { gs.liv += 1; gs.ca += ca; }
            if (am && am !== 'Non attribué') {
              var aAgg = parAm[am] || (parAm[am] = { semaines: {} });
              var aS = aAgg.semaines[semCle] || (aAgg.semaines[semCle] = { rec: 0, liv: 0, ca: 0 });
              aS.rec += 1; if (livre) { aS.liv += 1; aS.ca += ca; }
            }
          }
          // Lignes livrées des 2 dernières semaines, au format attendu par
          // le calcul de participation (cellules TARGET_HEADERS).
          if (livre && (semCle === semCourante.cle || semCle === semPrecedente.cle)) {
            var cells = new Array(TARGET_HEADERS.length).fill('');
            cells[idxRestoTH] = restoRaw;
            cells[idxJourTH] = opIso;
            var brutLigne = map.itemTotal !== -1 ? purgerNombre(row[map.itemTotal]) : 0;
            if (!(brutLigne > 0)) brutLigne = (map.totalFood !== -1 ? purgerNombre(row[map.totalFood]) : 0) + (map.discountAmount !== -1 ? purgerNombre(row[map.discountAmount]) : 0);
            cells[idxItemTH] = brutLigne;
            cells[idxTotalFoodTH] = map.totalFood !== -1 ? row[map.totalFood] : '';
            cells[idxDiscAmtTH] = map.discountAmount !== -1 ? row[map.discountAmount] : '';
            cells[idxDiscTypeTH] = '';
            cells[idxProviderTH] = '';
            cells[idxFoodCatTH] = '';
            var bucket = semCle === semCourante.cle ? livreesSemaines.courante : livreesSemaines.precedente;
            bucket.push({ cells: cells, _remise: map.discountAmount !== -1 ? purgerNombre(row[map.discountAmount]) : 0 });
          }
        });

        var fmtAgg = function (a) { return (a ? a.rec : 0) + ' reçues, ' + (a ? a.liv : 0) + ' livrées, CA ' + assistantFormaterMontant(a ? a.ca : 0) + ' TND'; };
        var semsTriees = Object.keys(globalSemaines).sort().reverse();
        lignes.push('GLOBAL par semaine :');
        for (var si = 0; si < semsTriees.length; si++) {
          lignes.push('  ' + semsTriees[si] + ' : ' + fmtAgg(globalSemaines[semsTriees[si]]));
        }
        lignes.push('GLOBAL par jour (7 derniers jours) :');
        for (var dj2 = 6; dj2 >= 0; dj2--) {
          var jIso = assistantIsoMoinsJours(auj, dj2);
          lignes.push('  ' + jIso + ' (' + assistantNomJour(jIso) + ') : ' + fmtAgg(globalJours[jIso]));
        }

        // Top 10 de la semaine en cours (par reçues).
        var tousRestos = Object.keys(parResto).map(function (k) { return parResto[k]; });
        tousRestos.sort(function (a, b) {
          var ra = (a.semaines[semCourante.cle] || { rec: 0 }).rec;
          var rb = (b.semaines[semCourante.cle] || { rec: 0 }).rec;
          return rb - ra;
        });
        lignes.push('TOP 10 semaine ' + semCourante.cle + ' (par reçues) :');
        var topN = Math.min(10, tousRestos.length);
        for (var t = 0; t < topN; t++) {
          var tr = tousRestos[t];
          lignes.push('  ' + (t + 1) + '. ' + tr.nom + ' — ' + fmtAgg(tr.semaines[semCourante.cle]));
        }

        // Restaurants (et AM) mentionnés dans la question : détail complet.
        var nomsDemandes = yassirAssistantTrouverRestaurants(question, Object.keys(parResto));
        var amsDemandes = [];
        try {
          var nomsAm = (typeof AM_AGENTS !== 'undefined' && AM_AGENTS.length > 0) ? AM_AGENTS.slice() : Object.keys(parAm);
          amsDemandes = yassirAssistantTrouverRestaurants(question, nomsAm.map(function (n) { return normalizeText(n); }))
            .map(function (nn) {
              var orig = nomsAm.find(function (n) { return normalizeText(n) === nn; });
              return orig || nn;
            });
        } catch (e) { amsDemandes = []; }
        if (nomsDemandes.length > 0) {
          lignes.push('RESTAURANTS DEMANDÉS :');
          for (var rd = 0; rd < nomsDemandes.length; rd++) {
            var rr = parResto[nomsDemandes[rd]];
            if (!rr) continue;
            lignes.push('  ' + rr.nom + ' (AM : ' + (rr.am || 'Non attribué') + ') :');
            lignes.push('    Par jour (14 derniers jours) :');
            for (var dj3 = 13; dj3 >= 0; dj3--) {
              var jIso3 = assistantIsoMoinsJours(auj, dj3);
              var aJ = rr.jours[jIso3];
              if (aJ) lignes.push('      ' + jIso3 + ' (' + assistantNomJour(jIso3) + ') : ' + fmtAgg(aJ));
            }
            lignes.push('    Par semaine :');
            for (var sw2 = 0; sw2 < 5; sw2++) {
              var sCle = assistantSemaineISO(assistantIsoMoinsJours(auj, sw2 * 7)).cle;
              var aS2 = rr.semaines[sCle];
              if (aS2) lignes.push('      ' + sCle + ' : ' + fmtAgg(aS2));
            }
          }
        } else {
          lignes.push('Aucun restaurant nommé dans la question : ne détaille aucun restaurant en particulier, réponds à partir du GLOBAL et du TOP 10 ci-dessus.');
        }
        if (amsDemandes.length > 0) {
          lignes.push('AM DEMANDÉS :');
          for (var ad = 0; ad < amsDemandes.length; ad++) {
            var aAgg2 = parAm[amsDemandes[ad]];
            if (!aAgg2) continue;
            lignes.push('  ' + amsDemandes[ad] + ' :');
            for (var sw3 = 0; sw3 < 5; sw3++) {
              var sCle3 = assistantSemaineISO(assistantIsoMoinsJours(auj, sw3 * 7)).cle;
              var aS3 = aAgg2.semaines[sCle3];
              if (aS3) lignes.push('    ' + sCle3 + ' : ' + fmtAgg(aS3));
            }
          }
        }

        // Totaux par AM (semaine en cours + précédente).
        var nomsAmTous = Object.keys(parAm).sort();
        if (nomsAmTous.length > 0) {
          lignes.push('PAR AM :');
          for (var pa = 0; pa < nomsAmTous.length; pa++) {
            var aAgg3 = parAm[nomsAmTous[pa]];
            lignes.push('  ' + nomsAmTous[pa] + ' — ' + semCourante.cle + ' : ' + fmtAgg(aAgg3.semaines[semCourante.cle]) + ' ; ' + semPrecedente.cle + ' : ' + fmtAgg(aAgg3.semaines[semPrecedente.cle]));
          }
        }

        // Budgets (jamais 0 quand ils sont inconnus : « non synchronisé »).
        var budgetsConnus = [];
        try {
          if (state.budgetGlobal > 0) budgetsConnus.push('global ' + assistantFormaterMontant(state.budgetGlobal) + ' TND');
          var bAm = state.budgetByAm || {};
          Object.keys(bAm).sort().forEach(function (amN) {
            if (Number(bAm[amN]) > 0) budgetsConnus.push(amN + ' ' + assistantFormaterMontant(bAm[amN]) + ' TND');
          });
        } catch (e) {}
        lignes.push(budgetsConnus.length > 0 ? ('BUDGETS : ' + budgetsConnus.join(' ; ') + '.') : 'BUDGETS : non synchronisés (aucun budget connu, ne pas afficher 0).');

        // Participation des offres (2 dernières semaines) : remise totale +
        // coût restaurant (même calcul que le panneau Participation).
        var participationLigne = function (liste, cleSem) {
          if (!liste || liste.length === 0) return '  ' + cleSem + ' : aucune commande livrée.';
          var remise = 0;
          for (var i = 0; i < liste.length; i++) remise += liste[i]._remise || 0;
          var cout = 0;
          try { cout = (typeof window !== 'undefined' && typeof window.yassirCalculerCoutParticipationOffresLivrees === 'function') ? window.yassirCalculerCoutParticipationOffresLivrees(liste) : 0; } catch (e) { cout = 0; }
          return '  ' + cleSem + ' : remise totale ' + assistantFormaterMontant(remise) + ' TND, coût restaurant ' + assistantFormaterMontant(cout) + ' TND (' + liste.length + ' livrées).';
        };
        lignes.push('PARTICIPATION (offres livrées) :');
        lignes.push(participationLigne(livreesSemaines.courante, semCourante.cle));
        lignes.push(participationLigne(livreesSemaines.precedente, semPrecedente.cle));

        var texte = lignes.join('\n');
        // Garde de taille : si le contexte dépasse 12 000 caractères, on
        // retire les lignes de détail journalier (dates complètes) des
        // restaurants demandés — les semaines + le global suffisent alors.
        if (texte.length > 12000) {
          var lignes2 = lignes.filter(function (l) { return !/^      \d{4}-\d{2}-\d{2} \(/.test(l); });
          texte = lignes2.join('\n');
        }
        return texte;
      }
      window.yassirConstruireContexteAssistant = yassirConstruireContexteAssistant;

      // ---- Panneau de chat ----
      var assistantVoixActive = false;
      var assistantEnCours = false;

      function yassirAssistantAjouterMessage(texte, qui) {
        var zone = document.getElementById('assistantIAMessages');
        if (!zone) return null;
        var div = document.createElement('div');
        if (qui === 'user') {
          div.className = 'ml-auto max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-[#6C2BD9] text-white whitespace-pre-wrap break-words';
        } else {
          div.className = 'mr-auto max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words';
        }
        div.textContent = texte; // textContent uniquement : jamais d'HTML (réponse Gemini).
        zone.appendChild(div);
        zone.scrollTop = zone.scrollHeight;
        return div;
      }

      window.yassirAssistantOuvrir = function () {
        var panel = document.getElementById('assistantIAPanel');
        var btn = document.getElementById('btnAssistantIA');
        if (!panel) return;
        panel.classList.remove('hidden');
        if (btn) btn.classList.add('hidden');
        var brandEl = document.getElementById('assistantIABrand');
        if (brandEl) {
          var brand = (typeof currentBrand !== 'undefined' && currentBrand === 'kool') ? 'Kool' : 'Yassir';
          var sem = assistantSemaineISO(assistantAujourdhuiISO());
          brandEl.textContent = brand + ' • ' + sem.cle;
        }
        var micBtn = document.getElementById('assistantIAMic');
        if (micBtn) {
          var srOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
          if (srOk) micBtn.classList.remove('hidden'); else micBtn.classList.add('hidden');
        }
        var zone = document.getElementById('assistantIAMessages');
        if (zone && zone.childElementCount === 0) {
          yassirAssistantAjouterMessage('Bonjour ! Posez votre question en écrivant ou avec le micro. Par exemple : « Babke, combien de commandes mardi ? »', 'assistant');
        }
        var input = document.getElementById('assistantIAInput');
        if (input) input.focus();
      };

      window.yassirAssistantFermer = function () {
        var panel = document.getElementById('assistantIAPanel');
        var btn = document.getElementById('btnAssistantIA');
        if (panel) panel.classList.add('hidden');
        if (btn) { btn.classList.remove('hidden'); btn.classList.add('flex'); }
        try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
      };

      window.yassirAssistantAfficherBouton = function () {
        var btn = document.getElementById('btnAssistantIA');
        if (!btn) return;
        btn.classList.remove('hidden');
        btn.classList.add('flex');
      };

      function yassirAssistantLire(texte) {
        try {
          if (!window.speechSynthesis || !texte) return;
          window.speechSynthesis.cancel();
          var u = new SpeechSynthesisUtterance(texte);
          u.lang = 'fr-FR';
          window.speechSynthesis.speak(u);
        } catch (e) {}
      }

      window.yassirEnvoyerQuestionAssistant = function () {
        var input = document.getElementById('assistantIAInput');
        var question = input ? input.value.trim() : '';
        if (!question || assistantEnCours) return;
        if (input) input.value = '';
        yassirAssistantAjouterMessage(question, 'user');
        var attente = yassirAssistantAjouterMessage('Je cherche dans vos données…', 'assistant');
        assistantEnCours = true;
        var contexte = '';
        try { contexte = yassirConstruireContexteAssistant(question); } catch (e) { contexte = ''; }
        PulseAuth.call('POST', '/api/assistant', { question: question, context: contexte })
          .then(function (r) {
            var rep = (r && r.answer) ? String(r.answer) : 'Je n\'ai pas de réponse pour cette question.';
            if (attente) attente.textContent = rep;
            if (assistantVoixActive) yassirAssistantLire(rep);
            assistantVoixActive = false;
          })
          .catch(function (err) {
            var msg = (err && err.status === 429)
              ? 'Trop de questions d\'affilée, réessayez dans quelques minutes.'
              : 'Assistant indisponible pour le moment, réessayez.';
            if (attente) attente.textContent = msg;
            assistantVoixActive = false;
          })
          .then(function () { assistantEnCours = false; });
      };

      var assistantReconnaissance = null;
      window.yassirAssistantMicro = function () {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          showToast('La reconnaissance vocale n\'est pas disponible sur ce navigateur. Écrivez votre question.', 'info');
          return;
        }
        if (assistantReconnaissance) {
          try { assistantReconnaissance.stop(); } catch (e) {}
          assistantReconnaissance = null;
          return;
        }
        var rec = new SR();
        rec.lang = 'fr-FR';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = function (ev) {
          var texte = '';
          try { texte = ev.results[0][0].transcript || ''; } catch (e) {}
          var input = document.getElementById('assistantIAInput');
          if (input) input.value = texte;
          if (texte.trim()) {
            assistantVoixActive = true;
            window.yassirEnvoyerQuestionAssistant();
          }
        };
        rec.onerror = function () {
          assistantReconnaissance = null;
          showToast('Je n\'ai pas compris, réessayez ou écrivez votre question.', 'info');
        };
        rec.onend = function () { assistantReconnaissance = null; };
        try {
          assistantReconnaissance = rec;
          rec.start();
          showToast('Parlez maintenant…', 'info');
        } catch (e) {
          assistantReconnaissance = null;
        }
      };

      // Câblage du panneau (addEventListener uniquement : aucun onclick inline).
      (function () {
        var btn = document.getElementById('btnAssistantIA');
        if (btn) btn.addEventListener('click', function () { window.yassirAssistantOuvrir(); });
        var fermer = document.getElementById('assistantIAFermer');
        if (fermer) fermer.addEventListener('click', function () { window.yassirAssistantFermer(); });
        var envoyer = document.getElementById('assistantIAEnvoyer');
        if (envoyer) envoyer.addEventListener('click', function () { window.yassirEnvoyerQuestionAssistant(); });
        var mic = document.getElementById('assistantIAMic');
        if (mic) mic.addEventListener('click', function () { window.yassirAssistantMicro(); });
        var input = document.getElementById('assistantIAInput');
        if (input) input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); window.yassirEnvoyerQuestionAssistant(); }
          if (e.key === 'Escape') window.yassirAssistantFermer();
        });
      })();
