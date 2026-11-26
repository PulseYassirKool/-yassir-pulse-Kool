      /* ========================================================================
         27. THÈME CLAIR / SOMBRE (MODE NUIT) — préférence personnelle, visible
         par tous les comptes (ce n'est pas une fonction admin).
         - Bouton dans l'en-tête (#btnBasculerTheme) : lune en mode clair,
           soleil en mode nuit. Clic = bascule immédiate, sans recharger.
         - Choix mémorisé en localStorage, clé `yassir_pulse_theme_v1`
           ('clair' | 'sombre'), par navigateur. Par défaut : MODE CLAIR
           (le système d'exploitation n'est pas suivi, pour ne surprendre
           personne). Un petit script inline dans le <head> de index.html
           applique déjà le thème avant le rendu (pas de flash clair).
         - Le thème est 100 % front : aucun changement serveur nécessaire.
         - Graphiques Chart.js : les couleurs de grille / graduations /
           légendes sont adaptées via yassirCouleurGraphique() (à la création)
           et yassirAppliquerThemeGraphiques() (graphiques déjà affichés).
           Les couleurs des courbes et barres ne changent pas.
         ======================================================================== */

      var YASSIR_THEME_CLE = 'yassir_pulse_theme_v1';

      // Thème sombre actif ? (défaut : non = mode clair).
      window.yassirThemeSombre = function () {
        try { return localStorage.getItem(YASSIR_THEME_CLE) === 'sombre'; } catch (e) { return false; }
      };

      // Couleurs Chart.js : grille et graduations claires -> équivalents sombres.
      // En mode clair, la couleur d'origine est renvoyée telle quelle (aucun changement visuel).
      var _yassirCouleursGraphiqueSombre = {
        '#E2E8F0': '#334155', '#F3EBFF': '#334155',
        '#6C2BD9': '#C4B5FD', '#5B21B6': '#C4B5FD',
        '#1A1A2E': '#F1F5F9', '#00897B': '#2DD4BF'
      };
      // Retour vers le clair (un graphique créé en mode nuit n'a pas d'original clair stocké).
      var _yassirCouleursGraphiqueClair = {
        '#334155': '#E2E8F0', '#C4B5FD': '#6C2BD9',
        '#F1F5F9': '#1A1A2E', '#2DD4BF': '#00897B'
      };
      window.yassirCouleurGraphique = function (couleurClaire) {
        try {
          if (!window.yassirThemeSombre()) return couleurClaire;
          return _yassirCouleursGraphiqueSombre[couleurClaire] || couleurClaire;
        } catch (e) { return couleurClaire; }
      };

      // Adapte les graphiques déjà affichés au thème (sans recharger la page).
      // Les couleurs d'origine (claires) sont sauvegardées sur chaque graphique
      // au premier passage, pour pouvoir les restaurer en revenant au clair.
      function yassirAppliquerThemeGraphiques(sombre) {
        try {
          if (!window.Chart) return;
          Chart.defaults.color = sombre ? '#CBD5E1' : '#666666';
          Chart.defaults.borderColor = sombre ? '#334155' : 'rgba(0, 0, 0, 0.1)';
          var instances = Chart.instances ? Object.keys(Chart.instances).map(function (k) { return Chart.instances[k]; }) : [];
          instances.forEach(function (chart) {
            if (!chart || !chart.options) return;
            if (!chart.$yassirOrig) {
              var orig = { scales: {}, legende: null };
              Object.keys(chart.options.scales || {}).forEach(function (nom) {
                var ec = chart.options.scales[nom] || {};
                orig.scales[nom] = {
                  grille: ec.grid && ec.grid.color ? (sombre ? (_yassirCouleursGraphiqueClair[ec.grid.color] || ec.grid.color) : ec.grid.color) : null,
                  graduations: ec.ticks && ec.ticks.color ? (sombre ? (_yassirCouleursGraphiqueClair[ec.ticks.color] || ec.ticks.color) : ec.ticks.color) : null,
                  titre: ec.title && ec.title.color ? (sombre ? (_yassirCouleursGraphiqueClair[ec.title.color] || ec.title.color) : ec.title.color) : null
                };
              });
              if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels && chart.options.plugins.legend.labels.color) {
                var cLeg = chart.options.plugins.legend.labels.color;
                orig.legende = sombre ? (_yassirCouleursGraphiqueClair[cLeg] || cLeg) : cLeg;
              }
              chart.$yassirOrig = orig;
            }
            var o = chart.$yassirOrig;
            Object.keys(chart.options.scales || {}).forEach(function (nom) {
              var ec = chart.options.scales[nom] || {};
              if (ec.grid && o.scales[nom] && o.scales[nom].grille) ec.grid.color = sombre ? window.yassirCouleurGraphique(o.scales[nom].grille) : o.scales[nom].grille;
              if (ec.ticks && o.scales[nom] && o.scales[nom].graduations) ec.ticks.color = sombre ? window.yassirCouleurGraphique(o.scales[nom].graduations) : o.scales[nom].graduations;
              if (ec.title && o.scales[nom] && o.scales[nom].titre) ec.title.color = sombre ? window.yassirCouleurGraphique(o.scales[nom].titre) : o.scales[nom].titre;
            });
            if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels && o.legende) {
              chart.options.plugins.legend.labels.color = sombre ? window.yassirCouleurGraphique(o.legende) : o.legende;
            }
            chart.update();
          });
        } catch (e) {}
      }

      // Applique un thème ('clair' | 'sombre'). Sans argument : relit le choix mémorisé.
      window.yassirAppliquerTheme = function (theme) {
        try {
          var sombre = (theme === 'sombre') || (theme !== 'clair' && window.yassirThemeSombre());
          document.documentElement.classList.toggle('dark', sombre);
          try { localStorage.setItem(YASSIR_THEME_CLE, sombre ? 'sombre' : 'clair'); } catch (e) {}
          var icone = document.getElementById('iconTheme');
          if (icone) {
            icone.classList.toggle('fa-moon', !sombre);
            icone.classList.toggle('fa-sun', sombre);
          }
          var bouton = document.getElementById('btnBasculerTheme');
          if (bouton) bouton.title = sombre ? 'Passer en mode clair' : 'Passer en mode nuit';
          yassirAppliquerThemeGraphiques(sombre);
        } catch (e) {}
      };

      // Bascule clair <-> sombre (bouton de l'en-tête).
      window.yassirBasculerTheme = function () {
        window.yassirAppliquerTheme(window.yassirThemeSombre() ? 'clair' : 'sombre');
      };

      // Appliquer le thème mémorisé au chargement (le script du <head> l'a déjà
      // fait avant le rendu ; ceci synchronise l'icône et les graphiques).
      window.yassirAppliquerTheme();
