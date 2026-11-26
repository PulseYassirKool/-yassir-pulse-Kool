      /* ========================================================================
         B. COMPTES, RÔLES & GRILLE COMMISSIONS SYNCHRONISÉE GOOGLE SHEETS
         ======================================================================== */
      var AM_AGENTS = [
        'Aziza Souli',
        'Khouloud Harbaoui',
        'Omar Beldi',
        'Imed Fourati',
        'Nour Ali',
        'Iheb Dachraoui',
        'Ilyes kammoun',
        'Eya Majdoub'
      ];

      var STORAGE_KEYS = {
        AM_PORTFOLIOS: 'yassir_vf_am_portfolios_v9',
        COMMISSIONS: 'yassir_vf_commissions_v9',
        BUDGET: 'yassir_vf_budget_v1',
        REASONS: 'yassir_vf_growth_drop_reasons_v1',
        RESTO_STATUS: 'yassir_vf_resto_status_v1',
        CRM_COMMENTS: 'yassir_vf_crm_comments_v1',
        OFFRE_PARTICIPATION: 'yassir_vf_offre_participation_v1',
        OFFRE_PART_SHEET_ID: 'yassir_vf_offre_part_sheet_id_v1'
      };

      // Rôles :
      // 'owner'      -> Propriétaire Admin (tout voir + tout modifier : accès, AM, commissions)
      // 'viewer_all' -> Propriétaire Lecture Seule (Karim Ben Rahal, Ahmed Marrouki : tout voir, rien modifier)
      // 'am'         -> Account Manager (voir Global + son propre portefeuille uniquement, rien modifier)

      // Grille officielle synchronisée depuis Google Sheets (Restaurant par facture.xlsx)
      var DEFAULT_COMMISSIONS_MAP = {}; // rempli après connexion (GET /api/bootstrap)

      // Portefeuilles AM pré-chargés (Omar Beldi: 127, Nour Ali: 265, Aziza Souli: 49, Khouloud Harbaoui: 105)
      var DEFAULT_PORTFOLIOS_COMPACT = {}; // rempli après connexion (GET /api/bootstrap)

      var currentUser = null;

      function loadInitialCommissions() {
        var raw = safeGet(STORAGE_KEYS.COMMISSIONS);
        if (raw) {
          try {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
          } catch (e) {
            // Ignorer
          }
        }
        var copy = Object.assign({}, DEFAULT_COMMISSIONS_MAP);
        if (Object.keys(copy).length > 0) safeSet(STORAGE_KEYS.COMMISSIONS, JSON.stringify(copy));
        return copy;
      }

      function saveCommissionsToStore() {
        var key = (typeof currentBrand !== 'undefined' && currentBrand === 'kool')
          ? 'kool_vf_commissions_v1'
          : STORAGE_KEYS.COMMISSIONS;
        safeSet(key, JSON.stringify(state.customCommissions));
      }

      function buildDefaultPortfolioMap() {
        var map = {};
        Object.keys(DEFAULT_PORTFOLIOS_COMPACT).forEach(function (amName) {
          var arr = DEFAULT_PORTFOLIOS_COMPACT[amName];
          for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            var rName = String(item[2] || '').trim();
            if (!rName) continue;
            map[rName.toLowerCase()] = {
              am: amName,
              displayName: rName,
              ville: String(item[0] || '').trim(),
              segment: String(item[1] || '').trim()
            };
          }
        });
        return map;
      }

      function loadInitialPortfolios() {
        var raw = safeGet(STORAGE_KEYS.AM_PORTFOLIOS);
        if (raw) {
          try {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
              return parsed;
            }
          } catch (e) {
            // Ignorer
          }
        }
        var defMap = buildDefaultPortfolioMap();
        if (Object.keys(defMap).length > 0) safeSet(STORAGE_KEYS.AM_PORTFOLIOS, JSON.stringify(defMap));
        return defMap;
      }

      function savePortfoliosToStore() {
        var key = (typeof currentBrand !== 'undefined' && currentBrand === 'kool')
          ? 'kool_vf_am_portfolios_v1'
          : STORAGE_KEYS.AM_PORTFOLIOS;
        safeSet(key, JSON.stringify(state.amPortfolios));
      }

      function isOwnerAdmin() {
        if (!currentUser) return false;
        return currentUser.role === 'owner';
      }

      function isMarketOnlyViewer() {
        if (!currentUser) return false;
        return currentUser.role === 'market_am' || currentUser.role === 'market_viewer';
      }

      function isFoodOnlyAm() {
        if (!currentUser) return false;
        return currentUser.role === 'am' && !isMarketOnlyViewer();
      }

      function canViewAllPortfolios() {
        return currentUser && (currentUser.role === 'owner' || currentUser.role === 'viewer_all');
      }

      function canSeeZeroOrdersStats() {
        if (!currentUser) return false;
        if (currentUser.role === 'owner' || currentUser.role === 'viewer_all' || isMarketOnlyViewer()) return true;
        return false;
      }

      function canSeeGlobalSynth() {
        return canSeeZeroOrdersStats();
      }

      function getAllowedAmListForCurrentUser() {
        if (!currentUser) return [];
        var isKool = (typeof currentBrand !== 'undefined' && currentBrand === 'kool');
        if (canViewAllPortfolios()) {
          return isKool
            ? AM_AGENTS.filter(function (a) { return a !== 'Eya Majdoub'; })
            : AM_AGENTS.slice();
        }
        if (currentUser.amName) {
          if (isKool && currentUser.amName === 'Eya Majdoub') return [];
          return [currentUser.amName];
        }
        return [];
      }

      function escapeHtml(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      var _normalizeTextCache = new Map();
      function normalizeText(str) {
        if (str === null || str === undefined) return '';
        var s = typeof str === 'string' ? str : String(str);
        if (!s) return '';
        var cached = _normalizeTextCache.get(s);
        if (cached !== undefined) return cached;
        var res = s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (_normalizeTextCache.size > 40000) _normalizeTextCache.clear();
        _normalizeTextCache.set(s, res);
        return res;
      }

      function toProperCase(str) {
        return String(str || '').replace(/\w\S*/g, function (txt) {
          return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
      }

      function showToast(htmlMessage, type) {
        var container = document.getElementById('toastContainer');
        if (!container) return;

        var styles = {
          success: 'bg-white border-l-4 border-[#00BFA5] text-[#1A1A2E]',
          error: 'bg-white border-l-4 border-[#FF2A6D] text-[#1A1A2E]',
          info: 'bg-white border-l-4 border-[#6C2BD9] text-[#1A1A2E]'
        };
        var icons = {
          success: '<i class="fa-solid fa-circle-check text-[#00BFA5] text-base shrink-0 mt-0.5"></i>',
          error: '<i class="fa-solid fa-circle-exclamation text-[#FF2A6D] text-base shrink-0 mt-0.5"></i>',
          info: '<i class="fa-solid fa-circle-info text-[#6C2BD9] text-base shrink-0 mt-0.5"></i>'
        };

        var toast = document.createElement('div');
        toast.className = 'pointer-events-auto p-3.5 rounded-2xl shadow-xl border border-purple-100 text-xs leading-relaxed flex items-start gap-2.5 transition-all duration-300 ' + (styles[type] || styles.info);
        toast.innerHTML = (icons[type] || icons.info) + '<div class="flex-1">' + htmlMessage + '</div>';
        container.appendChild(toast);

        setTimeout(function () {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(8px)';
          setTimeout(function () { toast.remove(); }, 300);
        }, 5000);
      }

      function activateSession(account, remember) {
        currentUser = {
          username: account.username,
          role: account.role,
          displayName: account.displayName || account.username,
          amName: account.amName || null
        };

        state.selectedAm = 'ALL';

        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appWrapper').classList.remove('hidden');

        document.getElementById('headerUserBadge').textContent = account.displayName || account.username;
        var roleBadge = document.getElementById('headerRoleBadge');
        var btnAccess = document.getElementById('btnOpenAccessManager');
        var btnSync = document.getElementById('btnSyncYassirAll');
        var mainSourceCard = document.getElementById('mainSourceImportCard');
        var commImportCard = document.getElementById('commissionsImportCard');
        var tabBtnComm = document.getElementById('tabBtnCommissions');
        var scopeSubtitle = document.getElementById('headerScopeSubtitle');
        var ownerAdminSection = document.getElementById('ownerPortfolioAdminSection');
        var amReadOnlyBanner = document.getElementById('amReadOnlyBanner');
        var amReadOnlyBannerText = document.getElementById('amReadOnlyBannerText');
        var tabLabelPortefeuilles = document.getElementById('tabLabelPortefeuilles');
        var thAmActions = document.getElementById('thAmActions');

        // Éléments commissions (strictement réservés à owner admin)
        var dropZoneComm = document.getElementById('dropZoneComm');
        var commReadOnlyCardInfo = document.getElementById('commReadOnlyCardInfo');
        var ownerCommHeaderActions = document.getElementById('ownerCommHeaderActions');
        var formAddCommission = document.getElementById('formAddCommission');
        var commReadOnlyBanner = document.getElementById('commReadOnlyBanner');
        var thCommActions = document.getElementById('thCommActions');
        var btnOpenCommTabLabel = document.getElementById('btnOpenCommTabLabel');

        var ownerImpSec = document.getElementById('ownerImportSection');
        if (ownerImpSec) {
          if (account.role === 'owner') ownerImpSec.classList.remove('hidden');
          else ownerImpSec.classList.add('hidden');
        }

        if (account.role === 'owner') {
          roleBadge.textContent = 'Propriétaire Admin';
          roleBadge.className = 'ml-1 px-2 py-0.2 rounded-full text-[10px] bg-[#FF2A6D] text-white font-extrabold';
          btnAccess.classList.remove('hidden');
          if (btnSync) btnSync.classList.remove('hidden');
          if (mainSourceCard) mainSourceCard.classList.remove('lg:col-span-2');
          if (commImportCard) commImportCard.classList.remove('hidden');
          if (tabBtnComm) tabBtnComm.classList.remove('hidden');
          scopeSubtitle.textContent = 'Propriétaire Admin • Accès complet aux 7 Portefeuilles AM, édition des listes & commissions';
          ownerAdminSection.classList.remove('hidden');
          amReadOnlyBanner.classList.add('hidden');
          tabLabelPortefeuilles.textContent = 'Portefeuilles AM';
          thAmActions.classList.remove('hidden');

          dropZoneComm.classList.remove('hidden');
          commReadOnlyCardInfo.classList.add('hidden');
          ownerCommHeaderActions.classList.remove('hidden');
          formAddCommission.classList.remove('hidden');
          commReadOnlyBanner.classList.add('hidden');
          thCommActions.classList.remove('hidden');
          btnOpenCommTabLabel.textContent = 'Voir / Éditer les taux de commission';
        } else if (account.role === 'market_am' || isMarketOnlyViewer()) {
          roleBadge.textContent = 'AM Market • ' + (account.amName || 'Eya Majdoub');
          roleBadge.className = 'ml-1 px-2 py-0.2 rounded-full text-[10px] bg-[#00BFA5] text-[#1A1A2E] font-extrabold';
          btnAccess.classList.add('hidden');
          if (btnSync) btnSync.classList.add('hidden');
          if (mainSourceCard) mainSourceCard.classList.add('lg:col-span-2');
          if (commImportCard) commImportCard.classList.add('hidden');
          if (tabBtnComm) tabBtnComm.classList.add('hidden');
          scopeSubtitle.textContent = 'Espace AM Market (' + (account.amName || 'Eya Majdoub') + ') • Accès exclusif à la Vue Globale Market, Synthèse Market & votre portefeuille';
          var chipsElMkt = document.getElementById('storedFilesChipsBar'); if (chipsElMkt) chipsElMkt.classList.add('hidden');
          ownerAdminSection.classList.add('hidden');
          amReadOnlyBanner.classList.remove('hidden');
          amReadOnlyBannerText.textContent = 'Vous consultez uniquement votre portefeuille et la vue globale Market (avec Synthèse & Variation Market).';
          tabLabelPortefeuilles.textContent = 'Mon Portefeuille';
          thAmActions.classList.add('hidden');

          dropZoneComm.classList.add('hidden');
          commReadOnlyCardInfo.classList.remove('hidden');
          ownerCommHeaderActions.classList.add('hidden');
          formAddCommission.classList.add('hidden');
          commReadOnlyBanner.classList.remove('hidden');
          thCommActions.classList.add('hidden');
          btnOpenCommTabLabel.textContent = 'Consulter la grille des commissions';
        } else if (account.role === 'viewer_all') {
          roleBadge.textContent = 'Propriétaire • Lecture';
          roleBadge.className = 'ml-1 px-2 py-0.2 rounded-full text-[10px] bg-[#00BFA5] text-[#1A1A2E] font-extrabold';
          btnAccess.classList.add('hidden');
          if (btnSync) btnSync.classList.add('hidden');
          if (mainSourceCard) mainSourceCard.classList.add('lg:col-span-2');
          if (commImportCard) commImportCard.classList.add('hidden');
          if (tabBtnComm) tabBtnComm.classList.add('hidden');
          scopeSubtitle.textContent = 'Vue Direction (' + (account.displayName || account.username) + ') • Consultation de tous les portefeuilles AM & Vue Globale (Lecture seule)';
          ownerAdminSection.classList.add('hidden');
          amReadOnlyBanner.classList.remove('hidden');
          amReadOnlyBannerText.textContent = 'Mode lecture seule : vous pouvez consulter et exporter les statistiques de tous les portefeuilles AM et du Global, sans modifier les listes.';
          tabLabelPortefeuilles.textContent = 'Portefeuilles AM';
          thAmActions.classList.add('hidden');

          dropZoneComm.classList.add('hidden');
          commReadOnlyCardInfo.classList.remove('hidden');
          ownerCommHeaderActions.classList.add('hidden');
          formAddCommission.classList.add('hidden');
          commReadOnlyBanner.classList.remove('hidden');
          thCommActions.classList.add('hidden');
          btnOpenCommTabLabel.textContent = 'Consulter la grille des commissions';
        } else {
          roleBadge.textContent = 'AM • ' + (account.amName || account.username);
          roleBadge.className = 'ml-1 px-2 py-0.2 rounded-full text-[10px] bg-[#00BFA5] text-[#1A1A2E] font-extrabold';
          btnAccess.classList.add('hidden');
          if (btnSync) btnSync.classList.add('hidden');
          if (mainSourceCard) mainSourceCard.classList.add('lg:col-span-2');
          if (commImportCard) commImportCard.classList.add('hidden');
          if (tabBtnComm) tabBtnComm.classList.add('hidden');
          scopeSubtitle.textContent = 'Espace AM (' + (account.amName || account.username) + ') • Accès exclusif à la Vue Globale et à votre portefeuille';
          var chipsElAm = document.getElementById('storedFilesChipsBar'); if (chipsElAm) chipsElAm.classList.add('hidden');
          ownerAdminSection.classList.add('hidden');
          amReadOnlyBanner.classList.remove('hidden');
          amReadOnlyBannerText.textContent = 'Vous consultez uniquement votre portefeuille et la vue globale. La modification des restaurants ou des commissions est réservée au Propriétaire Admin.';
          tabLabelPortefeuilles.textContent = 'Mon Portefeuille';
          thAmActions.classList.add('hidden');

          dropZoneComm.classList.add('hidden');
          commReadOnlyCardInfo.classList.remove('hidden');
          ownerCommHeaderActions.classList.add('hidden');
          formAddCommission.classList.add('hidden');
          commReadOnlyBanner.classList.remove('hidden');
          thCommActions.classList.add('hidden');
          btnOpenCommTabLabel.textContent = 'Consulter la grille des commissions';
        }

        var prevBar = document.getElementById('prevDataImportBar');
        if (prevBar) {
          if (canSeeGlobalSynth()) prevBar.classList.remove('hidden');
          else prevBar.classList.add('hidden');
        }
        var btnSyncYassir = document.getElementById('btnSyncYassirAll');
        if (btnSyncYassir) {
          if (isOwnerAdmin()) { btnSyncYassir.classList.remove('hidden'); } else { btnSyncYassir.classList.add('hidden'); }
        }
        // Sync Kool et section Synchronisation : strictement réservées au propriétaire.
        var btnSyncKool = document.getElementById('btnSyncKoolSheetsNow');
        if (btnSyncKool) {
          if (isOwnerAdmin()) { btnSyncKool.classList.remove('hidden'); } else { btnSyncKool.classList.add('hidden'); }
        }
        var syncSection = document.getElementById('syncSection');
        if (syncSection) {
          if (isOwnerAdmin()) { syncSection.classList.remove('hidden'); } else { syncSection.classList.add('hidden'); }
        }
        // Historique d'activité : strictement réservé au propriétaire.
        var btnActivityLog = document.getElementById('btnOpenActivityLog');
        if (btnActivityLog) {
          if (isOwnerAdmin()) { btnActivityLog.classList.remove('hidden'); } else { btnActivityLog.classList.add('hidden'); }
        }
        var btnReset = document.getElementById('btnResetAll');
        if (btnReset) {
          if (isOwnerAdmin() && state.rawSourceRows && state.rawSourceRows.length > 1) { btnReset.classList.remove('hidden'); btnReset.style.display = 'inline-flex'; } else { btnReset.classList.add('hidden'); btnReset.style.display = 'none'; }
        }
        _amStatsCache.clear();
        _notifCacheSig = '';
        syncLmdSidebarActiveState(state.activeTab);
        if (state.rawSourceRows && state.rawSourceRows.length > 1) {
          if (!state.minAvailableDate || !state.maxAvailableDate) {
            detecterBornesDatesSource(state.rawSourceRows);
          }
          state.dateStart = '';
          state.dateEnd = '';
          appliquerFiltreSemaineRapideParDefaut();
          executerTraitementMetier();
        } else {
          mettreAJourInterface();
        }
      }

      window.yassirTogglePwd = function () {
        var pwdInput = document.getElementById('loginPassword');
        var icon = document.getElementById('iconToggleLoginPwd');
        if (!pwdInput || !icon) return;
        var isPassword = pwdInput.type === 'password';
        pwdInput.type = isPassword ? 'text' : 'password';
        icon.className = isPassword ? 'fa-solid fa-eye-slash text-sm' : 'fa-solid fa-eye text-sm';
      };

      window.yassirLogout = function () {
        // Journaliser la déconnexion (AM uniquement) avant d'effacer la session.
        // Fire-and-forget : l'envoi ne bloque jamais la déconnexion.
        try { window.yassirJournaliser('logout', 'Déconnexion'); } catch (e) {}
        currentUser = null;
        state.selectedAm = 'ALL';
        amTableZeroOrderFilter = 'all';
        restoListZeroFilterMode = 'all';
        PulseAuth.clear();
        window.location.reload();
        document.getElementById('appWrapper').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('loginPassword').value = '';
      };
