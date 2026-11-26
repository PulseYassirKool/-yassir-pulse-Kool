      /* ========================================================================
         O1. SYNCHRONISATION TEMPS RÉEL GOOGLE SHEETS (FETCH + JSONP SANS BLOCAGE CORS)
         ======================================================================== */
      var LIVE_SHEETS_CONFIG = {"PORTFOLIOS_SHEET_ID": "", "PORTFOLIOS_MASTER_GIDS": [], "PORTFOLIOS_TABS": [], "COMMISSIONS_SHEET_ID": "", "COMMISSIONS_TAB": "", "COMMISSIONS_GID": "", "BUDGET_SHEET_ID": "", "BUDGET_GID": "", "BUDGET_TAB": "", "RESTO_STATUS_SHEET_ID": "", "RESTO_STATUS_GID": "", "OFFRE_PARTICIPATION_SHEET_ID": "", "OFFRE_PARTICIPATION_GID": "", "HISTORICAL_2025_SHEET_ID": "", "HISTORICAL_2025_GID": "", "HISTORICAL_MONTHS": []}; // rempli après connexion (GET /api/bootstrap)

      function parseCsvLineSimple(line, sep) {
        var result = [];
        var cur = '';
        var inQuotes = false;
        for (var i = 0; i < line.length; i++) {
          var ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === sep && !inQuotes) {
            result.push(cur);
            cur = '';
          } else {
            cur += ch;
          }
        }
        result.push(cur);
        return result;
      }

      function parseCsvTextToRows(csvText) {
        var clean = String(csvText || '').replace(/^\uFEFF/, '');
        if (!clean.trim()) return [];
        var firstNl = clean.indexOf('\n');
        var headerLine = firstNl !== -1 ? clean.slice(0, firstNl) : clean;
        var sep = (headerLine.split(';').length > headerLine.split(',').length) ? ';' : ',';

        var rows = [];
        var curRow = [];
        var cur = '';
        var inQuotes = false;
        for (var i = 0; i < clean.length; i++) {
          var ch = clean[i];
          if (ch === '"') {
            if (inQuotes && clean[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === sep && !inQuotes) {
            curRow.push(cur);
            cur = '';
          } else if ((ch === '\n' || (ch === '\r' && clean[i + 1] === '\n')) && !inQuotes) {
            if (ch === '\r') i++;
            curRow.push(cur);
            if (curRow.some(function (c) { return String(c).trim() !== ''; })) {
              rows.push(curRow);
            }
            curRow = [];
            cur = '';
          } else if (ch !== '\r' || inQuotes) {
            cur += ch;
          }
        }
        curRow.push(cur);
        if (curRow.some(function (c) { return String(c).trim() !== ''; })) {
          rows.push(curRow);
        }
        return rows;
      }

      // Méthode JSONP officielle Google Visualization (contourne 100% des blocages CORS dans Google Sites / GitHub Pages)
      function fetchGoogleSheetJsonp(sheetId, sheetNameOrGid, isGid) {
        return new Promise(function (resolve, reject) {
          var cbName = 'yassirGvizCb_' + Math.random().toString(36).slice(2) + '_' + Date.now();
          var script = document.createElement('script');
          var timer = setTimeout(function () {
            cleanup();
            reject(new Error('Timeout JSONP'));
          }, 25000);

          function cleanup() {
            clearTimeout(timer);
            if (script.parentNode) script.parentNode.removeChild(script);
            try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
          }

          window[cbName] = function (response) {
            cleanup();
            if (!response || response.status === 'error' || !response.table) {
              reject(new Error('Erreur réponse Google Sheets'));
              return;
            }
            var rows = [];
            if (response.table.cols) {
              var headerRow = response.table.cols.map(function (c) { return c && c.label ? String(c.label).trim() : ''; });
              if (headerRow.some(function (h) { return h !== ''; })) {
                rows.push(headerRow);
              }
            }
            if (response.table.rows) {
              response.table.rows.forEach(function (r) {
                if (!r || !r.c) return;
                rows.push(r.c.map(function (cell) {
                  if (!cell) return '';
                  if (cell.v === null || cell.v === undefined) {
                    return (cell.f !== null && cell.f !== undefined) ? String(cell.f).trim() : '';
                  }
                  var v = cell.v;
                  if (typeof v === 'string' && v.indexOf('Date(') === 0) {
                    var dm = v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
                    if (dm) {
                      var yy = parseInt(dm[1], 10);
                      var mm = parseInt(dm[2], 10) + 1;
                      var dd = parseInt(dm[3], 10);
                      var hh = dm[4] !== undefined ? parseInt(dm[4], 10) : 0;
                      var mi = dm[5] !== undefined ? parseInt(dm[5], 10) : 0;
                      var ss = dm[6] !== undefined ? parseInt(dm[6], 10) : 0;
                      if (yy <= 1900) {
                        return String(hh).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
                      }
                      var isoD = yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
                      if (hh !== 0 || mi !== 0 || ss !== 0) {
                        return isoD + ' ' + String(hh).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
                      }
                      return isoD;
                    }
                  }
                  return String(v);
                }));
              });
            }
            resolve(rows);
          };

          var param = isGid
            ? ('gid=' + encodeURIComponent(sheetNameOrGid))
            : ('sheet=' + encodeURIComponent(sheetNameOrGid));

          script.src = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) +
                       '/gviz/tq?' + param + '&tqx=out:json;responseHandler:' + cbName + '&_t=' + Date.now();
          script.onerror = function () {
            cleanup();
            reject(new Error('Erreur chargement script Google Sheets'));
          };
          document.head.appendChild(script);
        });
      }

      function fetchGoogleSheetTabSmart(sheetId, primaryTab, altTabs, gid) {
        var candidates = [];
        if (primaryTab) candidates.push({ val: primaryTab, isGid: false });
        if (altTabs && altTabs.length > 0) {
          altTabs.forEach(function (at) {
            if (at && at !== primaryTab) candidates.push({ val: at, isGid: false });
          });
        }
        if (gid) candidates.push({ val: gid, isGid: true });

        function tryFetchCandidate(c) {
          var param = c.isGid ? ('gid=' + encodeURIComponent(c.val)) : ('sheet=' + encodeURIComponent(c.val));
          var csvUrl = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) +
                       '/gviz/tq?tqx=out:csv&' + param + '&_t=' + Date.now();

          return fetch(csvUrl, { cache: 'no-store' })
            .then(function (resp) {
              if (!resp.ok) throw new Error('HTTP ' + resp.status);
              return resp.text();
            })
            .then(function (txt) {
              if (txt.trim().toLowerCase().startsWith('<!doctype html') || txt.trim().toLowerCase().startsWith('<html')) {
                throw new Error('HTML login page');
              }
              var rows = parseCsvTextToRows(txt);
              if (!rows || rows.length === 0) throw new Error('Empty CSV');
              return rows;
            })
            .catch(function () {
              return fetchGoogleSheetJsonp(sheetId, c.val, c.isGid);
            });
        }

        var chain = Promise.reject(new Error('init'));
        candidates.forEach(function (cand) {
          chain = chain.catch(function () {
            return tryFetchCandidate(cand);
          });
        });
        return chain;
      }

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

      // Lecture des onglets portefeuilles d'un classeur complet (.xlsx) : seuls les
      // onglets dont le nom correspond à un AM sont lus. Les autres onglets du classeur
      // fusionné (Budget, Commissions, Offre Participation, Statuts, 2025...) sont
      // ignorés — sinon l'onglet Budget injecterait des restaurants bidons nommés
      // 'Yassir' / 'Kool' (son nom d'AM en colonne A + la marque en dernière colonne).
      // brandFilter : 'Yassir' / 'Kool' (filtre colonne APP) ; exclureAm : AM à exclure
      // (Kool : 'Eya Majdoub', qui n'a pas de portefeuille Kool).
      function extrairePortefeuillesDepuisClasseur(sheetNames, lireLignes, brandFilter, exclureAm) {
        var extractedMap = {};
        var details = [];
        sheetNames.forEach(function (sName) {
          var amFromSheet = matchAgentFromText(sName);
          if (!amFromSheet) return;
          if (exclureAm && amFromSheet === exclureAm) return;
          var rows = lireLignes(sName);
          if (!rows || rows.length === 0) return;
          var tempMap = {};
          var added = extraireRestaurantsDepuisLignesSheet(rows, amFromSheet, tempMap, brandFilter);
          if (added > 0) {
            var keptForSheet = 0;
            Object.keys(tempMap).forEach(function (k) {
              if (exclureAm && tempMap[k].am === exclureAm) return;
              if (!Object.prototype.hasOwnProperty.call(extractedMap, k)) {
                extractedMap[k] = tempMap[k];
                keptForSheet++;
              }
            });
            details.push((amFromSheet || sName) + ' (' + keptForSheet + ')');
          }
        });
        return { map: extractedMap, details: details };
      }
      window.yassirExtrairePortefeuillesDepuisClasseur = extrairePortefeuillesDepuisClasseur;

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
          var cRate = (typeof rawRateVal === 'number' && rawRateVal > 0 && rawRateVal < 1)
            ? Number((rawRateVal * 100).toFixed(4))
            : purgerNombre(String(rawRateVal).replace(/%|[‎‏‪-‮]/g, ''));
          if (cName && cName !== 'restaurant' && cName !== 'restaurant name' && !isNaN(cRate) && cRate > 0) {
            map[cName] = cRate;
            count++;
          }
        }
        return { map: map, count: count };
      }
      window.yassirParseCommissionRows = parseCommissionRows;

      function fetchGoogleSheetByGidSmart(sheetId, gid, fallbackTab) {
        var exportCsvUrl = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) +
                           '/export?format=csv&gid=' + encodeURIComponent(gid) + '&_t=' + Date.now();
        var gvizCsvUrl = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) +
                         '/gviz/tq?tqx=out:csv&gid=' + encodeURIComponent(gid) + '&_t=' + Date.now();

        function tryFetchCsv(url) {
          return fetch(url, { cache: 'no-store' })
            .then(function (resp) {
              if (!resp.ok) throw new Error('HTTP ' + resp.status);
              return resp.text();
            })
            .then(function (txt) {
              if (txt.trim().toLowerCase().startsWith('<!doctype html') || txt.trim().toLowerCase().startsWith('<html')) {
                throw new Error('HTML login page');
              }
              var rows = parseCsvTextToRows(txt);
              if (!rows || rows.length < 2) throw new Error('Empty CSV');
              return rows;
            });
        }

        return tryFetchCsv(exportCsvUrl)
          .catch(function () {
            return tryFetchCsv(gvizCsvUrl);
          })
          .catch(function () {
            return fetchGoogleSheetJsonp(sheetId, gid, true);
          })
          .catch(function () {
            if (fallbackTab) {
              return fetchGoogleSheetJsonp(sheetId, fallbackTab, false);
            }
            throw new Error('All gid fallbacks failed');
          });
      }

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

        var promises = LIVE_SHEETS_CONFIG.HISTORICAL_MONTHS.map(function (mCfg) {
          // Onglet principal du mois + onglets journaliers supplémentaires
          // éventuels du même classeur, fusionnés dans les données du mois
          // (un seul index __fileSourceIdx par mois : les libellés, la purge
          // et les compteurs restent ceux d'aujourd'hui).
          return yassirLireClasseurToutesFeuilles(mCfg.sheetId, mCfg.gid, yassirValiderEnTetesDataYassir, { fallbackTab: mCfg.tab, force: !!manualTrigger })
            .then(function (rows) {
              return { label: mCfg.label, rows: rows, ok: true };
            })
            .catch(function (err) {
              return { label: mCfg.label, rows: [], ok: false, error: err && err.message ? err.message : 'Erreur' };
            });
        });

        return Promise.all(promises).then(function (results) {
          var loadedMonths = [];
          var failedMonths = [];
          var totalAddedRows = 0;

          results.forEach(function (res) {
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
                msg += '<br/><span class="text-[#FF2A6D]">Non accessibles (vérifier partage « Lecteur ») : ' + escapeHtml(failedMonths.join(', ')) + '</span>';
              }
              showToast(msg, 'success');
            }
          } else {
            if (label) label.textContent = 'Sync Mai–Nov';
            if (manualTrigger) {
              showToast(
                'Impossible de lire les 6 feuilles Google Sheets. Vérifiez que chaque feuille (Mai, Juin, Juillet, Août, Septembre, Octobre, Novembre) est partagée en <strong>« Tous les utilisateurs disposant du lien : Lecteur »</strong>.',
                'error'
              );
            }
          }
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

        return fetchGoogleSheetByGidSmart(
          LIVE_SHEETS_CONFIG.BUDGET_SHEET_ID,
          LIVE_SHEETS_CONFIG.BUDGET_GID,
          LIVE_SHEETS_CONFIG.BUDGET_TAB
        )
          .catch(function () {
            return fetchGoogleSheetJsonp(LIVE_SHEETS_CONFIG.BUDGET_SHEET_ID, 'Sheet1', false);
          })
          .catch(function () {
            return fetchGoogleSheetJsonp(LIVE_SHEETS_CONFIG.BUDGET_SHEET_ID, 'Feuille 1', false);
          })
          .then(function (rows) {
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
            if (manualTrigger) {
              showToast(
                '<strong>Budgets AM synchronisés !</strong> (' + Object.keys(state.budgetByAm).length + ' AM configurés).',
                'success'
              );
            }
          })
          .catch(function (err) {
            if (icon) icon.classList.remove('fa-spin');
            if (label) label.textContent = 'Sync Budget';
            if (manualTrigger) {
              showToast(
                '<strong>Budget non accessible par Google Sheets :</strong> ouvrez votre feuille Google Sheets <em>Budget</em>, cliquez sur <strong>Partager</strong> en haut à droite et réglez l\'accès général sur <strong>« Tous les utilisateurs disposant du lien : Lecteur »</strong> (ou saisissez les budgets manuellement ci-dessous).',
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

      function fetchGoogleWorkbookXlsx(sheetId) {
        var xlsxUrl = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) + '/export?format=xlsx&_t=' + Date.now();
        return fetch(xlsxUrl, { cache: 'no-store' })
          .then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.arrayBuffer();
          })
          .then(function (buf) {
            var wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
            if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
              throw new Error('Classeur vide');
            }
            return wb;
          });
      }

      // ==================================================================
      // LECTURE MULTI-ONGLETS (data journalière par onglet, 2026-11-26)
      // ==================================================================
      // Inventaire des onglets par classeur, mis en cache 6 h : évite de
      // retélécharger le classeur à chaque synchro quand il n'a qu'un seul
      // onglet. La synchro manuelle force la redécouverte (l'utilisateur
      // vient d'ajouter un onglet).
      var ONGLETS_CACHE_KEY = 'yassir_pulse_classeur_onglets_v1';
      var ONGLETS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

      function lireCacheOnglets() {
        try {
          var parsed = JSON.parse(safeGet(ONGLETS_CACHE_KEY) || '{}');
          return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) { return {}; }
      }
      function ecrireCacheOnglets(cache) {
        try { safeSet(ONGLETS_CACHE_KEY, JSON.stringify(cache || {})); } catch (e) {}
      }
      window.yassirViderCacheOngletsClasseur = function () { ecrireCacheOnglets({}); };

      // Normalisation d'un en-tête pour la comparaison entre onglets.
      function normaliserEnTeteMultiOnglets(h) {
        return normalizeText(h === null || h === undefined ? '' : String(h)).replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
      }

      // Ligne d'en-tête réelle d'un onglet : première ligne parmi les 5
      // premières avec au moins 4 cellules non vides (même règle que
      // normaliserLignesDataKool), sinon la ligne 0.
      function trouverLigneEnTeteMultiOnglets(rows) {
        if (!rows || rows.length === 0) return 0;
        for (var r = 0; r < Math.min(5, rows.length); r++) {
          var nonEmpty = (rows[r] || []).filter(function (c) { return String(c || '').trim() !== ''; }).length;
          if (nonEmpty >= 4) return r;
        }
        return 0;
      }

      // Validateurs d'en-têtes par type de feuille : un onglet dont les
      // en-têtes ne correspondent pas est ignoré silencieusement (jamais de
      // plantage de la synchro).
      function yassirValiderEnTetesDataKool(headersNorm) {
        var aDate = headersNorm.indexOf('date') !== -1;
        var aCmd = headersNorm.some(function (h) { return /^(n[°o]?\s*commande|order\s*id|numero\s*commande)$/.test(h); });
        return aDate && aCmd;
      }
      function yassirValiderEnTetesDetailsKool(headersNorm) {
        var aCmd = headersNorm.some(function (h) { return /^(order\s*id|n[°o]?\s*commande|numero\s*commande)$/.test(h); });
        var aArt = headersNorm.some(function (h) { return h === 'article' || h.indexOf('article') !== -1 || h.indexOf('item') !== -1; });
        return aCmd && aArt;
      }
      function yassirValiderEnTetesDataYassir(headersNorm) {
        var aOid = headersNorm.indexOf('order id') !== -1;
        var aDay = headersNorm.indexOf('order day') !== -1 || headersNorm.indexOf('delivered day') !== -1;
        return aOid && aDay;
      }
      window.yassirValiderEnTetesDataKool = yassirValiderEnTetesDataKool;
      window.yassirValiderEnTetesDetailsKool = yassirValiderEnTetesDetailsKool;
      window.yassirValiderEnTetesDataYassir = yassirValiderEnTetesDataYassir;

      // Découvre les onglets d'un classeur : inventaire en cache (TTL 6 h),
      // sinon UN SEUL téléchargement XLSX. Retourne { wb, names, sheetIds }
      // (wb null quand l'inventaire en cache suffit ou que le téléchargement
      // a échoué).
      function decouvrirOngletsClasseur(sheetId, force) {
        var cache = lireCacheOnglets();
        var entree = cache[sheetId];
        if (!force && entree && entree.names && entree.names.length <= 1 &&
            (Date.now() - (entree.savedAt || 0)) < ONGLETS_CACHE_TTL_MS) {
          return Promise.resolve({ wb: null, names: entree.names.slice(), sheetIds: entree.sheetIds || [] });
        }
        return fetchGoogleWorkbookXlsx(sheetId)
          .then(function (wb) {
            var names = (wb && wb.SheetNames) || [];
            var sheetIds = [];
            try {
              var ws = (wb.Workbook && wb.Workbook.Sheets) || [];
              sheetIds = ws.map(function (s) {
                if (!s) return '';
                var sid = (s.sheetId !== undefined) ? s.sheetId : s.sheetid;
                return (sid === undefined || sid === null) ? '' : String(sid);
              });
            } catch (e) { sheetIds = []; }
            cache[sheetId] = { names: names.slice(), sheetIds: sheetIds, savedAt: Date.now() };
            ecrireCacheOnglets(cache);
            return { wb: wb, names: names, sheetIds: sheetIds };
          })
          .catch(function () { return { wb: null, names: [], sheetIds: [] }; });
      }

      // Identifie l'onglet principal dans le classeur XLSX, pour ne pas le
      // fusionner deux fois : 1) par sheetId (l'export Google utilise le gid
      // comme sheetId), 2) repli : mêmes en-têtes normalisés ET même nombre de
      // lignes que la lecture par gid. Retourne l'index, ou -1 si introuvable
      // (la fusion est alors abandonnée : on garde l'onglet principal seul).
      function trouverOngletPrincipal(wb, names, mainGid, mainRows) {
        var sheets = [];
        try { sheets = (wb.Workbook && wb.Workbook.Sheets) || []; } catch (e) { sheets = []; }
        for (var i = 0; i < names.length; i++) {
          for (var j = 0; j < sheets.length; j++) {
            if (sheets[j] && sheets[j].name === names[i]) {
              var sid = (sheets[j].sheetId !== undefined) ? sheets[j].sheetId : sheets[j].sheetid;
              if (sid !== undefined && sid !== null && String(sid) === String(mainGid)) return i;
              break;
            }
          }
        }
        var mainHdr = (mainRows[0] || []).map(normaliserEnTeteMultiOnglets).join('|');
        for (var k = 0; k < names.length; k++) {
          try {
            var tabRows = XLSX.utils.sheet_to_json(wb.Sheets[names[k]], { header: 1, defval: '' });
            if (!tabRows || tabRows.length === 0) continue;
            var hdrIdx = trouverLigneEnTeteMultiOnglets(tabRows);
            var tabHdr = (tabRows[hdrIdx] || []).map(normaliserEnTeteMultiOnglets).join('|');
            if (tabHdr === mainHdr && tabRows.length === mainRows.length) return k;
          } catch (e) { /* ignore */ }
        }
        return -1;
      }

      // Lit TOUS les onglets d'un classeur de données et retourne les lignes
      // fusionnées (en-tête de l'onglet principal + lignes de tous les onglets).
      // Stratégie :
      //  1) voie rapide inchangée : l'onglet principal par gid (CSV export
      //     -> gviz -> JSONP) ;
      //  2) UN SEUL téléchargement XLSX du classeur pour découvrir les onglets
      //     supplémentaires et lire leurs lignes (inventaire mis en cache 6 h :
      //     un classeur à un seul onglet ne retélécharge rien entre deux
      //     découvertes) ;
      //  3) chaque onglet supplémentaire est validé par ses en-têtes puis ses
      //     lignes sont réalignées sur l'ordre des colonnes de l'onglet
      //     principal, par nom d'en-tête (chaque onglet mappe ses colonnes par
      //     ses propres en-têtes).
      // Un onglet vide, invalide ou illisible est ignoré silencieusement ; un
      // échec (XLSX illisible, etc.) ne remplace jamais les lignes de
      // l'onglet principal ; la fonction ne rejette jamais.
      // NOTE : il n'existe pas d'endpoint public léger pour lister les onglets
      // d'un classeur (gviz ne renvoie que le 1er onglet) — le téléchargement
      // XLSX est le seul moyen fiable de les découvrir. Pour un classeur à un
      // seul onglet, le résultat est identique à aujourd'hui (mêmes lignes,
      // mêmes compteurs).
      // opts : { fallbackTab, force } (force = redécouverte immédiate, synchro manuelle).
      function yassirLireClasseurToutesFeuilles(sheetId, mainGid, validerEnTetes, opts) {
        if (!sheetId) return Promise.resolve([]);
        var options = opts || {};
        var mainRows = [];
        return fetchGoogleSheetByGidSmart(sheetId, mainGid, options.fallbackTab || '')
          .catch(function () { return []; })
          .then(function (rows) {
            if (rows && rows.length > 1) mainRows = rows;
            // Lecture par gid en échec : le XLSX sert aussi de repli (comme
            // aujourd'hui) — on force la découverte dans ce cas.
            return decouvrirOngletsClasseur(sheetId, !!options.force || mainRows.length < 2);
          })
          .then(function (decouverte) {
            var wb = decouverte && decouverte.wb;
            var names = (decouverte && decouverte.names) || [];
            if (!wb) return mainRows;
            if (names.length === 0) return mainRows;
            if (mainRows.length < 2) {
              // Repli historique : l'onglet principal est le 1er onglet.
              mainRows = XLSX.utils.sheet_to_json(wb.Sheets[names[0]], { header: 1, defval: '' });
              if (!mainRows || mainRows.length < 2) return [];
            }
            if (names.length <= 1) return mainRows;
            var idxPrincipal = trouverOngletPrincipal(wb, names, mainGid, mainRows);
            if (idxPrincipal === -1) return mainRows;
            var mainHeadersNorm = (mainRows[0] || []).map(normaliserEnTeteMultiOnglets);
            var merged = mainRows.slice();
            for (var n = 0; n < names.length; n++) {
              if (n === idxPrincipal) continue;
              try {
                var tabRows = XLSX.utils.sheet_to_json(wb.Sheets[names[n]], { header: 1, defval: '' });
                if (!tabRows || tabRows.length < 2) continue;
                var hdrIdx = trouverLigneEnTeteMultiOnglets(tabRows);
                var tabHeadersNorm = (tabRows[hdrIdx] || []).map(normaliserEnTeteMultiOnglets);
                if (typeof validerEnTetes === 'function' && !validerEnTetes(tabHeadersNorm)) continue;
                var used = {};
                var colMap = mainHeadersNorm.map(function (mh, ci) {
                  if (!mh) return -1; // colonne sans en-tête : ignorée (aucun lecteur ne l'utilise)
                  for (var i = 0; i < tabHeadersNorm.length; i++) {
                    if (tabHeadersNorm[i] === mh && !used[i]) { used[i] = true; return i; }
                  }
                  return -1;
                });
                for (var r = hdrIdx + 1; r < tabRows.length; r++) {
                  var sRow = tabRows[r];
                  if (!sRow || sRow.every(function (c) { return c === null || c === undefined || String(c).trim() === ''; })) continue;
                  var aligned = new Array(mainRows[0].length).fill('');
                  for (var c = 0; c < colMap.length; c++) {
                    if (colMap[c] !== -1 && colMap[c] < sRow.length) aligned[c] = sRow[colMap[c]];
                  }
                  merged.push(aligned);
                }
              } catch (e) { /* onglet illisible : ignoré silencieusement */ }
            }
            return merged;
          })
          .catch(function () { return mainRows || []; });
      }
      window.yassirLireClasseurToutesFeuilles = yassirLireClasseurToutesFeuilles;

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

        // 1. Télécharger le classeur complet (.xlsx) pour lire EXCLUSIVEMENT la liste exacte donnée dans Google Sheets
        var portfoliosPromise = fetchGoogleWorkbookXlsx(LIVE_SHEETS_CONFIG.PORTFOLIOS_SHEET_ID)
          .then(function (wb) {
            var res = extrairePortefeuillesDepuisClasseur(wb.SheetNames, function (sName) {
              return XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' });
            }, 'Yassir', null);
            if (Object.keys(res.map).length === 0) {
              throw new Error('Aucun restaurant extrait depuis le classeur xlsx');
            }
            return { ok: true, map: res.map, details: res.details };
          })
          .catch(function () {
            // Fallback JSONP/CSV si export?format=xlsx est bloqué par CORS.
            // (L'ancien onglet maître gid 495278602 n'existe plus dans le classeur
            // fusionné : le repli lit désormais chaque onglet AM par son gid.)
            var tabPromises = LIVE_SHEETS_CONFIG.PORTFOLIOS_TABS.map(function (entry) {
              return fetchGoogleSheetTabSmart(LIVE_SHEETS_CONFIG.PORTFOLIOS_SHEET_ID, entry.tab, entry.altTabs, entry.gid)
                .then(function (rows) { return { am: entry.am, rows: rows, ok: true }; })
                .catch(function () { return { am: entry.am, rows: [], ok: false }; });
            });

            return Promise.all(tabPromises).then(function (tResList) {
              var extractedMap = {};
              var details = [];
              var seenSignatures = new Set();

              tResList.forEach(function (res) {
                if (!res.ok || !res.rows || res.rows.length === 0) return;
                var dataRowsForSig = res.rows.slice(1, 7).map(function (r) { return (r || []).join('|').trim(); }).join('||');
                var sig = dataRowsForSig || JSON.stringify(res.rows.slice(0, 6));
                if (seenSignatures.has(sig)) return;
                seenSignatures.add(sig);

                var tmpAm = {};
                var addAm = extraireRestaurantsDepuisLignesSheet(res.rows, res.am, tmpAm, 'Yassir');
                if (addAm > 0) {
                  var keptAm = 0;
                  Object.keys(tmpAm).forEach(function (k) {
                    if (!Object.prototype.hasOwnProperty.call(extractedMap, k)) {
                      extractedMap[k] = tmpAm[k];
                      keptAm++;
                    }
                  });
                  details.push(res.am + ' (' + keptAm + ')');
                }
              });

              return {
                ok: Object.keys(extractedMap).length > 0,
                map: extractedMap,
                details: details
              };
            });
          });

        // 2. Synchronisation stricte des Commissions Yassir depuis <sheet-id> (gid=1643627186)
        var commPromise = fetchGoogleSheetByGidSmart(
          LIVE_SHEETS_CONFIG.COMMISSIONS_SHEET_ID,
          LIVE_SHEETS_CONFIG.COMMISSIONS_GID,
          LIVE_SHEETS_CONFIG.COMMISSIONS_TAB
        )
          .catch(function () {
            return fetchGoogleSheetTabSmart(
              LIVE_SHEETS_CONFIG.COMMISSIONS_SHEET_ID,
              LIVE_SHEETS_CONFIG.COMMISSIONS_TAB,
              ['Sheet1', 'Feuille 1'],
              LIVE_SHEETS_CONFIG.COMMISSIONS_GID
            );
          })
          .then(function (rows) { return { rows: rows, ok: true }; })
          .catch(function () { return { rows: [], ok: false }; });

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
          if (commResult.ok && commResult.rows && commResult.rows.length > 1) {
            var parsedComm = parseCommissionRows(commResult.rows, 'Yassir');
            var freshComm = parsedComm.map;
            updatedCommCount = parsedComm.count;
            if (updatedCommCount > 0) {
              safeSet(STORAGE_KEYS.COMMISSIONS, JSON.stringify(freshComm));
              brandArchives.yassir.customCommissions = Object.assign({}, freshComm);
              if (currentBrand === 'yassir') {
                state.customCommissions = Object.assign({}, freshComm);
              }
            }
          }

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
                'Accès bloqué par Google Sheets : ouvrez la feuille Google Sheets, cliquez sur <strong>Partager</strong> en haut à droite et réglez l\'accès général sur <strong>« Tous les utilisateurs disposant du lien : Lecteur »</strong>.',
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
