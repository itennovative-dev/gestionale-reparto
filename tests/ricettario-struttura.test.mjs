// Test della lettura della struttura del ricettario (strati, PE/EST, adesivo automatico).
// Si lancia con:  node tests/ricettario-struttura.test.mjs
// Gira anche nella pubblicazione automatica: se un test fallisce il sito NON viene aggiornato.
// I valori attesi sono scritti a mano qui sotto, non presi dal programma.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'ricettario.html'), 'utf8');
function slice(a, b){
  const i = html.indexOf(a), j = html.indexOf(b, i);
  if(i < 0 || j < 0) throw new Error(`Sezione non trovata in ricettario.html: "${a}" → "${b}"`);
  return html.slice(i, j);
}
const code = slice('const DEFAULT_MATS = {', 'const CFG_GROUPS = [') + slice('function lookup(raw){', 'function unwToPanel(');
const ctx = vm.createContext({console, Math, JSON, Number, String, Object, Array, parseFloat});
vm.runInContext(code + `
  const clone = o => JSON.parse(JSON.stringify(o));
  const MATS = clone(DEFAULT_MATS), CFG = clone(DEFAULT_CFG);
  globalThis.T = {MATS, CFG, lookup, normStruct, adhJoints, parseStruct, contactLoad, knifeFor};`, ctx, {filename:'ricettario.html (estratto struttura)'});
const T = ctx.T;

let pass = 0, fail = 0;
function eq(name, got, exp, tol = 1e-9){
  const ok = (typeof exp === 'number') ? Math.abs(got - exp) <= tol : JSON.stringify(got) === JSON.stringify(exp);
  if(ok) pass++; else { fail++; console.error(`✗ ${name}\n    atteso:   ${JSON.stringify(exp)}\n    ottenuto: ${JSON.stringify(got)}`); }
}
const keys = s => T.parseStruct(s).layers.map(l => l.key);
const adhG = s => { const a = T.parseStruct(s).layers.find(l => l.key === 'ADH'); return a ? a.g : 0; };
const adh = T.CFG.adh; // 2,5 g/m² per accoppiatura

// ---------- PE/EST riconosciuto in tutte le scritture ----------
eq('PE/EST con barra', keys('PET 12 / PE/EST 15 / AL 9 / PE 50'), ['PET','PEEST','ALU','PE','ADH']);
eq('PE/EST con +', keys('PET 12 + PE/EST 15 + AL 9 + PE 50'), ['PET','PEEST','ALU','PE','ADH']);
eq('PE EST con spazio', keys('PET 12 + PE EST 20'), ['PET','PEEST']);
eq('PE-EST', keys('PET 12 + PE-EST 20'), ['PET','PEEST']);
eq('PE/ESTR', keys('PET 12 + pe/estr 20'), ['PET','PEEST']);
eq('LDPE/EST', keys('PET 12 + LDPE/EST 20'), ['PET','PEEST']);
eq('PE semplice resta PE', keys('PET 12 + PE 50'), ['PET','PE','ADH']);
eq('PE / PET non diventa estruso', keys('PE 50 / PET 12'), ['PE','PET','ADH']);
eq('nessun errore', T.parseStruct('PET 12 / PE/EST 15 / AL 9 / PE 50').errors, []);

// ---------- adesivo: solo sulle giunzioni senza PE/EST ----------
eq('accoppiato classico: 2 giunzioni', adhG('PET 12 + AL 9 + PE 50'), 2*adh);
eq('estruso come legante: resta solo AL–PE', adhG('PET 12 / PE/EST 15 / AL 9 / PE 50'), 1*adh);
eq('extrusion coating: nessun adesivo', adhG('PET 12 + PE/EST 20'), 0);
eq('PE/EST interno a tre strati: nessun adesivo', adhG('PET 12 + PE/EST 15 + PE 40'), 0);
eq('giunzioni da sequenza', T.adhJoints(['PET','PEEST','ALU','PE']), 1);

// ---------- spessore e grammatura dello strato estruso ----------
const est = T.parseStruct('PET 12 + PE/EST 20').layers[1];
eq('µm per default', est.t, 20);
eq('grammatura = µm × densità', est.g, 20*0.92, 1e-6);
const estG = T.parseStruct('PET 12 + PE/EST 18 g').layers[1];
eq('in g/m² se indicato', estG.g, 18);
eq('µm da g/m²', estG.t, 18/0.92, 1e-6);
eq('classe estensibile', T.MATS.PEEST.cls, 'estensibile');
eq('estruso regge meno del film PE', T.MATS.PEEST.sigma < T.MATS.PE.sigma, true);

// ---------- rullatura: PE/EST in faccia esterna fa più presa ----------
const base = {T:60, stretchDom:false, hasMet:false, estOuter:false};
eq('rullatura base 50–100 µm', T.contactLoad(base, 300), 130);
eq('rullatura con PE/EST esterno (130 × 0,90 → 115)', T.contactLoad({...base, estOuter:true}, 300), 115);
eq('PE/EST solo interno non cambia la rullatura', T.contactLoad({...base, hasEst:true}, 300), 130);

console.log(`Struttura ricettario: ${pass} ok, ${fail} falliti`);
if(fail) process.exit(1);
