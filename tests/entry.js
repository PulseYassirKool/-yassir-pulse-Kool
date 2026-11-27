// En test, les bibliothèques lourdes sont chargées directement (jsdom ne charge
// pas les chunks dynamiques) : le chargeur différé les trouve déjà présentes et
// ne fait rien (audit 2026-11-27, item 11a).
import * as XLSX from 'xlsx';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);
window.XLSX = XLSX;
window.Chart = Chart;
import '../src/globals.js';
import './api-url.js'; // l'API de test remplace l'URL de production
import 'virtual:legacy-app';
