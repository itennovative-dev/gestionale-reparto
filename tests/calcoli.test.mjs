// Test dei calcoli del gestionale (conteggio ore, 13ª, IRPEF, TFR, ferie, import timbrature, Pareto fermi).
// Si lancia con:  node tests/calcoli.test.mjs
// Gira anche nella pubblicazione automatica: se un test fallisce il sito NON viene aggiornato.
// I valori attesi sono calcolati a mano qui sotto (con le formule scritte per esteso), non presi dal programma.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function section(startMarker, endMarker){
  const a = html.indexOf(startMarker), b = html.indexOf(endMarker, a);
  if(a < 0 || b < 0) throw new Error(`Sezione non trovata: "${startMarker}" → "${endMarker}" (è cambiato un commento-marcatore nel codice?)`);
  return html.slice(a, b);
}
const hoursCode = section('/* ============================= CONTEGGIO ORE (timbrature', 'async function loadRoster(){');
const downtimeCode = section('/* ============================= REGISTRO FERMI MACCHINA', '/* ============================= CONTEGGIO ORE (timbrature');

// Ambiente minimo: data "oggi" fissa e funzioni di servizio usate dai calcoli
const stubs = `
  const TODAY = '2026-10-22';
  function todayStr(){ return TODAY; }
  function shiftDate(d,n){ const x = new Date(d+'T00:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); }
  function fmtDate(d){ return d; }
  function escHtml(s){ return String(s); }
  function plantLabel(p){ return p; }
  function turnoLabel(t){ return t; }
  const store = {};
  async function storageGet(k){ return store[k] ? {value:store[k]} : null; }
  async function storageSet(k,v){ store[k] = v; }
  function toast(){}
  function downloadBlob(){}
  const document = { getElementById: () => null };
  let MAINTENANCE_LOG = [];
`;
const ctx = vm.createContext({console, Math, Date, JSON, Number, String, Object, Array, Set, Map, isNaN, Promise});
vm.runInContext(stubs + hoursCode + downtimeCode, ctx, {filename:'index.html (estratto)'});
const run = code => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function eq(name, got, exp, tol = 0.005){
  const ok = (typeof exp === 'number') ? Math.abs(got - exp) <= tol : JSON.stringify(got) === JSON.stringify(exp);
  if(ok){ pass++; } else { fail++; console.error(`✗ ${name}\n    atteso:   ${JSON.stringify(exp)}\n    ottenuto: ${JSON.stringify(got)}`); }
}
function reset(){ run(`for(const k in MONTHLY_PARAMS) delete MONTHLY_PARAMS[k]; for(const k in DAILY_HOURS) delete DAILY_HOURS[k]; for(const k in TREDICESIME) delete TREDICESIME[k];`); }

// Impostazioni di riferimento (valori di default del programma)
run(`Object.assign(HOURS_SETTINGS, {oreOrdinarieMax:8, cral:5, addRegionale:114.41, buoniPastoTariffa:7.04, buoniPastoNumero:28,
  irpefSoglia:2153.85, irpefAliquota:0.33, irpefQuotaFissa:495.39, giornoPagaStipendio:6, giornoPagaTredicesima:15, oreTredicesima:173});`);
const P = {tipo:'Reale', tariffa:'14.2', giorni:'21', baseGiorno:'113.6', ivs:'0.0949', stimaStraord:'10', premio:'', conguaglio:'', rettifica:'', rimborso730:''};

// ---------- Timbrature giornaliere ----------
{
  const d = run(`computeDailyHours({e1:'07:58',u1:'12:00',e2:'12:30',u2:'18:10',manuale:''})`);
  eq('ore totali giornata spezzata', d.tot, (12 - (7+58/60)) + ((18+10/60) - 12.5));
  eq('ordinarie max 8', d.ordinarie, 8);
  eq('straordinario oltre le 8', d.straord, d.tot - 8);
  eq('turno notte a cavallo della mezzanotte', run(`computeDailyHours({e1:'22:00',u1:'06:00',manuale:''}).tot`), 8);
  eq('straordinario manuale ha la precedenza', run(`computeDailyHours({e1:'08:00',u1:'16:00',manuale:'2'}).straord`), 2);
}

