import { ingestObject } from "./ingest";
import { jsonResponse } from "./respond";
import type { Env } from "./types";

// Tag-parsing (ID3/FLAC header decode) is the real CPU cost per file — R2/D1
// calls are I/O and don't count against the free-tier 10ms/request CPU limit.
// Keeping this small leaves headroom even on unusually large/complex files.
const BATCH_SIZE = 15;

interface ReconcileJob {
  id: number;
  r2_cursor: string | null;
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  errors: number;
  last_error: string | null;
  status: string;
  started_at: number;
  updated_at: number;
}

export async function handleReconcile(request: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(request.url);

  if (path === "/api/reconcile/start" && request.method === "POST") {
    const now = Date.now();
    const res = await env.DB.prepare(
      `INSERT INTO reconcile_jobs (r2_cursor, status, started_at, updated_at) VALUES (NULL, 'running', ?, ?)`,
    )
      .bind(now, now)
      .run();
    return jsonResponse({ ok: true, jobId: Number(res.meta.last_row_id) });
  }

  if (path === "/api/reconcile/step" && request.method === "POST") {
    const jobId = Number(url.searchParams.get("jobId"));
    if (!jobId) return jsonResponse({ ok: false, error: "jobId required" }, 400);
    return stepJob(env, jobId);
  }

  if (path === "/api/reconcile/status" && request.method === "GET") {
    const jobId = Number(url.searchParams.get("jobId"));
    if (!jobId) return jsonResponse({ ok: false, error: "jobId required" }, 400);
    const job = await env.DB.prepare("SELECT * FROM reconcile_jobs WHERE id = ?").bind(jobId).first<ReconcileJob>();
    if (!job) return jsonResponse({ ok: false, error: "Job not found" }, 404);
    return jsonResponse({ ok: true, job });
  }

  return jsonResponse({ ok: false, error: "Not found" }, 404);
}

async function stepJob(env: Env, jobId: number): Promise<Response> {
  const job = await env.DB.prepare("SELECT * FROM reconcile_jobs WHERE id = ?").bind(jobId).first<ReconcileJob>();
  if (!job) return jsonResponse({ ok: false, error: "Job not found" }, 404);

  if (job.status === "done") {
    return jsonResponse({ ok: true, done: true, ...job });
  }

  const listing = await env.MUSIC.list({
    cursor: job.r2_cursor || undefined,
    limit: BATCH_SIZE,
  });

  let scanned = job.scanned;
  let added = job.added;
  let updated = job.updated;
  let skipped = job.skipped;
  let errors = job.errors;
  let lastError = job.last_error;

  for (const obj of listing.objects) {
    scanned++;
    const result = await ingestObject(env, obj.key, obj.etag ?? null);
    if (result.status === "added") added++;
    else if (result.status === "updated") updated++;
    else if (result.status === "skipped") skipped++;
    else {
      errors++;
      lastError = `${obj.key}: ${result.error ?? "unknown error"}`;
    }
  }

  const done = !listing.truncated;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE reconcile_jobs SET r2_cursor=?, scanned=?, added=?, updated=?, skipped=?, errors=?, last_error=?, status=?, updated_at=? WHERE id=?`,
  )
    .bind(
      done ? null : listing.cursor ?? null,
      scanned,
      added,
      updated,
      skipped,
      errors,
      lastError,
      done ? "done" : "running",
      now,
      jobId,
    )
    .run();

  return jsonResponse({ ok: true, jobId, done, scanned, added, updated, skipped, errors, lastError });
}
