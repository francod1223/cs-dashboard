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
// HubSpot — Time to Launch
// ---------------------------------------------------------------------------
const HS_PIPELINE = '867839032';
const HS_OWNER_MAP = {
  '1917156077': 'Ryan McCallion',
  '79820034': 'Alexander Skodras',
  '151071591': 'Michael Fortinberry',
  '1587569571': 'Itzel Zeledon',
  '1441641182': 'Joe Cruz',
  '151071828': 'David Franco',
};

async function fetchHubSpotDeals() {
  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) {
    console.log('[HubSpot] HUBSPOT_API_KEY not set — skipping deal enrichment');
    return { deals: [], stages: {} };
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
    console.log(`[HubSpot] Fetched ${(dealsRes.data.results || []).length} deals, ${Object.keys(stages).length} stages`);
    return { deals: dealsRes.data.results || [], stages };
  } catch (err) {
    console.warn('[HubSpot] Failed to fetch deals:', err.message);
    return { deals: [], stages: {} };
  }
}

function normalizeCompanyName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(llc|inc|ltd|co|corp|company|the|and|services|group|solutions|design|construction|painting|landscape|landscaping|lawn|care|tree|cleaning|window|roofing|building|builders|management|enterprises|enterprise)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

function matchDealToOrg(orgName, deals) {
  const normOrg = normalizeCompanyName(orgName);
  if (!normOrg) return null;
  for (const deal of deals) {
    if (normalizeCompanyName(deal.properties.dealname) === normOrg) return deal;
  }
  const orgWords = new Set(normOrg.split(' ').filter(w => w.length > 2));
  let bestMatch = null, bestScore = 1;
  for (const deal of deals) {
    const dealNorm = normalizeCompanyName(deal.properties.dealname);
    const dealWords = dealNorm.split(' ').filter(w => w.length > 2);
    const common = dealWords.filter(w => orgWords.has(w));
    if (common.length > bestScore) { bestScore = common.length; bestMatch = deal; }
  }
  return bestScore >= 2 ? bestMatch : null;
}

function buildTTLData(orgs, deals, stages) {
  const now = Date.now();

  const enriched = orgs.map(org => {
    const createdAt = org.organization_created_at ? new Date(org.organization_created_at).getTime() : null;
    const billingDate = org.active_billing_date ? new Date(org.active_billing_date).getTime() : null;
    const isLaunched = !!billingDate;
    const daysToLaunch = (isLaunched && createdAt) ? Math.round((billingDate - createdAt) / 86400000) : null;
    const daysInOnboarding = (!isLaunched && createdAt) ? Math.round((now - createdAt) / 86400000) : null;

    const deal = matchDealToOrg(org.organization_name, deals);
    const dealCreated = deal ? new Date(deal.properties.createdate).getTime() : null;
    const dealToOrgDays = (deal && dealCreated && createdAt) ? Math.round(Math.abs(dealCreated - createdAt) / 86400000) : null;

    return {
      organization_id: org.organization_id,
      organization_name: org.organization_name,
      organization_created_at: org.organization_created_at,
      active_billing_date: org.active_billing_date,
      subscription_status: org.subscription_status,
      active_user_count: org.active_user_count,
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
    };
  });

  enriched.sort((a, b) => {
    if (a.is_launched && !b.is_launched) return 1;
    if (!a.is_launched && b.is_launched) return -1;
    return (b.days_in_onboarding || 0) - (a.days_in_onboarding || 0);
  });

  const launched = enriched.filter(o => o.is_launched);
  const inOnboarding = enriched.filter(o => !o.is_launched);
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
    if (!ownerMap[owner]) ownerMap[owner] = { owner, launched: 0, in_onboarding: 0, days_sum: 0, days_count: 0 };
    if (o.is_launched) {
      ownerMap[owner].launched++;
      if (o.days_to_launch != null) { ownerMap[owner].days_sum += o.days_to_launch; ownerMap[owner].days_count++; }
    } else {
      ownerMap[owner].in_onboarding++;
    }
  });
  const byOwner = Object.values(ownerMap).map(o => ({
    owner: o.owner,
    launched: o.launched,
    in_onboarding: o.in_onboarding,
    avg_days: o.days_count ? Math.round(o.days_sum / o.days_count) : null,
  })).sort((a, b) => b.in_onboarding - a.in_onboarding);

  return {
    orgs: enriched,
    summary: {
      total: enriched.length,
      launched: launched.length,
      in_onboarding: inOnboarding.length,
      pct_launched: enriched.length ? Math.round(launched.length / enriched.length * 100) : 0,
      avg_days_to_launch: avgLaunch,
      median_days_to_launch: medLaunch,
      avg_days_open: avgOpen,
      longest_open: longestOpen,
      hs_matched: enriched.filter(o => o.hs_matched).length,
    },
    aging_buckets: agingBuckets,
    launch_dist: launchDist,
    by_owner: byOwner,
    generated_at: new Date().toISOString(),
  };
}

let ttlCache = { data: null, ts: 0 };
const TTL_CACHE_MS = 5 * 60 * 1000;

async function fetchTTL(force = false) {
  if (!force && ttlCache.data && (Date.now() - ttlCache.ts) < TTL_CACHE_MS) {
    return ttlCache.data;
  }
  console.log('[TTL] Fetching Time-to-Launch data...');
  const [mtBilling, hsData] = await Promise.all([
    fetchCard(process.env.CARD_CS_BILLING_MT || 77),
    fetchHubSpotDeals(),
  ]);
  const data = buildTTLData(mtBilling, hsData.deals, hsData.stages);
  console.log(`[TTL] Built: ${data.summary.total} orgs, ${data.summary.launched} launched, ${data.summary.hs_matched} HS-matched`);
  ttlCache = { data, ts: Date.now() };
  return data;
}

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
