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

          if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
            var idxOrderDayOff = headers.indexOf('order day') !== -1 ? headers.indexOf('order day') : 6;
            var evOffKool = evaluerOffreKoolPourCommande(rawResto, row[idxOrderDayOff], idxOrderIdOff !== -1 ? row[idxOrderIdOff] : '');
            if (!evOffKool) continue;
            isPromoArticle = evOffKool.isPromoArticle;
            isPromoRestaurant = evOffKool.isPromoRestaurant;
            isPromoAdmin = evOffKool.isPromoAdmin;
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
              promoRestaurant: 0
            });
          }

          var entry = groupedMap.get(groupKey);
          entry.totalOffres += 1;
          entry.discountArticle += isPromoArticle;
          entry.promoAdmin += isPromoAdmin;
          entry.promoRestaurant += isPromoRestaurant;
        }

        return Array.from(groupedMap.values())
          .sort(function (a, b) {
            return a.am.localeCompare(b.am, 'fr') || a.area.localeCompare(b.area, 'fr') || a.resto.localeCompare(b.resto, 'fr');
          })
          .map(function (item) {
            return {
              am: item.am,
              cells: [item.am, item.area, item.resto, item.totalOffres, item.discountArticle, item.promoAdmin, item.promoRestaurant]
            };
          });
      }
