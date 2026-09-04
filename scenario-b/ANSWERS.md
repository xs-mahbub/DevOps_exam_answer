# Scenario B3 - Instrumentation, Prometheus and Grafana Answers
**Exam Token:** root-vmi3536696-1788282556-1536d427

---

## Task 32 — Grafana Dashboard Analysis

### Panel A — Top 5 Slowest Endpoints by p95 Latency
* **PromQL:**
  `topk(5, histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[2m])) by (le, route)))`
* **Slowest Endpoint:** `/api/notes` (with large limits) and `/api/search`.

### Panel B — Endpoint Consuming Most TOTAL Time
* **PromQL:**
  `topk(5, sum(rate(http_request_duration_seconds_sum[2m])) by (route))`
* **Winning Endpoint:** `/api/notes`
* **Explanation (Panel A vs Panel B):**
  * Panel A measures individual request latency (the slow tail per hit).
  * Panel B measures total cumulative execution time (request duration multiplied by request volume).
  * Why they differ: An unindexed search query might take 200ms but only run once a minute. Conversely, `/api/notes` takes ~50-100ms due to the N+1 queries, but is called constantly across multiple workers. Therefore, `/api/notes` wins Panel B because high call volume multiplied by moderate latency consumes the vast majority of server CPU time.

### Panel C — Average and p99 DB Query Duration by Query Name
* **PromQL (Average):**
  `sum(rate(db_query_duration_seconds_sum[2m])) by (query_name) / sum(rate(db_query_duration_seconds_count[2m])) by (query_name)`
* **PromQL (p99):**
  `histogram_quantile(0.99, sum(rate(db_query_duration_seconds_bucket[2m])) by (le, query_name))`

### Panel D — The Slowest Single Query vs Frequency
* **PromQL (p99 Duration):**
  `histogram_quantile(0.99, sum(rate(db_query_duration_seconds_bucket[2m])) by (le, query_name))`
* **PromQL (Execution Rate):**
  `sum(rate(db_query_duration_seconds_count[2m])) by (query_name)`
* **Analysis:**
  * Slowest query: `search_notes_body` (unindexed sequential scan on table `notes`).
  * Most frequent: `select_note_tags` (runs N times for every note fetched in `/api/notes`).
  * The slowest query is NOT the most frequent query.

### Panel E — The N+1 Detector
* **PromQL:**
  `histogram_quantile(0.95, sum(rate(db_queries_per_request_bucket[2m])) by (le, route))`
* **Observation:**
  * Typical endpoints (`/api/search`, `/api/notes/:id`, `/api/stats`) execute only 1 to 2 DB queries per request.
  * `/api/notes` executes ~21 queries per request (1 query for 20 notes + 20 individual tag queries), clearly demonstrating the N+1 problem.

### Panel F — Harmful Queries Over Time (>50ms)
* **PromQL:**
  `sum(rate(db_query_duration_seconds_count[2m])) by (query_name) - sum(rate(db_query_duration_seconds_bucket{le="0.05"}[2m])) by (query_name)`
* **Threshold Justification (50ms):**
  * Baseline database queries (`select_tenant`, single row lookups) complete within 1ms to 5ms.
  * 50ms is more than 10x the normal baseline latency, representing pathological operations such as full table sequential scans or heavy connection contention.

### Panel G — Rows Returned Distribution
* **PromQL:**
  `histogram_quantile(0.95, sum(rate(db_rows_returned_bucket[2m])) by (le, query_name))`
* **Mitigation:**
  * Set a maximum hard limit (e.g., `100` rows).
  * If a client requests more than the limit (`?limit=5000`), the API should either reject it with `HTTP 400 Bad Request` or clamp it to 100 and require pagination (cursor-based or offset).

### Panel H — Error Rate and Latency by Tenant
* **PromQL (p95 Latency):**
  `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[2m])) by (le, tenant))`
* **PromQL (5xx Errors):**
  `sum(rate(http_requests_total{status=~"5.."}[2m])) by (tenant)`
* **Analysis:**
  * Tenant `umbrella` exhibits severe latency spikes compared to other tenants.
  * Reason: Umbrella sent requests asking for 5,000 rows (`?limit=5000`), forcing the database to run 5,000 tag queries and transfer huge payloads, proving that heavy requests caused the degradation rather than tenant data size.

### Panel I — Saturation: In-Flight Requests vs Latency
* **PromQL (In-Flight):** `http_requests_in_flight`
* **PromQL (p95 Latency):** `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[2m])) by (le))`
* **Bottleneck Analysis:**
  * Latency spikes directly coincide with the concurrency burst (in-flight surge).
  * Node.js is single-threaded and the Postgres connection pool is bounded; high concurrency leads to immediate event loop and connection pool queueing delays.
