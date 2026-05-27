/**
 * Protiv CS Dashboard — Express Server
 * Simple password auth (no Google OAuth needed)
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const axios = require('axios');
const { fetchCard } = require('./lib/metabase');
const { buildDashboardData } = require('./lib/transforms');

// ---------------------------------------------------------------------------
// Stripe API client (optional — only active if STRIPE_SECRET_KEY is set)
// ---------------------------------------------------------------------------
const stripeClient = process.env.STRIPE_SECRET_KEY
  ? axios.create({
      baseURL: 'https://api.stripe.com/v1',
      timeout: 15000,
      headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` }
    })
  : null;

async function getStripeBilledUsersForSub(subId) {
  if (!stripeClient) return null;
  try {
    for (const status of ['draft', 'paid']) {
      const res = await stripeClient.get('/invoices', {
        params: { subscription: subId, status, limit: 1 }
      });
      const invoice = res.data?.data?.[0];
      if (!invoice) continue;
      const linesRes = await stripeClient.get(`/invoices/${invoice.id}/lines`, {
        params: { limit: 100 }
      });
      const lines = linesRes.data?.data || [];
      const usageLine = lines.find(l =>
        (l.price?.metadata?.type === 'usage') ||
        (l.plan?.metadata?.type === 'usage')
      );
      if (usageLine?.quantity != null) return usageLine.quantity;
    }
    return null;
  } catch (err) {
    console.warn(`[Stripe] Failed for ${subId}: ${err.message}`);
    return null;
  }
}

async function fetchStripeBilledUsers(subIds) {
  if (!stripeClient || !subIds.length) return {};
  console.log(`[Stripe] Fetching billed users for ${subIds.length} subscriptions...`);
  const CHUNK = 10;
  const result = {};
  for (let i = 0; i < subIds.length; i += CHUNK) {
    const chunk = subIds.slice(i, i + CHUNK);
    const values = await Promise.all(chunk.map(id => getStripeBilledUsersForSub(id)));
    chunk.forEach((id, idx) => { if (values[idx] != null) result[id] = values[idx]; });
  }
  console.log(`[Stripe] Got billed users for ${Object.keys(result).length}/${subIds.length} subs`);
  return result;
}

const app = express();
const PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "cdn.prod.website-files.com", "data:", "https:"],
      connectSrc: ["'self'"],
    }
  }
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'protiv-cs-dashboard-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === 'true',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ---------------------------------------------------------------------------
// Auth — simple password
// ---------------------------------------------------------------------------
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login');
}

app.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:#E53E3E;margin-bottom:16px;">Incorrect password. Please try again.</p>' : '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Protiv CS Dashboard — Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #FAFBFC; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 48px 40px; width: 100%; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,.06); text-align: center; }
    .login-card img { height: 36px; margin-bottom: 24px; }
    .login-card h1 { font-size: 20px; font-weight: 700; color: #1A202C; margin-bottom: 8px; }
    .login-card p.subtitle { font-size: 14px; color: #718096; margin-bottom: 28px; }
    .login-card input[type="password"] { width: 100%; padding: 12px 16px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 14px; margin-bottom: 16px; font-family: 'Inter', sans-serif; }
    .login-card input[type="password"]:focus { outline: none; border-color: #1DA856; box-shadow: 0 0 0 3px rgba(29,168,86,.15); }
    .login-card button { width: 100%; padding: 12px; background: #1DA856; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Inter', sans-serif; }
    .login-card button:hover { background: #178a47; }
  </style>
</head>
<body>
  <div class="login-card">
    <img src="https://cdn.prod.website-files.com/66671f410e61d3c1e56a316c/666d3282383f46e4eb62375f_protiv_logo.svg" alt="Protiv">
    <h1>Customer Success Dashboard</h1>
    <p class="subtitle">Enter your team password to continue</p>
    ${error}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Team password" required autofocus>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  return res.redirect('/login?error=1');
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ name: 'Protiv Team', email: '' });
});

// ---------------------------------------------------------------------------
// Static files (behind auth)
// ---------------------------------------------------------------------------
app.use(requireAuth, express.static(path.join(__dirname, 'public')));

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Data cache
// ---------------------------------------------------------------------------
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

async function fetchDashboardData(force = false) {
  if (!force && cache.data && (Date.now() - cache.timestamp) < CACHE_TTL) {
    return cache.data;
  }

  console.log('[Data] Fetching from Metabase...');
  const [csBilling, bonusesPaid, missingInvites, mtBilling, mtBonuses, mtInvites] = await Promise.all([
    fetchCard(process.env.CARD_CS_BILLING || 71),
    fetchCard(process.env.CARD_BONUSES_PAID || 74),
    fetchCard(process.env.CARD_MISSING_INVITES || 73),
    fetchCard(process.env.CARD_CS_BILLING_MT || 77),
    fetchCard(process.env.CARD_BONUSES_PAID_MT || 78),
    fetchCard(process.env.CARD_MISSING_INVITES_MT || 76),
  ]);

  console.log(`[Data] Fetched: billing=${csBilling.length}, bonuses=${bonusesPaid.length}, invites=${missingInvites.length}`);
  console.log(`[Data] MT Fetched: billing=${mtBilling.length}, bonuses=${mtBonuses.length}, invites=${mtInvites.length}`);

  const subIds = [...new Set(
    csBilling.filter(r => r.stripe_subscription_id).map(r => r.stripe_subscription_id)
  )];
  const stripeData = await fetchStripeBilledUsers(subIds);

  const data = buildDashboardData(csBilling, bonusesPaid, missingInvites, stripeData);
  const mtData = buildDashboardData(mtBilling, mtBonuses, mtInvites, {});
  const combined = { ...data, mt: mtData };
  cache = { data: combined, timestamp: Date.now() };
  return combined;
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const data = await fetchDashboardData();
    res.json(data);
  } catch (err) {
    console.error('[API] Dashboard error:', err.message);
    res.status(500).json({ error: 'Failed to fetch dashboard data', details: err.message });
  }
});

app.post('/api/refresh', requireAuth, async (req, res) => {
  try {
    const data = await fetchDashboardData(true);
    res.json({ ok: true, org_count: data.orgs.length, generated_at: data.meta.generated_at });
  } catch (err) {
    console.error('[API] Refresh error:', err.message);
    res.status(500).json({ error: 'Failed to refresh data', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// TTL Org Overrides — in-memory store (persisted via TTL_OVERRIDES_JSON env var)
// ---------------------------------------------------------------------------
let ttlOverrides = {};   // keyed by org_id (number)
(function loadOverridesFromEnv() {
  try {
    if (process.env.TTL_OVERRIDES_JSON) {
      const parsed = JSON.parse(process.env.TTL_OVERRIDES_JSON);
      parsed.forEach(o => { if (o.org_id) ttlOverrides[Number(o.org_id)] = o; });
      console.log(`[TTL] Loaded ${Object.keys(ttlOverrides).length} org overrides from env`);
    }
  } catch (e) {
    console.warn('[TTL] Could not parse TTL_OVERRIDES_JSON:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// HubSpot — Time to Launch
// ---------------------------------------------------------------------------
// Pipeline ID can be overridden via HUBSPOT_PIPELINE_ID env var.
// Set HUBSPOT_PIPELINE_ID in Render to the correct "V2 launch" pipeline.
// On first deploy, check server logs for "[HubSpot] Available pipelines:" to find the right ID.
const HS_PIPELINE = process.env.HUBSPOT_PIPELINE_ID || '867839032';
const HS_OWNER_MAP = {
  '1917156077': 'Ryan McCallion',
  '79820034': 'Alexander Skodras',
  '151071591': 'Michael Fortinberry',
  '1587569571': 'Itzel Zeledon',
  '1441641182': 'Joe Cruz',
  '151071828': 'David Franco',
};

async function logHubSpotPipelines(apiKey) {
  try {
    const res = await axios.get('https://api.hubapi.com/crm/v3/pipelines/deals',
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 });
    const pipelines = (res.data.results || []).map(p => `  ${p.id} = "${p.label}"`).join('\n');
    console.log(`[HubSpot] Available pipelines (set HUBSPOT_PIPELINE_ID to the correct one):\n${pipelines}`);
    console.log(`[HubSpot] Currently using pipeline: ${HS_PIPELINE}`);
  } catch (e) {
    console.warn('[HubSpot] Could not list pipelines:', e.message);
  }
}

let _pipelinesLogged = false;
async function fetchHubSpotDeals() {
  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) {
    console.log('[HubSpot] HUBSPOT_API_KEY not set — skipping deal enrichment');
    return { deals: [], stages: {} };
  }
  // Log all pipelines once at startup so we can identify the correct "V2 launch" pipeline ID
  if (!_pipelinesLogged) {
    _pipelinesLogged = true;
    logHubSpotPipelines(apiKey).catch(() => {});
  }
  try {
    const [dealsRes, stagesRes] = await Promise.all([
      axios.post('https://api.hubapi.com/crm/v3/objects/deals/search', {
        filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: HS_PIPELINE }] }],
        properties: ['dealname', 'dealstage', 'hubspot_owner_id', 'createdate', 'number_of_implementation_employees', 'closedate'],
        limit: 200,
      }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 }),
      axios.get(`https://api.hubapi.com/crm/v3/pipelines/deals/${HS_PIPELINE}/stages`,
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
      ).catch(() => ({ data: { results: [] } }))
    ]);
    const stages = {};
    (stagesRes.data.results || []).forEach(s => { stages[s.id] = s.label; });
    console.log(`[HubSpot] Fetched ${(dealsRes.data.results || []).length} deals from pipeline ${HS_PIPELINE}, ${Object.keys(stages).length} stages`);
    return { deals: dealsRes.data.results || [], stages };
  } catch (err) {
    console.warn('[HubSpot] Failed to fetch deals:', err.message);
    return { deals: [], stages: {} };
  }
}

function normalizeCompanyName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\s*\(\d+\)\s*/g, ' ')   // strip (2), (3) deal-duplicate suffixes
    .replace(/[^a-z0-9\s]/g, ' ')
    // Only strip generic legal/filler words — keep industry words for matching signal
    .replace(/\b(llc|inc|ltd|co|corp|company|the|and|of|a|an)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

function matchDealToOrg(orgName, deals) {
  const normOrg = normalizeCompanyName(orgName);
  if (!normOrg || normOrg.length < 3) return null;

  // Pass 1: exact match after normalization
  for (const deal of deals) {
    if (normalizeCompanyName(deal.properties.dealname) === normOrg) return deal;
  }

  // Pass 2: substring containment — one fully contains the other (both ≥5 chars)
  for (const deal of deals) {
    const dealNorm = normalizeCompanyName(deal.properties.dealname);
    if (dealNorm.length >= 5 && normOrg.length >= 5) {
      if (dealNorm.includes(normOrg) || normOrg.includes(dealNorm)) return deal;
    }
  }

  // Pass 3: significant word overlap
  // Require ≥1 word of ≥5 chars, OR ≥2 words of ≥4 chars
  const orgWords4 = new Set(normOrg.split(' ').filter(w => w.length >= 4));
  const orgWords5 = new Set(normOrg.split(' ').filter(w => w.length >= 5));
  if (orgWords4.size === 0) return null;

  let bestMatch = null, bestScore = 0;
  for (const deal of deals) {
    const dealNorm = normalizeCompanyName(deal.properties.dealname);
    const dealWords = dealNorm.split(' ');
    const common4 = dealWords.filter(w => w.length >= 4 && orgWords4.has(w));
    const common5 = dealWords.filter(w => w.length >= 5 && orgWords5.has(w));
    // Score: prioritize longer word matches
    const score = common5.length >= 1 ? common5.length * 10 + common4.length
                : common4.length >= 2 ? common4.length
                : 0;
    if (score > bestScore) { bestScore = score; bestMatch = deal; }
  }
  return bestScore > 0 ? bestMatch : null;
}

function buildTTLData(orgs, deals, stages, overrides = {}, fathomCounts = {}) {
  const now = Date.now();

  const enriched = orgs.map(org => {
    const ov = overrides[org.organization_id] || {};

    // Skip orgs marked hidden in overrides
    if (ov.hidden) return null;

    const isLost = !!ov.lost;  // lost = paid impl fee, never launched, churned
    const isV1Migration = !!ov.is_v1_migration;  // transitioning from Protiv v1 — excluded from new-customer metrics by default

    // Derive company_size from active_user_count (same logic as transforms.js)
    const activeUsers = Number(org.active_user_count) || 0;
    const companySize = activeUsers <= 10 ? '1–10'
      : activeUsers <= 25 ? '11–25'
      : activeUsers <= 50 ? '26–50'
      : activeUsers <= 100 ? '51–100' : '100+';

    // Estimated billable (pre-launch uses active_user_count; post-launch uses snapshot)
    const estimatedBillable = Number(org.latest_snapshot_billable_users) || Number(org.active_user_count) || null;

    // Onboarding fee (stored in cents in Metabase)
    const onboardingFee = org.onboarding_fee_amount_cents
      ? Math.round(Number(org.onboarding_fee_amount_cents) / 100) : null;

    // Estimated MRR ($20/user)
    const estimatedMrr = estimatedBillable ? estimatedBillable * 20 : null;

    const createdAt = org.organization_created_at ? new Date(org.organization_created_at).getTime() : null;
    // Use manual billing date from override if set, otherwise use Metabase value
    const rawBillingDate = ov.manual_billing_date || org.active_billing_date;
    const billingDate = rawBillingDate ? new Date(rawBillingDate).getTime() : null;
    const isLaunched = !!billingDate && !isLost;  // lost orgs are treated as not launched
    const daysToLaunch = (isLaunched && createdAt) ? Math.round((billingDate - createdAt) / 86400000) : null;
    // In-onboarding days only applies to orgs actively being onboarded (not lost)
    const daysInOnboarding = (!isLaunched && !isLost && createdAt) ? Math.round((now - createdAt) / 86400000) : null;

    const deal = matchDealToOrg(org.organization_name, deals);
    const dealCreated = deal ? new Date(deal.properties.createdate).getTime() : null;
    const dealToOrgDays = (deal && dealCreated && createdAt) ? Math.round(Math.abs(dealCreated - createdAt) / 86400000) : null;

    return {
      organization_id: org.organization_id,
      organization_name: org.organization_name,
      organization_created_at: org.organization_created_at,
      active_billing_date: rawBillingDate,
      subscription_status: org.subscription_status,
      active_user_count: org.active_user_count,
      company_size: companySize,
      estimated_billable: estimatedBillable,
      onboarding_fee: onboardingFee,
      estimated_mrr: estimatedMrr,
      integrations: org.integrations,
      is_launched: isLaunched,
      days_to_launch: daysToLaunch,
      days_in_onboarding: daysInOnboarding,
      hs_owner: deal ? (HS_OWNER_MAP[deal.properties.hubspot_owner_id] || deal.properties.hubspot_owner_id || 'Unknown') : null,
      hs_deal_created: deal ? deal.properties.createdate : null,
      hs_stage: deal ? (stages[deal.properties.dealstage] || deal.properties.dealstage) : null,
      hs_employees: deal && deal.properties.number_of_implementation_employees
        ? parseInt(deal.properties.number_of_implementation_employees) : null,
      deal_to_org_days: dealToOrgDays,
      hs_matched: !!deal,
      // Override metadata (shown in UI)
      is_lost: isLost,
      is_v1_migration: isV1Migration,
      block_reason: ov.block_reason || null,
      is_manual_date: !!ov.manual_billing_date,
      override_notes: ov.notes || null,
      // Fathom lookup: try org name first, then matched deal name (since Fathom CRM matches use HS company names)
      fathom_meetings: fathomCounts[normalizeCompanyName(org.organization_name)]
        || (deal ? fathomCounts[normalizeCompanyName(deal.properties.dealname)] : null)
        || null,
    };
  }).filter(Boolean);  // remove hidden orgs

  enriched.sort((a, b) => {
    if (a.is_launched && !b.is_launched) return 1;
    if (!a.is_launched && b.is_launched) return -1;
    return (b.days_in_onboarding || 0) - (a.days_in_onboarding || 0);
  });

  const launched = enriched.filter(o => o.is_launched);
  const lost = enriched.filter(o => o.is_lost);
  const inOnboarding = enriched.filter(o => !o.is_launched && !o.is_lost);
  const launchTimes = launched.filter(o => o.days_to_launch != null && o.days_to_launch >= 0).map(o => o.days_to_launch);
  const onboardingDays = inOnboarding.filter(o => o.days_in_onboarding != null).map(o => o.days_in_onboarding);

  const avgLaunch = launchTimes.length ? Math.round(launchTimes.reduce((a, b) => a + b, 0) / launchTimes.length) : null;
  const sortedLT = [...launchTimes].sort((a, b) => a - b);
  const mid = Math.floor(sortedLT.length / 2);
  const medLaunch = sortedLT.length
    ? (sortedLT.length % 2 ? sortedLT[mid] : Math.round((sortedLT[mid - 1] + sortedLT[mid]) / 2))
    : null;
  const avgOpen = onboardingDays.length ? Math.round(onboardingDays.reduce((a, b) => a + b, 0) / onboardingDays.length) : null;
  const longestOpen = onboardingDays.length ? Math.max(...onboardingDays) : null;

  const agingBuckets = [
    { label: '0-14d', count: 0 }, { label: '15-30d', count: 0 },
    { label: '31-60d', count: 0 }, { label: '61-90d', count: 0 }, { label: '90d+', count: 0 },
  ];
  inOnboarding.forEach(o => {
    const d = o.days_in_onboarding || 0;
    if (d <= 14) agingBuckets[0].count++;
    else if (d <= 30) agingBuckets[1].count++;
    else if (d <= 60) agingBuckets[2].count++;
    else if (d <= 90) agingBuckets[3].count++;
    else agingBuckets[4].count++;
  });

  const launchDist = [
    { label: '0-14d', count: 0 }, { label: '15-30d', count: 0 },
    { label: '31-60d', count: 0 }, { label: '61-90d', count: 0 }, { label: '90d+', count: 0 },
  ];
  launched.forEach(o => {
    const d = o.days_to_launch || 0;
    if (d <= 14) launchDist[0].count++;
    else if (d <= 30) launchDist[1].count++;
    else if (d <= 60) launchDist[2].count++;
    else if (d <= 90) launchDist[3].count++;
    else launchDist[4].count++;
  });

  const ownerMap = {};
  enriched.forEach(o => {
    const owner = o.hs_owner || 'Unassigned';
    if (!ownerMap[owner]) ownerMap[owner] = { owner, launched: 0, lost: 0, in_onboarding: 0, days_sum: 0, days_count: 0 };
    if (o.is_launched) {
      ownerMap[owner].launched++;
      if (o.days_to_launch != null) { ownerMap[owner].days_sum += o.days_to_launch; ownerMap[owner].days_count++; }
    } else if (o.is_lost) {
      ownerMap[owner].lost++;
    } else {
      ownerMap[owner].in_onboarding++;
    }
  });
  const byOwner = Object.values(ownerMap).map(o => ({
    owner: o.owner,
    launched: o.launched,
    lost: o.lost,
    in_onboarding: o.in_onboarding,
    avg_days: o.days_count ? Math.round(o.days_sum / o.days_count) : null,
  })).sort((a, b) => b.in_onboarding - a.in_onboarding);

  return {
    orgs: enriched,
    summary: {
      total: enriched.length,
      launched: launched.length,
      lost: lost.length,
      in_onboarding: inOnboarding.length,
      // Launch rate: launched / (launched + lost + in_onboarding) — excludes nothing, shows true conversion
      pct_launched: enriched.length ? Math.round(launched.length / enriched.length * 100) : 0,
      pct_lost: enriched.length ? Math.round(lost.length / enriched.length * 100) : 0,
      avg_days_to_launch: avgLaunch,
      median_days_to_launch: medLaunch,
      avg_days_open: avgOpen,
      longest_open: longestOpen,
      v1_migrations: enriched.filter(o => o.is_v1_migration).length,
      hs_matched: enriched.filter(o => o.hs_matched).length,
      fathom_matched: enriched.filter(o => o.fathom_meetings != null).length,
    },
    aging_buckets: agingBuckets,
    launch_dist: launchDist,
    by_owner: byOwner,
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fathom — meeting counts per org
// ---------------------------------------------------------------------------
async function fetchFathomMeetingsRaw() {
  const apiKey = process.env.FATHOM_API_KEY;
  if (!apiKey) {
    console.log('[Fathom] FATHOM_API_KEY not set — skipping meeting counts');
    return [];
  }
  const allMeetings = [];
  let cursor = null;
  let pageCount = 0;
  const MAX_PAGES = 15;  // 15 pages × up to 100/page = up to 1,500 meetings
  do {
    const params = new URLSearchParams({ calendar_invitees_domains_type: 'one_or_more_external', include_crm_matches: 'true', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const res = await axios.get(`https://api.fathom.ai/external/v1/meetings?${params}`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: 15000,
    });
    const items = res.data.items || [];
    allMeetings.push(...items);
    cursor = res.data.next_cursor || null;
    pageCount++;
    if (pageCount >= MAX_PAGES) break;
  } while (cursor);
  console.log(`[Fathom] Fetched ${allMeetings.length} external meetings across ${pageCount} pages`);
  return allMeetings;
}

async function fetchFathomMeetings() {
  try {
    // Hard cap: if Fathom takes >45s total, return whatever we got so far
    return await Promise.race([
      fetchFathomMeetingsRaw(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Fathom fetch timeout')), 45000)),
    ]);
  } catch (err) {
    console.warn('[Fathom] Skipping meeting counts:', err.message);
    return [];
  }
}

// Build a map of normalized-org-name → meeting count
function countFathomMeetingsPerOrg(meetings) {
  const counts = {};
  const bump = (name) => {
    if (!name) return;
    const key = normalizeCompanyName(name);
    if (key.length < 3) return;
    counts[key] = (counts[key] || 0) + 1;
  };

  meetings.forEach(m => {
    // Strategy 1: CRM company matches (HubSpot — most reliable)
    const companies = m.crm_matches?.companies || [];
    if (companies.length > 0) {
      companies.forEach(c => bump(c.name));
      return;
    }

    // Strategy 2: parse meeting title for known patterns
    const title = (m.title || '').replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();  // strip emoji

    // "[Name] at [Company] x Protiv [...]"
    let match = title.match(/at (.+?)\s+[x×]\s+Protiv/i);
    if (match) { bump(match[1].trim()); return; }

    // "[Company] x Protiv [...]"
    match = title.match(/^(.+?)\s+[x×]\s+Protiv/i);
    if (match) { bump(match[1].trim()); return; }

    // "[Company] - Protiv [...]" or "[Company] — Protiv [...]"
    match = title.match(/^(.+?)\s+[-–—]\s+Protiv/i);
    if (match) { bump(match[1].trim()); return; }

    // "Protiv [x/-] [Company]"
    match = title.match(/^Protiv\s+[x×/-]\s+(.+)/i);
    if (match) { bump(match[1].trim()); return; }
  });

  return counts;
}

// Two-layer cache: Fathom meetings (30 min) + TTL data (5 min)
// Fathom cache persists across TTL invalidations so override saves don't re-hit Fathom
let fathomCache = { data: null, ts: 0 };
const FATHOM_CACHE_MS = 30 * 60 * 1000;

let ttlCache = { data: null, ts: 0 };
const TTL_CACHE_MS = 5 * 60 * 1000;

async function getCachedFathomMeetings(forceFathom = false) {
  if (!forceFathom && fathomCache.data && (Date.now() - fathomCache.ts) < FATHOM_CACHE_MS) {
    console.log(`[Fathom] Using cached ${fathomCache.data.length} meetings`);
    return fathomCache.data;
  }
  const meetings = await fetchFathomMeetings();
  fathomCache = { data: meetings, ts: Date.now() };
  return meetings;
}

async function fetchTTL(force = false) {
  if (!force && ttlCache.data && (Date.now() - ttlCache.ts) < TTL_CACHE_MS) {
    return ttlCache.data;
  }
  console.log('[TTL] Fetching Time-to-Launch data...');
  // forceFathom only when explicitly requested (manual Refresh button)
  const [mtBilling, hsData, fathomMeetings] = await Promise.all([
    fetchCard(process.env.CARD_CS_BILLING_MT || 77),
    fetchHubSpotDeals(),
    getCachedFathomMeetings(force),  // only re-fetches Fathom on forced refresh
  ]);
  const fathomCounts = countFathomMeetingsPerOrg(fathomMeetings);
  console.log(`[Fathom] Meeting counts built for ${Object.keys(fathomCounts).length} unique orgs`);
  const data = buildTTLData(mtBilling, hsData.deals, hsData.stages, ttlOverrides, fathomCounts);
  const hiddenCount = Object.values(ttlOverrides).filter(o => o.hidden).length;
  console.log(`[TTL] Built: ${data.summary.total} orgs (${hiddenCount} hidden), ${data.summary.launched} launched, ${data.summary.hs_matched} HS-matched`);
  ttlCache = { data, ts: Date.now() };
  return data;
}

// ---------------------------------------------------------------------------
// TTL Override endpoints (hidden flag + manual billing dates)
// ---------------------------------------------------------------------------
app.get('/api/ttl/overrides', requireAuth, (req, res) => {
  res.json(Object.values(ttlOverrides));
});

// Returns the full JSON string to paste into TTL_OVERRIDES_JSON on Render
app.get('/api/ttl/overrides/export', requireAuth, (req, res) => {
  const json = JSON.stringify(Object.values(ttlOverrides));
  res.type('text/plain').send(json);
});

app.post('/api/ttl/overrides', requireAuth, (req, res) => {
  const { org_id, org_name, hidden, lost, is_v1_migration, block_reason, manual_billing_date, notes } = req.body;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });
  const id = Number(org_id);
  ttlOverrides[id] = {
    org_id: id,
    org_name: org_name || '',
    hidden: !!hidden,
    lost: !!lost,
    is_v1_migration: !!is_v1_migration,
    block_reason: block_reason || null,
    manual_billing_date: manual_billing_date || null,
    notes: notes || '',
    updated_at: new Date().toISOString(),
  };
  ttlCache = { data: null, ts: 0 };  // invalidate cache so next fetch picks it up
  const exportJson = JSON.stringify(Object.values(ttlOverrides));
  console.log(`[TTL] Override saved for org ${id} (${org_name}): hidden=${hidden}, lost=${lost}, v1=${is_v1_migration}, block=${block_reason}`);
  console.log(`[TTL] TTL_OVERRIDES_JSON (paste into Render env var to persist):\n${exportJson}`);
  res.json({ ok: true, override: ttlOverrides[id], export_hint: exportJson });
});

app.delete('/api/ttl/overrides/:org_id', requireAuth, (req, res) => {
  const id = Number(req.params.org_id);
  delete ttlOverrides[id];
  ttlCache = { data: null, ts: 0 };
  res.json({ ok: true });
});

app.get('/api/time-to-launch', requireAuth, async (req, res) => {
  try {
    const data = await fetchTTL();
    res.json(data);
  } catch (err) {
    console.error('[API] TTL error:', err.message);
    res.status(500).json({ error: 'Failed to fetch time-to-launch data', details: err.message });
  }
});

app.post('/api/time-to-launch/refresh', requireAuth, async (req, res) => {
  try {
    const data = await fetchTTL(true);
    res.json({ ok: true, total: data.summary.total, generated_at: data.generated_at });
  } catch (err) {
    console.error('[API] TTL refresh error:', err.message);
    res.status(500).json({ error: 'Failed to refresh time-to-launch data', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Protiv CS Dashboard running on port ${PORT}`);
  if (!DASHBOARD_PASSWORD) {
    console.warn('WARNING: DASHBOARD_PASSWORD is not set.');
  }
});
