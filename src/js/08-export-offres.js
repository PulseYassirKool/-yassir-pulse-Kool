      /* ========================================================================
         F. MODULE EXPORT D'OFFRES (SUR COMMANDES LIVRÉES + ATTRIBUTION AM)
         ======================================================================== */
      function calculerOffresDepuisDataExp(sourceData) {
        if (!sourceData || sourceData.length < 2) return [];

        var headers = sourceData[0].map(function (h) {
          return h !== null && h !== undefined ? String(h).trim().toLowerCase() : '';
        });

        var idxArea = headers.indexOf('area') !== -1 ? headers.indexOf('area') : 2;
        var idxResto = headers.indexOf('restaurant name') !== -1 ? headers.indexOf('restaurant name') : 24;
        var idxStatus = headers.indexOf('status') !== -1 ? headers.indexOf('status') : 30;
        var idxServices = headers.indexOf('services');
        // Colonne CA (dernière colonne "Discount Type" ou index 78)
        var idxDiscType = headers.lastIndexOf('discount type') !== -1 ? headers.lastIndexOf('discount type') : 78;
        var idxDiscTypeColCA = 78;
        // Colonne CM ("Discount Type Provider" ou index 90)
        var idxProvider = headers.indexOf('discount type provider') !== -1 ? headers.indexOf('discount type provider') : 90;
        var idxProviderColCM = 90;
        // Colonne Food Category ("Food Category" ou index 82)
        var idxFoodCat = headers.indexOf('food category') !== -1 ? headers.indexOf('food category') : 82;
        var idxCommercial = headers.indexOf('commercial');
        var idxOrderIdOff = headers.indexOf('order id');

        var regexSuperPromo = /super\s*promo/i;
        var regexPercentage = /(percentage|pourcentage)/i;
        var regexDelivered = /delivered/i;
        var regexAdmin = /admin/i;
        var regexRestaurant = /restaurant/i;

        var groupedMap = new Map();

        for (var r = 1; r < sourceData.length; r++) {
          var row = sourceData[r];
          if (!row || row.length === 0) continue;
          if (idxOrderIdOff !== -1 && !estOrderIdYaf(row[idxOrderIdOff])) continue;

          // 1. Uniquement les commandes Delivered
          var valStatus = (idxStatus < row.length && row[idxStatus] !== null && row[idxStatus] !== undefined)
            ? String(row[idxStatus])
            : '';
          if (!regexDelivered.test(valStatus)) continue;

          var rawResto = (idxResto < row.length && row[idxResto] !== null && row[idxResto] !== undefined)
            ? String(row[idxResto]).trim()
            : '';
          if (!rawResto) continue;
          var rKey = rawResto.toLowerCase();

          var srv = (idxServices !== -1 && idxServices < row.length && row[idxServices] !== null)
            ? String(row[idxServices]).trim().toLowerCase()
            : '';
          if (srv.includes('market') || rKey.includes('mg market') || rKey.includes('market')) continue;

          var rawArea = (idxArea < row.length && row[idxArea] !== null && row[idxArea] !== undefined)
            ? String(row[idxArea]).trim()
            : '';
          if (!rawArea) {
            var cfgA = state.amPortfolios[rKey];
            rawArea = (cfgA && cfgA.ville) ? cfgA.ville : 'Non spécifié';
          }

          var isPromoArticle = 0;
          var isPromoRestaurant = 0;
          var isPromoAdmin = 0;
          // Remise Bogof de la commande (TND) — Kool uniquement, 0 pour Yassir.
          var bogofTndOrder = 0;

          if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
            var idxOrderDayOff = headers.indexOf('order day') !== -1 ? headers.indexOf('order day') : 6;
            var evOffKool = evaluerOffreKoolPourCommande(rawResto, row[idxOrderDayOff], idxOrderIdOff !== -1 ? row[idxOrderIdOff] : '');
            if (!evOffKool) continue;
            isPromoArticle = evOffKool.isPromoArticle;
            isPromoRestaurant = evOffKool.isPromoRestaurant;
            isPromoAdmin = evOffKool.isPromoAdmin;
            bogofTndOrder = evOffKool.bogofDiscountTnd || 0;
          } else {
            // 2. Promo article : Food Category contient "Super Promo" / "super promo" / "Super promo"
            var valFoodCat = (idxFoodCat < row.length && row[idxFoodCat] !== null && row[idxFoodCat] !== undefined)
              ? String(row[idxFoodCat]).trim()
              : '';
            isPromoArticle = regexSuperPromo.test(valFoodCat) ? 1 : 0;

            // 3. Discount Type (colonne CA) = Percentage / Pourcentage
            var valDiscType = (idxDiscType < row.length && row[idxDiscType] !== null && row[idxDiscType] !== undefined)
              ? String(row[idxDiscType]).trim()
              : '';
            if (!valDiscType && idxDiscTypeColCA < row.length && row[idxDiscTypeColCA] !== null && row[idxDiscTypeColCA] !== undefined) {
              valDiscType = String(row[idxDiscTypeColCA]).trim();
            }
            var isPercentage = regexPercentage.test(valDiscType);

            // 4. Discount Type Provider (colonne CM) = Restaurant ou Admin
            var valProvider = (idxProvider < row.length && row[idxProvider] !== null && row[idxProvider] !== undefined)
              ? String(row[idxProvider]).trim()
              : '';
            if (!valProvider && idxProviderColCM < row.length && row[idxProviderColCM] !== null && row[idxProviderColCM] !== undefined) {
              valProvider = String(row[idxProviderColCM]).trim();
            }
            isPromoRestaurant = (isPercentage && regexRestaurant.test(valProvider)) ? 1 : 0;
            isPromoAdmin = (isPercentage && regexAdmin.test(valProvider)) ? 1 : 0;

            if (isPromoArticle !== 1 && isPromoRestaurant !== 1 && isPromoAdmin !== 1) continue;
          }

          var rawComm = (idxCommercial !== -1 && idxCommercial < row.length && row[idxCommercial] !== null)
            ? String(row[idxCommercial])
            : '';
          var amAssigned = determinerAmPourCommande(rawResto);

          var groupKey = amAssigned + '|||' + rawArea + '|||' + rawResto;
          if (!groupedMap.has(groupKey)) {
            groupedMap.set(groupKey, {
              am: amAssigned,
              area: rawArea,
              resto: rawResto,
              totalOffres: 0,
              discountArticle: 0,
              promoAdmin: 0,
              promoRestaurant: 0,
              bogofTnd: 0
            });
          }

          var entry = groupedMap.get(groupKey);
          entry.totalOffres += 1;
          entry.discountArticle += isPromoArticle;
          entry.promoAdmin += isPromoAdmin;
          entry.promoRestaurant += isPromoRestaurant;
          entry.bogofTnd += bogofTndOrder;
        }

        return Array.from(groupedMap.values())
          .sort(function (a, b) {
            return a.am.localeCompare(b.am, 'fr') || a.area.localeCompare(b.area, 'fr') || a.resto.localeCompare(b.resto, 'fr');
          })
          .map(function (item) {
            return {
              am: item.am,
              cells: [item.am, item.area, item.resto, item.totalOffres, item.discountArticle, item.promoAdmin, item.promoRestaurant, Number(item.bogofTnd.toFixed(2))]
            };
          });
      }

      // Index des règles Yassir par restaurant (même construction que
      // calculerCoutParticipationOffresLivrees, 04-state.js). Une règle à partPct 0
      // (ou vide) est une règle valide : le restaurant prend toute l'offre.
      function indexerReglesParticipationYassir() {
        var rulesByResto = new Map();
        var rules = state.offreParticipationRules || [];
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
        return rulesByResto;
      }

      // Première règle applicable à une commande Yassir (mêmes contrôles de dates
      // et de TAG que calculerCoutParticipationOffresLivrees, 04-state.js).
      function trouverRegleParticipationYassir(rulesByResto, rawResto, orderIso, dTypeLower, fCatLower, dAmt) {
        var candidateRules = rulesByResto.get(rawResto) || rulesByResto.get(normalizeText(rawResto));
        if (!candidateRules || candidateRules.length === 0) return null;
        for (var j = 0; j < candidateRules.length; j++) {
          var cand = candidateRules[j];
          if (orderIso) {
            if (cand.startDate && orderIso < cand.startDate) continue;
            if (cand.endDate && orderIso > cand.endDate) continue;
          }
          var tagLow = (cand.tag || '').toLowerCase();
          if (tagLow === 'pack' && !/super\s*promo/i.test(fCatLower) && !/pack/i.test(dTypeLower)) continue;
          if (tagLow === 'discount' && !/(percentage|pourcentage)/i.test(dTypeLower) && dAmt <= 0) continue;
          return cand;
        }
        return null;
      }

      // Calcul de la participation par restaurant, sur les commandes livrées déjà
      // filtrées par date par le moteur (state.marketRows + state.foodRows) : la
      // section réagit donc au filtre de date comme les autres sections.
      // viewMode : 'carte' (offres sur toute la carte) ou 'article' (offres sur articles).
      // Règle de calcul (cohérente avec calculerCoutParticipationOffresLivrees) :
      // - Remise totale (D) = montant réellement accordé au client : « Discount Amount »
      //   de la commande (Yassir comme Kool) ; en vue « Par article » (Kool) : somme
      //   sur les lignes remisées de (Original Price − Discount Price) × Quantity.
      // - partPct = points du taux de l'offre pris en charge par la PLATEFORME (pas un %
      //   de la remise) : Participation plateforme = partPct % × total BRUT avant remise
      //   (Yassir : item total ; Kool : item total = J + L, pas Total Food VF = J net ;
      //   en vue « Par article » : total original des lignes).
      //   Exemple : offre 30 %, participation 10 % → sur un brut de 100 TND, remise 30,
      //   plateforme 10, restaurant 20.
      // - Participation restaurant = D − participation plateforme, par commande, bornée à 0
      //   (si partPct % × brut > D, plateforme = D et restaurant = 0).
      //   Yassir n'a pas de détail par article avec prix : la vue
      //   « Par article » y est calculée au niveau commande (offres Super Promo).
      // - Règle à partPct vide ou 0 : la plateforme prend 0, le restaurant prend toute la remise.
      // - RÈGLE COMPTABLE (2026-11-26, KOOL UNIQUEMENT) : pour Kool, seules les offres
      //   présentes dans la feuille « Offre Participation » sont comptées. Une commande
      //   Kool livrée avec une remise mais SANS aucune règle applicable est IGNORÉE
      //   (ni en Total Offres, ni en remise, ni en participation). En vue « Par article »
      //   Kool, les lignes d'articles remisées sans règle article sont ignorées de la
      //   même façon. Pour Yassir, le repli change de sens (règle 2026-11-26) : remise
      //   sans règle → 100 % à la charge du restaurant (voir la branche Yassir
      //   ci-dessous) — l'offre reste comptée (Total Offres, remise, budgets).
      function calculerParticipationParRestaurant(viewMode) {
        var isKool = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        var view = (viewMode === 'article' || viewMode === 'bogof') ? viewMode : 'carte';
        var idxResto = TARGET_HEADERS.indexOf('restaurant name');
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxOrderDay = TARGET_HEADERS.indexOf('order day');
        var idxOrderId = TARGET_HEADERS.indexOf('order id');
        var idxServices = TARGET_HEADERS.indexOf('services');
        var idxDiscAmt = TARGET_HEADERS.indexOf('Discount Amount');
        var idxItemTot = TARGET_HEADERS.indexOf('item total');
        var idxTotalFood = TARGET_HEADERS.indexOf('Total Food');
        var idxDiscType = TARGET_HEADERS.indexOf('Discount Type');
        var idxFoodCat = TARGET_HEADERS.indexOf('Food Category');
        var idxArea = TARGET_HEADERS.indexOf('Area');

        var rulesByRestoYassir = isKool ? null : indexerReglesParticipationYassir();
        var rulesCount = (state.offreParticipationRules || []).length;

        var groupedMap = new Map();
        var deliveredCount = 0;
        var totals = { totalOffres: 0, remiseTnd: 0, partRestoTnd: 0, partPlateformeTnd: 0, unattributedTnd: 0, unattributedCount: 0 };

        function getEntry(am, area, resto) {
          var key = am + '|||' + area + '|||' + resto;
          if (!groupedMap.has(key)) {
            groupedMap.set(key, { am: am, area: area, resto: resto, totalOffres: 0, remiseTnd: 0, partRestoTnd: 0, partPlateformeTnd: 0 });
          }
          return groupedMap.get(key);
        }

        var allRecords = filtrerParPolygoneSelectionne(filtrerParAmSelectionne(state.marketRows.concat(state.foodRows)));
        for (var r = 0; r < allRecords.length; r++) {
          var rec = allRecords[r];
          var c = rec.cells;
          if (!estCommandeLivree(c[idxStatus])) continue;
          var srv = String(c[idxServices] || '').trim().toLowerCase();
          var rawResto = String(c[idxResto] || '').trim();
          if (!rawResto) continue;
          if (srv.includes('market') || rawResto.toLowerCase().includes('mg market') || rawResto.toLowerCase().includes('market')) continue;
          deliveredCount++;

          var rawArea = String(c[idxArea] || '').trim();
          if (!rawArea) {
            var cfgA = state.amPortfolios[rawResto.toLowerCase()];
            rawArea = (cfgA && cfgA.ville) ? cfgA.ville : 'Non spécifié';
          }
          var dAmt = purgerNombre(c[idxDiscAmt]);
          var itemTotVal = purgerNombre(c[idxItemTot]);
          var baseCarteYassir = itemTotVal > 0 ? itemTotVal : (purgerNombre(c[idxTotalFood]) + dAmt);
          // Base BRUT avant remise : item total (J + L pour Kool). Si absent, Total Food (J, net) + remise (L).
          var baseCarteKool = itemTotVal > 0 ? itemTotVal : (purgerNombre(c[idxTotalFood]) + dAmt);

          if (isKool) {
            var evK = evaluerOffreKoolPourCommande(rawResto, c[idxOrderDay], c[idxOrderId]);
            if (view === 'carte') {
              if (evK && evK.isPromoRestaurant) {
                // Règle « Toute la carte » applicable (même à 0 %) : la plateforme prend
                // partPct points du brut, le restaurant le reste de la remise (plafonné).
                var partPlatCarte = Math.min((evK.partPct / 100) * baseCarteKool, dAmt);
                var partRestoCarte = Math.max(0, dAmt - partPlatCarte);
                var e1 = getEntry(rec.am, rawArea, rawResto);
                e1.totalOffres += 1;
                e1.remiseTnd += dAmt;
                e1.partRestoTnd += partRestoCarte;
                e1.partPlateformeTnd += partPlatCarte;
              }
              // Sans règle « Toute la carte » : commande ignorée (remise non comptable).
            } else if (view === 'bogof') {
              // Vue « Bogof » (Kool uniquement) : UNIQUEMENT les lignes Bogof
              // attribuées (breakdown bogof: true). Le split est celui en place :
              // plateforme = « Participation 2ème article » telle quelle,
              // restaurant = remise − plateforme. Les lignes Bogof sans règle
              // vont dans les « non attribuées » de cette vue.
              if (evK) {
                totals.unattributedTnd += (evK.bogofUnattributedTnd || 0);
                totals.unattributedCount += (evK.bogofUnattributedCount || 0);
                if (evK.isPromoBogof) {
                  var eB = getEntry(rec.am, rawArea, rawResto);
                  eB.totalOffres += 1;
                  eB.remiseTnd += evK.bogofDiscountTnd || 0;
                  eB.partRestoTnd += evK.bogofPartTnd || 0;
                  eB.partPlateformeTnd += evK.bogofPlateformeTnd || 0;
                }
              } else if (dAmt > 0) {
                // Aucune règle pour cette commande : on évalue les lignes sans
                // règle pour mesurer les Bogof non attribués (catégorie
                // « Buy 1 Get 1 Free » sans règle Bogof correspondante).
                var unattrB = calculerParticipationArticlesCommandeKool(c[idxOrderId], []);
                var unattrBBreak = unattrB.unattributedBreakdown || [];
                for (var ub = 0; ub < unattrBBreak.length; ub++) {
                  var ubCat = normalizeText(unattrBBreak[ub].category || '');
                  if (ubCat.includes('buy 1 get 1') || ubCat.includes('bogof')) {
                    totals.unattributedTnd += unattrBBreak[ub].discountTnd || 0;
                    totals.unattributedCount += unattrBBreak[ub].quantity || 1;
                  }
                }
              }
              // Sans ligne Bogof attribuée : commande ignorée dans cette vue.
            } else {
              // Articles remisés sans règle correspondante = « non attribués »
              // (audit 2026-11-27, item 5a) : comptés à part dans les totaux,
              // jamais rattachés à une règle, jamais dans les parts resto/plateforme.
              if (evK) {
                totals.unattributedTnd += (evK.articleUnattributedTnd || 0);
                totals.unattributedCount += (evK.articleUnattributedCount || 0);
              } else if (dAmt > 0) {
                // Aucune règle pour cette commande : on évalue les lignes sans
                // règle pour mesurer les remises non attribuées.
                var unattr = calculerParticipationArticlesCommandeKool(c[idxOrderId], []);
                totals.unattributedTnd += (unattr.unattributedTnd || 0);
                totals.unattributedCount += (unattr.unattributedCount || 0);
              }
              if (evK && evK.isPromoArticle) {
                // articlePartTnd = part restaurant (remise lignes − part plateforme,
                // calculée sur le brut des lignes) ; la plateforme prend le reste.
                var discArt = evK.articleDiscountTnd || 0;
                var partPlatArt = Math.max(0, discArt - evK.articlePartTnd);
                var e2 = getEntry(rec.am, rawArea, rawResto);
                e2.totalOffres += 1;
                e2.remiseTnd += discArt;
                e2.partRestoTnd += evK.articlePartTnd;
                e2.partPlateformeTnd += partPlatArt;
              }
              // Sans règle article : lignes remisées ignorées (remise non comptable).
            }
          } else {
            // Vue « Bogof » : Kool uniquement — Yassir n'a pas de Bogof.
            if (view === 'bogof') continue;
            var dTypeLower = String(c[idxDiscType] || '').toLowerCase();
            var fCatLower = String(c[idxFoodCat] || '').toLowerCase();
            var hasOffer = dAmt > 0 || /(percentage|pourcentage|pack|discount)/i.test(dTypeLower) || /super\s*promo/i.test(fCatLower);
            if (!hasOffer) continue;
            var orderIso = parseOrderDayToIsoDate(c[idxOrderDay]);
            var matchedRule = trouverRegleParticipationYassir(rulesByRestoYassir, rawResto.toLowerCase(), orderIso, dTypeLower, fCatLower, dAmt);
            var isArticleOffer = /super\s*promo/i.test(fCatLower) || /pack/i.test(dTypeLower);
            if (matchedRule) {
              var isCarteRule = estOffreTouteLaCarteKool(matchedRule);
              if (view === 'carte' && !isCarteRule) continue;
              if (view === 'article' && isCarteRule) continue;
              if (view === 'article' && !isArticleOffer) continue;
              var partPlatY = Math.min((matchedRule.partPct / 100) * baseCarteYassir, dAmt);
              var partRestoY = Math.max(0, dAmt - partPlatY);
              var e3 = getEntry(rec.am, rawArea, rawResto);
              e3.totalOffres += 1;
              e3.remiseTnd += dAmt;
              e3.partRestoTnd += partRestoY;
              e3.partPlateformeTnd += partPlatY;
            } else if (dAmt > 0) {
              // Repli Yassir (règle 2026-11-26) : remise sans règle → 100 % à la charge
              // du restaurant (vue selon le type d'offre). Pour Kool, sans règle = exclu
              // (voir la branche Kool ci-dessus).
              if (view === 'carte' && isArticleOffer) continue;
              if (view === 'article' && !isArticleOffer) continue;
              var e3f = getEntry(rec.am, rawArea, rawResto);
              e3f.totalOffres += 1;
              e3f.remiseTnd += dAmt;
              e3f.partRestoTnd += dAmt;
            }
          }
        }

        var rows = Array.from(groupedMap.values())
          .sort(function (a, b) { return (b.remiseTnd - a.remiseTnd) || a.resto.localeCompare(b.resto, 'fr'); })
          .map(function (it) {
            it.remiseTnd = Number(it.remiseTnd.toFixed(2));
            it.partRestoTnd = Number(it.partRestoTnd.toFixed(2));
            it.partPlateformeTnd = Number(it.partPlateformeTnd.toFixed(2));
            totals.totalOffres += it.totalOffres;
            totals.remiseTnd += it.remiseTnd;
            totals.partRestoTnd += it.partRestoTnd;
            totals.partPlateformeTnd += it.partPlateformeTnd;
            return it;
          });
        totals.remiseTnd = Number(totals.remiseTnd.toFixed(2));
        totals.partRestoTnd = Number(totals.partRestoTnd.toFixed(2));
        totals.partPlateformeTnd = Number(totals.partPlateformeTnd.toFixed(2));
        totals.unattributedTnd = Number(totals.unattributedTnd.toFixed(2));

        // Note de couverture (même logique que le Top des ventes) : vue « Par article »
        // Kool sans aucune ligne alors que des commandes livrées existent sur la période.
        var note = '';
        var hasData = (state.marketRows.length + state.foodRows.length) > 0;
        var bogofRulesCount = (state.bogofRules || []).length;
        if (!hasData) {
          note = 'no_data';
        } else if (rulesCount === 0 && !(isKool && view === 'bogof' && bogofRulesCount > 0)) {
          note = 'no_rules';
        } else if (isKool && (view === 'article' || view === 'bogof') && rows.length === 0 && deliveredCount > 0) {
          if (!window.koolOrderItemsByOrderId || window.koolOrderItemsByOrderId.size === 0) {
            note = 'no_items_loaded';
          } else {
            var covMin = window.koolOrderItemsMinDate || '';
            var covMax = window.koolOrderItemsMaxDate || '';
            var outOfCoverage = (state.dateStart && covMax && state.dateStart > covMax) ||
              (state.dateEnd && covMin && state.dateEnd < covMin);
            note = outOfCoverage ? 'items_out_of_coverage' : (view === 'bogof' ? 'no_bogof_offer' : 'no_article_offer');
          }
        }

        return { view: view, rows: rows, totals: totals, note: note, deliveredCount: deliveredCount };
      }

      // Colonnes visibles du tableau des offres : « Promo Admin » est toujours à 0
      // pour Kool (evaluerOffreKoolPourCommande renvoie isPromoAdmin: 0), la colonne
      // est donc masquée en mode Kool uniquement (elle reste pour Yassir).
      var OFFRES_PROMO_ADMIN_IDX = OFFRES_HEADERS.indexOf('Promo Admin');
      var OFFRES_BOGOF_IDX = OFFRES_HEADERS.indexOf('Bogof');
      function getOffresVisibleHeaders() {
        var isKool = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        // Kool : « Promo Admin » masquée (toujours 0). Yassir : « Bogof »
        // masquée (le Bogof n'existe pas côté Yassir).
        return isKool
          ? OFFRES_HEADERS.filter(function (h) { return h !== 'Promo Admin'; })
          : OFFRES_HEADERS.filter(function (h) { return h !== 'Bogof'; });
      }
      function filtrerCellulesOffresVisibles(cells) {
        var isKool = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        if (!cells) return cells;
        if (isKool) return cells.filter(function (c, idx) { return idx !== OFFRES_PROMO_ADMIN_IDX; });
        return cells.filter(function (c, idx) { return idx !== OFFRES_BOGOF_IDX; });
      }
      window.yassirGetOffresVisibleHeaders = getOffresVisibleHeaders;

      // ---- Rendu de la section Participation (panneau dédié) ----
      var participationViewMode = 'carte';
      var _participationCache = { key: '', result: null };
      var currentParticipationRows = [];
      var currentParticipationTotals = { totalOffres: 0, remiseTnd: 0, partRestoTnd: 0, partPlateformeTnd: 0 };

      function getParticipationPeriodLabel() {
        if (state.dateStart && state.dateEnd) {
          return 'du ' + state.dateStart.split('-').reverse().join('/') + ' au ' + state.dateEnd.split('-').reverse().join('/');
        }
        return 'toute la période';
      }

      function renderParticipationPanel() {
        var isKool = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        // Vue « Bogof » : Kool uniquement — si on bascule sur Yassir en étant
        // en vue Bogof, on revient sur « Toute la carte ».
        if (!isKool && participationViewMode === 'bogof') participationViewMode = 'carte';
        var cacheKey = String(state._calcRevision || 0) + '|' + (currentBrand || 'yassir') + '|' + participationViewMode + '|' + getEffectiveAmFilter() + '|' + getPolygonFilterKey() + '|' + state.marketRows.length + '|' + state.foodRows.length;
        if (_participationCache.key !== cacheKey) {
          _participationCache = { key: cacheKey, result: calculerParticipationParRestaurant(participationViewMode) };
        }
        var res = _participationCache.result;
        currentParticipationRows = res.rows;
        currentParticipationTotals = res.totals;

        var btnCarte = document.getElementById('partViewCarteBtn');
        var btnArticle = document.getElementById('partViewArticleBtn');
        var btnBogof = document.getElementById('partViewBogofBtn');
        var activeCls = 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#6C2BD9] text-white shadow-sm transition cursor-pointer';
        var idleCls = 'px-3.5 py-1.5 rounded-full text-xs font-bold text-[#6C2BD9] hover:text-[#5521B5] transition cursor-pointer';
        if (btnCarte) btnCarte.className = res.view === 'carte' ? activeCls : idleCls;
        if (btnArticle) btnArticle.className = res.view === 'article' ? activeCls : idleCls;
        if (btnBogof) {
          btnBogof.className = res.view === 'bogof' ? activeCls : idleCls;
          btnBogof.classList.toggle('hidden', !isKool);
        }

        var viewLabel = document.getElementById('partViewLabel');
        if (viewLabel) {
          var viewName = res.view === 'carte' ? 'Toute la carte' : (res.view === 'bogof' ? 'Bogof' : 'Par article');
          viewLabel.textContent = 'Vue : ' + viewName + ' • Période : ' + getParticipationPeriodLabel() +
            (res.view === 'article' && !isKool ? ' • Montants au niveau commande (pas de détail par article pour Yassir)' : '') +
            (res.view === 'bogof' ? ' • Offres Buy 1 Get 1 Free uniquement' : '');
        }

        var elOffres = document.getElementById('partKpiOffres');
        if (elOffres) elOffres.textContent = Number(res.totals.totalOffres).toLocaleString('fr-FR');
        var elRemise = document.getElementById('partKpiRemise');
        if (elRemise) elRemise.textContent = Number(res.totals.remiseTnd).toFixed(2) + ' TND';
        var elResto = document.getElementById('partKpiResto');
        if (elResto) elResto.textContent = Number(res.totals.partRestoTnd).toFixed(2) + ' TND';
        var elPlat = document.getElementById('partKpiPlateforme');
        if (elPlat) elPlat.textContent = Number(res.totals.partPlateformeTnd).toFixed(2) + ' TND';

        var banner = document.getElementById('partNoteBanner');
        if (banner) {
          var msg = '';
          if (res.note === 'no_data') msg = 'Aucune donnée chargée : importez d’abord votre fichier Data exp (ou lancez « Sync Yassir » / « Sync Kool »).';
          else if (res.note === 'no_rules') msg = isKool
            ? 'Aucune règle de participation chargée : pour Kool, seules les offres de la feuille « Offre Participation » sont comptées — les remises sans règle ne sont pas comptables. Lancez « Sync Kool » pour charger la feuille « Offre Participation ».'
            : 'Aucune règle de participation chargée : les remises sont comptées à 100 % à la charge du restaurant. Lancez « Sync Yassir » pour charger la feuille « Offre Participation ».';
          else if (res.note === 'no_items_loaded') msg = 'Aucun détail article chargé : faites un « Sync Kool » pour charger la feuille des détails articles.';
          else if (res.note === 'items_out_of_coverage') {
            var covMax = window.koolOrderItemsMaxDate || '';
            msg = covMax
              ? 'Aucun détail article pour cette période : la feuille « détails articles » Kool s’arrête au ' + covMax.split('-').reverse().join('/') + '. Ajoutez les lignes manquantes pour voir la participation par article.'
              : 'Aucun détail article pour cette période : la feuille « détails articles » Kool ne couvre pas ces commandes.';
          } else if (res.note === 'no_article_offer') msg = 'Aucune participation sur articles pour cette période : les détails articles couvrent bien la période, mais aucune commande livrée n’a d’offre article avec participation.';
          else if (res.note === 'no_bogof_offer') msg = 'Aucune participation Bogof pour cette période : les détails articles couvrent bien la période, mais aucune commande livrée n’a d’offre « Buy 1 Get 1 Free » avec règle Bogof.';
          if (msg) {
            banner.textContent = msg;
            banner.classList.remove('hidden');
          } else {
            banner.classList.add('hidden');
          }
        }

        // Bandeau « remises non attribuées » (audit 2026-11-27, item 5a) : visible
        // en vue « Par article » Kool quand des remises n'ont aucune règle.
        // En vue « Bogof », il ne porte que sur les lignes « Buy 1 Get 1 Free »
        // sans règle Bogof correspondante (feuille « Bogof »).
        var unattrBanner = document.getElementById('partUnattributedBanner');
        if (unattrBanner) {
          var unattrTnd = Number(res.totals.unattributedTnd || 0);
          if (isKool && (res.view === 'article' || res.view === 'bogof') && unattrTnd > 0) {
            if (res.view === 'bogof') {
              unattrBanner.textContent = 'Remises Bogof non attribuées : ' + unattrTnd.toFixed(2) + ' TND (' + Number(res.totals.unattributedCount || 0).toLocaleString('fr-FR') + ' article(s)) « Buy 1 Get 1 Free » sans règle Bogof correspondante dans la feuille « Bogof » — elles ne sont comptées ni à la charge du restaurant, ni à celle de la plateforme. Ajoutez la règle dans la feuille « Bogof » puis refaites « Sync Kool ».';
            } else {
              unattrBanner.textContent = 'Remises non attribuées : ' + unattrTnd.toFixed(2) + ' TND (' + Number(res.totals.unattributedCount || 0).toLocaleString('fr-FR') + ' article(s)) sans règle correspondante dans la feuille « Offre Participation » — elles ne sont comptées ni à la charge du restaurant, ni à celle de la plateforme. Ajoutez la règle dans la feuille puis refaites « Sync Kool ».';
            }
            unattrBanner.classList.remove('hidden');
          } else {
            unattrBanner.classList.add('hidden');
          }
        }

        // Bandeau « règles de secours » (audit 2026-11-27, item 5b) : visible quand
        // les règles en cours ne viennent pas de la feuille (repli Black Friday expiré).
        var fallbackBanner = document.getElementById('partFallbackBanner');
        if (fallbackBanner) {
          if (state.offreRulesSource === 'secours') {
            fallbackBanner.textContent = 'Règles de participation de secours utilisées (synchro de la feuille « Offre Participation » échouée ou jamais faite) : ce sont d’anciennes règles Black Friday, EXPIRÉES le 30 novembre 2026 — les montants peuvent être faux. Mettez les règles actuelles dans la feuille puis refaites la synchro.';
            fallbackBanner.classList.remove('hidden');
          } else {
            fallbackBanner.classList.add('hidden');
          }
        }

        window.yassirRenderParticipationTable();
      }

      window.yassirSetParticipationView = function (view) {
        if (view !== 'carte' && view !== 'article' && view !== 'bogof') return;
        if (participationViewMode === view) return;
        participationViewMode = view;
        renderParticipationPanel();
      };

      window.yassirRenderParticipationTable = function () {
        var tbody = document.getElementById('partTableBody');
        var tfoot = document.getElementById('partTableFoot');
        if (!tbody) return;
        var q = '';
        var searchEl = document.getElementById('partSearchInput');
        if (searchEl) q = searchEl.value.trim().toLowerCase();
        var filtered = currentParticipationRows.filter(function (it) {
          if (!q) return true;
          return it.am.toLowerCase().includes(q) || it.area.toLowerCase().includes(q) || it.resto.toLowerCase().includes(q);
        });

        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-10 text-center text-slate-400">Aucune participation pour cette vue et cette période.</td></tr>';
        } else {
          var rowsHtml = filtered.map(function (it, idx) {
            var num = idx + 1;
            var amBadge = it.am === 'Non attribué'
              ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">Non attribué</span>'
              : '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F3EBFF] text-[#6C2BD9]">' + escapeHtml(it.am) + '</span>';
            return '<tr class="hover:bg-[#F3EBFF]/40 transition-colors">' +
              '<td class="px-3 py-2.5 text-slate-400 font-mono bg-slate-50 sticky left-0 z-10 border-r border-slate-100">' + num + '</td>' +
              '<td class="px-4 py-2.5 whitespace-nowrap">' + amBadge + '</td>' +
              '<td class="px-4 py-2.5 whitespace-nowrap font-semibold text-[#1A1A2E]">' + escapeHtml(it.area) + '</td>' +
              '<td class="px-4 py-2.5 whitespace-nowrap font-bold text-[#6C2BD9]">' + escapeHtml(it.resto) + '</td>' +
              '<td class="px-4 py-2.5 whitespace-nowrap text-right font-mono font-extrabold bg-pink-50/70 text-[#FF2A6D]">' + Number(it.totalOffres).toLocaleString('fr-FR') + '</td>' +
              '<td class="px-4 py-2.5 whitespace-nowrap text-right font-mono font-bold bg-[#F3EBFF]/55 text-[#1A1A2E]">' + Number(it.remiseTnd).toFixed(2) + '</td>' +
              '<td class="px-4 py-2.5 whitespace-nowrap text-right font-mono font-bold bg-[#F3EBFF]/55 text-[#00897B]">' + Number(it.partRestoTnd).toFixed(2) + '</td>' +
              '<td class="px-4 py-2.5 whitespace-nowrap text-right font-mono font-bold bg-[#F3EBFF]/55 text-[#6C2BD9]">' + Number(it.partPlateformeTnd).toFixed(2) + '</td>' +
              '</tr>';
          }).join('');
          tbody.innerHTML = rowsHtml;
        }

        if (tfoot) {
          var t = currentParticipationTotals;
          var footHtml = '<tr class="bg-[#F3EBFF]/60 font-extrabold">' +
            '<td colspan="4" class="px-4 py-2.5 text-right text-[#1A1A2E]">Total</td>' +
            '<td class="px-4 py-2.5 text-right font-mono text-[#FF2A6D]">' + Number(t.totalOffres).toLocaleString('fr-FR') + '</td>' +
            '<td class="px-4 py-2.5 text-right font-mono text-[#1A1A2E]">' + Number(t.remiseTnd).toFixed(2) + '</td>' +
            '<td class="px-4 py-2.5 text-right font-mono text-[#00897B]">' + Number(t.partRestoTnd).toFixed(2) + '</td>' +
            '<td class="px-4 py-2.5 text-right font-mono text-[#6C2BD9]">' + Number(t.partPlateformeTnd).toFixed(2) + '</td>' +
            '</tr>';
          tfoot.innerHTML = footHtml;
        }
      };
