const express = require('express');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password123@postgres:5432/notes_db'
});

pool.query('SELECT 1', (err) => {
  if (err) {
    console.error("FATAL DB ERROR:", err.message);
    process.exit(1);
  }
  console.log("Database connection established successfully.");
});

// --- Prometheus Metrics ---
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['route', 'method', 'status', 'tenant'],
  registers: [register]
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['route', 'method', 'tenant'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

const dbQueryDurationSeconds = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query_name'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register]
});

const dbQueriesPerRequest = new client.Histogram({
  name: 'db_queries_per_request',
  help: 'Number of database queries executed per HTTP request',
  labelNames: ['route'],
  buckets: [1, 2, 5, 10, 20, 25, 50, 100],
  registers: [register]
});

const dbRowsReturned = new client.Histogram({
  name: 'db_rows_returned',
  help: 'Number of rows returned by query',
  labelNames: ['query_name'],
  buckets: [1, 10, 20, 50, 100, 500, 1000, 5000, 10000],
  registers: [register]
});

const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Current in-flight HTTP requests',
  registers: [register]
});

async function trackedQuery(queryName, text, params, req) {
  const start = process.hrtime();
  try {
    const res = await pool.query(text, params);
    const duration = process.hrtime(start);
    const seconds = duration[0] + duration[1] / 1e9;
    dbQueryDurationSeconds.labels(queryName).observe(seconds);
    dbRowsReturned.labels(queryName).observe(res.rowCount || 0);
    if (req) req.dbQueryCount = (req.dbQueryCount || 0) + 1;
    return res;
  } catch (err) {
    const duration = process.hrtime(start);
    const seconds = duration[0] + duration[1] / 1e9;
    dbQueryDurationSeconds.labels(queryName).observe(seconds);
    throw err;
  }
}

app.use((req, res, next) => {
  if (['/metrics', '/healthz', '/readyz'].includes(req.path)) return next();
  httpRequestsInFlight.inc();
  req.dbQueryCount = 0;
  const start = process.hrtime();

  res.on('finish', () => {
    httpRequestsInFlight.dec();
    const duration = process.hrtime(start);
    const seconds = duration[0] + duration[1] / 1e9;

    let route = req.baseUrl + (req.route ? req.route.path : req.path);
    if (req.path.match(/^\/api\/notes\/\d+$/)) {
      route = '/api/notes/:id';
    }

    const tenant = req.headers['x-tenant'] || 'unknown';
    const status = res.statusCode.toString();

    httpRequestsTotal.labels(route, req.method, status, tenant).inc();
    httpRequestDurationSeconds.labels(route, req.method, tenant).observe(seconds);
    dbQueriesPerRequest.labels(route).observe(req.dbQueryCount || 0);
  });

  next();
});

app.use(async (req, res, next) => {
  if (['/healthz', '/readyz', '/metrics'].includes(req.path)) return next();
  const slug = req.headers['x-tenant'];
  if (!slug) return res.status(400).json({ error: 'Missing X-Tenant header' });

  try {
    const tenantRes = await trackedQuery('select_tenant', 'SELECT id FROM tenants WHERE slug = $1', [slug], req);
    if (tenantRes.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    req.tenantId = tenantRes.rows[0].id;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/healthz', (req, res) => res.status(200).send('OK\n'));
app.get('/readyz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).send('READY\n');
  } catch (err) {
    res.status(500).send('NOT READY\n');
  }
});

app.get('/api/notes', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  try {
    const notes = await trackedQuery('select_notes_list', 'SELECT * FROM notes WHERE tenant_id = $1 LIMIT $2', [req.tenantId, limit], req);
    for (const note of notes.rows) {
      const tags = await trackedQuery('select_note_tags', 'SELECT name FROM tags WHERE note_id = $1', [note.id], req);
      note.tags = tags.rows.map(t => t.name);
    }
    res.json(notes.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notes/:id', async (req, res) => {
  try {
    const result = await trackedQuery('select_single_note', 'SELECT * FROM notes WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId], req);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notes', async (req, res) => {
  const { title, body } = req.body;
  try {
    const result = await trackedQuery('insert_note', 'INSERT INTO notes (tenant_id, title, body) VALUES ($1, $2, $3) RETURNING *', [req.tenantId, title, body], req);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  try {
    const result = await trackedQuery('search_notes_body', "SELECT * FROM notes WHERE tenant_id = $1 AND body LIKE '%' || $2 || '%'", [req.tenantId, q], req);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const query = `
      SELECT t.slug, COUNT(DISTINCT n.id) AS note_count, COUNT(tg.id) AS tag_count
      FROM tenants t
      LEFT JOIN notes n ON t.id = n.tenant_id
      LEFT JOIN tags tg ON n.id = tg.note_id
      WHERE t.id = $1
      GROUP BY t.slug
    `;
    const result = await trackedQuery('calculate_tenant_stats', query, [req.tenantId], req);
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Notes API running on port ${PORT}`));
