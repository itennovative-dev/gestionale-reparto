// Test delle funzioni di calcolo dei lavori laser del ricettario (scostamenti, confronto rilevazioni, velocità, versioni).
// Si lancia con:  node tests/ricettario-laser.test.mjs
// Gira anche nella pubblicazione automatica: se un test fallisce il sito NON viene aggiornato.
// I valori attesi sono scritti a mano qui sotto, non presi dal programma.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'ricettario.html'), 'utf8');
const A = '/* ============================= LASER: CALCOLI PURI', B = '/* ============================= FINE LASER: CALCOLI PURI';
const a = html.indexOf(A), b = html.indexOf(B, a);
if(a < 0 || b < 0) throw new Error('Blocco "LASER: CALCOLI PURI" non trovato in ricettario.html (è cambiato un commento-marcatore?)');
const ctx = vm.createContext({console, Math, JSON, Number, String, Object, Array, Set, isNaN, Infinity});
vm.runInContext(html.slice(a, b) + `
  globalThis.T = {LASER_UNITS, LZ_KEYS, LZ_DEV_THR, LZ_DIFF_TOL, lzSlug, lzNum, lzRel, lzDeviations, lzDiffKeys, lzEsito, lzRanges, lzSpeedCompare, lzPushHist, lzNextVersion};`, ctx, {filename:'ricettario.html (estratto laser)'});
const T = ctx.T;

let pass = 0, fail = 0;
function eq(name, got, exp, tol = 1e-9){
  const ok = (typeof exp === 'number') ? (Number.isFinite(exp) ? Math.abs(got - exp) <= tol : Object.is(got, exp)) : JSON.stringify(got) === JSON.stringify(exp);
  if(ok) pass++; else { fail++; console.error(`✗ ${name}\n    atteso:   ${JSON.stringify(exp)}\n    ottenuto: ${JSON.stringify(got)}`); }
}

// ---------- impianti con laser ----------
eq('laser solo su 115 e 116', Object.keys(T.LASER_UNITS).sort(), ['115', '116']);
eq('115 = SEI', T.LASER_UNITS['115'], 'SEI Laser');
eq('116 = Lang', T.LASER_UNITS['116'], 'Lang Laser');

// ---------- codice articolo → id ----------
eq('slug codice', T.lzSlug('  ART 12.345/B  '), 'art-12-345-b');
eq('slug accenti', T.lzSlug('Busta caffè È'), 'busta-caffe-e');
eq('slug vuoto', T.lzSlug('***'), '');

// ---------- numeri ----------
eq('stringa vuota non è zero', T.lzNum(''), NaN);
eq('null non è zero', T.lzNum(null), NaN);
eq('zero resta zero', T.lzNum(0), 0);
eq('stringa numerica', T.lzNum('12.5'), 12.5);

// ---------- scostamento relativo ----------
eq('+10%', T.lzRel(110, 100), 0.10);
eq('-25%', T.lzRel(75, 100), -0.25);
eq('riferimento zero, valore zero', T.lzRel(0, 0), 0);
eq('riferimento zero, valore diverso', T.lzRel(5, 0), Infinity);
eq('valore mancante', T.lzRel(null, 100), NaN);

// ---------- avviso di scostamento dal calcolo (soglia 30%) ----------
eq('soglia 30%', T.LZ_DEV_THR, 0.30);
{
  const saved = {unw:120, rewA:1.0, rewB:2.0, taper:20, rollA:100, rollB:null, v:250, rup:200, rollVel:50};
  const calc  = {unw:100, rewA:1.5, rewB:2.0, taper:25, rollA:140, rollB:150, v:400, rup:100, rollVel:0};
  const d = T.lzDeviations(saved, calc, T.LZ_DEV_THR);
  // unw +20% no · rewA -33,3% sì · rewB 0 no · taper -20% no · rollA -28,6% no · rollB manca · v -37,5% sì · rampe e Vel% non calcolate dal materiale: ignorate
  eq('parametri oltre soglia', d.map(x=>x.k), ['rewA', 'v']);
  eq('percentuale albero A', d[0].pct, (1.0 - 1.5)/1.5);
  eq('percentuale velocità', d[1].pct, (250 - 400)/400);
  eq('calcolato zero ignorato', T.lzDeviations({taper:10}, {taper:0}, 0.3), []);
}

// ---------- confronto tra rilevazione e ricetta ----------
eq('tolleranza confronto 3%', T.LZ_DIFF_TOL, 0.03);
{
  const ric = {unw:120, rewA:1.20, taper:20, rollA:100, v:300, rup:200};
  const ril = {unw:122, rewA:1.30, taper:20, rollA:0, v:300};      // unw +1,7% no · rewA +8,3% sì · rollA -100% sì · rup assente
  eq('chiavi diverse', T.lzDiffKeys(ril, ric, T.LZ_DIFF_TOL), ['rewA', 'rollA']);
  eq('stessi valori', T.lzDiffKeys(ric, ric, 0.005), []);
  eq('riferimento zero e valore presente', T.lzDiffKeys({rollVel:10}, {rollVel:0}, 0.03), ['rollVel']);
}

// ---------- esito della bobina ----------
eq('nessun difetto = ok', T.lzEsito({cordonature:false, spire:false}), 'ok');
eq('cordonature = difetti', T.lzEsito({cordonature:true}), 'difetti');
eq('senza dati = ok', T.lzEsito(undefined), 'ok');

// ---------- campo dei valori sui lotti buoni ----------
{
  const rils = [
    {valori:{v:300, taper:20}, difetti:{}},
    {valori:{v:320, taper:22}, difetti:{cordonature:false}},
    {valori:{v:400, taper:10}, difetti:{spire:true}},      // con difetti: escluso
    {valori:{v:310}, difetti:{}}
  ];
  const r = T.lzRanges(rils);
  eq('lotti buoni', r.n, 3);
  eq('velocità min-max', [r.per.v.min, r.per.v.max, r.per.v.n], [300, 320, 3]);
  eq('taper min-max', [r.per.taper.min, r.per.taper.max, r.per.taper.n], [20, 22, 2]);
  eq('parametro mai rilevato', r.per.rewA, undefined);
}

// ---------- confronto velocità tra impianti ----------
{
  const c = T.lzSpeedCompare(250, 400);               // da Lang 250 a SEI 400 m/min
  eq('differenza m/min', c.dv, 150);
  eq('velocità +60%', c.pct, 0.60);
  eq('tempo di marcia -37,5%', c.tempo, 1 - 250/400);
  eq('velocità mancante', T.lzSpeedCompare(0, 400), null);
}

// ---------- storico e versioni ----------
{
  let h = [];
  for(let i = 1; i <= 45; i++) h = T.lzPushHist(h, {n:i}, 40);
  eq('storico al massimo 40 voci', h.length, 40);
  eq('ultima modifica in cima', h[0].n, 45);
  eq('più vecchia tenuta', h[39].n, 6);
  eq('storico da vuoto', T.lzPushHist(undefined, {n:1}).length, 1);
}
eq('prima versione', T.lzNextVersion(null), 1);
eq('versione successiva', T.lzNextVersion({versione:3}), 4);
eq('versione non valida', T.lzNextVersion({versione:''}), 1);

console.log(`Ricettario laser: ${pass} test superati${fail ? `, ${fail} FALLITI` : ''}`);
if(fail) process.exit(1);
