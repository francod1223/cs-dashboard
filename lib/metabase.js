/**
 * Metabase API client
 * Fetches card/question results from Metabase using the API key.
 */
const axios = require('axios');

const METABASE_URL = (process.env.METABASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.METABASE_API_KEY || '';

const client = axios.create({
  baseURL: METABASE_URL,
  timeout: 30000,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  }
});

/**
 * Fetch the JSON results of a saved Metabase question (card).
 * @param {string|number} cardId  The Metabase card/question ID
 * @returns {Array<Object>} rows as JSON objects
 */
async function fetchCard(cardId) {
  if (!cardId || cardId === 'CHANGE_ME') {
    console.warn(`Metabase card ID not configured: ${cardId}`);
    return [];
  }
  try {
    const res = await client.post(`/api/card/${cardId}/query/json`);
    return res.data || [];
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    console.error(`Metabase fetch card ${cardId} failed (${status}): ${msg}`);
    throw new Error(`Metabase card ${cardId}: ${msg}`);
  }
}

/**
 * Health check — verify connection to Metabase.
 */
async function ping() {
  try {
    const res = await client.get('/api/health');
    return res.data;
  } catch (err) {
    throw new Error(`Cannot reach Metabase at ${METABASE_URL}`);
  }
}

module.exports = { fetchCard, ping };
