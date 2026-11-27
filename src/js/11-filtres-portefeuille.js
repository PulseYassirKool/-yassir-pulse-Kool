      /* ========================================================================
         H. HELPERS DE FILTRAGE PAR PORTEFEUILLE AM (CLOISONNEMENT RBAC)
         ======================================================================== */
      function getEffectiveAmFilter() {
        if (!currentUser) return 'ALL';
        if (canViewAllPortfolios()) {
          return state.selectedAm || 'ALL';
        }
        if (state.selectedAm === currentUser.amName) {
          return currentUser.amName;
        }
        return 'ALL';
      }

      function filtrerParAmSelectionne(recordsList) {
        var activeFilter = getEffectiveAmFilter();
        if (activeFilter === 'ALL') return recordsList;
        return recordsList.filter(function (rec) { return rec.am === activeFilter; });
      }

      /* ========================================================================
         H2. FILTRE PAR POLYGONE CLIENT (Kool uniquement — colonne « Polygone Client »,
         col. AB de la feuille Data Kool, lue par le normaliseur Kool).
         Comme le filtre AM : état en mémoire uniquement. Sémantique :
         state.polygonFilter = null → pas de filtre (« Tous les polygones ») ;
         [] → filtre actif sans aucune sélection (aucun résultat) ;
         [...] → filtre actif sur la sélection. Yassir n'a pas cette colonne :
         le filtre ne s'applique jamais en mode Yassir.
         ======================================================================== */
      function getEffectivePolygonFilter() {
        if (typeof currentBrand === 'undefined' || currentBrand !== 'kool') return null;
        if (!Array.isArray(state.polygonFilter)) return null;
        return state.polygonFilter.slice();
      }

      function getPolygonFilterKey() {
        var sel = getEffectivePolygonFilter();
        if (sel === null) return 'ALL';
        return sel.map(function (p) { return String(p).trim().toLowerCase(); }).sort().join(',');
      }

      function getRowPolygon(rec) {
        if (!rec || !rec.cells) return '';
        var idx = TARGET_HEADERS.indexOf('polygone client');
        if (idx === -1) return '';
        return String(rec.cells[idx] || '').trim();
      }

      function filtrerParPolygoneSelectionne(recordsList) {
        var sel = getEffectivePolygonFilter();
        if (sel === null) return recordsList;
        if (sel.length === 0) return [];
        var norm = {};
        sel.forEach(function (p) { norm[String(p).trim().toLowerCase()] = true; });
        return recordsList.filter(function (rec) {
          return !!norm[getRowPolygon(rec).toLowerCase()];
        });
      }

      // Polygones distincts présents dans les données Kool chargées, triés,
      // + les polygones sélectionnés manuellement (ils restent affichés tant
      // qu'ils sont sélectionnés, même s'ils ne sont plus dans les données).
      function getDistinctPolygones() {
        var seen = {};
        var list = [];
        var rows = (state.marketRows || []).concat(state.foodRows || []);
        rows.forEach(function (rec) {
          var p = getRowPolygon(rec);
          if (p && !seen[p.toLowerCase()]) { seen[p.toLowerCase()] = true; list.push(p); }
        });
        var selPolys = getEffectivePolygonFilter();
        if (selPolys) selPolys.forEach(function (p) {
          var t = String(p).trim();
          if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = true; list.push(t); }
        });
        list.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase(), 'fr'); });
        return list;
      }

      // Appliquer le filtre polygone (Kool uniquement) : null = pas de filtre
      // (« Tous »), [] = filtre actif sans sélection (aucun résultat).
      window.yassirSetPolygonFilter = function (arr) {
        state.polygonFilter = (arr === null || arr === undefined) ? null : (Array.isArray(arr) ? arr.slice() : null);
        state.currentPage = 1;
        mettreAJourInterface();
      };

      function calculerStatsPourAm(amFilter) {
        var cacheKey = String(state._calcRevision || 0) + '|' + (currentBrand || 'yassir') + '|' + (amFilter || 'ALL') + '|' + getPolygonFilterKey();
        if (_amStatsCache.has(cacheKey)) {
          return _amStatsCache.get(cacheKey);
        }
        var idxStatus = TARGET_HEADERS.indexOf('status');
        var idxCA = TARGET_HEADERS.indexOf('CA');
        var idxLrLg = TARGET_HEADERS.indexOf('à payer réduits');
        var idxOrigDelivAm = TARGET_HEADERS.indexOf('original delivery amount');
        var idxDelivAmt = TARGET_HEADERS.indexOf('delivery amount');

        var mList = amFilter === 'ALL' ? state.marketRows : state.marketRows.filter(function (r) { return r.am === amFilter; });
        var fList = amFilter === 'ALL' ? state.foodRows : state.foodRows.filter(function (r) { return r.am === amFilter; });
        var oList = amFilter === 'ALL' ? state.offresRows : state.offresRows.filter(function (r) { return r.am === amFilter; });

        // Filtre polygone Kool (comme le filtre AM) : ne s'applique qu'en mode Kool.
        mList = filtrerParPolygoneSelectionne(mList);
        fList = filtrerParPolygoneSelectionne(fList);
        oList = filtrerParPolygoneSelectionne(oList);

        var mDel = mList.filter(function (r) { return estCommandeLivree(r.cells[idxStatus]); });
        var fDel = fList.filter(function (r) { return estCommandeLivree(r.cells[idxStatus]); });

        var totalRecues = mList.length + fList.length;
        var totalLivrees = mDel.length + fDel.length;

        var caLivrees = mDel.reduce(function (acc, r) { return acc + purgerNombre(r.cells[idxCA]); }, 0) +
                        fDel.reduce(function (acc, r) { return acc + purgerNombre(r.cells[idxCA]); }, 0);
        var caRecues = mList.reduce(function (acc, r) { return acc + purgerNombre(r.cells[idxCA]); }, 0) +
                       fList.reduce(function (acc, r) { return acc + purgerNombre(r.cells[idxCA]); }, 0);

        var allDelivForScope = mDel.concat(fDel);
        var lrLgTnd = allDelivForScope.reduce(function (acc, r) {
          var oD = idxOrigDelivAm !== -1 ? purgerNombre(r.cells[idxOrigDelivAm]) : 0;
          var dA = idxDelivAmt !== -1 ? purgerNombre(r.cells[idxDelivAmt]) : 0;
          return acc + (oD - dA);
        }, 0);
        var offerPartTnd = calculerCoutParticipationOffresLivrees(allDelivForScope);
        var livraisonGratuiteCount = allDelivForScope.filter(function (r) { return purgerNombre(r.cells[idxDelivAmt]) === 0; }).length;
        var budgetTnd = amFilter === 'ALL'
          ? Number(state.budgetGlobal || 0)
          : Number(state.budgetByAm[amFilter] || 0);
        var totalBudgetUsedTnd = lrLgTnd + offerPartTnd;
        var remainingBudgetTnd = budgetTnd - totalBudgetUsedTnd;

        var totalOffres = 0;
        var restosOffreSet = new Set();
        oList.forEach(function (item) {
          totalOffres += Number(item.cells[3] || 0);
          if (item.cells[2]) restosOffreSet.add(String(item.cells[2]).toLowerCase());
        });

        var revTag = String(state._calcRevision || 0) + '|' + (currentBrand || 'yassir');
        if (_restosWithOrdersCache.rev !== revTag) {
          var idxRestoSet = TARGET_HEADERS.indexOf('restaurant name');
          var s = new Set();
          for (var mi = 0; mi < state.marketRows.length; mi++) {
            var rnM = String(state.marketRows[mi].cells[idxRestoSet] || '').trim().toLowerCase();
            if (rnM) s.add(rnM);
          }
          for (var fi = 0; fi < state.foodRows.length; fi++) {
            var rnF = String(state.foodRows[fi].cells[idxRestoSet] || '').trim().toLowerCase();
            if (rnF) s.add(rnF);
          }
          _restosWithOrdersCache = { rev: revTag, set: s };
        }
        var restosWithOrdersSet = _restosWithOrdersCache.set;

        var assignedRestosCount = 0;
        var zeroOrdersRestosCount = 0;
        Object.entries(state.amPortfolios).forEach(function (pair) {
          var key = pair[0];
          var info = pair[1];
          if (amFilter === 'ALL' || info.am === amFilter) {
            assignedRestosCount++;
            if (!restosWithOrdersSet.has(key)) {
              zeroOrdersRestosCount++;
            }
          }
        });

        var resObj = {
          totalRecues: totalRecues,
          totalLivrees: totalLivrees,
          marketRecues: mList.length,
          marketLivrees: mDel.length,
          foodRecues: fList.length,
          foodLivrees: fDel.length,
          totalOffres: totalOffres,
          restosOffreCount: restosOffreSet.size,
          caLivrees: caLivrees,
          caRecues: caRecues,
          lrLgTnd: lrLgTnd,
          offerPartTnd: offerPartTnd,
          totalBudgetUsedTnd: totalBudgetUsedTnd,
          remainingBudgetTnd: remainingBudgetTnd,
          livraisonGratuiteCount: livraisonGratuiteCount,
          budgetTnd: budgetTnd,
          assignedRestosCount: assignedRestosCount,
          zeroOrdersRestosCount: zeroOrdersRestosCount
        };
        _amStatsCache.set(cacheKey, resObj);
        return resObj;
      }

      // Résolution du budget affiché dans la carte profil du menu latéral.
      // Règle : ne jamais comparer des dépenses réelles à un budget absent —
      // un budget non chargé (synchro Budget en échec, ou AM sans ligne dans
      // la feuille) n'est pas un budget à 0, sinon le « Reste Budget » devient
      // négatif (ex. -99 915,79 TND) et le % tombe à 0.
      // - budget du périmètre connu (> 0) : périmètre tel quel, libellé « Budget AM ».
      // - sinon, si l'utilisateur voit tout (proprio / lecture) et que le budget
      //   global de la marque active est connu : périmètre Global, libellé
      //   « Budget global », dépenses globales face au budget global.
      // - sinon : budget inconnu (budgetConnu = false) — l'affichage met « — ».
      function resoudreBudgetCarteProfil(scopeAm) {
        var st = calculerStatsPourAm(scopeAm);
        if (st && st.budgetTnd > 0) {
          return { stats: st, budgetTnd: st.budgetTnd, budgetConnu: true, libelle: 'Budget AM', scope: scopeAm };
        }
        if (typeof canViewAllPortfolios === 'function' && canViewAllPortfolios()) {
          var stGlobal = calculerStatsPourAm('ALL');
          if (stGlobal && stGlobal.budgetTnd > 0) {
            return { stats: stGlobal, budgetTnd: stGlobal.budgetTnd, budgetConnu: true, libelle: 'Budget global', scope: 'ALL' };
          }
        }
        return { stats: st, budgetTnd: 0, budgetConnu: false, libelle: 'Budget AM', scope: scopeAm };
      }
      window.yassirResoudreBudgetCarteProfil = resoudreBudgetCarteProfil;
