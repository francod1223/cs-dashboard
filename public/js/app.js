/* ================================================================
   Protiv CS Dashboard - Frontend Application (Light Theme)
   ================================================================ */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let DATA = null;            // Full API response
  let filteredOrgs = [];      // Yellowstone orgs after filters
  let filteredMtOrgs = [];    // Multi-Tenant orgs after filters
  let mtOrgs = [];            // MT orgs (raw, pre-filter)
  let sortCol = null;
  let sortAsc = true;
  let chartInstances = {};

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const fmt = (n) => n == null ? '-' : Number(n).toLocaleString('en-US');
  const fmtDollar = (n) => n == null ? '-' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtPct = (n) => n == null ? '-' : Number(n).toFixed(1) + '%';
  const fmtDec = (n, d = 2) => n == null ? '-' : Number(n).toFixed(d);
  const shortDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

  // Light-theme chart colors
  const COLORS = {
    green: '#1DA856',
    greenLight: 'rgba(29,168,86,0.15)',
    orange: '#FF9500',
    orangeLight: 'rgba(255,149,0,0.15)',
    red: '#E53E3E',
    redLight: 'rgba(229,62,62,0.15)',
    blue: '#3898EC',
    blueLight: 'rgba(56,152,236,0.15)',
    purple: '#805AD5',
    purpleLight: 'rgba(128,90,213,0.15)',
    yellow: '#ECC94B',
    yellowLight: 'rgba(236,201,75,0.15)',
    gray: '#A0AEC0',
  };

  // Chart.js defaults for light theme
  Chart.defaults.color = '#718096';
  Chart.defaults.borderColor = 'rgba(226,232,240,0.7)';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    setupTabs();
    setupRefresh();
    await loadUser();
    await loadData();
  }

  async function loadUser() {
    try {
      const res = await fetch('/auth/me');
      if (!res.ok) return;
      const user = await res.json();
      const el = $('#user-info');
      el.innerHTML = `
        ${user.avatar ? `<img src="${user.avatar}" alt="">` : ''}
        <span>${user.name || user.email}</span>
      `;
    } catch (e) { /* ignore */ }
  }

  async function loadData() {
    showLoading(true);
    try {
      const res = await fetch('/api/dashboard');
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
      mtOrgs = (DATA.mt && DATA.mt.orgs) ? DATA.mt.orgs : [];
      populateFilters();
      applyFilters();
      render();
    } catch (err) {
      console.error('Failed to load data:', err);
      showError(err.message);
    } finally {
      showLoading(false);
    }
  }

  function showLoading(show) {
    $('#loading').style.display = show ? 'flex' : 'none';
  }

  function showError(msg) {
    const el = $('#loading');
    el.innerHTML = `
      <div style="text-align:center;color:#E53E3E;">
        <div style="font-size:40px;margin-bottom:12px;"></div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">Failed to load dashboard</div>
        <div style="font-size:13px;color:#718096;margin-bottom:16px;">${msg}</div>
        <button onclick="location.reload()" class="btn-refresh">Retry</button>
      </div>`;
    el.style.display = 'flex';
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function setupTabs() {
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        $(`#${btn.dataset.tab}`).classList.add('active');
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------
  function setupRefresh() {
    $('#btn-refresh').addEventListener('click', async () => {
      $('#btn-refresh').disabled = true;
      $('#btn-refresh').textContent = 'Refreshing...';
      try {
        await fetch('/api/refresh', { method: 'POST' });
        await loadData();
      } finally {
        $('#btn-refresh').disabled = false;
        $('#btn-refresh').textContent = 'Refresh';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------
  function populateFilters() {
    if (!DATA) return;
    const f = DATA.aggregations.filters;

    const statusSelect = $('#filter-status');
    statusSelect.innerHTML = '<option value="">All Statuses</option>';
    f.subscription_statuses.forEach(s => {
      statusSelect.innerHTML += `<option value="${s}">${s}</option>`;
    });

    const sizeSelect = $('#filter-size');
    sizeSelect.innerHTML = '<option value="">All Sizes</option>';
    f.company_sizes.forEach(s => {
      sizeSelect.innerHTML += `<option value="${s}">${s}</option>`;
    });

    // Attach listeners
    $('#filter-status').addEventListener('change', onFilterChange);
    $('#filter-size').addEventListener('change', onFilterChange);
    $('#filter-db').addEventListener('change', onFilterChange);
    $('#filter-search').addEventListener('input', onFilterChange);
  }

  function onFilterChange() {
    applyFilters();
    render();
  }

  function applyFilters() {
    if (!DATA) return;
    const status = $('#filter-status').value;
    const size = $('#filter-size').value;
    const search = ($('#filter-search').value || '').toLowerCase().trim();
    const db = $('#filter-db').value;

    const matchOrg = (o) => {
      if (status && o.subscription_status !== status) return false;
      if (size && o.company_size !== size) return false;
      if (search && !(o.organization_name || '').toLowerCase().includes(search)) return false;
      return true;
    };

    filteredOrgs = (db === 'mt') ? [] : DATA.orgs.filter(matchOrg);
    filteredMtOrgs = (db === 'yellowstone') ? [] : mtOrgs.filter(matchOrg);

    const totalOrgs = DATA.orgs.length + mtOrgs.length;
    const showing = filteredOrgs.length + filteredMtOrgs.length;
    $('#filter-count').textContent = `Showing ${showing} of ${totalOrgs} orgs`;
  }

  // ---------------------------------------------------------------------------
  // Render everything
  // ---------------------------------------------------------------------------
  function render() {
    if (!DATA) return;
    renderIndicators();
    renderMultiTenant();
    renderDetails();
  }

  // ---------------------------------------------------------------------------
  // Tab 1: Indicators â Yellowstone
  // ---------------------------------------------------------------------------
  function renderIndicators() {
    const pre = filteredOrgs.filter(o => o.is_pre_launch);
    const post = filteredOrgs.filter(o => o.is_post_launch);
    const agg = DATA.aggregations;

    // Badges
    $('#badge-pre-launch').textContent = `${pre.length} orgs`;
    $('#badge-post-launch').textContent = `${post.length} orgs`;
    const atRisk = post.filter(o => o.at_risk);
    $('#badge-at-risk').textContent = `${atRisk.length} at risk`;
    $('#badge-at-risk').className = `badge ${atRisk.length > 0 ? 'badge-red' : 'badge-green'}`;

    renderPreLaunchKPIs(pre, agg);
    renderPreLaunchCharts(pre, agg);
    renderPostLaunchKPIs(post, agg);
    renderPostLaunchCharts(post, agg);
    renderPercentiles(agg);
  }

  function renderPreLaunchKPIs(pre, agg) {
    const launched = filteredOrgs.filter(o => o.days_to_launch !== null && o.days_to_launch >= 0);
    const times = launched.map(o => o.days_to_launch);
    const avgTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const medTime = times.length ? medianCalc(times) : 0;

    const estBillable = pre.reduce((s, o) => s + o.estimated_billable_users, 0);
    const estMRR = pre.reduce((s, o) => s + o.estimated_mrr, 0);
    const estARR = pre.reduce((s, o) => s + o.estimated_arr, 0);

    const aging30 = pre.filter(o => o.days_since_created >= 30).length;
    const aging60 = pre.filter(o => o.days_since_created >= 60).length;

    $('#pre-launch-kpis').innerHTML = kpiCards([
      { label: 'Avg Time to Launch', value: `${avgTime}d`, sub: `Median: ${medTime}d`, icon: '' },
      { label: 'Pre-Launch Orgs', value: fmt(pre.length), sub: `${aging30} aging 30d+`, icon: '' },
      { label: 'Aging 60+ Days', value: fmt(aging60), cls: aging60 > 0 ? 'warning' : '', icon: '' },
      { label: 'Est. Billable Users', value: fmt(estBillable), sub: `Avg ${fmt(Math.round(estBillable / (pre.length || 1)))} per org`, icon: '' },
      { label: 'Est. MRR', value: fmtDollar(estMRR), icon: '' },
      { label: 'Est. ARR', value: fmtDollar(estARR), icon: '' },
    ]);
  }

  function renderPreLaunchCharts(pre, agg) {
    const dist = agg.pre_launch.time_to_launch.distribution;
    makeChart('chart-launch-distribution', 'bar', {
      labels: dist.map(d => d.label),
      datasets: [{
        label: 'Orgs',
        data: dist.map(d => d.count),
        backgroundColor: [COLORS.blue, COLORS.green, COLORS.purple, COLORS.yellow, COLORS.red],
        borderRadius: 6,
      }]
    }, { plugins: { legend: { display: false } } });

    const aging = agg.pre_launch.aging;
    makeChart('chart-aging', 'bar', {
      labels: aging.map(a => a.label),
      datasets: [{
        label: 'Count',
        data: aging.map(a => a.count),
        backgroundColor: [COLORS.yellow, COLORS.orange, COLORS.red, '#C53030'],
        borderRadius: 6,
      }]
    }, { indexAxis: 'y', plugins: { legend: { display: false } } });

    const trend = agg.pre_launch.launch_trend;
    if (trend.length) {
      makeChart('chart-launch-trend', 'line', {
        labels: trend.map(t => t.month),
        datasets: [
          { label: 'Avg Days', data: trend.map(t => t.avg), borderColor: COLORS.blue, backgroundColor: COLORS.blueLight, fill: true, tension: 0.3 },
          { label: 'Median Days', data: trend.map(t => t.median), borderColor: COLORS.purple, borderDash: [5, 3], tension: 0.3 }
        ]
      });
    }

    const rev = agg.pre_launch.estimated_revenue;
    makeChart('chart-pre-revenue', 'bar', {
      labels: ['Total MRR', 'Avg MRR', 'Median MRR', 'Total ARR'],
      datasets: [{
        label: 'USD',
        data: [rev.total_mrr, rev.avg_mrr, rev.median_mrr, rev.total_arr],
        backgroundColor: [COLORS.blue, COLORS.purple, COLORS.orange, COLORS.green],
        borderRadius: 6,
      }]
    }, { plugins: { legend: { display: false } } });
  }

  function renderPostLaunchKPIs(post, agg) {
    const pl = agg.post_launch;
    const atRisk = post.filter(o => o.at_risk);
    const totalBonuses30d = post.reduce((s, o) => s + o.total_bonuses_paid_30d, 0);
    const paidOrgs30d = post.filter(o => o.total_bonuses_paid_30d > 0).length;

    $('#post-launch-kpis').innerHTML = kpiCards([
      { label: 'Post-Launch Orgs', value: fmt(post.length), icon: '' },
      { label: 'At Risk', value: fmt(atRisk.length), cls: atRisk.length > 0 ? 'danger' : 'success', sub: fmtPct(post.length ? (atRisk.length / post.length * 100) : 0) + ' of post-launch', icon: '' },
      { label: 'Billable Users (Actual)', value: fmt(pl.billable_users.total_actual), sub: `Gap: ${fmt(pl.billable_users.gap)}`, icon: '' },
      { label: 'Billable Ratio', value: fmtPct(pl.billable_users.ratio), icon: '' },
      { label: 'Missing Invites', value: fmt(pl.missing_invites.total), sub: `${pl.missing_invites.orgs_with_missing} orgs affected`, cls: pl.missing_invites.total > 0 ? 'warning' : '', icon: '' },
      { label: 'Bonuses Paid (30d)', value: fmtDollar(totalBonuses30d), sub: `${paidOrgs30d} orgs paying`, icon: '' },
      { label: 'Avg Bonus/Person (30d)', value: fmtDollar(pl.bonus_performance.last_30d.avg_per_user), icon: '' },
      { label: 'Orgs Paying Bonuses (30d)', value: fmt(pl.bonus_activity.paid_30d), sub: `${pl.bonus_activity.not_paid_30d} not paying`, cls: pl.bonus_activity.not_paid_30d > 0 ? 'warning' : '', icon: '' },
    ]);
  }

  function renderPostLaunchCharts(post, agg) {
    const pl = agg.post_launch;

    makeChart('chart-billable-gap', 'doughnut', {
      labels: ['Actual Billed', 'Gap (Potential)'],
      datasets: [{
        data: [pl.billable_users.total_actual, pl.billable_users.gap],
        backgroundColor: [COLORS.green, COLORS.redLight],
        borderWidth: 0,
      }]
    }, { cutout: '65%' });

    makeChart('chart-bonus-activity', 'doughnut', {
      labels: ['Paid Bonuses', 'No Bonuses'],
      datasets: [{
        data: [pl.bonus_activity.paid_30d, pl.bonus_activity.not_paid_30d],
        backgroundColor: [COLORS.green, COLORS.redLight],
        borderWidth: 0,
      }]
    }, { cutout: '65%' });

    makeChart('chart-incentive-activity', 'doughnut', {
      labels: ['Active', 'Inactive'],
      datasets: [{
        data: [pl.incentive_activity.active_30d, pl.incentive_activity.inactive_30d],
        backgroundColor: [COLORS.blue, COLORS.yellowLight],
        borderWidth: 0,
      }]
    }, { cutout: '65%' });

    const rf = pl.at_risk.by_flag;
    makeChart('chart-red-flags', 'bar', {
      labels: ['Bonus <$1/hr', '<50% Earning', 'No Bonus 30d', 'No Incentive 30d', 'Missing Accts'],
      datasets: [{
        label: 'Orgs',
        data: [rf.bonuses_below_1, rf.low_earning_staff, rf.no_bonuses_30d, rf.no_incentives_30d, rf.missing_accounts],
        backgroundColor: [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.purple, COLORS.blue],
        borderRadius: 6,
      }]
    }, { indexAxis: 'y', plugins: { legend: { display: false } } });
  }

  function renderPercentiles(agg) {
    const pcts = agg.post_launch.percentiles;
    const el = $('#percentile-tables');
    el.innerHTML = '';

    if (pcts.top_bonus_orgs.length) {
      el.innerHTML += pctTable('Top 10% - Bonus per Person', pcts.top_bonus_orgs, '$');
    }
    if (pcts.bottom_bonus_orgs.length) {
      el.innerHTML += pctTable('Bottom 10% - Bonus per Person', pcts.bottom_bonus_orgs, '$');
    }
    if (pcts.fastest_launch.length) {
      el.innerHTML += pctTable('Top 10% - Fastest Launch', pcts.fastest_launch, 'd');
    }
    if (pcts.slowest_launch.length) {
      el.innerHTML += pctTable('Bottom 10% - Slowest Launch', pcts.slowest_launch, 'd');
    }
    if (pcts.top_missing_invites && pcts.top_missing_invites.length) {
      el.innerHTML += pctTable('Worst - Missing Invites', pcts.top_missing_invites, '');
    }
  }

  function pctTable(title, items, unit) {
    const rows = items.map(i =>
      `<tr><td>${i.org}</td><td style="text-align:right;font-weight:600;">${unit === '$' ? fmtDollar(i.value) : fmt(i.value)}${unit === 'd' ? ' days' : ''}</td></tr>`
    ).join('');
    return `<div class="pct-table"><h3>${title}</h3><table><thead><tr><th>Organization</th><th style="text-align:right">Value</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------------------
  // Tab 2: Details
  // ---------------------------------------------------------------------------
  const DETAIL_COLS = [
    { key: 'organization_id', label: 'ID', type: 'num' },
    { key: 'organization_name', label: 'Organization', type: 'str' },
    { key: '_source', label: 'Source', type: 'source' },
    { key: 'subscription_status', label: 'Status', type: 'status' },
    { key: 'company_size', label: 'Size', type: 'str' },
    { key: 'organization_created_at', label: 'Created', type: 'date' },
    { key: 'launch_date', label: 'Launch Date', type: 'date' },
    { key: 'days_to_launch', label: 'Days to Launch', type: 'num' },
    { key: 'days_since_created', label: 'Days Since Created', type: 'num' },
    { key: 'active_user_count', label: 'Active Users', type: 'num' },
    { key: 'identities_tracking_hours_30d', label: 'Tracking Hrs 30d', type: 'num' },
    { key: 'stripe_billed_users', label: 'Billed Users (Stripe)', type: 'num' },
    { key: 'stripe_customer_url', label: 'Stripe', type: 'link' },
    { key: 'latest_snapshot_billable_users', label: 'Billable Users (DB)', type: 'num' },
    { key: 'estimated_billable_users', label: 'Est. Billable', type: 'num' },
    { key: 'onboarding_fee_amount', label: 'Onboarding Fee', type: 'dollar' },
    { key: 'billing_anchor_date', label: 'Billing Anchor', type: 'date' },
    { key: 'active_billing_date', label: 'Active Billing', type: 'date' },
    { key: 'latest_invoice_amount', label: 'Latest Invoice', type: 'dollar' },
    { key: 'current_prepaid_balance', label: 'Prepaid Balance', type: 'dollar' },
    { key: 'estimated_mrr', label: 'Est. MRR', type: 'dollar' },
    { key: 'last_approved_at', label: 'Last Approved', type: 'date' },
    { key: 'last_statement_paid_at', label: 'Last Paid', type: 'date' },
    { key: 'integrations', label: 'Integrations', type: 'str' },
    { key: 'total_paid_statements', label: 'Paid Stmts', type: 'num' },
    { key: 'paid_statements_30d', label: 'Stmts 30d', type: 'num' },
    { key: 'total_bonuses_paid', label: 'Total Bonuses', type: 'dollar' },
    { key: 'total_bonuses_paid_30d', label: 'Bonuses 30d', type: 'dollar' },
    { key: 'total_bonuses_paid_60d', label: 'Bonuses 60d', type: 'dollar' },
    { key: 'unique_paid_people_total', label: 'Paid People', type: 'num' },
    { key: 'unique_paid_people_30d', label: 'Paid People 30d', type: 'num' },
    { key: 'avg_bonus_per_person', label: 'Avg Bonus/Person', type: 'dollar' },
    { key: 'avg_bonus_per_person_30d', label: 'Avg $/Person 30d', type: 'dollar' },
    { key: 'bonus_per_hour_30d', label: 'Bonus/Hr 30d', type: 'dollar' },
    { key: 'avg_effective_wage_30d', label: 'Eff. Wage 30d', type: 'dollar' },
    { key: 'avg_base_wage_30d', label: 'Base Wage 30d', type: 'dollar' },
    { key: 'avg_bonus_rate_30d', label: 'Bonus Rate 30d', type: 'dollar' },
    { key: 'pay_lift_per_hour_30d', label: 'Pay Lift/Hr 30d', type: 'dollar' },
    { key: 'pay_lift_pct_30d', label: 'Pay Lift % 30d', type: 'pct' },
    { key: 'needs_invite_count', label: 'Needs Invite', type: 'num' },
    { key: 'failed_invite_count', label: 'Failed Invites', type: 'num' },
    { key: 'pending_invite_count', label: 'Pending Invites', type: 'num' },
    { key: 'total_invite_alert_count', label: 'Invite Alerts', type: 'num' },
    { key: 'red_flag_count', label: 'Red Flags', type: 'num' },
    { key: 'at_risk', label: 'At Risk', type: 'bool' },
  ];

  function renderDetails() {
    renderDetailsHeader();
    renderDetailsBody();
    setupTableSearch();
    setupExport();
  }

  function renderDetailsHeader() {
    const thead = $('#details-thead');
    thead.innerHTML = DETAIL_COLS.map(c =>
      `<th data-col="${c.key}">${c.label}<span class="sort-arrow">${sortCol === c.key ? (sortAsc ? '\u25B2' : '\u25BC') : ''}</span></th>`
    ).join('');

    thead.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) { sortAsc = !sortAsc; }
        else { sortCol = col; sortAsc = true; }
        renderDetailsBody();
        renderDetailsHeader();
      });
    });
  }

  function getDetailRows() {
    const ysRows = filteredOrgs.map(o => ({ ...o, _source: 'Yellowstone' }));
    const mtRows = filteredMtOrgs.map(o => ({ ...o, _source: 'Multi-Tenant' }));
    return [...ysRows, ...mtRows];
  }

  function renderDetailsBody() {
    let rows = getDetailRows();

    const search = ($('#table-search').value || '').toLowerCase().trim();
    if (search) {
      rows = rows.filter(o => (o.organization_name || '').toLowerCase().includes(search));
    }

    if (sortCol) {
      const colDef = DETAIL_COLS.find(c => c.key === sortCol);
      rows.sort((a, b) => {
        let va = a[sortCol], vb = b[sortCol];
        if (va == null) va = colDef?.type === 'num' || colDef?.type === 'dollar' ? -Infinity : '';
        if (vb == null) vb = colDef?.type === 'num' || colDef?.type === 'dollar' ? -Infinity : '';
        if (colDef?.type === 'date') {
          va = va ? new Date(va).getTime() : 0;
          vb = vb ? new Date(vb).getTime() : 0;
        }
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    const tbody = $('#details-tbody');
    tbody.innerHTML = rows.map(o => {
      const classes = [];
      if (o.at_risk) classes.push('at-risk');
      if (o.is_prepay) classes.push('prepay');
      const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
      return `<tr${cls}>${DETAIL_COLS.map(c => `<td>${formatCell(o[c.key], c.type)}</td>`).join('')}</tr>`;
    }).join('');

    $('#table-count').textContent = `${rows.length} rows`;
  }

  function formatCell(val, type) {
    if (val == null || val === '') return '<span style="color:#A0AEC0">-</span>';
    switch (type) {
      case 'num': return fmt(val);
      case 'dollar': return fmtDollar(val);
      case 'date': return shortDate(val);
      case 'bool': return val
        ? '<span class="flag-pill red">YES</span>'
        : '<span class="flag-pill green">NO</span>';
      case 'pct': return fmtPct(val);
      case 'link':
        return `<a href="${val}" target="_blank" rel="noopener" style="color:#3898EC;text-decoration:none;font-weight:500;white-space:nowrap;"> Stripe</a>`;
      case 'status':
        if (val === 'billing_started') return '<span class="status-pill billing">billing_started</span>';
        if (val === 'initial_prepayment_collected') return '<span class="status-pill prepay">prepaid</span>';
        if (val === 'awaiting_initial_prepayment') return '<span class="status-pill prepay" style="opacity:.6">awaiting prepay</span>';
        return `<span class="status-pill inactive">${val}</span>`;
      case 'source':
        return val === 'Yellowstone'
          ? '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#EBF8FF;color:#2B6CB0;">Yellowstone</span>'
          : '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#F0FFF4;color:#276749;">Multi-Tenant</span>';
      default: return String(val);
    }
  }

  function setupTableSearch() {
    let timer;
    $('#table-search').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(renderDetailsBody, 200);
    });
  }

  function setupExport() {
    $('#btn-export').addEventListener('click', () => {
      const allRows = getDetailRows();
      const header = DETAIL_COLS.map(c => c.label).join(',');
      const rows = allRows.map(o =>
        DETAIL_COLS.map(c => {
          let v = o[c.key];
          if (v == null) return '';
          if (c.type === 'date') return shortDate(v);
          if (c.type === 'source') return v;
          if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
          return v;
        }).join(',')
      );
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `protiv-cs-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function makeChart(canvasId, type, data, extraOpts = {}) {
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const opts = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        datalabels: { display: false },
        ...(extraOpts.plugins || {})
      },
      scales: type === 'doughnut' || type === 'pie' ? undefined : {
        x: { grid: { color: 'rgba(226,232,240,0.5)' } },
        y: { grid: { color: 'rgba(226,232,240,0.5)' } },
        ...(extraOpts.scales || {})
      },
      ...extraOpts,
    };
    delete opts.plugins;
    opts.plugins = { datalabels: { display: false }, ...(extraOpts.plugins || {}) };

    chartInstances[canvasId] = new Chart(ctx, { type, data, options: opts });
  }

  function kpiCards(cards) {
    return cards.map(c => `
      <div class="kpi-card ${c.cls || ''}">
        <div class="kpi-icon">${c.icon || ''}</div>
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${c.value}</div>
        ${c.sub ? `<div class="kpi-sub">${c.sub}</div>` : ''}
      </div>
    `).join('');
  }

  function medianCalc(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  // ---------------------------------------------------------------------------
  // Indicators â Multi-Tenant
  // ---------------------------------------------------------------------------
  function renderMultiTenant() {
    if (!DATA || !DATA.mt) return;
    const orgs = filteredMtOrgs;
    const agg = DATA.mt.aggregations;
    const pre = orgs.filter(o => o.is_pre_launch);
    const post = orgs.filter(o => o.is_post_launch);

    $('#mt-badge-pre-launch').textContent = `${pre.length} orgs`;
    $('#mt-badge-post-launch').textContent = `${post.length} orgs`;
    const atRisk = post.filter(o => o.at_risk);
    $('#mt-badge-at-risk').textContent = `${atRisk.length} at risk`;
    $('#mt-badge-at-risk').className = `badge ${atRisk.length > 0 ? 'badge-red' : 'badge-green'}`;

    renderMTPreLaunchKPIs(pre, agg);
    renderMTPreLaunchCharts(agg);
    renderMTPostLaunchKPIs(post, agg);
    renderMTPostLaunchCharts(agg);
    renderMTPercentiles(agg);
  }

  function renderMTPreLaunchKPIs(pre, agg) {
    const launched = filteredMtOrgs.filter(o => o.days_to_launch !== null && o.days_to_launch >= 0);
    const times = launched.map(o => o.days_to_launch);
    const avgTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const medTime = times.length ? medianCalc(times) : 0;
    const estBillable = pre.reduce((s, o) => s + o.estimated_billable_users, 0);
    const estMRR = pre.reduce((s, o) => s + o.estimated_mrr, 0);
    const estARR = pre.reduce((s, o) => s + o.estimated_arr, 0);
    const aging30 = pre.filter(o => o.days_since_created >= 30).length;
    const aging60 = pre.filter(o => o.days_since_created >= 60).length;
    $('#mt-pre-launch-kpis').innerHTML = kpiCards([
      { label: 'Avg Time to Launch', value: `${avgTime}d`, sub: `Median: ${medTime}d`, icon: '' },
      { label: 'Pre-Launch Orgs', value: fmt(pre.length), sub: `${aging30} aging 30d+`, icon: '' },
      { label: 'Aging 60+ Days', value: fmt(aging60), cls: aging60 > 0 ? 'warning' : '', icon: '' },
      { label: 'Est. Billable Users', value: fmt(estBillable), sub: `Avg ${fmt(Math.round(estBillable / (pre.length || 1)))} per org`, icon: '' },
      { label: 'Est. MRR', value: fmtDollar(estMRR), icon: '' },
      { label: 'Est. ARR', value: fmtDollar(estARR), icon: '' },
    ]);
  }

  function renderMTPreLaunchCharts(agg) {
    const dist = agg.pre_launch.time_to_launch.distribution;
    makeChart('mt-chart-launch-distribution', 'bar', {
      labels: dist.map(d => d.label),
      datasets: [{ label: 'Orgs', data: dist.map(d => d.count), backgroundColor: [COLORS.blue, COLORS.green, COLORS.purple, COLORS.yellow, COLORS.red], borderRadius: 6 }]
    }, { plugins: { legend: { display: false } } });

    const aging = agg.pre_launch.aging;
    makeChart('mt-chart-aging', 'bar', {
      labels: aging.map(a => a.label),
      datasets: [{ label: 'Count', data: aging.map(a => a.count), backgroundColor: [COLORS.yellow, COLORS.orange, COLORS.red, '#C53030'], borderRadius: 6 }]
    }, { indexAxis: 'y', plugins: { legend: { display: false } } });

    const trend = agg.pre_launch.launch_trend;
    if (trend.length) {
      makeChart('mt-chart-launch-trend', 'line', {
        labels: trend.map(t => t.month),
        datasets: [
          { label: 'Avg Days', data: trend.map(t => t.avg), borderColor: COLORS.blue, backgroundColor: COLORS.blueLight, fill: true, tension: 0.3 },
          { label: 'Median Days', data: trend.map(t => t.median), borderColor: COLORS.purple, borderDash: [5, 3], tension: 0.3 }
        ]
      });
    }

    const rev = agg.pre_launch.estimated_revenue;
    makeChart('mt-chart-pre-revenue', 'bar', {
      labels: ['Total MRR', 'Avg MRR', 'Median MRR', 'Total ARR'],
      datasets: [{ label: 'USD', data: [rev.total_mrr, rev.avg_mrr, rev.median_mrr, rev.total_arr], backgroundColor: [COLORS.blue, COLORS.purple, COLORS.orange, COLORS.green], borderRadius: 6 }]
    }, { plugins: { legend: { display: false } } });
  }

  function renderMTPostLaunchKPIs(post, agg) {
    const pl = agg.post_launch;
    const atRisk = post.filter(o => o.at_risk);
    const totalBonuses30d = post.reduce((s, o) => s + o.total_bonuses_paid_30d, 0);
    const paidOrgs30d = post.filter(o => o.total_bonuses_paid_30d > 0).length;
    $('#mt-post-launch-kpis').innerHTML = kpiCards([
      { label: 'Post-Launch Orgs', value: fmt(post.length), icon: '' },
      { label: 'At Risk', value: fmt(atRisk.length), cls: atRisk.length > 0 ? 'danger' : 'success', sub: fmtPct(post.length ? (atRisk.length / post.length * 100) : 0) + ' of post-launch', icon: '' },
      { label: 'Billable Users (Actual)', value: fmt(pl.billable_users.total_actual), sub: `Gap: ${fmt(pl.billable_users.gap)}`, icon: '' },
      { label: 'Billable Ratio', value: fmtPct(pl.billable_users.ratio), icon: '' },
      { label: 'Missing Invites', value: fmt(pl.missing_invites.total), sub: `${pl.missing_invites.orgs_with_missing} orgs affected`, cls: pl.missing_invites.total > 0 ? 'warning' : '', icon: '' },
      { label: 'Bonuses Paid (30d)', value: fmtDollar(totalBonuses30d), sub: `${paidOrgs30d} orgs paying`, icon: '' },
      { label: 'Avg Bonus/Person (30d)', value: fmtDollar(pl.bonus_performance.last_30d.avg_per_user), icon: '' },
      { label: 'Orgs Paying Bonuses (30d)', value: fmt(pl.bonus_activity.paid_30d), sub: `${pl.bonus_activity.not_paid_30d} not paying`, cls: pl.bonus_activity.not_paid_30d > 0 ? 'warning' : '', icon: '' },
    ]);
  }

  function renderMTPostLaunchCharts(agg) {
    const pl = agg.post_launch;
    makeChart('mt-chart-billable-gap', 'doughnut', {
      labels: ['Actual Billed', 'Gap (Potential)'],
      datasets: [{ data: [pl.billable_users.total_actual, pl.billable_users.gap], backgroundColor: [COLORS.green, COLORS.redLight], borderWidth: 0 }]
    }, { cutout: '65%' });

    makeChart('mt-chart-bonus-activity', 'doughnut', {
      labels: ['Paid Bonuses', 'No Bonuses'],
      datasets: [{ data: [pl.bonus_activity.paid_30d, pl.bonus_activity.not_paid_30d], backgroundColor: [COLORS.green, COLORS.redLight], borderWidth: 0 }]
    }, { cutout: '65%' });

    makeChart('mt-chart-incentive-activity', 'doughnut', {
      labels: ['Active', 'Inactive'],
      datasets: [{ data: [pl.incentive_activity.active_30d, pl.incentive_activity.inactive_30d], backgroundColor: [COLORS.blue, COLORS.yellowLight], borderWidth: 0 }]
    }, { cutout: '65%' });

    const rf = pl.at_risk.by_flag;
    makeChart('mt-chart-red-flags', 'bar', {
      labels: ['Bonus <$1/hr', '<50% Earning', 'No Bonus 30d', 'No Incentive 30d', 'Missing Accts'],
      datasets: [{ label: 'Orgs', data: [rf.bonuses_below_1, rf.low_earning_staff, rf.no_bonuses_30d, rf.no_incentives_30d, rf.missing_accounts], backgroundColor: [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.purple, COLORS.blue], borderRadius: 6 }]
    }, { indexAxis: 'y', plugins: { legend: { display: false } } });
  }

  function renderMTPercentiles(agg) {
    const pcts = agg.post_launch.percentiles;
    const el = $('#mt-percentile-tables');
    el.innerHTML = '';
    if (pcts.top_bonus_orgs.length) el.innerHTML += pctTable('Top 10% - Bonus per Person', pcts.top_bonus_orgs, '$');
    if (pcts.bottom_bonus_orgs.length) el.innerHTML += pctTable('Bottom 10% - Bonus per Person', pcts.bottom_bonus_orgs, '$');
    if (pcts.fastest_launch.length) el.innerHTML += pctTable('Top 10% - Fastest Launch', pcts.fastest_launch, 'd');
    if (pcts.slowest_launch.length) el.innerHTML += pctTable('Bottom 10% - Slowest Launch', pcts.slowest_launch, 'd');
    if (pcts.top_missing_invites && pcts.top_missing_invites.length) el.innerHTML += pctTable('Worst - Missing Invites', pcts.top_missing_invites, '');
  }

  document.addEventListener('DOMContentLoaded', init);
}());
