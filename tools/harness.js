global.PokeIO = require('../src/io.js');
global.PokeGerber = require('../src/gerber.js');
global.PokeBoard = require('../src/board.js');
const fs = require('fs');
module.exports = async function run(paths, log=true) {
  const inputs = paths.map(p => ({ name: p.split('/').pop(), blob: new Blob([fs.readFileSync(p)]) }));
  const t0 = Date.now();
  const st = await PokeBoard.scan(inputs);
  if (log) console.log('scan', Date.now()-t0, 'ms; set', st.set && st.set.dir, st.set && st.set.layers.map(l=>l.role+':'+l.path.split('/').pop()).join(' '), 'drills', st.set && st.set.drills.length, 'boms', st.boms.map(b=>b.name), 'cpls', st.cpls.map(b=>b.name), 'order', JSON.stringify(st.order), st.notes);
  const t1 = Date.now();
  const p = await PokeBoard.build(st);
  if (log) { console.log('build', Date.now()-t1, 'ms', p.name, p.mode, p.meta, 'comps', p.comps.length, 'rows', p.rows.length, 'svg', p.sides.top.length, p.sides.bottom.length);
  p.rows.forEach(r => console.log('  ', r.val, '|', r.kind, '|', r.lcsc, '|', r.refs.join(' '), r.info?'INFO':'', r.polar?'POLAR':'', r.note||''));
  p.checks.forEach(c => console.log('  CHECK', c.level, c.text)); }
  return p;
};
if (require.main === module) module.exports(process.argv.slice(2));