// ---------- Cedolino mensile (mese senza timbrature: usa giorni e stima straordinario) ----------
{
  reset(); run(`MONTHLY_PARAMS['2026-09'] = ${JSON.stringify(P)};`);
  const s = run(`computeMonthSummary('2026-09')`);
  const comp = 21*113.6 + 10*14.2;                       // 2527,60
  const ivs = comp*0.0949;
  const irpef = (comp - ivs - 2153.85)*0.33 + 495.39;
  const tratt = ivs + irpef + 5 + 114.41;
  eq('totale competenze', s.totaleCompetenze, comp);
  eq('IVS', s.ivs, ivs);
  eq('IRPEF mensile', s.irpef, irpef);
  eq('totale trattenute', s.totaleTrattenute, tratt);
  eq('netto del mese', s.nettoMese, comp - tratt);
  // con rimborso 730 e conguaglio
  run(`MONTHLY_PARAMS['2026-09'].rimborso730 = '120'; MONTHLY_PARAMS['2026-09'].conguaglio = '30';`);
  const s2 = run(`computeMonthSummary('2026-09')`);
  eq('netto effettivo con 730 e conguaglio', s2.nettoEffettivo, comp - (tratt + 30) + 120);
}

// ---------- Creazione rapida del mese e calendario ----------
{
  eq('giorni lavorativi dicembre 2026 (8 e 25 festivi)', run(`workingDaysInMonth('2026-12')`), 21);
  eq('giorni lavorativi aprile 2026 (Pasquetta 6/4)', run(`workingDaysInMonth('2026-04')`), 21);
  eq('giorni lavorativi agosto 2026 (15/8 è sabato)', run(`workingDaysInMonth('2026-08')`), 21);
  eq('Pasqua 2027', run(`easterSunday(2027)`), '2027-03-28');
  reset(); run(`MONTHLY_PARAMS['2026-09'] = ${JSON.stringify(P)}; createMonthParams('2026-10');`);
  const m = run(`MONTHLY_PARAMS['2026-10']`);
  eq('nuovo mese copia tariffa/base/IVS/stima', [m.tariffa, m.baseGiorno, m.ivs, m.stimaStraord], ['14.2','113.6','0.0949','10']);
  eq('nuovo mese azzera voci una tantum', [m.premio, m.conguaglio, m.rettifica, m.rimborso730], ['','','','']);
  eq('nuovo mese: giorni dal calendario (ottobre 2026)', m.giorni, 22);
  eq('mese suggerito = successivo all\'ultimo', run(`suggestedNewMonth()`), '2026-11');
  eq('accredito stipendio di novembre', run(`accreditoStipendio('2026-11')`), '2026-12-06');
}

// ---------- 13ª ----------
{
  const t = run(`computeTredicesima(2026)`);
  const lordo = 113.6/8*173;                              // paga oraria × 173
  const ivs = lordo*0.0949, irpef = (lordo - ivs)*0.33;
  eq('13ª lorda stimata = paga oraria × 173', t.lordo, lordo);
  eq('13ª IRPEF marginale', t.irpef, irpef);
  eq('13ª netta', t.netto, lordo - ivs - irpef);
  eq('accredito 13ª', t.accredito, '2026-12-15');
  run(`TREDICESIME['2026'] = {lordo:'2500', ivs:''};`);
  eq('13ª inserita a mano', run(`computeTredicesima(2026).lordo`), 2500);
  eq('13ª non entra nel cedolino di dicembre', run(`MONTHLY_PARAMS['2026-12'] = ${JSON.stringify(P)}; computeMonthSummary('2026-12').totaleCompetenze`), 21*113.6 + 10*14.2);
}

