/**
 * Red-flag evaluation engine for post-launch customers.
 *
 * An org is AT RISK if any of the following are true:
 *   1. Bonuses earned < $1/hour per billable user
 *   2. < 50% of staff are earning any bonuses
 *   3. No bonuses paid in last 30 days
 *   4. No incentives approved in last 30 days
 *   5. 50%+ of billable users do not have an active Protiv account
 */

function safeDiv(a, b) { return b && b !== 0 ? a / b : 0; }

/**
 * Evaluate all red flags for a single org.
 * @param {Object} o  Org record (already merged + derived)
 * @returns {Object}  Flag booleans + count + at_risk
 */
function evaluate(o) {
  // Only post-launch orgs get red flags
  if (o.is_pre_launch) {
    return {
      bonuses_below_1: false,
      low_earning_staff: false,
      no_bonuses_30d: false,
      no_incentives_30d: false,
      missing_accounts: false,
      count: 0,
      at_risk: false
    };
  }

  // Flag 1: Bonuses earned < $1/hour per billable user
  const billableUsers = o.latest_snapshot_billable_users || o.active_user_count || 0;
  const hoursProxy = billableUsers * 160;
  const bonusPerHour = safeDiv(o.total_bonuses_paid_30d, hoursProxy);
  const bonuses_below_1 = billableUsers > 0 && bonusPerHour < 1;

  // Flag 2: < 50% of staff earning bonuses
  const earningRatio = safeDiv(o.unique_paid_people_30d, billableUsers);
  const low_earning_staff = billableUsers > 0 && earningRatio < 0.5;

  // Flag 3: No bonuses paid in last 30 days
  const no_bonuses_30d = (o.total_bonuses_paid_30d || 0) === 0;

  // Flag 4: No incentives approved in last 30 days
  let no_incentives_30d = true;
  if (o.last_incentive_approved_date) {
    const daysSinceApproval = (Date.now() - new Date(o.last_incentive_approved_date).getTime()) / (1000 * 60 * 60 * 24);
    no_incentives_30d = daysSinceApproval > 30;
  }
  if (no_incentives_30d && (o.paid_statements_30d || 0) > 0) {
    no_incentives_30d = false;
  }

  // Flag 5: 50%+ of billable users missing active account
  const totalWorkforce = (o.active_user_count || 0) + (o.needs_invite_count || 0);
  const missingRatio = safeDiv(o.needs_invite_count, totalWorkforce);
  const missing_accounts = totalWorkforce > 0 && missingRatio >= 0.5;

  const flags = [bonuses_below_1, low_earning_staff, no_bonuses_30d, no_incentives_30d, missing_accounts];
  const count = flags.filter(Boolean).length;

  return {
    bonuses_below_1,
    low_earning_staff,
    no_bonuses_30d,
    no_incentives_30d,
    missing_accounts,
    count,
    at_risk: count > 0
  };
}

module.exports = { evaluate };
