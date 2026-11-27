// Les anciennes sections utilisent XLSX et Chart comme variables globales.
// Chargement différé (audit 2026-11-27, item 11a) : la page de connexion ne doit
// plus embarquer SheetJS + Chart.js (~1 Mo). Les deux bibliothèques sont chargées
// APRÈS la connexion par window.yassirChargerLibsLourdes() (appelée dans
// onAuthenticated, 02b-auth.js). Tant qu'elles ne sont pas là, les graphiques
// sont ignorés (chaque site `new Chart` vérifie déjà window.Chart) et
// fetchGoogleWorkbookXlsx attend le chargement avant XLSX.read.
window.__PULSE_API__ = import.meta.env.VITE_API_URL || '';

var _libsLourdesPromise = null;
window.yassirChargerLibsLourdes = function () {
  if (window.XLSX && window.Chart) return Promise.resolve(true);
  if (_libsLourdesPromise) return _libsLourdesPromise;
  _libsLourdesPromise = Promise.all([
    import('xlsx'),
    import('chart.js')
  ]).then(function (mods) {
    var XLSX = mods[0];
    var ChartMod = mods[1];
    ChartMod.Chart.register.apply(ChartMod.Chart, ChartMod.registerables);
    window.XLSX = XLSX;
    window.Chart = ChartMod.Chart;
    return true;
  }).catch(function () {
    // La promesse ne rejette jamais : l'app continue sans les libs (les synchros
    // échouent proprement et sont signalées, voir le statut par source).
    _libsLourdesPromise = null;
    return false;
  });
  return _libsLourdesPromise;
};
// Promesse de disponibilité des libs : démarre le chargement si besoin.
window.yassirLibsLourdesPretes = function () {
  if (window.XLSX && window.Chart) return Promise.resolve(true);
  return window.yassirChargerLibsLourdes();
};
