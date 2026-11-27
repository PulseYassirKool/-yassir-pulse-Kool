// Les anciennes sections utilisent XLSX et Chart comme variables globales.
// Chargement différé (audit 2026-11-27, item 11a) : la page de connexion ne doit
// plus embarquer SheetJS + Chart.js (~1 Mo). Les deux bibliothèques sont chargées
// APRÈS la connexion par window.yassirChargerLibsLourdes() (appelée dans
// onAuthenticated, 02b-auth.js). Tant qu'elles ne sont pas là, les graphiques
// sont ignorés (chaque site `new Chart` vérifie déjà window.Chart) et
// l'import de fichier XLSX local attend le chargement avant XLSX.read.
window.__PULSE_API__ = import.meta.env.VITE_API_URL || '';

var _libsLourdesModules = null;
var _libsLourdesPromise = null;
window.yassirChargerLibsLourdes = function () {
  if (window.XLSX && window.Chart) return Promise.resolve(true);
  if (_libsLourdesModules) {
    // Modules déjà téléchargés (ex. window.XLSX effacé entre-temps) : on
    // rattache simplement les globales, sans retélécharger.
    window.XLSX = _libsLourdesModules[0];
    window.Chart = _libsLourdesModules[1];
    return Promise.resolve(true);
  }
  if (_libsLourdesPromise) return _libsLourdesPromise;
  _libsLourdesPromise = Promise.all([
    import('xlsx'),
    import('chart.js')
  ]).then(function (mods) {
    var XLSX = mods[0];
    var ChartMod = mods[1];
    ChartMod.Chart.register.apply(ChartMod.Chart, ChartMod.registerables);
    _libsLourdesModules = [XLSX, ChartMod.Chart];
    window.XLSX = XLSX;
    window.Chart = ChartMod.Chart;
    // I2 : des graphiques ont pu être demandés avant l'arrivée des libs
    // (panneau affiché sans Chart) : on les redessine maintenant.
    if (window.__yassirChartsManquants) {
      window.__yassirChartsManquants = false;
      if (typeof window.yassirRedessinerGraphiquesApresLibs === 'function') {
        try { window.yassirRedessinerGraphiquesApresLibs(); } catch (e) {}
      }
    }
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
// I2 : garde à appeler en tête de chaque export / import Excel et de chaque
// export PNG : attend les bibliothèques (message visible pendant l'attente),
// et signale clairement l'échec au lieu d'échouer silencieusement.
// Retourne true si les libs sont là, false sinon (l'appelant abandonne).
window.yassirAttendreLibsLourdes = async function () {
  if (window.XLSX && window.Chart) return true;
  if (typeof window.yassirShowToast === 'function') window.yassirShowToast('Chargement des bibliothèques (Excel / graphiques)…', 'info');
  var ok = await window.yassirLibsLourdesPretes();
  if (!ok) {
    if (typeof window.yassirShowToast === 'function') window.yassirShowToast('Impossible de charger les bibliothèques Excel / graphiques. Vérifiez votre connexion puis réessayez.', 'error');
    return false;
  }
  return true;
};
