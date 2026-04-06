/**
 * Data transformation and normalization layer.
 * Combines the three Metabase reports into a unified dashboard dataset.
 *
 * REAL source report schemas (from Metabase API):
 *
 * CS Support Billing/Activity (card 71):
 *   organization_id, organization_name, organization_created_at,
 *   subscription_created_at, subscription_status, billing_anchor_date,
 *   active_billing_date, onboarding_fee_amount_cents,
 *   latest_snapshot_billable_users, latest_billing_month,
 *   latest_invoice_amount_cents, current_prepaid_balance_cents,
 *   active_user_count, last_pro_pay_approved_at, last_group_approved_at,
 *   last_pro_goal_approved_at, last_statement_paid_at, integrations
 *
 * Bonuses Paid (card 74):
 *   organization_id, organization_name, subscription_status,
 *   total_paid_statements, paid_statements_30d, paid_statements_60d,
 *   unique_paid_people_total, unique_paid_people_30d, unique_paid_people_60d,
 *   total_bonuses_paid, total_bonuses_paid_30d, total_bonuses_paid_60d,
 *   avg_bonus_paid_per_person, avg_bonus_paid_per_person_30d, avg_bonus_paid_per_person_60d,
 *   avg_effective_wage, avg_effective_wage_30d, avg_effective_wage_60d,
 *   avg_base_wage, avg_base_wage_30d, avg_base_wage_60d,
 *   avg_bonus_rate, avg_bonus_rate_30d, avg_bonus_rate_60d,
 *   pay_lift_per_hour, pay_lift_per_hour_30d, pay_lift_per_hour_60d,
 *   pay_lift_pct, pay_lift_pct_30d, pay_lift_pct_60d
 *
 * Missing Invites Required (card 73):
 *   organization_id, organization_name, subscription_status,
 *   active_user_count, identities_tracking_hours_30d,
 *   needs_invite_count, failed_invite_count, pending_invite_count,
 *   total_invite_alert_count
 *
 * Subscription statuses in real data:
 *   billing_started, initial_prepayment_collected, awaiting_initial_prepayment,
 *   inactive, canceled, null
 */

const redflags = require('./redflags');

