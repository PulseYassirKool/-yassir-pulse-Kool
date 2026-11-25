// Les anciennes sections utilisent XLSX et Chart comme variables globales.
import * as XLSX from 'xlsx';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);
window.XLSX = XLSX;
window.Chart = Chart;
window.__PULSE_API__ = import.meta.env.VITE_API_URL || '';
