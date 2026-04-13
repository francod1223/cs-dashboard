/**
 * Protiv CS Dashboard Ã¢ÂÂ Express Server
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
// Stripe API client (optional Ã¢ÂÂ only active if STRIPE_SECRET_KEY is set)
// ---------------------------------------------------------------------------
const stripeClient = process.env.STRIPE_SECRET_KEY
  ? axios.create({
      baseURL: 'https://api.stripe.com/v1',
      timeout: 15000,
      headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` }
    })
  : null;

/**
 * For a single subscription, fetch the quantity of billed users from the
 * current open (draft) invoice, falling back to the latest paid invoice.
 * Returns null if no invoice or Stripe key not configured.
 */
async function getStripeBilledUsersForSub(subId) {
  if (!stripeClient) return null;
  try {
    // Try draft invoice first (current open period)
    for (const status of ['draft', 'paid']) {
      const res = await stripeClient.get('/invoices', {
        params: { subscription: subId, status, limit: 1 }
      });
      const invoice = res.data?.data?.[0];
      if (!invoice) continue;

      // Fetch line items for this invoice
      const linesRes = await stripeClient.get(`/invoices/${invoice.id}/lines`, {
        params: { limit: 100 }
      });
      const lines = linesRes.data?.data || [];

      // Find the "usage" line (not excluded_usage) Ã¢ÂÂ $15/user metered line
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

/**
 * Fetch billed user counts for all provided subscription IDs in parallel.
 * Returns { [subId]: quantity } map.
 */
async function fetchStripeBilledUsers(subIds) {
  if (!stripeClient || !subIds.length) return {};
  console.log(`[Stripe] Fetching billed users for ${subIds.length} subscriptions...`);

  // Process in chunks of 10 to stay well within Stripe rate limits
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
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Trust proxy when behind Render/Railway load balancer
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ---------------------------------------------------------------------------
// Auth Ã¢ÂÂ simple password
// ---------------------------------------------------------------------------
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login');
}

// Login page
app.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:#E53E3E;margin-bottom:16px;">Incorrect password. Please try again.</p>' : '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Protiv CS Dashboard Ã¢ÂÂ Login</title>
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
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  // Collect unique Stripe subscription IDs from billing data, then fetch billed quantities
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
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Protiv CS Dashboard running on port ${PORT}`);
  if (!DASHBOARD_PASSWORD) {
    console.warn('WARNING: DASHBOARD_PASSWORD is not set.');
  }
});
