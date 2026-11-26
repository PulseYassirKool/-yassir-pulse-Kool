      /* ========================================================================
         28. CLICS DÉLÉGUÉS — SÉCURITÉ XSS (audit 2026-11-27, item 2)
         ========================================================================
         Les valeurs venant des données (noms de restaurants, raisons
         d'annulation, clés d'alerte, N° de commande...) ne doivent JAMAIS
         être interpolées dans du code JavaScript généré (onclick="f('...')") :
         escapeHtml convertit ' en &#39;, que le navigateur reconvertit en '
         avant d'exécuter le code — un nom contenant ');...;// s'exécutait
         au clic, et les noms avec apostrophe cassaient les boutons.
         Règle : les éléments cliquables portent data-action + data-key
         (valeur échappée HTML, relue telle quelle via getAttribute, jamais
         exécutée), et UN SEUL écouteur sur document distribue les clics.
         Motif repris de 21-analyse-restaurant.js (data-resto-key lu via
         getAttribute), généralisé ici à toute l'application.
         ======================================================================== */
      (function () {
        document.addEventListener('click', function (e) {
          var cible = (e.target && e.target.closest) ? e.target.closest('[data-action]') : null;
          if (!cible) return;
          var action = cible.getAttribute('data-action');
          var cle = cible.getAttribute('data-key');
          var type = cible.getAttribute('data-type');
          try {
            if (action === 'remove-commission') {
              window.yassirRemoveCommission(cle);
            } else if (action === 'filter-am-zero') {
              window.yassirFilterAmZeroByCard(e, cle);
            } else if (action === 'select-am-filter') {
              window.yassirSelectAmFilter(cle);
            } else if (action === 'open-edit-resto') {
              window.yassirOpenEditRestoModal(cle);
            } else if (action === 'remove-resto') {
              window.yassirRemoveRestoFromAm(cle);
            } else if (action === 'open-alert') {
              window.yassirOuvrirAlerte(cle, type);
            } else if (action === 'treat-alert') {
              window.yassirTraiterAlerte(cle);
            } else if (action === 'open-order-items') {
              window.yassirOpenOrderItemsModal(cle);
            } else if (action === 'set-canc-type') {
              window.yassirSetCancTypeFilter(cle);
            } else if (action === 'set-canc-reason') {
              window.yassirSetCancReasonFilter(cle);
            }
          } catch (err) {
            // Un clic ne doit jamais faire planter l'application.
            if (window.console && window.console.error) window.console.error('[clic délégué] ' + action, err);
          }
        });
      })();