// ---------- IRPEF annuale 2026 ----------
{
  eq('IRPEF lorda 20.000', run(`irpefLorda(20000)`), 4600);
  eq('IRPEF lorda 40.000', run(`irpefLorda(40000)`), 28000*0.23 + 12000*0.33);
  eq('IRPEF lorda 60.000', run(`irpefLorda(60000)`), 28000*0.23 + 22000*0.33 + 10000*0.43);
  eq('detrazione lavoro dip. 12.000', run(`detrazioneLavoroDip(12000)`), 1955);
  eq('detrazione lavoro dip. 20.000', run(`detrazioneLavoroDip(20000)`), 1910 + 1190*8000/13000);
  eq('detrazione lavoro dip. 30.000 (+65)', run(`detrazioneLavoroDip(30000)`), 1910*20000/22000 + 65);
  eq('detrazione lavoro dip. 40.000', run(`detrazioneLavoroDip(40000)`), 1910*10000/22000);
  eq('cuneo: 30.000 → 1.000 € di detrazione', run(`cuneoFiscale(30000).detrazione`), 1000);
  eq('cuneo: 36.000 → 500 €', run(`cuneoFiscale(36000).detrazione`), 500);
  eq('cuneo: 18.000 → somma esente 4,8%', run(`cuneoFiscale(18000).sommaEsente`), 864);
  // con i progressivi da busta: mesi successivi all'aliquota effettiva reale
  reset();
  ['2026-09','2026-10','2026-11','2026-12'].forEach(k=>run(`MONTHLY_PARAMS['${k}'] = ${JSON.stringify(P)};`));
  run(`HOURS_EXTRA.tax['2026'] = {progMese:'2026-09', progImponibile:'20000', progIrpef:'3000'};`);
  const r = run(`computeAnnualTax(2026)`);
  const impM = (21*113.6 + 10*14.2)*(1-0.0949);
  const tLordo = 113.6/8*173, tIvs = tLordo*0.0949, tIrpef = (tLordo - tIvs)*0.33;
  const R = 20000 + 3*impM + (tLordo - tIvs);
  const tratt = 3000 + 3*impM*0.15 + tIrpef;
  const netta = (28000*0.23 + (R-28000)*0.33) - (1910*(50000-R)/22000 + 65) - 1000;
  eq('conguaglio: reddito annuo', r.imponibile, R);
  eq('conguaglio: IRPEF trattenuta', r.trattenuta, tratt);
  eq('conguaglio: IRPEF dovuta', r.netta, netta);
  eq('conguaglio stimato', r.conguaglio, tratt - netta);
}

// ---------- Ferie e ROL ----------
{
  reset();
  run(`Object.assign(HOURS_EXTRA.leave, {saldoData:'2026-08-31', ferieSaldo:'120', rolSaldo:'40', ferieMese:13.33, rolMese:6});
       DAILY_HOURS['2026-10-06'] = {ferie:'8', ferieTipo:'ferie'}; DAILY_HOURS['2026-10-07'] = {ferie:'4', ferieTipo:'rol'};
       DAILY_HOURS['2026-08-20'] = {ferie:'8', ferieTipo:'ferie'};`); // prima del saldo: già conteggiata in busta
  const l = run(`computeLeave('2026-10-22')`);
  eq('ferie residue (saldo + 1 mese maturato − 8 h)', l.ferie, 120 + 13.33 - 8);
  eq('ROL residui (saldo + 1 mese − 4 h)', l.rol, 40 + 6 - 4);
  eq('ferie a fine anno (+ ott, nov, dic)', l.ferieYearEnd, 120 + 4*13.33 - 8);
}

// ---------- TFR ----------
{
  reset();
  for(let m=1; m<=12; m++) run(`MONTHLY_PARAMS['2026-${String(m).padStart(2,'0')}'] = ${JSON.stringify(P)};`);
  run(`Object.assign(HOURS_EXTRA.tfr, {fondoIniziale:'10000', annoFondo:'2025', rivalutazione:2, includiStraord:false});`);
  const t = run(`computeTfr(2026)`);
  const utileMese = 21*113.6, tred = 113.6/8*173;
  const quota = (12*utileMese + tred)/13.5 - (12*utileMese + tred)*0.005;
  eq('TFR quota annua (÷13,5 − 0,50%)', t.quotaAnno, quota);
  eq('TFR rivalutazione netta 17%', t.rival - t.impSost, 10000*0.02*0.83);
  eq('TFR a fine anno', t.fondoFine, 10000 + 10000*0.02*0.83 + quota);
}