function safeDiv(a, b) { return b && b !== 0 ? a / b : 0; }
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}
function daysSince(d) {
  if (!d) return null;
  return Math.round((Date.now() - new Date(d)) / (1000 * 60 * 60 * 24));
}
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function num(v) {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function cents(v) { return num(v) / 100; }

const POST_LAUNCH_STATUSES = new Set(['billing_started', 'initial_prepayment_collected']);
const PREPAY_STATUSES = new Set(['initial_prepayment_collected']);
const EXCLUDED_STATUSES = new Set(['canceled']);

function classifyStatus(status) {
  const s = (status || '').toLowerCase().trim();
  return {
    normalized: s || 'unknown',
    is_post_launch: POST_LAUNCH_STATUSES.has(s),
    is_pre_launch: !POST_LAUNCH_STATUSES.has(s) && !EXCLUDED_STATUSES.has(s),
    is_prepay: PREPAY_STATUSES.has(s),
    is_canceled: EXCLUDED_STATUSES.has(s),
  };
}

function mergeReports(csBilling, bonusesPaid, missingInvites) {
  const map = {};
  for (const row of csBilling) {
    const id = row.organization_id;
    if (!id) continue;
    map[id] = {
      organization_id: String(id),
      organization_name: row.organization_name || `Org ${id}`,
      organization_created_at: row.organization_created_at || null,
      subscription_created_at: row.subscription_created_at || null,
      subscription_status: (row.subscription_status || '').toLowerCase().trim(),
      billing_anchor_date: row.billing_anchor_date || null,
      active_billing_date: row.active_billing_date || null,
      onboarding_fee_amount_cents: num(row.onboarding_fee_amount_cents),
      latest_snapshot_billable_users: num(row.latest_snapshot_billable_users),
      latest_billing_month: row.latest_billing_month || null,
      latest_invoice_amount_cents: num(row.latest_invoice_amount_cents),
      current_prepaid_balance_cents: num(row.current_prepaid_balance_cents),
      active_user_count_billing: num(row.active_user_count),
      last_pro_pay_approved_at: row.last_pro_pay_approved_at || null,
      last_group_approved_at: row.last_group_approved_at || null,
      last_pro_goal_approved_at: row.last_pro_goal_approved_at || null,
      last_statement_paid_at: row.last_statement_paid_at || null,
      integrations: row.integrations || null,
    };
  }
  for (const row of bonusesPaid) {
    const id = row.organization_id;
    if (!id) continue;
    if (!map[id]) {
      map[id] = { organization_id: String(id), organization_name: row.organization_name || `Org ${id}`, subscription_status: (row.subscription_status || '').toLowerCase().trim() };
    }
    map[id].total_paid_statements = num(row.total_paid_statements);
    map[id].paid_statements_30d = num(row.paid_statements_30d);
    map[id].paid_statements_60d = num(row.paid_statements_60d);
    map[id].unique_paid_people_total = num(row.unique_paid_people_total);
    map[id].unique_paid_people_30d = num(row.unique_paid_people_30d);
    map[id].unique_paid_people_60d = num(row.unique_paid_people_60d);
    map[id].total_bonuses_paid = num(row.total_bonuses_paid);
    map[id].total_bonuses_paid_30d = num(row.total_bonuses_paid_30d);
    map[id].total_bonuses_paid_60d = num(row.total_bonuses_paid_60d);
    map[id].avg_bonus_paid_per_person = numOrNull(row.avg_bonus_paid_per_person);
    map[id].avg_bonus_paid_per_person_30d = numOrNull(row.avg_bonus_paid_per_person_30d);
    map[id].avg_bonus_paid_per_person_60d = numOrNull(row.avg_bonus_paid_per_person_60d);
    map[id].avg_effective_wage = numOrNull(row.avg_effective_wage);
    map[id].avg_effective_wage_30d = numOrNull(row.avg_effective_wage_30d);
    map[id].avg_effective_wage_60d = numOrNull(row.avg_effective_wage_60d);
    map[id].avg_base_wage = numOrNull(row.avg_base_wage);
    map[id].avg_base_wage_30d = numOrNull(row.avg_base_wage_30d);
    map[id].avg_base_wage_60d = numOrNull(row.avg_base_wage_60d);
    map[id].avg_bonus_rate = numOrNull(row.avg_bonus_rate);
    map[id].avg_bonus_rate_30d = numOrNull(row.avg_bonus_rate_30d);
    map[id].avg_bonus_rate_60d = numOrNull(row.avg_bonus_rate_60d);
    map[id].pay_lift_per_hour = numOrNull(row.pay_lift_per_hour);
    map[id].pay_lift_per_hour_30d = numOrNull(row.pay_lift_per_hour_30d);
    map[id].pay_lift_per_hour_60d = numOrNull(row.pay_lift_per_hour_60d);
    map[id].pay_lift_pct = numOrNull(row.pay_lift_pct);
    map[id].pay_lift_pct_30d = numOrNull(row.pay_lift_pct_30d);
    map[id].pay_lift_pct_60d = numOrNull(row.pay_lift_pct_60d);
  }
  for (const row of missingInvites) {
    const id = row.organization_id;
    if (!id) continue;
    if (!map[id]) {
      map[id] = { organization_id: String(id), organization_name: row.organization_name || `Org ${id}`, subscription_status: (row.subscription_status || '').toLowerCase().trim() };
    }
    map[id].active_user_count = num(row.active_user_count);
    map[id].identities_tracking_hours_30d = num(row.identities_tracking_hours_30d);
    map[id].needs_invite_count = num(row.needs_invite_count);
    map[id].failed_invite_count = num(row.failed_invite_count);
    map[id].pending_invite_count = num(row.pending_invite_count);
    map[id].total_invite_alert_count = num(row.total_invite_alert_count);
  }
  return Object.values(map);
}

function deriveOrgFields(raw) {
  const o = { ...raw };
  const cls = classifyStatus(o.subscription_status);
  o.is_post_launch = cls.is_post_launch;
  o.is_pre_launch = cls.is_pre_launch;
  o.is_prepay = cls.is_prepay;
  o.is_canceled = cls.is_canceled;
  o.organization_created_at = parseDate(o.organization_created_at);
  o.subscription_created_at = parseDate(o.subscription_created_at);
  o.billing_anchor_date = parseDate(o.billing_anchor_date);
  o.active_billing_date = parseDate(o.active_billing_date);
  o.last_pro_pay_approved_at = parseDate(o.last_pro_pay_approved_at);
  o.last_group_approved_at = parseDate(o.last_group_approved_at);
  o.last_pro_goal_approved_at = parseDate(o.last_pro_goal_approved_at);
  o.last_statement_paid_at = parseDate(o.last_statement_paid_at);
  o.launch_date = o.active_billing_date || o.billing_anchor_date || null;
  const approvalDates = [o.last_pro_pay_approved_at, o.last_group_approved_at, o.last_pro_goal_approved_at].filter(Boolean).sort().reverse();
  o.last_approved_at = approvalDates[0] || null;
  o.days_since_created = daysSince(o.organization_created_at);
  o.days_to_launch = (o.launch_date && o.organization_created_at) ? daysBetween(o.organization_created_at, o.launch_date) : null;
  o.active_user_count = num(o.active_user_count) || num(o.active_user_count_billing);
  o.identities_tracking_hours_30d = num(o.identities_tracking_hours_30d);
  o.latest_snapshot_billable_users = num(o.latest_snapshot_billable_users);
  o.estimated_billable_users = o.is_pre_launch ? Math.max(o.identities_tracking_hours_30d, o.active_user_count) : o.latest_snapshot_billable_users || o.active_user_count;
  o.estimated_mrr = o.estimated_billable_users * 20;
  o.estimated_arr = o.estimated_mrr * 12;
  o.onboarding_fee_amount = cents(o.onboarding_fee_amount_cents);
  o.latest_invoice_amount = cents(o.latest_invoice_amount_cents);
  o.current_prepaid_balance = cents(o.current_prepaid_balance_cents);
  o.total_paid_statements = num(o.total_paid_statements);
  o.paid_statements_30d = num(o.paid_statements_30d);
  o.paid_statements_60d = num(o.paid_statements_60d);
  o.unique_paid_people_total = num(o.unique_paid_people_total);
  o.unique_paid_people_30d = num(o.unique_paid_people_30d);
  o.unique_paid_people_60d = num(o.unique_paid_people_60d);
  o.total_bonuses_paid = num(o.total_bonuses_paid);
  o.total_bonuses_paid_30d = num(o.total_bonuses_paid_30d);
  o.total_bonuses_paid_60d = num(o.total_bonuses_paid_60d);
  o.avg_bonus_per_person = o.avg_bonus_paid_per_person ?? safeDiv(o.total_bonuses_paid, o.unique_paid_people_total);
  o.avg_bonus_per_person_30d = o.avg_bonus_paid_per_person_30d ?? safeDiv(o.total_bonuses_paid_30d, o.unique_paid_people_30d);
  o.avg_bonus_per_person_60d = o.avg_bonus_paid_per_person_60d ?? safeDiv(o.total_bonuses_paid_60d, o.unique_paid_people_60d);
  const hoursProxy30d = o.identities_tracking_hours_30d * 160;
  o.bonus_per_hour_30d = safeDiv(o.total_bonuses_paid_30d, hoursProxy30d);
  o.avg_effective_wage = numOrNull(o.avg_effective_wage);
  o.avg_effective_wage_30d = numOrNull(o.avg_effective_wage_30d);
  o.avg_base_wage = numOrNull(o.avg_base_wage);
  o.avg_base_wage_30d = numOrNull(o.avg_base_wage_30d);
  o.avg_bonus_rate = numOrNull(o.avg_bonus_rate);
  o.avg_bonus_rate_30d = numOrNull(o.avg_bonus_rate_30d);
  o.pay_lift_per_hour = numOrNull(o.pay_lift_per_hour);
  o.pay_lift_per_hour_30d = numOrNull(o.pay_lift_per_hour_30d);
  o.pay_lift_pct = numOrNull(o.pay_lift_pct);
  o.pay_lift_pct_30d = numOrNull(o.pay_lift_pct_30d);
  o.needs_invite_count = num(o.needs_invite_count);
  o.failed_invite_count = num(o.failed_invite_count);
  o.pending_invite_count = num(o.pending_invite_count);
  o.total_invite_alert_count = num(o.total_invite_alert_count);
  o.incentives_active_30d = o.paid_statements_30d > 0;
  const flags = redflags.evaluate(o);
  o.red_flag_bonuses_below_1 = flags.bonuses_below_1;
  o.red_flag_low_earning_staff = flags.low_earning_staff;
  o.red_flag_no_bonuses_30d = flags.no_bonuses_30d;
  o.red_flag_no_incentives_30d = flags.no_incentives_30d;
  o.red_flag_missing_accounts = flags.missing_accounts;
  o.red_flag_count = flags.count;
  o.at_risk = flags.at_risk;
  const size = o.active_user_count || o.estimated_billable_users;
  if (size <= 10) o.company_size = '1-10';
  else if (size <= 25) o.company_size = '11-25';
  else if (size <= 50) o.company_size = '26-50';
  else if (size <= 100) o.company_size = '51-100';
  else o.company_size = '100+';
  return o;
}

function buildAggregations(orgs) {
  const preLaunch = orgs.filter(o => o.is_pre_launch);
  const postLaunch = orgs.filter(o => o.is_post_launch);
  const launched = orgs.filter(o => o.days_to_launch !== null && o.days_to_launch >= 0);
  const launchTimes = launched.map(o => o.days_to_launch);
  const timeBuckets = [
    { label: '0–14 days', min: 0, max: 14 },
    { label: '15–30 days', min: 15, max: 30 },
    { label: '31–60 days', min: 31, max: 60 },
    { label: '61–100 days', min: 61, max: 100 },
    { label: '100+ days', min: 101, max: Infinity }
  ];
  const launchDistribution = timeBuckets.map(b => {
    const count = launchTimes.filter(d => d >= b.min && d <= b.max).length;
    return { label: b.label, count, pct: Math.round(safeDiv(count, launchTimes.length) * 1000) / 10 };
  });
  const preLaunchDays = preLaunch.map(o => o.days_since_created).filter(d => d !== null);
  const agingCounts = [
    { label: '14+ days', threshold: 14 },
    { label: '30+ days', threshold: 30 },
    { label: '60+ days', threshold: 60 },
    { label: '100+ days', threshold: 100 }
  ].map(b => ({ label: b.label, count: preLaunchDays.filter(d => d >= b.threshold).length, pct: Math.round(safeDiv(preLaunchDays.filter(d => d >= b.threshold).length, preLaunch.length) * 1000) / 10 }));
  const cohortMap = {};
  for (const o of launched) {
    if (!o.organization_created_at) continue;
    const month = o.organization_created_at.substring(0, 7);
    if (!cohortMap[month]) cohortMap[month] = [];
    cohortMap[month].push(o.days_to_launch);
  }
  const launchTrend = Object.entries(cohortMap).sort().map(([month, vals]) => ({ month, avg: Math.round(avg(vals)), median: Math.round(median(vals)), count: vals.length }));
  const preEstBillable = preLaunch.map(o => o.estimated_billable_users);
  const preMRR = preLaunch.map(o => o.estimated_mrr);
  const preARR = preLaunch.map(o => o.estimated_arr);
  const postActual = postLaunch.map(o => o.latest_snapshot_billable_users);
  const postPotential = postLaunch.map(o => Math.max(o.latest_snapshot_billable_users, o.active_user_count + o.needs_invite_count));
  const totalActual = postActual.reduce((a, b) => a + b, 0);
  const totalPotential = postPotential.reduce((a, b) => a + b, 0);
  const inviteAlerts = postLaunch.map(o => o.total_invite_alert_count);
  const orgsWithMissing = postLaunch.filter(o => o.total_invite_alert_count > 0);
  const incentiveActive = postLaunch.filter(o => o.incentives_active_30d);
  const bonusActive30d = postLaunch.filter(o => o.total_bonuses_paid_30d > 0);
  const bp30 = postLaunch.filter(o => o.total_bonuses_paid_30d > 0).map(o => o.total_bonuses_paid_30d);
  const bp60 = postLaunch.filter(o => o.total_bonuses_paid_60d > 0).map(o => o.total_bonuses_paid_60d);
  const bpp30 = postLaunch.filter(o => o.avg_bonus_per_person_30d > 0).map(o => o.avg_bonus_per_person_30d);
  const bpp60 = postLaunch.filter(o => o.avg_bonus_per_person_60d > 0).map(o => o.avg_bonus_per_person_60d);
  const bph30 = postLaunch.filter(o => o.bonus_per_hour_30d > 0).map(o => o.bonus_per_hour_30d);
  const bonusRanked = postLaunch.filter(o => o.avg_bonus_per_person > 0).map(o => ({ org: o.organization_name, id: o.organization_id, value: Math.round(o.avg_bonus_per_person * 100) / 100 })).sort((a, b) => b.value - a.value);
  const pctSize = Math.max(1, Math.ceil(bonusRanked.length * 0.1));
  const launchRanked = launched.map(o => ({ org: o.organization_name, id: o.organization_id, value: o.days_to_launch })).sort((a, b) => a.value - b.value);
  const launchPctSize = Math.max(1, Math.ceil(launchRanked.length * 0.1));
  const missingRanked = postLaunch.filter(o => o.total_invite_alert_count > 0).map(o => ({ org: o.organization_name, id: o.organization_id, value: o.total_invite_alert_count })).sort((a, b) => b.value - a.value);
  const missingPctSize = Math.max(1, Math.ceil(missingRanked.length * 0.1));
  const atRiskOrgs = postLaunch.filter(o => o.at_risk);
  return {
    summary: { total_orgs: orgs.length, pre_launch_count: preLaunch.length, post_launch_count: postLaunch.length, at_risk_count: atRiskOrgs.length },
    pre_launch: {
      time_to_launch: { avg: Math.round(avg(launchTimes)), median: Math.round(median(launchTimes)), distribution: launchDistribution },
      aging: agingCounts,
      launch_trend: launchTrend,
      estimated_billable: { total: preEstBillable.reduce((a, b) => a + b, 0), avg: Math.round(avg(preEstBillable)), median: Math.round(median(preEstBillable)) },
      estimated_revenue: { total_mrr: Math.round(preMRR.reduce((a, b) => a + b, 0)), total_arr: Math.round(preARR.reduce((a, b) => a + b, 0)), avg_mrr: Math.round(avg(preMRR)), avg_arr: Math.round(avg(preARR)), median_mrr: Math.round(median(preMRR)), median_arr: Math.round(median(preARR)) }
    },
    post_launch: {
      billable_users: { total_potential: totalPotential, total_actual: totalActual, gap: totalPotential - totalActual, ratio: Math.round(safeDiv(totalActual, totalPotential) * 1000) / 10 },
      missing_invites: { total: inviteAlerts.reduce((a, b) => a + b, 0), orgs_with_missing: orgsWithMissing.length, avg_per_org: Math.round(avg(inviteAlerts) * 10) / 10 },
      incentive_activity: { active_30d: incentiveActive.length, inactive_30d: postLaunch.length - incentiveActive.length },
      bonus_activity: { paid_30d: bonusActive30d.length, not_paid_30d: postLaunch.length - bonusActive30d.length },
      bonus_performance: {
        last_30d: { total: Math.round(bp30.reduce((a, b) => a + b, 0) * 100) / 100, avg_per_user: Math.round(avg(bpp30) * 100) / 100, median_per_user: Math.round(median(bpp30) * 100) / 100, avg_per_hour: Math.round(avg(bph30) * 100) / 100, median_per_hour: Math.round(median(bph30) * 100) / 100 },
        last_60d: { total: Math.round(bp60.reduce((a, b) => a + b, 0) * 100) / 100, avg_per_user: Math.round(avg(bpp60) * 100) / 100, median_per_user: Math.round(median(bpp60) * 100) / 100 }
      },
      percentiles: { top_bonus_orgs: bonusRanked.slice(0, pctSize), bottom_bonus_orgs: bonusRanked.slice(-pctSize), fastest_launch: launchRanked.slice(0, launchPctSize), slowest_launch: launchRanked.slice(-launchPctSize), top_missing_invites: missingRanked.slice(0, missingPctSize) },
      at_risk: { count: atRiskOrgs.length, pct: Math.round(safeDiv(atRiskOrgs.length, postLaunch.length) * 1000) / 10, by_flag: { bonuses_below_1: postLaunch.filter(o => o.red_flag_bonuses_below_1).length, low_earning_staff: postLaunch.filter(o => o.red_flag_low_earning_staff).length, no_bonuses_30d: postLaunch.filter(o => o.red_flag_no_bonuses_30d).length, no_incentives_30d: postLaunch.filter(o => o.red_flag_no_incentives_30d).length, missing_accounts: postLaunch.filter(o => o.red_flag_missing_accounts).length } }
    },
    filters: { company_sizes: ['1-10', '11-25', '26-50', '51-100', '100+'], subscription_statuses: [...new Set(orgs.map(o => o.subscription_status).filter(Boolean))].sort() }
  };
}

function isTestOrDeleted(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.includes('test') || lower.includes('delete');
}

function buildDashboardData(csBilling, bonusesPaid, missingInvites) {
  const filteredBilling = csBilling.filter(r => !isTestOrDeleted(r.organization_name));
  const filteredBonuses = bonusesPaid.filter(r => !isTestOrDeleted(r.organization_name));
  const filteredInvites = missingInvites.filter(r => !isTestOrDeleted(r.organization_name));
  const merged = mergeReports(filteredBilling, filteredBonuses, filteredInvites);
  const orgs = merged.map(deriveOrgFields).filter(o => !o.is_canceled);
  const aggregations = buildAggregations(orgs);
  return {
    aggregations, orgs,
    meta: { generated_at: new Date().toISOString(), org_count: orgs.length, source_counts: { cs_billing: csBilling.length, bonuses_paid: bonusesPaid.length, missing_invites: missingInvites.length } }
  };
}

module.exports = { buildDashboardData };
