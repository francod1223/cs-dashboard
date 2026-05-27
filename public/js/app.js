/* ================================================================
   Protiv CS Dashboard - Frontend Application (Light Theme)
   ================================================================ */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let DATA = null;
  let filteredOrgs = [];
  let filteredMtOrgs = [];
  let mtOrgs = [];
  let sortCol = null;
  let sortAsc = true;
  let chartInstances = {};

  // Time to Launch state
  let TTL_DATA = null;
  let ttlFiltered = [];
  let ttlSortCol = 'days_in_onboarding';
  let ttlSortAsc = false;
  let ttlFiltersReady = false;

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
  // Tabs — lazy-load TTL on first visit
  // ---------------------------------------------------------------------------
  function setupTabs() {
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        $(`#${btn.dataset.tab}`).classList.add('active');
        if (btn.dataset.tab === 'tab-ttl' && !TTL_DATA) {
          loadTTLData();
        }
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
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    if (!DATA) return;
    renderIndicators();
    renderDetails();
  }

  // ---------------------------------------------------------------------------
  // Tab 1: Indicators
  // ---------------------------------------------------------------------------
  function renderIndicators() {
    const db = $('#filter-db').value;
    const ysAgg = DATA.aggregations;
    const mtAgg = DATA.mt ? DATA.mt.aggregations : null;

    const allPre = [
      ...filteredOrgs.filter(o => o.is_pre_launch),
      ...filteredMtOrgs.filter(o => o.is_pre_launch),
    ];
    const allPost = [
      ...filteredOrgs.filter(o => o.is_post_launch),
      ...filteredMtOrgs.filter(o => o.is_post_launch),
    ];

    const atRisk = allPost.filter(o => o.at_risk);
    $('#badge-pre-launch').textContent = `${allPre.length} orgs`;
    $('#badge-post-launch').textContent = `${allPost.length} orgs`;
    $('#badge-at-risk').textContent = `${atRisk.length} at risk`;
    $('#badge-at-risk').className = `badge ${atRisk.length > 0 ? 'badge-red' : 'badge-green'}`;

    renderPreLaunchKPIs(allPre);
    renderPreLaunchCharts(allPre, ysAgg, mtAgg, db);
    renderPostLaunchKPIs(allPost, ysAgg, mtAgg, db);
    renderPostLaunchCharts(ysAgg, mtAgg, db);
    renderPercentiles(ysAgg, mtAgg, db);
  }

  function renderPreLaunchKPIs(allPre) {
    const launched = allPre.filter(o => o.days_to_launch !== null && o.days_to_launch >= 0);
    const times = launched.map(o => o.days_to_launch);
    const avgTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const medTime = times.length ? medianCalc(times) : 0;

    const estBillable = allPre.reduce((s, o) => s + (o.estimated_billable_users || 0), 0);
    const estMRR = allPre.reduce((s, o) => s + (o.estimated_mrr || 0), 0);
    const estARR = allPre.reduce((s, o) => s + (o.estimated_arr || 0), 0);
    const aging30 = allPre.filter(o => o.days_since_created >= 30).length;
    const aging60 = allPre.filter(o => o.days_since_created >= 60).length;

    $('#pre-launch-kpis').innerHTML = kpiCards([
      { label: 'Avg Time to Launch', value: `${avgTime}d`, sub: `Median: ${medTime}d`, icon: '' },
      { label: 'Pre-Launch Orgs', value: fmt(allPre.length), sub: `${aging30} aging 30d+`, icon: '' },
      { label: 'Aging 60+ Days', value: fmt(aging60), cls: aging60 > 0 ? 'warning' : '', icon: '' },
      { label: 'Est. Billable Users', value: fmt(estBillable), sub: `Avg ${fmt(Math.round(estBillable / (allPre.length || 1)))} per org`, icon: '' },
      { label: 'Est. MRR', value: fmtDollar(estMRR), icon: '' },
      { label: 'Est. ARR', value: fmtDollar(estARR), icon: '' },
    ]);
  }

  function renderPreLaunchCharts(allPre, ysAgg, mtAgg, db) {
    const showYS = db !== 'mt';
    const showMT = db !== 'yellowstone' && !!mtAgg;

    const combinedDist = mergeBuckets(
      showYS ? ysAgg.pre_launch.time_to_launch.distribution : [],
      showMT ? mtAgg.pre_launch.time_to_launch.distribution : []
    );
    makeChart('chart-launch-distribution', 'bar', {
      labels: combinedDist.map(d => d.label),
      datasets: [{ label: 'Orgs', data: combinedDist.map(d => d.count), backgroundColor: [COLORS.blue, COLORS.green, COLORS.purple, COLORS.yellow, COLORS.red], borderRadius: 6 }]
    }, { plugins: { legend: { display: false } } });

    const combinedAging = mergeBuckets(
      showYS ? ysAgg.pre_launch.aging : [],
      showMT ? mtAgg.pre_launch.aging : []
    );
    makeChart('chart-aging', 'bar', {
      labels: combinedAging.map(a => a.label),
      datasets: [{ label: 'Count', data: combinedAging.map(a => a.count), backgroundColor: [COLORS.yellow, COLORS.orange, COLORS.red, '#C53030'], borderRadius: 6 }]
    }, { indexAxis: 'y', plugins: { legend: { display: false } } });

    const ysTrend = showYS ? ysAgg.pre_launch.launch_trend : [];
    const mtTrend = showMT ? mtAgg.pre_launch.launch_trend : [];
    if (ysTrend.length || mtTrend.length) {
      const allMonths = [...new Set([...ysTrend.map(t => t.month), ...mtTrend.map(t => t.month)])].sort();
      const datasets = [];
      if (ysTrend.length) {
        datasets.push({
          label: 'Yellowstone',
          data: allMonths.map(m => { const pt = ysTrend.find(t => t.month === m); return pt ? pt.avg : null; }),
          borderColor: COLORS.blue, backgroundColor: COLORS.blueLight, fill: false, tension: 0.3, spanGaps: true,
        });
      }
      if (mtTrend.length) {
        datasets.push({
          label: 'Multi-Tenant',
          data: allMonths.map(m => { const pt = mtTrend.find(t => t.month === m); return pt ? pt.avg : null; }),
          borderColor: COLORS.green, borderDash: [4, 2], fill: false, tension: 0.3, spanGaps: true,
        });
      }
      makeChart('chart-launch-trend', 'line', { labels: allMonths, datasets });
    }

    const totalMRR = allPre.reduce((s, o) => s + (o.estimated_mrr || 0), 0);
    const totalARR = allPre.reduce((s, o) => s + (o.estimated_arr || 0), 0);
    const avgMRR = allPre.length ? Math.round(totalMRR / allPre.length) : 0;
    const medianMRR = medianCalc(allPre.map(o => o.estimated_mrr || 0));
    makeChart('chart-pre-revenue', 'bar', {
      labels: ['Total MRR', 'Avg MRR', 'Median MRR', 'Total ARR'],
      datasets: [{ label: 'USD', data: [totalMRR, avgMRR, medianMRR, totalARR], backgroundColor: [COLORS.blue, COLORS.purple, COLORS.orange, COLORS.green], borderRadius: 6 }]
    }, { plugins: { legend: { display: false } } });
  }

  function renderPostLaunchKPIs(allPost, ysAgg, mtAgg, db) {
    const showYS = db !== 'mt';
    const showMT = db !== 'yellowstone' && !!mtAgg;
    const ysPL = ysAgg.post_launch;
    const mtPL = mtAgg ? mtAgg.post_launch : null;

    const atRisk = allPost.filter(o => o.at_risk);
    const totalBonuses30d = allPost.reduce((s, o) => s + (o.total_bonuses_paid_30d || 0), 0);
    const paidOrgs30d = allPost.filter(o => (o.total_bonuses_paid_30d || 0) > 0).length;

    const totalActual = (showYS ? ysPL.billable_users.total_actual : 0) + (showMT && mtPL ? mtPL.billable_users.total_actual : 0);
    const totalGap = (showYS ? ysPL.billable_users.gap : 0) + (showMT && mtPL ? mtPL.billable_users.gap : 0);
    const ratio = (totalActual + totalGap) > 0 ? (totalActual / (totalActual + totalGap) * 100) : 0;

    const missingTotal = (showYS ? ysPL.missing_invites.total : 0) + (showMT && mtPL ? mtPL.missing_invites.total : 0);
    const missingOrgs = (showYS ? ysPL.missing_invites.orgs_with_missing : 0) + (showMT && mtPL ? mtPL.missing_invites.orgs_with_missing : 0);

    const bonusPaid = (showYS ? ysPL.bonus_activity.paid_30d : 0) + (showMT && mtPL ? mtPL.bonus_activity.paid_30d : 0);
    const bonusNotPaid = (showYS ? ysPL.bonus_activity.not_paid_30d : 0) + (showMT && mtPL ? mtPL.bonus_activity.not_paid_30d : 0);

    const totalPaidPeople30d = allPost.reduce((s, o) => s + (o.unique_paid_people_30d || 0), 0);
    const avgBonusPerPerson30d = totalPaidPeople30d > 0 ? totalBonuses30d / totalPaidPeople30d : 0;

    $('#post-launch-kpis').innerHTML = kpiCards([
      { label: 'Post-Launch Orgs', value: fmt(allPost.length), icon: '' },
      { label: 'At Risk', value: fmt(atRisk.length), cls: atRisk.length > 0 ? 'danger' : 'success', sub: fmtPct(allPost.length ? (atRisk.length / allPost.length * 100) : 0) + ' of post-launch', icon: '' },
      { label: 'Billable Users (Actual)', value: fmt(totalActual), sub: `Gap: ${fmt(totalGap)}`, icon: '' },
      { label: 'Billable Ratio', value: fmtPct(ratio), icon: '' },
      { label: 'Missing Invites', value: fmt(missingTotal), sub: `${missingOrgs} orgs affected`, cls: missingTotal > 0 ? 'warning' : '', icon: '' },
      { label: 'Bonuses Paid (30d)', value: fmtDollar(totalBonuses30d), sub: `${paidOrgs30d} orgs paying`, icon: '' },
      { label: 'Avg Bonus/Person (30d)', value: fmtDollar(avgBonusPerPerson30d), icon: '' },
      { label: 'Orgs Paying Bonuses (30d)', value: fmt(bonusPaid), sub: `${bonusNotPaid} not paying`, cls: bonusNotPaid > 0 ? 'warning' : '', icon: '' },
    ]);
  }

  function renderPostLaunchCharts(ysAgg, mtAgg, db) {
    const showYS = db !== 'mt';
    const showMT = db !== 'yellowstone' && !!mtAgg;
    const ysPL = ysAgg.post_launch;
    const mtPL = mtAgg ? mtAgg.post_launch : null;

    const actualBilled = (showYS ? ysPL.billable_users.total_actual : 0) + (showMT && mtPL ? mtPL.billable_users.total_actual : 0);
    const gap = (showYS ? ysPL.billable_users.gap : 0) + (showMT && mtPL ? mtPL.billable_users.gap : 0);
    makeChart('chart-billable-gap', 'doughnut', {
      labels: ['Actual Billed', 'Gap (Potential)'],
      datasets: [{ data: [actualBilled, gap], backgroundColor: [COLORS.green, COLORS.redLight], borderWidth: 0 }]
    }, { cutout: '65%' });

    const bonusPaid = (showYS ? ysPL.bonus_activity.paid_30d : 0) + (showMT && mtPL ? mtPL.bonus_activity.paid_30d : 0);
    const bonusNotPaid = (showYS ? ysPL.bonus_activity.not_paid_30d : 0) + (showMT && mtPL ? mtPL.bonus_activity.not_paid_30d : 0);
    makeChart('chart-bonus-activity', 'doughnut', {
      labels: ['Paid Bonuses', 'No Bonuses'],
      datasets: [{ data: [bonusPaid, bonusNotPaid], backgroundColor: [COLORS.green, COLORS.redLight], borderWidth: 0 }]
    }, { cutout: '65%' });

    const incentiveActive = (showYS ? ysPL.incentive_activity.active_30d : 0) + (showMT && mtPL ? mtPL.incentive_activity.active_30d : 0);
    const incentiveInactive = (showYS ? ysPL.incentive_activity.inactive_30d : 0) + (showMT && mtPL ? mtPL.incentive_activity.inactive_30d : 0);
    makeChart('chart-incentive-activity', 'doughnut', {
      labels: ['Active', 'Inactive'],
      datasets: [{ data: [incentiveActive, incentiveInactive], backgroundColor: [COLORS.blue, COLORS.yellowLight], borderWidth: 0 }]
    }, { cutout: '65%' });

    const zero = { bonuses_below_1: 0, low_earning_staff: 0, no_bonuses_30d: 0, no_incentives_30d: 0, missing_accounts: 0 };
    const ysRF = showYS ? ysPL.at_risk.by_flag : zero;
    const mtRF = showMT && mtPL ? mtPL.at_risk.by_flag : zero;
    makeChart('chart-red-flags', 'bar', {
      labels: ['Bonus <$1/hr', '<50% Earning', 'No Bonus 30d', 'No Incentive 30d', 'Missing Accts'],
      datasets: [{ label: 'Orgs', data: [
        ysRF.bonuses_below_1 + mtRF.bonuses_below_1,
        ysRF.low_earning_staff + mtRF.low_earning_staff,
        ysRF.no_bonuses_30d + mtRF.no_bonuses_30d,
        ysRF.no_incentives_30d + mtRF.no_incentives_30d,
        ysRF.missing_accounts + mtRF.missing_accounts,
      ], backgroundColor: [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.purple, COLORS.blue], borderRadius: 6 }]
    }, { indexAxis: 'y', plugins: { legend: { display: false } } });
  }

  function renderPercentiles(ysAgg, mtAgg, db) {
    const showYS = db !== 'mt';
    const showMT = db !== 'yellowstone' && !!mtAgg;
    const el = $('#percentile-tables');
    el.innerHTML = '';

    const ysPcts = ysAgg.post_launch.percentiles;
    const mtPcts = mtAgg ? mtAgg.post_launch.percentiles : {};

    const combine = (ysItems, mtItems) => [
      ...(showYS && ysItems ? ysItems : []),
      ...(showMT && mtItems ? mtItems : []),
    ];

    const topBonus = combine(ysPcts.top_bonus_orgs, mtPcts.top_bonus_orgs).sort((a, b) => b.value - a.value).slice(0, 10);
    const bottomBonus = combine(ysPcts.bottom_bonus_orgs, mtPcts.bottom_bonus_orgs).sort((a, b) => a.value - b.value).slice(0, 10);
    const fastest = combine(ysPcts.fastest_launch, mtPcts.fastest_launch).sort((a, b) => a.value - b.value).slice(0, 10);
    const slowest = combine(ysPcts.slowest_launch, mtPcts.slowest_launch).sort((a, b) => b.value - a.value).slice(0, 10);
    const topMissing = combine(ysPcts.top_missing_invites, mtPcts.top_missing_invites).sort((a, b) => b.value - a.value).slice(0, 10);

    if (topBonus.length) el.innerHTML += pctTable('Top 10% - Bonus per Person', topBonus, '$');
    if (bottomBonus.length) el.innerHTML += pctTable('Bottom 10% - Bonus per Person', bottomBonus, '$');
    if (fastest.length) el.innerHTML += pctTable('Top 10% - Fastest Launch', fastest, 'd');
    if (slowest.length) el.innerHTML += pctTable('Bottom 10% - Slowest Launch', slowest, 'd');
    if (topMissing.length) el.innerHTML += pctTable('Worst - Missing Invites', topMissing, '');
  }

  function pctTable(title, items, unit) {
    const rows = items.map(i =>
      `<tr><td>${i.org}</td><td style="text-align:right;font-weight:600;">${unit === '$' ? fmtDollar(i.value) : fmt(i.value)}${unit === 'd' ? ' days' : ''}</td></tr>`
    ).join('');
    return `<div class="pct-table"><h3>${title}</h3><table><thead><tr><th>Organization</th><th style="text-align:right">Value</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function mergeBuckets(arr1, arr2) {
    const map = {};
    const order = [];
    (arr1 || []).forEach(d => {
      if (!map[d.label]) { map[d.label] = 0; order.push(d.label); }
      map[d.label] += d.count;
    });
    (arr2 || []).forEach(d => {
      if (!map[d.label]) { map[d.label] = 0; order.push(d.label); }
      map[d.label] += d.count;
    });
    return order.map(label => ({ label, count: map[label] }));
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
      `<th data-col="${c.key}">${c.label}<span class="sort-arrow">${sortCol === c.key ? (sortAsc ? '▲' : '▼') : ''}</span></th>`
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

  // ---------------------------------------------------------------------------
  // Tab 3: Time to Launch
  // ---------------------------------------------------------------------------
  async function loadTTLData() {
    const loading = $('#ttl-loading');
    const content = $('#ttl-content');
    if (!loading || !content) return;
    loading.style.display = 'flex';
    content.style.display = 'none';
    try {
      const res = await fetch('/api/time-to-launch');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      TTL_DATA = await res.json();
      loading.style.display = 'none';
      content.style.display = 'block';
      setupTTLTableSort();      // must run first — creates the header checkbox before renderTTL touches it
      initTTLFilters();
      applyTTLFilters();
      renderTTL();
      setupTTLRefresh();
      setupTTLExport();
      setupTTLOverrideModal();
      setupTTLPersistButton();
    } catch (err) {
      loading.style.display = 'none';
      content.style.display = 'block';
      content.innerHTML = `<div style="padding:60px;text-align:center;color:#E53E3E;font-size:14px;">Failed to load: ${err.message}</div>`;
    }
  }

  function initTTLFilters() {
    if (!TTL_DATA || ttlFiltersReady) return;
    ttlFiltersReady = true;

    const ownerSel = $('#ttl-filter-owner');
    ownerSel.innerHTML = '<option value="">All Owners</option>';
    const owners = [...new Set(TTL_DATA.orgs.map(o => o.hs_owner).filter(Boolean))].sort();
    owners.forEach(o => { ownerSel.innerHTML += `<option value="${o}">${o}</option>`; });
    ownerSel.addEventListener('change', () => { applyTTLFilters(); renderTTL(); });

    const intSel = $('#ttl-filter-integration');
    if (intSel) {
      intSel.innerHTML = '<option value="">All Integrations</option>';
      const ints = [...new Set(
        TTL_DATA.orgs.flatMap(o => o.integrations ? o.integrations.split(', ') : [])
      )].sort();
      ints.forEach(i => {
        const label = { aspire: 'Aspire', jobber: 'Jobber', quickbooks_time: 'QuickBooks Time',
          lmn: 'LMN', procore: 'Procore', boss: 'BOSS', paycom: 'Paycom', salesforce: 'Salesforce' }[i] || i;
        intSel.innerHTML += `<option value="${i}">${label}</option>`;
      });
      intSel.addEventListener('change', () => { applyTTLFilters(); renderTTL(); });
    }

    $('#ttl-filter-status').addEventListener('change', () => { applyTTLFilters(); renderTTL(); });
    $('#ttl-filter-search').addEventListener('input', () => { applyTTLFilters(); renderTTL(); });
    const hideV1El = document.getElementById('ttl-filter-hide-v1');
    if (hideV1El) hideV1El.addEventListener('change', () => { applyTTLFilters(); renderTTL(); });
  }

  function applyTTLFilters() {
    if (!TTL_DATA) return;
    const owner = $('#ttl-filter-owner').value;
    const status = $('#ttl-filter-status').value;
    const integration = ($('#ttl-filter-integration') || {}).value || '';
    const search = ($('#ttl-filter-search').value || '').toLowerCase().trim();
    const hideV1El = document.getElementById('ttl-filter-hide-v1');
    const hideV1 = hideV1El ? hideV1El.checked : true;  // default: hide V1 migrations
    ttlFiltered = TTL_DATA.orgs.filter(o => {
      if (owner && o.hs_owner !== owner) return false;
      if (status === 'launched' && !o.is_launched) return false;
      if (status === 'in_onboarding' && (o.is_launched || o.is_lost || o.is_v1_migration)) return false;
      if (status === 'lost' && !o.is_lost) return false;
      if (status === 'v1_migration' && !o.is_v1_migration) return false;
      if (hideV1 && o.is_v1_migration && status !== 'v1_migration') return false;
      if (integration) {
        const orgInts = (o.integrations || '').split(', ').map(s => s.trim()).filter(Boolean);
        if (!orgInts.includes(integration)) return false;
      }
      if (search && !(o.organization_name || '').toLowerCase().includes(search)) return false;
      return true;
    });
    const v1Count = TTL_DATA.orgs.filter(o => o.is_v1_migration).length;
    const hiddenNote = hideV1 && v1Count > 0 ? ` (${v1Count} V1 hidden)` : '';
    $('#ttl-filter-count').textContent = `${ttlFiltered.length} of ${TTL_DATA.summary.total} orgs${hiddenNote}`;
  }

  function renderTTL() {
    if (!TTL_DATA) return;
    const s = TTL_DATA.summary;
    $('#ttl-badge-total').textContent = `${s.total} orgs`;
    $('#ttl-generated').textContent = `Updated: ${new Date(TTL_DATA.generated_at).toLocaleTimeString()}`;
    $('#ttl-kpis').innerHTML = kpiCards([
      { label: 'Total Orgs', value: fmt(s.total) },
      { label: 'In Onboarding', value: fmt(s.in_onboarding), sub: s.avg_days_open != null ? `${s.avg_days_open}d avg open` : null },
      { label: 'Launched', value: fmt(s.launched), sub: s.pct_launched + '% of total', cls: 'success' },
      { label: 'Lost (never launched)', value: fmt(s.lost || 0), sub: (s.pct_lost || 0) + '% of total', cls: (s.lost || 0) > 0 ? 'danger' : '' },
      { label: 'Avg Days to Launch', value: s.avg_days_to_launch != null ? `${s.avg_days_to_launch}d` : '-', sub: s.median_days_to_launch != null ? `Median: ${s.median_days_to_launch}d` : null },
      { label: 'Longest Open', value: s.longest_open != null ? `${s.longest_open}d` : '-', cls: s.longest_open > 60 ? 'danger' : '' },
    ]);
    renderTTLCharts();
    renderTTLTable();
  }

  function computeTTLAggregates(orgs) {
    const agingBuckets = [
      { label: '0-14d', count: 0 }, { label: '15-30d', count: 0 },
      { label: '31-60d', count: 0 }, { label: '61-90d', count: 0 }, { label: '90d+', count: 0 },
    ];
    const launchDist = [
      { label: '0-14d', count: 0 }, { label: '15-30d', count: 0 },
      { label: '31-60d', count: 0 }, { label: '61-90d', count: 0 }, { label: '90d+', count: 0 },
    ];
    const ownerMap = {};
    let launched = 0, inOnboarding = 0, lostCount = 0;
    orgs.forEach(o => {
      if (o.is_launched) {
        launched++;
        const d = o.days_to_launch || 0;
        if (d <= 14) launchDist[0].count++;
        else if (d <= 30) launchDist[1].count++;
        else if (d <= 60) launchDist[2].count++;
        else if (d <= 90) launchDist[3].count++;
        else launchDist[4].count++;
      } else if (o.is_lost) {
        lostCount++;
      } else {
        inOnboarding++;
        const d = o.days_in_onboarding || 0;
        if (d <= 14) agingBuckets[0].count++;
        else if (d <= 30) agingBuckets[1].count++;
        else if (d <= 60) agingBuckets[2].count++;
        else if (d <= 90) agingBuckets[3].count++;
        else agingBuckets[4].count++;
      }
      const owner = o.hs_owner || 'Unassigned';
      if (!ownerMap[owner]) ownerMap[owner] = { owner, launched: 0, in_onboarding: 0, lost: 0 };
      if (o.is_launched) ownerMap[owner].launched++;
      else if (o.is_lost) ownerMap[owner].lost++;
      else ownerMap[owner].in_onboarding++;
    });
    return {
      agingBuckets, launchDist,
      byOwner: Object.values(ownerMap).sort((a, b) => b.in_onboarding - a.in_onboarding),
      launched, inOnboarding, lostCount,
    };
  }

  function renderTTLCharts() {
    if (!TTL_DATA) return;
    // Use ttlFiltered so all filters (owner, status, integration) affect charts
    const agg = computeTTLAggregates(ttlFiltered);

    makeChart('ttl-aging', 'bar', {
      labels: agg.agingBuckets.map(b => b.label),
      datasets: [{ label: 'Orgs in Onboarding', data: agg.agingBuckets.map(b => b.count),
        backgroundColor: [COLORS.green, COLORS.blue, COLORS.orange, COLORS.red, '#C53030'], borderRadius: 6 }]
    }, { indexAxis: 'y', plugins: { legend: { display: false } } });

    makeChart('ttl-launch-dist', 'bar', {
      labels: agg.launchDist.map(b => b.label),
      datasets: [{ label: 'Launched Orgs', data: agg.launchDist.map(b => b.count),
        backgroundColor: [COLORS.green, COLORS.blue, COLORS.orange, COLORS.red, '#C53030'], borderRadius: 6 }]
    }, { plugins: { legend: { display: false } } });

    makeChart('ttl-by-owner', 'bar', {
      labels: agg.byOwner.map(o => o.owner),
      datasets: [
        { label: 'In Onboarding', data: agg.byOwner.map(o => o.in_onboarding), backgroundColor: COLORS.orange, borderRadius: 2 },
        { label: 'Launched', data: agg.byOwner.map(o => o.launched), backgroundColor: COLORS.green, borderRadius: 2 },
        { label: 'Lost', data: agg.byOwner.map(o => o.lost || 0), backgroundColor: COLORS.red, borderRadius: 2 },
      ]
    }, { scales: { x: { stacked: true }, y: { stacked: true } } });

    makeChart('ttl-launch-rate', 'doughnut', {
      labels: ['Launched', 'In Onboarding', 'Lost'],
      datasets: [{ data: [agg.launched, agg.inOnboarding, agg.lostCount],
        backgroundColor: [COLORS.green, COLORS.orangeLight, COLORS.red], borderWidth: 0 }]
    }, { cutout: '65%' });

    // Block reason breakdown — only show if any orgs have a block reason set
    const BR_LABELS = {
      technical_problems: 'Technical problems',
      worried_overpaying: 'Worried about overpaying',
      budget_issues: 'Budget issues',
      internal_decision: 'Internal decision-making',
      no_technical_leader: 'No technical leader',
      key_champion_left: 'Key champion left',
      never_responded: 'Never responded / ghosted',
      timing_seasonal: 'Timing / seasonal pause',
    };
    const brCounts = {};
    ttlFiltered.filter(o => o.block_reason).forEach(o => {
      const label = BR_LABELS[o.block_reason] || o.block_reason;
      brCounts[label] = (brCounts[label] || 0) + 1;
    });
    const brRow = document.getElementById('ttl-block-reason-row');
    if (brRow) {
      if (Object.keys(brCounts).length > 0) {
        brRow.style.display = '';
        const brLabels = Object.keys(brCounts).sort((a, b) => brCounts[b] - brCounts[a]);
        makeChart('ttl-block-reasons', 'bar', {
          labels: brLabels,
          datasets: [{ label: 'Orgs', data: brLabels.map(l => brCounts[l]),
            backgroundColor: [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.purple, COLORS.blue, COLORS.green, '#FC8181', '#F6AD55'],
            borderRadius: 6 }]
        }, { indexAxis: 'y', plugins: { legend: { display: false } } });
      } else {
        brRow.style.display = 'none';
      }
    }
  }

  const TTL_COLS = [
    { key: '_check', label: '', type: 'check' },
    { key: '_actions', label: '', type: 'actions' },
    { key: 'organization_name', label: 'Organization', sortable: true },
    { key: 'is_launched', label: 'Status', type: 'ttl_status', sortable: true },
    { key: 'organization_created_at', label: 'Created', type: 'date', sortable: true },
    { key: 'active_billing_date', label: 'Billing Start', type: 'date_ov', sortable: true },
    { key: 'days_to_launch', label: 'Days to Launch', type: 'num', sortable: true },
    { key: 'days_in_onboarding', label: 'Days Open', type: 'num_heat', sortable: true },
    { key: 'company_size', label: 'Size', sortable: true },
    { key: 'active_user_count', label: 'Active Users', type: 'num', sortable: true },
    { key: 'estimated_billable', label: 'Est. Billable', type: 'num', sortable: true },
    { key: 'integrations', label: 'Integrations' },
    { key: 'fathom_meetings', label: 'Meetings', type: 'num', sortable: true },
    { key: 'hs_owner', label: 'HS Owner', sortable: true },
    { key: 'hs_stage', label: 'HS Stage' },
    { key: 'block_reason', label: 'Block Reason', type: 'block_reason' },
  ];

  function setupTTLTableSort() {
    const thead = $('#ttl-thead');
    if (!thead) return;
    thead.innerHTML = '<tr>' + TTL_COLS.map(c => {
      if (c.type === 'check') return `<th style="width:22px;"><input type="checkbox" id="ttl-check-all" title="Select all" style="width:15px;height:15px;cursor:pointer;accent-color:#3182CE;"></th>`;
      if (c.type === 'actions') return `<th style="width:32px;"></th>`;
      const arrow = ttlSortCol === c.key ? (ttlSortAsc ? ' ▲' : ' ▼') : '';
      const style = c.sortable ? 'cursor:pointer;' : '';
      return `<th style="${style}" data-col="${c.key}">${c.label}${arrow}</th>`;
    }).join('') + '</tr>';

    // Wire select-all here — right after creating the checkbox, before anything else touches it
    const checkAll = document.getElementById('ttl-check-all');
    if (checkAll) {
      checkAll.addEventListener('change', () => {
        document.querySelectorAll('#ttl-tbody .ttl-row-check').forEach(cb => { cb.checked = checkAll.checked; });
        updateBulkBar();
      });
    }

    thead.querySelectorAll('th[data-col]').forEach(th => {
      const col = TTL_COLS.find(c => c.key === th.dataset.col);
      if (!col || !col.sortable) return;
      th.addEventListener('click', () => {
        if (ttlSortCol === col.key) ttlSortAsc = !ttlSortAsc;
        else { ttlSortCol = col.key; ttlSortAsc = col.key !== 'days_in_onboarding'; }
        setupTTLTableSort();
        renderTTLTable();
      });
    });
  }

  function renderTTLTable() {
    let rows = [...ttlFiltered];
    rows.sort((a, b) => {
      let va = a[ttlSortCol], vb = b[ttlSortCol];
      if (ttlSortCol === 'is_launched') {
        const statusVal = o => o.is_lost ? 0 : o.is_launched ? 2 : 1;
        va = statusVal(a); vb = statusVal(b);
      }
      if (va == null) va = -Infinity;
      if (vb == null) vb = -Infinity;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return ttlSortAsc ? -1 : 1;
      if (va > vb) return ttlSortAsc ? 1 : -1;
      return 0;
    });
    const tbody = $('#ttl-tbody');
    tbody.innerHTML = rows.map(o => {
      const rowCls = o.is_lost ? ''
        : o.is_v1_migration ? ''
        : (!o.is_launched && o.days_in_onboarding > 60) ? 'at-risk'
        : (!o.is_launched && o.days_in_onboarding > 30) ? 'prepay' : '';
      const rowStyle = o.is_lost ? ' style="background:#FFF5F5;color:#742A2A;opacity:0.85;"'
        : o.is_v1_migration ? ' style="background:#FAF5FF;opacity:0.9;"'
        : '';
      return `<tr class="${rowCls}"${rowStyle} data-org-id="${o.organization_id}">${TTL_COLS.map(c => `<td>${formatTTLCell(o[c.key], c.type, o)}</td>`).join('')}</tr>`;
    }).join('');
    $('#ttl-table-count').textContent = `${rows.length} orgs`;

    // Wire up edit buttons
    tbody.querySelectorAll('.ttl-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openTTLOverrideModal(Number(btn.dataset.id)));
    });

    // Wire row checkboxes (select-all is wired in setupTTLTableSort — only once per thead creation)
    tbody.querySelectorAll('.ttl-row-check').forEach(cb => {
      cb.addEventListener('change', updateBulkBar);
    });
    updateBulkBar();
  }

  function updateBulkBar() {
    const selected = [...document.querySelectorAll('.ttl-row-check:checked')];
    const bar = document.getElementById('ttl-bulk-bar');
    if (!bar) return;
    if (selected.length === 0) {
      bar.style.display = 'none';
    } else {
      bar.style.display = 'flex';
      const countEl = bar.querySelector('#ttl-bulk-count');
      if (countEl) countEl.textContent = `${selected.length} org${selected.length > 1 ? 's' : ''} selected`;
    }
  }

  async function bulkHideSelected() {
    const selected = [...document.querySelectorAll('.ttl-row-check:checked')];
    if (!selected.length) return;
    const btn = document.getElementById('ttl-bulk-hide-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Hiding…'; }
    const ids = selected.map(cb => Number(cb.dataset.id));
    // Fire all hide requests in parallel
    await Promise.all(ids.map(id => {
      const org = TTL_DATA.orgs.find(o => Number(o.organization_id) === id);
      return fetch('/api/ttl/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: id, org_name: org ? org.organization_name : '', hidden: true, manual_billing_date: null, notes: 'Bulk hidden' }),
      });
    }));
    // Remove all hidden orgs from local data
    TTL_DATA.orgs = TTL_DATA.orgs.filter(o => !ids.includes(Number(o.organization_id)));
    TTL_DATA.summary.total = TTL_DATA.orgs.length;
    if (btn) { btn.disabled = false; btn.textContent = 'Hide selected'; }
    document.getElementById('ttl-bulk-bar').style.display = 'none';
    applyTTLFilters();
    renderTTL();
  }

  async function bulkMarkLost() {
    const selected = [...document.querySelectorAll('.ttl-row-check:checked')];
    if (!selected.length) return;
    const btn = document.getElementById('ttl-bulk-lost-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Marking…'; }
    const ids = selected.map(cb => Number(cb.dataset.id));
    await Promise.all(ids.map(id => {
      const org = TTL_DATA.orgs.find(o => Number(o.organization_id) === id);
      return fetch('/api/ttl/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: id, org_name: org ? org.organization_name : '', lost: true, hidden: false, manual_billing_date: null, notes: 'Marked lost' }),
      });
    }));
    // Update orgs locally: mark as lost, clear onboarding days
    ids.forEach(id => {
      const org = TTL_DATA.orgs.find(o => Number(o.organization_id) === id);
      if (org) {
        org.is_lost = true;
        org.is_launched = false;
        org.days_in_onboarding = null;
      }
    });
    TTL_DATA.summary.lost = (TTL_DATA.summary.lost || 0) + ids.length;
    TTL_DATA.summary.in_onboarding = Math.max(0, TTL_DATA.summary.in_onboarding - ids.length);
    if (btn) { btn.disabled = false; btn.textContent = '🚫 Mark as Lost'; }
    document.querySelectorAll('.ttl-row-check').forEach(c => c.checked = false);
    document.getElementById('ttl-bulk-bar').style.display = 'none';
    applyTTLFilters();
    renderTTL();
  }

  async function bulkMarkV1() {
    const selected = [...document.querySelectorAll('.ttl-row-check:checked')];
    if (!selected.length) return;
    const btn = document.getElementById('ttl-bulk-v1-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Tagging…'; }
    const ids = selected.map(cb => Number(cb.dataset.id));
    await Promise.all(ids.map(id => {
      const org = TTL_DATA.orgs.find(o => Number(o.organization_id) === id);
      return fetch('/api/ttl/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: id, org_name: org ? org.organization_name : '', is_v1_migration: true, notes: 'V1 Migration' }),
      });
    }));
    ids.forEach(id => {
      const org = TTL_DATA.orgs.find(o => Number(o.organization_id) === id);
      if (org) org.is_v1_migration = true;
    });
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Tag as V1 Migration'; }
    document.querySelectorAll('.ttl-row-check').forEach(c => c.checked = false);
    document.getElementById('ttl-bulk-bar').style.display = 'none';
    applyTTLFilters();
    renderTTL();
  }

  async function bulkSetBlockReason() {
    const reasonEl = document.getElementById('ttl-bulk-block-reason');
    const reason = reasonEl ? reasonEl.value : '';
    if (!reason) {
      reasonEl && (reasonEl.style.border = '2px solid #FC8181');
      setTimeout(() => { if (reasonEl) reasonEl.style.border = ''; }, 1500);
      return;
    }
    const selected = [...document.querySelectorAll('.ttl-row-check:checked')];
    if (!selected.length) return;
    const btn = document.getElementById('ttl-bulk-block-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
    const ids = selected.map(cb => Number(cb.dataset.id));
    await Promise.all(ids.map(id => {
      const org = TTL_DATA.orgs.find(o => Number(o.organization_id) === id);
      return fetch('/api/ttl/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: id, org_name: org ? org.organization_name : '', block_reason: reason }),
      });
    }));
    ids.forEach(id => {
      const org = TTL_DATA.orgs.find(o => Number(o.organization_id) === id);
      if (org) org.block_reason = reason;
    });
    if (btn) { btn.disabled = false; btn.textContent = '✔ Apply'; }
    if (reasonEl) reasonEl.value = '';
    document.querySelectorAll('.ttl-row-check').forEach(c => c.checked = false);
    document.getElementById('ttl-bulk-bar').style.display = 'none';
    applyTTLFilters();
    renderTTL();
  }

  // Expose for inline onclick in HTML
  window.bulkHideSelected = bulkHideSelected;
  window.bulkMarkLost = bulkMarkLost;
  window.bulkMarkV1 = bulkMarkV1;
  window.bulkSetBlockReason = bulkSetBlockReason;

  function formatTTLCell(val, type, org) {
    switch (type) {
      case 'check':
        return `<input type="checkbox" class="ttl-row-check" data-id="${org.organization_id}" style="width:15px;height:15px;cursor:pointer;accent-color:#3182CE;">`;
      case 'actions':
        return `<button class="ttl-edit-btn" data-id="${org.organization_id}" title="Edit override" style="border:none;background:transparent;cursor:pointer;padding:2px 6px;border-radius:4px;color:#718096;font-size:13px;">✏️</button>`;
      case 'ttl_status':
        if (org.is_lost) return '<span class="status-pill" style="background:#FFF5F5;color:#C53030;border:1px solid #FC8181;">Lost</span>';
        if (org.is_v1_migration) return '<span class="status-pill" style="background:#FAF5FF;color:#553C9A;border:1px solid #D6BCFA;">V1 Migration</span>';
        return org.is_launched
          ? '<span class="status-pill billing">Launched</span>'
          : '<span class="status-pill inactive">In Onboarding</span>';
      case 'block_reason': {
        if (!val) return '<span style="color:#A0AEC0">-</span>';
        const BR_LABELS = {
          technical_problems: 'Technical problems',
          worried_overpaying: 'Overpaying concern',
          budget_issues: 'Budget issues',
          internal_decision: 'Internal decision',
          no_technical_leader: 'No tech leader',
          key_champion_left: 'Champion left',
          never_responded: 'Never responded',
          timing_seasonal: 'Timing / seasonal',
        };
        return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#FFFAF0;color:#744210;border:1px solid #FBD38D;" title="${BR_LABELS[val] || val}">${BR_LABELS[val] || val}</span>`;
      }
      case 'date': return shortDate(val);
      case 'date_ov': {
        const d = shortDate(val);
        if (!org.is_manual_date) return d;
        return `<span title="${org.override_notes || 'Manual override'}" style="color:#805AD5;font-weight:600;">${d} ✏</span>`;
      }
      case 'num': return val != null ? fmt(val) : '<span style="color:#A0AEC0">-</span>';
      case 'dollar': return val != null ? fmtDollar(val) : '<span style="color:#A0AEC0">-</span>';
      case 'num_heat': {
        if (val == null) return '<span style="color:#A0AEC0">-</span>';
        const color = val > 60 ? COLORS.red : val > 30 ? COLORS.orange : COLORS.green;
        return `<span style="font-weight:600;color:${color}">${fmt(val)}d</span>`;
      }
      default: return val != null ? String(val) : '<span style="color:#A0AEC0">-</span>';
    }
  }

  function setupTTLPersistButton() {
    const btn = document.getElementById('ttl-btn-persist');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/ttl/overrides/export');
        const json = await res.text();
        await navigator.clipboard.writeText(json);
        btn.textContent = '✅ Copied!';
        btn.style.background = '#C6F6D5';
        setTimeout(() => {
          btn.textContent = '💾 Save overrides';
          btn.style.background = '#F0FFF4';
        }, 2500);
      } catch (e) {
        // Fallback: open the export URL
        window.open('/api/ttl/overrides/export', '_blank');
      }
    });
  }

  function setupTTLRefresh() {
    const btn = $('#ttl-btn-refresh');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Refreshing...';
      try {
        await fetch('/api/time-to-launch/refresh', { method: 'POST' });
        TTL_DATA = null;
        ttlFiltersReady = false;
        await loadTTLData();
      } finally {
        btn.disabled = false;
        btn.innerHTML = '&#x27F3; Refresh';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // TTL Org Override Modal
  // ---------------------------------------------------------------------------
  let _ttlOverrideOrgId = null;

  function openTTLOverrideModal(orgId) {
    const org = TTL_DATA && TTL_DATA.orgs.find(o => o.organization_id === orgId);
    if (!org) return;
    _ttlOverrideOrgId = orgId;
    $('#ttl-override-orgname').textContent = `Org #${orgId}: ${org.organization_name}`;
    $('#ttl-ov-hidden').checked = false;  // hidden orgs never show in modal; this is for fresh hides
    $('#ttl-ov-lost').checked = !!org.is_lost;
    const v1El = $('#ttl-ov-v1');
    if (v1El) v1El.checked = !!org.is_v1_migration;
    const brEl = $('#ttl-ov-block-reason');
    if (brEl) brEl.value = org.block_reason || '';
    $('#ttl-ov-date').value = org.is_manual_date ? (org.active_billing_date || '').slice(0, 10) : '';
    $('#ttl-ov-notes').value = org.override_notes || '';
    const backdrop = $('#ttl-override-backdrop');
    backdrop.style.display = 'flex';
  }

  function closeTTLOverrideModal() {
    $('#ttl-override-backdrop').style.display = 'none';
    _ttlOverrideOrgId = null;
  }

  async function saveTTLOverride(clear = false) {
    if (!_ttlOverrideOrgId) return;
    const org = TTL_DATA.orgs.find(o => o.organization_id === _ttlOverrideOrgId);
    if (!org) { closeTTLOverrideModal(); return; }

    if (clear) {
      await fetch(`/api/ttl/overrides/${_ttlOverrideOrgId}`, { method: 'DELETE' });
      // Restore org to unoverridden state locally
      org.is_manual_date = false;
      org.override_notes = null;
    } else {
      const hidden = $('#ttl-ov-hidden').checked;
      const lostChecked = ($('#ttl-ov-lost') || {}).checked || false;
      const v1Migration = ($('#ttl-ov-v1') || {}).checked || false;
      const blockReason = ($('#ttl-ov-block-reason') || {}).value || null;
      const manualDate = $('#ttl-ov-date').value || null;
      const notes = $('#ttl-ov-notes').value;
      const body = { org_id: _ttlOverrideOrgId, org_name: org.organization_name, hidden, lost: lostChecked, is_v1_migration: v1Migration, block_reason: blockReason, manual_billing_date: manualDate, notes };
      const res = await fetch('/api/ttl/overrides', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.export_hint) console.info('[TTL] Paste into TTL_OVERRIDES_JSON on Render:\n', json.export_hint);

      if (hidden) {
        // Remove org from local data immediately — no reload needed
        TTL_DATA.orgs = TTL_DATA.orgs.filter(o => o.organization_id !== _ttlOverrideOrgId);
        TTL_DATA.summary.total = TTL_DATA.orgs.length;
      } else {
        // Update org fields locally
        org.override_notes = notes || null;
        org.is_v1_migration = v1Migration;
        org.block_reason = blockReason || null;
        // Handle lost toggle
        const wasLost = org.is_lost;
        org.is_lost = lostChecked;
        if (lostChecked && !wasLost) {
          org.is_launched = false;
          org.days_in_onboarding = null;
          TTL_DATA.summary.lost = (TTL_DATA.summary.lost || 0) + 1;
          TTL_DATA.summary.in_onboarding = Math.max(0, TTL_DATA.summary.in_onboarding - 1);
        } else if (!lostChecked && wasLost) {
          TTL_DATA.summary.lost = Math.max(0, (TTL_DATA.summary.lost || 0) - 1);
        }
        if (manualDate) {
          const createdMs = org.organization_created_at ? new Date(org.organization_created_at).getTime() : null;
          const billingMs = new Date(manualDate).getTime();
          org.active_billing_date = manualDate;
          org.is_manual_date = true;
          org.is_launched = true;
          org.is_lost = false;  // a manual billing date means they launched
          org.days_to_launch = createdMs ? Math.round((billingMs - createdMs) / 86400000) : null;
          org.days_in_onboarding = null;
        }
      }
    }

    closeTTLOverrideModal();
    // Re-filter and re-render locally — no server roundtrip needed
    applyTTLFilters();
    renderTTL();
  }

  function setupTTLOverrideModal() {
    const backdrop = $('#ttl-override-backdrop');
    if (!backdrop) return;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeTTLOverrideModal(); });
    $('#ttl-ov-cancel').addEventListener('click', closeTTLOverrideModal);
    $('#ttl-ov-save').addEventListener('click', () => saveTTLOverride(false));
    $('#ttl-ov-clear').addEventListener('click', () => saveTTLOverride(true));
  }

  function setupTTLExport() {
    const btn = $('#ttl-btn-export');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const exportCols = TTL_COLS.filter(c => c.type !== 'actions' && c.type !== 'check');
      const header = exportCols.map(c => c.label || c.key).join(',');
      const rows = ttlFiltered.map(o =>
        exportCols.map(c => {
          if (c.key === 'is_launched') return o.is_lost ? 'Lost' : o.is_launched ? 'Launched' : 'In Onboarding';
          if (c.type === 'dollar') return v != null ? v : '';
          let v = o[c.key];
          if (v == null) return '';
          if (c.type === 'date' || c.type === 'date_ov') return shortDate(v);
          if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
          return v;
        }).join(',')
      );
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `time-to-launch-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ---------------------------------------------------------------------------
  // Shared chart factory
  // ---------------------------------------------------------------------------
  function makeChart(canvasId, type, data, extraOpts = {}) {
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const opts = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { datalabels: { display: false }, ...(extraOpts.plugins || {}) },
      scales: type === 'doughnut' || type === 'pie' ? undefined : {
        x: { grid: { color: 'rgba(226,232,240,0.5)' } },
        y: { grid: { color: 'rgba(226,232,240,0.5)' } },
        ...(extraOpts.scales || {})
      },
      ...extraOpts,
    };
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

  document.addEventListener('DOMContentLoaded', init);
}());