// ---------- Import timbrature ----------
{
  const a = run(`parseHoursRows(parseCsvText('Dipendente;Data;Entrata;Uscita;Entrata;Uscita\\nRossi;07/10/2026;07:55;12:01;12:31;17:05\\nRossi;08/10/2026;08.00;16:30\\n'))`);
  eq('import: una riga per giorno', [a['2026-10-07'].e1, a['2026-10-07'].u1, a['2026-10-07'].e2, a['2026-10-07'].u2], ['07:55','12:01','12:31','17:05']);
  eq('import: orario col punto', a['2026-10-08'].e1, '08:00');
  const b = run(`parseHoursRows(parseCsvText('data,ora\\n2026-10-09,12:02\\n2026-10-09,07:58\\n2026-10-09,17:00\\n2026-10-09,12:33\\n'))`);
  eq('import: una riga per timbratura, ordinate', [b['2026-10-09'].e1, b['2026-10-09'].u1, b['2026-10-09'].e2, b['2026-10-09'].u2], ['07:58','12:02','12:33','17:00']);
  const c = run(`parseHoursRows([[new Date(Date.UTC(2026,9,12)), 0.3333333, 0.5]])`);
  eq('import: celle Excel (data e frazione di giorno)', [c['2026-10-12'].e1, c['2026-10-12'].u1], ['08:00','12:00']);
  const d = run(`parseHoursRows(parseCsvText('ven 16/10/26;07:59;16:01'))`);
  eq('import: data con giorno della settimana e anno a 2 cifre', d['2026-10-16'].u1, '16:01');
}

// ---------- Pareto fermi ----------
{
  const p = run(`paretoOf([{cause:'A',minutes:90},{cause:'B',minutes:45},{cause:'A',minutes:60},{cause:'C',minutes:5}], r=>r.cause)`);
  eq('Pareto: ordine per tempo', p.map(x=>x.key), ['A','B','C']);
  eq('Pareto: % cumulata seconda causa', p[1].cumPct, 195/200*100);
}

// ---------- Linea Eutrolog: 1 h di linea ferma = 1 h su ciascuno dei 5 impianti ----------
{
  const e = run(`expandDowntime([{id:'x',plant:'EUTROLOG',cause:'Guasto meccanico',minutes:60},{id:'y',plant:'110',cause:'Pulizia',minutes:30}])`);
  eq('Eutrolog: impianti fermati', e.filter(r=>r.viaEutrolog).map(r=>r.plant), ['100','116','118','115','119']);
  eq('Eutrolog: 1 h di linea = 5 h di fermo impianti', e.filter(r=>r.viaEutrolog).reduce((s,r)=>s+r.minutes,0), 300);
  eq('Eutrolog: gli altri fermi restano invariati', e.filter(r=>!r.viaEutrolog).map(r=>[r.plant,r.minutes]), [['110',30]]);
  const p = run(`paretoOf(expandDowntime([{id:'x',plant:'EUTROLOG',cause:'G',minutes:60}]), r=>r.plant)`);
  eq('Eutrolog: nel Pareto per impianto ogni impianto ha 60 minuti', p.map(x=>x.minutes), [60,60,60,60,60]);
  const f = run(`expandDowntime([{id:'z',plant:'EUTROLOG',cause:'G',minutes:60,affected:['100','116','118','119']}])`);
  eq('Eutrolog: impianto fuori linea (115) escluso', f.map(r=>r.plant), ['100','116','118','119']);
  eq('Eutrolog: 1 h di linea con 4 impianti collegati = 4 h', f.reduce((s,r)=>s+r.minutes,0), 240);
}

console.log(`\n${pass} test superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
