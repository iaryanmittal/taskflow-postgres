/* ===== performance.js — Employee Performance Analytics ===== */
'use strict';

let PERF_DATA   = [];
let PERF_PERIOD = 'month';
let _charts     = {};

async function renderPerformance() {
  const root = document.getElementById('perf-root');
  root.innerHTML = '<div style="padding:60px;text-align:center;color:var(--text3)"><i class="ti ti-loader" style="font-size:28px"></i><br><br>Loading analytics…</div>';
  try { PERF_DATA = await api('/api/performance?period=' + PERF_PERIOD); }
  catch(e) { toast('Failed to load performance data','error'); return; }
  _buildPage(root);
}

async function switchPeriod(p) {
  PERF_PERIOD = p;
  renderPerformance();
}

// ── Main page builder ─────────────────────────────────────────────────────
function _buildPage(root) {
  _destroyCharts();
  const emp = PERF_DATA;
  if (!emp.length) {
    root.innerHTML = '<div class="empty-state"><i class="ti ti-chart-off"></i><div>No employee data</div></div>';
    return;
  }

  const top     = emp[0];
  const bottom  = emp[emp.length - 1];
  const periods = { week:'This Week', month:'This Month', year:'This Year', all:'All Time' };

  root.innerHTML = `

    <!-- Header row: title + period tabs -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div>
        <div style="font-family:var(--font-head);font-size:20px;font-weight:800">Performance Analytics</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${periods[PERF_PERIOD]} · ${emp.length} team members</div>
      </div>
      <div class="perf-period-tabs">
        ${['week','month','year','all'].map(p=>`
          <button class="perf-period-tab ${PERF_PERIOD===p?'active':''}" onclick="switchPeriod('${p}')">
            ${p.charAt(0).toUpperCase()+p.slice(1)}
          </button>`).join('')}
      </div>
    </div>

    <!-- Top performer banner -->
    ${top.score > 0 ? `
    <div class="perf-top-banner">
      <div style="font-size:28px">🏆</div>
      <div class="avatar" style="background:${top.color};width:40px;height:40px;font-size:14px;flex-shrink:0">${top.initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-head);font-size:16px;font-weight:800">${escapeHtml(top.name)} <span style="color:var(--accent);font-size:12px;font-weight:500">Top Performer</span></div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${top.completed}/${top.total} tasks · ${top.updateCount} updates · ${top.overdue} overdue</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:var(--font-head);font-size:36px;font-weight:900;color:var(--accent);line-height:1">${top.score}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Score / 100</div>
      </div>
    </div>` : ''}

    <!-- Concern banner -->
    ${bottom.score < 30 && emp.length > 1 ? `
    <div class="perf-concern">
      <i class="ti ti-alert-triangle" style="color:#ef4444;vertical-align:-2px;margin-right:6px"></i>
      <b>Needs attention:</b> ${escapeHtml(bottom.name)} — score <b>${bottom.score}/100</b>, ${bottom.overdue} overdue task${bottom.overdue!==1?'s':''}, ${bottom.updateCount} update${bottom.updateCount!==1?'s':''} this period.
    </div>` : ''}

    <!-- Leaderboard -->
    <div class="perf-card" style="margin-bottom:16px">
      <div class="perf-card-title">Leaderboard</div>
      <div class="perf-card-sub">Ranked by performance score · click any row for details</div>
      <div class="lb-row lb-head" style="border-bottom:2px solid var(--border)">
        <div>#</div><div>Employee</div>
        <div>Score</div><div>Done/Total</div><div>Updates</div><div>Overdue</div><div>Progress</div>
      </div>
      ${emp.map((e,i) => `
        <div class="lb-row" onclick="openEmpDrill('${e.id}')">
          <div class="lb-rank ${['r1','r2','r3'][i]||''}">${i+1}</div>
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span class="avatar" style="background:${e.color};width:28px;height:28px;font-size:10px;flex-shrink:0">${e.initials}</span>
            <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.name)}</span>
          </div>
          <div class="lb-score" style="color:${_scoreColor(e.score)}">${e.score}</div>
          <div><span style="color:var(--green);font-weight:600">${e.completed}</span><span style="color:var(--text3)">/${e.total}</span></div>
          <div style="color:var(--accent)">${e.updateCount}</div>
          <div style="color:${e.overdue>0?'var(--red)':'var(--green)'}">${e.overdue}</div>
          <div>
            <div class="lb-bar-wrap"><div class="lb-bar-fill" style="width:${e.score}%;background:${_scoreColor(e.score)}"></div></div>
            <div style="font-size:10px;color:var(--text3);margin-top:2px">${e.score}%</div>
          </div>
        </div>`).join('')}
    </div>

    <!-- Charts row 1: completion + donut -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="perf-card">
        <div class="perf-card-title">Completion Rate</div>
        <div class="perf-card-sub">% of assigned tasks completed</div>
        <div class="perf-chart-wrap"><canvas id="ch-completion"></canvas></div>
      </div>
      <div class="perf-card">
        <div class="perf-card-title">Task Status Split</div>
        <div class="perf-card-sub">Overall breakdown across all employees</div>
        <div class="perf-chart-wrap"><canvas id="ch-donut"></canvas></div>
      </div>
    </div>

    <!-- Charts row 2: scores + radar -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="perf-card">
        <div class="perf-card-title">Performance Scores</div>
        <div class="perf-card-sub">Composite score out of 100</div>
        <div class="perf-chart-wrap"><canvas id="ch-scores"></canvas></div>
      </div>
      <div class="perf-card">
        <div class="perf-card-title">Skill Radar — Top 3</div>
        <div class="perf-card-sub">Multi-dimension comparison</div>
        <div class="perf-chart-wrap"><canvas id="ch-radar"></canvas></div>
      </div>
    </div>

    <!-- Charts row 3: activity full width -->
    <div class="perf-card" style="margin-bottom:16px">
      <div class="perf-card-title">Update Activity (Responsiveness)</div>
      <div class="perf-card-sub">Updates submitted per employee — shows who communicates and stays accountable</div>
      <div class="perf-chart-tall"><canvas id="ch-activity"></canvas></div>
    </div>

    <!-- Charts row 4: overdue + high-priority -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="perf-card">
        <div class="perf-card-title">Overdue Tasks</div>
        <div class="perf-card-sub">Lower = better punctuality</div>
        <div class="perf-chart-wrap"><canvas id="ch-overdue"></canvas></div>
      </div>
      <div class="perf-card">
        <div class="perf-card-title">High-Priority Completion</div>
        <div class="perf-card-sub">Shows reliability on critical work</div>
        <div class="perf-chart-wrap"><canvas id="ch-highpri"></canvas></div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    _chartDefaults();
    _chartCompletion(emp);
    _chartDonut(emp);
    _chartScores(emp);
    _chartRadar(emp);
    _chartActivity(emp);
    _chartOverdue(emp);
    _chartHighPri(emp);
  });
}

// ── Chart helpers ─────────────────────────────────────────────────────────
function _chartDefaults() {
  Chart.defaults.color       = '#9aa0b8';
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.font.size   = 11;
  Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
}

function _mkChart(id, config) {
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  if (_charts[id]) _charts[id].destroy();
  _charts[id] = new Chart(ctx, config);
}

function _destroyCharts() {
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch(_){} });
  _charts = {};
}

function _scoreColor(s) {
  return s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444';
}

const _GRID = 'rgba(255,255,255,0.05)';

// 1. Completion rate
function _chartCompletion(emp) {
  _mkChart('ch-completion', {
    type: 'bar',
    data: {
      labels: emp.map(e => e.name.split(' ')[0]),
      datasets: [{ label: '%', data: emp.map(e => e.compRate),
        backgroundColor: emp.map(e => e.color+'bb'), borderColor: emp.map(e => e.color),
        borderWidth:2, borderRadius:5 }]
    },
    options: { responsive:true, maintainAspectRatio:true,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+'%' }, grid:{ color:_GRID } }, x:{ grid:{ display:false } } }
    }
  });
}

// 2. Donut
function _chartDonut(emp) {
  const t = emp.reduce((a,e) => ({ c:a.c+e.completed, i:a.i+e.inProgress, p:a.p+e.pending, o:a.o+e.overdue }), {c:0,i:0,p:0,o:0});
  _mkChart('ch-donut', {
    type: 'doughnut',
    data: {
      labels: ['Completed','In Progress','Pending','Overdue'],
      datasets: [{ data:[t.c,t.i,t.p,t.o],
        backgroundColor:['#22c55e','#4f8ef7','#f59e0b','#ef4444'],
        borderColor:'#151820', borderWidth:3, hoverOffset:6 }]
    },
    options: { responsive:true, maintainAspectRatio:true, cutout:'62%',
      plugins:{ legend:{ position:'bottom', labels:{ padding:14, usePointStyle:true, boxWidth:7 } } }
    }
  });
}

// 3. Scores horizontal bar
function _chartScores(emp) {
  const s = [...emp].sort((a,b) => a.score - b.score);
  _mkChart('ch-scores', {
    type: 'bar',
    data: {
      labels: s.map(e => e.name.split(' ')[0]),
      datasets: [{ label: 'Score', data: s.map(e => e.score),
        backgroundColor: s.map(e => _scoreColor(e.score)+'99'),
        borderColor: s.map(e => _scoreColor(e.score)),
        borderWidth:2, borderRadius:5 }]
    },
    options: { indexAxis:'y', responsive:true, maintainAspectRatio:true,
      plugins:{ legend:{ display:false } },
      scales:{ x:{ min:0, max:100, grid:{ color:_GRID } }, y:{ grid:{ display:false } } }
    }
  });
}

// 4. Radar — top 3
function _chartRadar(emp) {
  const top3 = emp.slice(0, Math.min(3, emp.length));
  _mkChart('ch-radar', {
    type: 'radar',
    data: {
      labels: ['Completion','Responsiveness','Punctuality','High-Pri','Consistency'],
      datasets: top3.map(e => ({
        label: e.name.split(' ')[0],
        data: [
          e.compRate,
          Math.min(100, e.updateCount * 15),
          e.total > 0 ? Math.max(0, 100 - e.overdue * 25) : 0,
          e.highTotal > 0 ? Math.round(e.highDone / e.highTotal * 100) : 0,
          e.total > 0 ? Math.round((e.completed + e.inProgress) / e.total * 100) : 0,
        ],
        borderColor: e.color, backgroundColor: e.color+'22',
        pointBackgroundColor: e.color, borderWidth:2, pointRadius:3,
      }))
    },
    options: { responsive:true, maintainAspectRatio:true,
      scales:{ r:{ min:0, max:100,
        angleLines:{ color:_GRID }, grid:{ color:_GRID },
        pointLabels:{ font:{ size:10 }, color:'#9aa0b8' }, ticks:{ display:false }
      }},
      plugins:{ legend:{ position:'bottom', labels:{ padding:12, usePointStyle:true, boxWidth:7 } } }
    }
  });
}

// 5. Activity bar
function _chartActivity(emp) {
  _mkChart('ch-activity', {
    type: 'bar',
    data: {
      labels: emp.map(e => e.name.split(' ')[0]),
      datasets: [{ label: 'Updates', data: emp.map(e => e.updateCount),
        backgroundColor: emp.map(e => e.color+'bb'), borderColor: emp.map(e => e.color),
        borderWidth:2, borderRadius:5 }]
    },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 }, grid:{ color:_GRID } }, x:{ grid:{ display:false } } }
    }
  });
}

// 6. Overdue
function _chartOverdue(emp) {
  _mkChart('ch-overdue', {
    type: 'bar',
    data: {
      labels: emp.map(e => e.name.split(' ')[0]),
      datasets: [{ label: 'Overdue', data: emp.map(e => e.overdue),
        backgroundColor: emp.map(e => e.overdue > 0 ? '#ef444477' : '#22c55e44'),
        borderColor: emp.map(e => e.overdue > 0 ? '#ef4444' : '#22c55e'),
        borderWidth:2, borderRadius:5 }]
    },
    options: { responsive:true, maintainAspectRatio:true,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 }, grid:{ color:_GRID } }, x:{ grid:{ display:false } } }
    }
  });
}

// 7. High priority stacked
function _chartHighPri(emp) {
  _mkChart('ch-highpri', {
    type: 'bar',
    data: {
      labels: emp.map(e => e.name.split(' ')[0]),
      datasets: [
        { label:'Done',    data: emp.map(e => e.highDone),               backgroundColor:'#22c55e99', borderColor:'#22c55e', borderWidth:2, borderRadius:5 },
        { label:'Pending', data: emp.map(e => e.highTotal - e.highDone), backgroundColor:'#ef444455', borderColor:'#ef4444', borderWidth:2, borderRadius:5 },
      ]
    },
    options: { responsive:true, maintainAspectRatio:true,
      plugins:{ legend:{ position:'bottom', labels:{ padding:10, usePointStyle:true, boxWidth:7 } } },
      scales:{ x:{ stacked:true, grid:{ display:false } }, y:{ stacked:true, beginAtZero:true, ticks:{ stepSize:1 }, grid:{ color:_GRID } } }
    }
  });
}

// ── Employee drill-down (reuses existing detail-modal) ────────────────────
function openEmpDrill(empId) {
  const e = PERF_DATA.find(x => x.id === empId);
  if (!e) return;

  const rspStr = e.avgResponseHrs != null
    ? (e.avgResponseHrs < 1 ? Math.round(e.avgResponseHrs*60)+'m avg response' : e.avgResponseHrs+'h avg response')
    : 'No responses yet';

  const breakdown = [
    { lbl:'Completion Rate (×0.4)', val:Math.round(e.compRate*0.4),   max:40, color:'#22c55e' },
    { lbl:'Update Activity',         val:Math.min(30,e.updateCount*10), max:30, color:'#4f8ef7' },
    { lbl:'On-Time Delivery',        val:e.completed>0?Math.round(e.onTime/e.completed*20):0, max:20, color:'#f59e0b' },
    { lbl:'No Overdue Bonus',        val:e.total>0?(e.overdue===0?10:Math.max(0,10-e.overdue*5)):0, max:10, color:'#a855f7' },
  ];

  document.getElementById('detail-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
      <div class="avatar" style="background:${e.color};width:48px;height:48px;font-size:16px;flex-shrink:0">${e.initials}</div>
      <div style="flex:1">
        <div style="font-family:var(--font-head);font-size:20px;font-weight:800">${escapeHtml(e.name)}</div>
        <div style="font-size:12px;color:var(--text3)">Performance · ${{'week':'This Week','month':'This Month','year':'This Year','all':'All Time'}[PERF_PERIOD]}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--font-head);font-size:38px;font-weight:900;color:${_scoreColor(e.score)};line-height:1">${e.score}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Out of 100</div>
      </div>
    </div>

    <div class="drill-grid">
      <div class="drill-stat"><div class="drill-stat-val" style="color:var(--green)">${e.completed}</div><div class="drill-stat-lbl">Completed</div></div>
      <div class="drill-stat"><div class="drill-stat-val" style="color:var(--accent)">${e.total}</div><div class="drill-stat-lbl">Assigned</div></div>
      <div class="drill-stat"><div class="drill-stat-val" style="color:var(--amber)">${e.updateCount}</div><div class="drill-stat-lbl">Updates Sent</div></div>
      <div class="drill-stat"><div class="drill-stat-val" style="color:${e.overdue>0?'var(--red)':'var(--green)'}">${e.overdue}</div><div class="drill-stat-lbl">Overdue</div></div>
    </div>

    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3);margin-bottom:5px">
        <span>Completion Rate</span><span style="font-weight:700;color:${_scoreColor(e.compRate)}">${e.compRate}%</span>
      </div>
      <div style="background:var(--bg3);border-radius:20px;height:8px;overflow:hidden">
        <div style="height:100%;border-radius:20px;background:${_scoreColor(e.compRate)};width:${e.compRate}%;transition:width .6s ease"></div>
      </div>
    </div>

    <div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Score Breakdown</div>
      ${breakdown.map(r => `
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
            <span style="color:var(--text2)">${r.lbl}</span>
            <span style="font-weight:700;color:${r.color}">${r.val}/${r.max}</span>
          </div>
          <div style="background:var(--surface);border-radius:20px;height:4px;overflow:hidden">
            <div style="height:100%;border-radius:20px;background:${r.color};width:${Math.round(r.val/r.max*100)}%"></div>
          </div>
        </div>`).join('')}
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:7px">
      <div class="metric-chip"><i class="ti ti-clock" style="color:var(--accent)"></i>${rspStr}</div>
      <div class="metric-chip"><i class="ti ti-star" style="color:var(--amber)"></i><b>${e.highDone}</b>/${e.highTotal} high-pri done</div>
      <div class="metric-chip"><i class="ti ti-loader" style="color:var(--green)"></i><b>${e.inProgress}</b> in progress</div>
    </div>
  `;

  openModal('detail-modal');
}
