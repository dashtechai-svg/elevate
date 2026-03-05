const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { parse } = require('csv-parse/sync');

const DATA_FILE = path.join(__dirname, 'data.json');
const CSV_FILE  = path.join(__dirname, 'report.csv');
const PORT      = 3000;

/* ─── Init data.json ─── */
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ agents: [] }, null, 2));
  console.log('✅ Created fresh data.json');
}

/* ─── Helpers ─── */
function readData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(d.agents)) d.agents = [];
    return d;
  } catch(e) { return { agents: [] }; }
}

function writeData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function sendJSON(res, data, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendHTML(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}

/* ─── Duration → seconds ─── */
function durToSec(s) {
  if (!s) return 0;
  const p = String(s).trim().split(':').map(Number);
  if (p.length === 3) return (p[0]||0)*3600 + (p[1]||0)*60 + (p[2]||0);
  if (p.length === 2) return (p[0]||0)*60 + (p[1]||0);
  return 0;
}

/* ─── Seconds → HH:MM:SS ─── */
function secToDur(s) {
  s = Math.round(s||0);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

/* ─── US Eastern Time helper ─── */
function easternDateStr() {
  // Always returns YYYY-MM-DD in US Eastern Time (ET handles EST/EDT automatically)
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/* ─── Email → Name map ─── */
const EMAIL_NAME = {
  'abhijeet.d@elevateme.pro':  'Abhijeet Das',
  'avni.g@elevateme.pro':      'Avni Gajjar',
  'harsh.b@elevateme.pro':     'Harsh Bhojak',
  'kartik.d@elevateme.pro':    'Kartik Deshawar',
  'meet.patel@elevateme.pro':  'Meet Patel',
  'meet.v@elevateme.pro':      'Meet Vyas',
  'nikunj.p@elevateme.pro':    'Nikunj Patel',
  'Nikunj.p@elevateme.pro':    'Nikunj Patel',
  'nupur.v@elevateme.pro':     'Nupur Vyas',
  'om.d@elevateme.pro':        'Om Dave',
  'pranali.m@elevateme.pro':   'Pranali Mishra',
  'shivraj.j@elevateme.pro':   'Shivraj Jhala',
  'vidhi.p@elevateme.pro':     'Vidhi Patel',
  'yash.k@elevateme.pro':      'Yash Karwa',
  'yash.m@dashtechinc.com':    'Yash Mishra',
  'yogeshwar.t@elevateme.pro': 'Yogeshwar Tiwari',
  'tanu.k@elevateme.pro':      'Tanu Kumari',
  'nishant.s@elevateme.pro':   'Nishant Sharma',
  'soham.b@elevateme.pro':     'Soham Bajpai',
  'tejasvi.p@elevateme.pro':   'Tejasvi Pathe',
  'divya.j@elevateme.pro':     'Divya Joshi',
  'rushikesh.p@elevateme.pro': 'Rushikesh Petkar',
  'baldev.s@elevateme.pro':    'Baldev Singh Nagi',
};

function emailToName(email) {
  if (!email) return 'Unknown';
  const e = email.trim();
  if (EMAIL_NAME[e]) return EMAIL_NAME[e];
  // auto-format: john.doe@... → John Doe
  return e.split('@')[0].replace(/\./g,' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* ─── Detect format ─── */
function isRawCallLog(headers) {
  return headers.some(h =>
    h.includes('direction') || h.includes('source userid') ||
    h.includes('destination userid') || h.includes('source user id') ||
    h.includes('sourceuserid') || h.includes('destinationuserid')
  );
}

/* ─── Process raw call log ─── */
function processRawCallLog(records, date) {
  const map = {};

  records.forEach(row => {
    // Normalize keys
    const keys = Object.keys(row);
    const get = (...names) => {
      for (const n of names) {
        const k = keys.find(k => k.toLowerCase().replace(/\s/g,'').includes(n.toLowerCase().replace(/\s/g,'')));
        if (k && row[k] !== undefined) return (row[k]||'').trim();
      }
      return '';
    };

    const dir     = get('Direction').toLowerCase();
    const srcUser = get('SourceUserId', 'Source UserId', 'source user id');
    const dstUser = get('DestinationUserId', 'Destination UserId', 'destination user id');
    const durSec  = durToSec(get('Duration'));

    const email = dir === 'outbound' ? srcUser : dstUser;
    if (!email || !email.includes('@')) return;

    const name = emailToName(email);
    if (!map[email]) {
      map[email] = {
        date, user: name, exts: '', email,
        total: 0, inbound: 0, inboundSec: 0,
        out: 0, conn: 0, missed: 0, vm: 0,
        qualified: 0, prospects: 0, enrolled: 0
      };
    }

    map[email].total++;
    if (dir === 'outbound') {
      map[email].out++;
      if (durSec >= 60) map[email].conn++;
    } else if (dir === 'inbound') {
      map[email].inbound++;
      map[email].inboundSec += durSec;
    }
  });

  return Object.values(map).map(a => {
    a.inboundDur = secToDur(a.inboundSec);
    a.inboundConnected = a.inbound > 0
      ? Math.round(a.inbound * (Math.min(a.inboundSec / a.inbound, 120) / 120))
      : 0;
    delete a.inboundSec;
    return a;
  });
}

/* ─── Process summary report ─── */
function processSummaryReport(records, date) {
  return records.map(row => ({
    date,
    user:        row['User'] || '',
    exts:        row['Ext(s)'] || '',
    total:       Number(row['Total Calls']) || 0,
    inbound:     Number(row['Inbound Calls']) || 0,
    inboundDur:  row['Inbound Call Duration'] || '0:00:00',
    inboundConnected: 0,
    out:         Number(row['Outbound Calls']) || 0,
    missed:      Number(row['Missed Calls']) || 0,
    conn:        Number(row['Answered Calls']) || 0,
    vm:          Number(row['Voicemail Calls']) || 0,
    qualified:   0, prospects: 0, enrolled: 0
  })).filter(a => a.user);
}

/* ─── Import CSV file ─── */
function importCSV(targetDate) {
  if (!fs.existsSync(CSV_FILE)) { console.log('⚠ report.csv not found'); return; }
  try {
    console.log('📥 Importing report.csv...');
    const content = fs.readFileSync(CSV_FILE).toString();
    let delim = '\t';
    if (!content.includes('\t') && content.includes(',')) delim = ',';
    else if (!content.includes('\t') && content.includes(';')) delim = ';';

    const records = parse(content, { columns:true, skip_empty_lines:true, relax_column_count:true, delimiter:delim });
    if (!records || !records.length) { console.log('⚠ No records found'); return; }

    const date = targetDate || easternDateStr();
    const headers = Object.keys(records[0]).map(h => h.toLowerCase().trim());
    const agents = isRawCallLog(headers)
      ? processRawCallLog(records, date)
      : processSummaryReport(records, date);

    const raw = readData();
    raw.agents = raw.agents.filter(a => a.date !== date);
    raw.agents.push(...agents);
    writeData(raw);
    console.log(`✅ Imported ${agents.length} agents for ${date}`);
  } catch(e) { console.log('❌ CSV Import Error:', e.message); }
}

/* ─── Aggregate for a date ─── */
function durToSecLocal(s) { return durToSec(s); }

function aggregate(records) {
  const map = {};
  records.forEach(a => {
    const key = a.user || a.email || 'unknown';
    if (!map[key]) {
      map[key] = {
        user: a.user, exts: a.exts||'', email: a.email||'',
        total:0, inbound:0, inboundSec:0, inboundConnected:0,
        out:0, conn:0, missed:0, vm:0,
        qualified: a.qualified||0, prospects: a.prospects||0, enrolled: a.enrolled||0
      };
    }
    const m = map[key];
    m.total   += (a.total||0);
    m.inbound += (a.inbound||0);
    m.inboundSec += durToSecLocal(a.inboundDur||'0:00:00');
    m.inboundConnected += (a.inboundConnected||0);
    m.out     += (a.out||0);
    m.conn    += (a.conn||0);
    m.missed  += (a.missed||0);
    m.vm      += (a.vm||0);
    m.qualified  = a.qualified||0;
    m.prospects  = a.prospects||0;
    m.enrolled   = a.enrolled||0;
  });

  return Object.values(map).map(a => {
    a.inboundDur = secToDur(a.inboundSec);
    delete a.inboundSec;
    return a;
  }).sort((a,b) => b.conn - a.conn);
}

/* ─── Get available dates ─── */
function getAvailableDates() {
  const raw = readData();
  const dates = [...new Set(raw.agents.map(a => a.date))].filter(Boolean).sort().reverse();
  return dates;
}

/* ─── HTTP Server ─── */
const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query    = parsed.query;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // Pages
  if (pathname === '/' || pathname === '/dashboard')
    return sendHTML(res, path.join(__dirname, 'index.html'));

  if (pathname === '/admin')
    return sendHTML(res, path.join(__dirname, 'admin.html'));

  // API: data for a specific date (default = latest available)
  if (pathname === '/api/data') {
    const raw   = readData();
    const dates = getAvailableDates();
    // If a specific date is requested, always use it (even if no data exists yet)
    // so the UI can show an empty state rather than silently showing the wrong date.
    const date    = query.date || dates[0] || easternDateStr();
    const filtered = raw.agents.filter(a => a.date === date);
    const agents   = aggregate(filtered);
    return sendJSON(res, { agents, date, availableDates: dates });
  }

  // API: available dates list
  if (pathname === '/api/dates') {
    return sendJSON(res, { dates: getAvailableDates() });
  }

  // API: raw data
  if (pathname === '/api/raw') {
    return sendJSON(res, readData());
  }

  // API: update agent qualified/prospects/enrolled
  if (pathname.startsWith('/api/agent/') && req.method === 'PUT') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const agentName = decodeURIComponent(pathname.replace('/api/agent/', ''));
        const updates = JSON.parse(body);
        const raw = readData();
        const dates = getAvailableDates();
        const date = updates.date || dates[0] || easternDateStr();
        raw.agents.forEach(a => {
          if (a.user === agentName && a.date === date) {
            if (updates.qualified  !== undefined) a.qualified  = updates.qualified;
            if (updates.prospects  !== undefined) a.prospects  = updates.prospects;
            if (updates.enrolled   !== undefined) a.enrolled   = updates.enrolled;
          }
        });
        writeData(raw);
        sendJSON(res, { success: true });
      } catch(e) { res.writeHead(400); res.end('Bad request'); }
    });
    return;
  }

  // API: reimport CSV
  if (pathname === '/api/import' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { date } = body ? JSON.parse(body) : {};
        importCSV(date);
        sendJSON(res, { success: true });
      } catch(e) { importCSV(); sendJSON(res, { success: true }); }
    });
    return;
  }

  // API: import pasted data
  if (pathname === '/api/import-paste' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { agents, date } = JSON.parse(body);
        if (!agents || !agents.length) { res.writeHead(400); return res.end('No agents'); }
        const raw = readData();
        const targetDate = date || agents[0].date || easternDateStr();
        raw.agents = raw.agents.filter(a => a.date !== targetDate);
        raw.agents.push(...agents.map(a => ({ ...a, date: targetDate })));
        writeData(raw);
        console.log(`✅ Paste Import: ${agents.length} agents for ${targetDate}`);
        sendJSON(res, { success: true, date: targetDate });
      } catch(e) { res.writeHead(400); res.end('Bad request: ' + e.message); }
    });
    return;
  }

  // ── POST /api/leads  ← called by Google Apps Script ─────────────────
  if (pathname === '/api/leads' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        // Simple auth check
        if (payload.secret !== 'elevateme2026') {
          res.writeHead(401); return res.end('Unauthorized');
        }

        const raw   = readData();
        const dates = getAvailableDates();
        const date  = payload.date || dates[0] || easternDateStr();
        const leads = payload.leads || [];

        if (!leads.length) {
          return sendJSON(res, { success:false, message:'No leads' }, 400);
        }

        // Count per BDE name
        const counts = {};
        leads.forEach(l => {
          const name   = (l.bdeName || '').trim();
          const status = (l.status  || '').trim().toLowerCase();
          if (!name) return;
          if (!counts[name]) counts[name] = { qualified:0, prospects:0, enrolled:0 };
          if      (status === 'qualified')                           counts[name].qualified++;
          else if (status === 'prospect' || status === 'prospects') counts[name].prospects++;
          else if (status === 'enrolled')                            counts[name].enrolled++;
        });

        // Match by name (case-insensitive first-name match)
        let updated = 0, created = 0;
        Object.entries(counts).forEach(([bdeName, c]) => {
          const bde = bdeName.toLowerCase();
          const existing = raw.agents.find(a =>
            a.date === date && (
              a.user.toLowerCase() === bde ||
              a.user.toLowerCase().startsWith(bde.split(' ')[0]) ||
              bde.startsWith(a.user.toLowerCase().split(' ')[0])
            )
          );
          if (existing) {
            existing.qualified = c.qualified;
            existing.prospects = c.prospects;
            existing.enrolled  = c.enrolled;
            updated++;
          } else {
            raw.agents.push({
              date, user: bdeName, exts: '', email: '',
              total:0, inbound:0, inboundDur:'0:00:00', inboundConnected:0,
              out:0, conn:0, missed:0, vm:0,
              qualified: c.qualified, prospects: c.prospects, enrolled: c.enrolled
            });
            created++;
          }
        });

        writeData(raw);
        console.log(`✅ Leads sync: ${leads.length} leads → ${updated} updated, ${created} new for ${date}`);

        sendJSON(res, {
          success: true,
          message: `Synced ${leads.length} leads for ${date}`,
          date, updated, created, breakdown: counts
        });
      } catch(e) {
        res.writeHead(400); res.end('Bad request: ' + e.message);
      }
    });
    return;
  }

  // ── GET /api/leads?date= ── view current lead counts ─────────────────
  if (pathname === '/api/leads' && req.method === 'GET') {
    const raw   = readData();
    const dates = getAvailableDates();
    const date  = query.date || dates[0] || easternDateStr();
    const agents = raw.agents
      .filter(a => a.date === date)
      .map(a => ({ name:a.user, qualified:a.qualified||0, prospects:a.prospects||0, enrolled:a.enrolled||0 }));
    return sendJSON(res, { date, agents });
  }

  // ── Serve setup guide ─────────────────────────────────────────────────
  if (pathname === '/setup') {
    return sendHTML(res, path.join(__dirname, 'setup-guide.html'));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   ElevateMe Sales Dashboard          ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Dashboard → http://localhost:${PORT}       ║`);
  console.log(`║  Admin     → http://localhost:${PORT}/admin ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  importCSV();
});
