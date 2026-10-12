'use strict';
// Fills an EMPTY database with demo data for local testing.
// Usage: node scripts/seed-demo.js        Logins: owner / Owner#2026, ravi / Ravi#2026, priya / Priya#2026
const { createPool, migrate } = require('../src/db');
const { push } = require('../src/sync');

const now = new Date(), iso = now.toISOString();
const day = n => { const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const team = [
  { id: 1001, name: 'Owner', mobile: '9000000001', role: 'Admin', username: 'owner', password: 'Owner#2026', salType: 'Monthly', rate: 0, openBal: 0, leaves: 0, address: '', active: true, _up: iso },
  { id: 1002, name: 'Ravi Patil', mobile: '9000000002', role: 'Technician', username: 'ravi', password: 'Ravi#2026', salType: 'Monthly', rate: 15000, openBal: 0, leaves: 0, address: '', active: true, _up: iso },
  { id: 1003, name: 'Priya Shah', mobile: '9000000003', role: 'Accountant', username: 'priya', password: 'Priya#2026', salType: 'Monthly', rate: 18000, openBal: 0, leaves: 0, address: '', active: true, _up: iso },
];
const attendance = [];
let aid = 2001;
for (let n = 1; n <= 5; n++) for (const m of team.slice(1)) {
  attendance.push({ id: aid++, mId: m.id, mName: m.name, date: day(n), ci: '09:0' + n, co: '18:30', status: 'Present', approval: 'approved', _up: iso });
}
const data = {
  team,
  attendance,
  notices: [{ id: 3001, title: 'Welcome to the new server', msg: 'This is demo data for local testing.', role: 'All', priority: 'Normal', by: 'Owner', date: day(0), _up: iso }],
  tasks: [{ id: 4001, title: 'Install 4 CCTV cameras at Shah Traders', description: 'Demo task', dueDate: day(-2), priority: 'High', status: 'Pending', assignedIds: [1002], _up: iso }],
  advances: [{ id: 5001, mId: 1002, mName: 'Ravi Patil', date: day(3), amount: 2000, note: 'Demo advance', approval: 'approved', _up: iso }],
  officeGps: { lat: 18.5204, lng: 73.8567, radius: 200, _up: iso },
};

(async () => {
  const pool = createPool();
  await migrate(pool);
  const n = Number((await pool.query('select count(*) from records')).rows[0].count);
  if (n > 0 && process.argv[2] !== '--force') { console.error(`database already has ${n} records; not seeding (use --force to add demo data anyway)`); process.exit(1); }
  const changes = [];
  for (const [module, v] of Object.entries(data)) {
    if (Array.isArray(v)) v.forEach(r => changes.push({ module, id: String(r.id), data: r }));
    else changes.push({ module, id: '_', data: v });
  }
  const { results } = await push(pool, { system: true, role: 'Admin' }, changes);
  const bad = results.filter(r => r.status !== 'applied');
  console.log(`demo data: ${results.length - bad.length} records added${bad.length ? `, ${bad.length} refused: ${bad.map(b => b.reason).join('; ')}` : ''}`);
  console.log('logins: owner / Owner#2026 (Admin), ravi / Ravi#2026 (Technician), priya / Priya#2026 (Accountant)');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
