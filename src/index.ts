import { handleRestRequest } from "./rest";
import { handleApiRequest } from "./api";

export interface Env {
  DB: D1Database;
  MUSIC: R2Bucket;
  SERVER_NAME?: string;
  SERVER_VERSION?: string;
  MUSIC_FOLDER_NAME?: string;
  R2_BUCKET_NAME?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route Subsonic REST requests (e.g., /rest/getLyrics.view)
    if (path.startsWith("/rest/") || path.startsWith("/rest")) {
      return handleRestRequest(request, env, ctx);
    }

    // Route custom API requests (e.g., /api/ingest)
    if (path.startsWith("/api/") || path.startsWith("/api")) {
      return handleApiRequest(request, env, ctx);
    }

    // Serve static assets or fallback
    if (env.ASSETS) {
      return (env.ASSETS as Fetcher).fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
