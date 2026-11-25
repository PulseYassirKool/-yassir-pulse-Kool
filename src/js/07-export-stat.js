      /* ========================================================================
         E. MODULE EXPORT STAT (IMPLÉMENTATION EXACTE DE LA FORMULE VSTACK/QUERY)
         ======================================================================== */
      function calculerStatDepuisDataExp(allTargetRecords) {
        if (!allTargetRecords || allTargetRecords.length === 0) return [];

        // Correspondance exacte des colonnes dans TARGET_HEADERS (A=0 .. DE=108) :
        // W  (22)  = 'order id'
        // AI (34)  = 'restaurant name'
        // AP (41)  = 'status'
        // BB (53)  = 'à payer réduits' (LR_LG_Costs)
        // BN (65)  = 'CA' (Commission Yassir)
        // BR (69)  = 'Total Food VF' (GMV)
        // CO (92)  = 'Discount Type'
        // CR (95)  = 'Food Category' / 'Tags' (super promo)
        // CT (97)  = 'Accepted By'
        // CZ (103) = 'Discount Type Provider'
        var idxW_OrderId = TARGET_HEADERS.indexOf('order id');
        var idxAI_Resto = TARGET_HEADERS.indexOf('restaurant name');
        var idxAP_Status = TARGET_HEADERS.indexOf('status');
        var idxBB_LrLg = TARGET_HEADERS.indexOf('à payer réduits');
        var idxBN_Comm = TARGET_HEADERS.indexOf('CA');
        var idxBR_Gmv = TARGET_HEADERS.indexOf('Total Food VF');
        var idxCO_DiscType = TARGET_HEADERS.indexOf('Discount Type');
        var idxCR_FoodCat = TARGET_HEADERS.indexOf('Food Category');
        var idxTags = TARGET_HEADERS.indexOf('Tags');
        var idxCT_AcceptedBy = TARGET_HEADERS.indexOf('Accepted By');
        var idxCZ_Provider = TARGET_HEADERS.indexOf('Discount Type Provider');
        var idxArea = TARGET_HEADERS.indexOf('Area');

        // 1. Calcul de totDelivGlobal : COUNTIF(LOWER(Data!AP2:AP), "*delivered*")
        var totDelivGlobal = 0;
        for (var i = 0; i < allTargetRecords.length; i++) {
          var stVal = String(allTargetRecords[i].cells[idxAP_Status] || '').toLowerCase();
          if (stVal.includes('delivered')) {
            totDelivGlobal++;
          }
        }

        // 2. Agrégation par restaurant (keysExtract = TRIM(LOWER(Data!AI2:AI)))
        var aggMap = new Map();
        for (var r = 0; r < allTargetRecords.length; r++) {
          var rec = allTargetRecords[r];
          var c = rec.cells;
          var rawResto = String(c[idxAI_Resto] || '').trim();
          var keyResto = rawResto.toLowerCase();
          if (!keyResto) continue;

          var statusLower = String(c[idxAP_Status] || '').trim().toLowerCase();
          var isDelivered = statusLower.includes('delivered');
          var isRejected = statusLower.includes('restaurant rejected') || (!isDelivered && isRestaurantRejectedReason(c[TARGET_HEADERS.indexOf('cancellation reason VF')] || c[TARGET_HEADERS.indexOf('cancellation reason')]));
          var acceptedByLower = String(c[idxCT_AcceptedBy] || '').trim().toLowerCase();
          var discTypeLower = String(c[idxCO_DiscType] || '').trim().toLowerCase();
          var providerLower = String(c[idxCZ_Provider] || '').trim().toLowerCase();
          var foodCatLower = (String(c[idxCR_FoodCat] || '') + ' ' + String(c[idxTags] || '')).trim().toLowerCase();

          var req = String(c[idxW_OrderId] || '').trim().length > 0 ? 1 : 0;
          var deliv = isDelivered ? 1 : 0;
          var acc = (acceptedByLower.includes('restaurant') && isDelivered) ? 1 : 0;
          var canc = isRejected ? 1 : 0;
          var gmv = isDelivered ? purgerNombre(c[idxBR_Gmv]) : 0;
          var comm = isDelivered ? purgerNombre(c[idxBN_Comm]) : 0;

          var promoResto = 0;
          var promoAdmin = 0;
          if (typeof currentBrand !== 'undefined' && currentBrand === 'kool') {
            if (isDelivered) {
              var evStatK = evaluerOffreKoolPourCommande(rawResto, c[TARGET_HEADERS.indexOf('order day')], c[idxW_OrderId]);
              if (evStatK) {
                promoResto = evStatK.isPromoRestaurant ? 1 : (evStatK.isPromoArticle ? 1 : 0);
                promoAdmin = 0;
              }
            }
          } else {
            var hasSuperPromo = /super\s*promo/i.test(String(c[idxCR_FoodCat] || ''));
            var isPercDisc = /(percentage|pourcentage)/i.test(discTypeLower);
            var hasPercResto = isPercDisc && providerLower.includes('restaurant');
            promoResto = ((hasSuperPromo || hasPercResto) && isDelivered) ? 1 : 0;
            promoAdmin = (isPercDisc && providerLower.includes('admin') && isDelivered) ? 1 : 0;
          }
          var lrLg = isDelivered ? ((idxOrigDelivStat !== -1 ? purgerNombre(c[idxOrigDelivStat]) : 0) - (idxDelivAmtStat !== -1 ? purgerNombre(c[idxDelivAmtStat]) : 0)) : 0;

          if (!aggMap.has(keyResto)) {
            aggMap.set(keyResto, {
              areaFromData: String(c[idxArea] || '').trim(),
              displayName: rawResto,
              req: 0,
              deliv: 0,
              acc: 0,
              canc: 0,
              gmv: 0,
              comm: 0,
              promoResto: 0,
              promoAdmin: 0,
              lrLg: 0
            });
          }

          var entry = aggMap.get(keyResto);
          if (!entry.areaFromData && c[idxArea]) entry.areaFromData = String(c[idxArea]).trim();
          entry.req += req;
          entry.deliv += deliv;
          entry.acc += acc;
          entry.canc += canc;
          entry.gmv += gmv;
          entry.comm += comm;
          entry.promoResto += promoResto;
          entry.promoAdmin += promoAdmin;
          entry.lrLg += lrLg;
        }

        // 3. Jointure avec Config (state.amPortfolios) + restaurants présents dans Data
        var allKeys = new Set(Object.keys(state.amPortfolios));
        aggMap.forEach(function (_, k) { allKeys.add(k); });

        var statRecords = [];
        allKeys.forEach(function (keyResto) {
          var cfg = state.amPortfolios[keyResto];
          var agg = aggMap.get(keyResto);

          // On affiche les restaurants du portefeuille Config ou ceux ayant des commandes dans Data
          if (!cfg && !agg) return;

          var amName = cfg ? cfg.am : 'Non attribué';
          var areaVal = (cfg && cfg.ville) ? cfg.ville : (agg ? agg.areaFromData : '');
          var displayResto = cfg ? cfg.displayName : toProperCase(agg.displayName);

          var v_req = agg ? agg.req : 0;
          var v_deliv = agg ? agg.deliv : 0;
          var v_acc = agg ? agg.acc : 0;
          var v_canc = agg ? agg.canc : 0;
          var v_gmv = agg ? agg.gmv : 0;
          var v_comm = agg ? agg.comm : 0;
          var v_pres = agg ? agg.promoResto : 0;
          var v_padm = agg ? agg.promoAdmin : 0;
          var v_lrlg = agg ? agg.lrLg : 0;

          var successRate = v_req === 0 ? 0 : (v_deliv / v_req);
          var tauxAccept = v_deliv === 0 ? 0 : (v_acc / v_deliv);
          var tauxCanc = v_req === 0 ? 0 : (v_canc / v_req);
          var aov = v_deliv === 0 ? 0 : (v_gmv / v_deliv);
          var pctGlobalDeliv = totDelivGlobal === 0 ? 0 : (v_deliv / totDelivGlobal);

          statRecords.push({
            am: amName,
            rawMetrics: {
              req: v_req,
              deliv: v_deliv,
              successRate: successRate,
              acc: v_acc,
              tauxAccept: tauxAccept,
              canc: v_canc,
              tauxCanc: tauxCanc,
              gmv: Number(v_gmv.toFixed(2)),
              aov: Number(aov.toFixed(2)),
              comm: Number(v_comm.toFixed(2)),
              promoResto: v_pres,
              promoAdmin: v_padm,
              lrLg: Number(v_lrlg.toFixed(2)),
              pctGlobalDeliv: pctGlobalDeliv
            },
            cells: [
              amName,
              areaVal,
              displayResto,
              v_req,
              v_deliv,
              (successRate * 100).toFixed(1) + '%',
              v_acc,
              (tauxAccept * 100).toFixed(1) + '%',
              v_canc,
              (tauxCanc * 100).toFixed(1) + '%',
              Number(v_gmv.toFixed(2)),
              Number(aov.toFixed(2)),
              Number(v_comm.toFixed(2)),
              v_pres,
              v_padm,
              Number(v_lrlg.toFixed(2)),
              (pctGlobalDeliv * 100).toFixed(2) + '%'
            ]
          });
        });

        statRecords.sort(function (a, b) {
          return (b.rawMetrics.deliv - a.rawMetrics.deliv) || a.cells[2].localeCompare(b.cells[2], 'fr');
        });

        return statRecords;
      }
