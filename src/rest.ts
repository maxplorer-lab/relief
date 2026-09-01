import { Env } from "./index";
import { TrackRow } from "./catalog";

function str(url: URL, param: string): string | null {
  return url.searchParams.get(param);
}

function parseId(idStr: string | null): { kind: string; n: number } | null {
  if (!idStr) return null;
  const parts = idStr.split("-");
  if (parts.length !== 2) return null;
  const n = parseInt(parts[1], 10);
  return isNaN(n) ? null : { kind: parts[0], n };
}

async function trackById(env: Env, id: number): Promise<TrackRow | null> {
  return await env.DB.prepare("SELECT * FROM tracks WHERE id = ? LIMIT 1")
    .bind(id)
    .first<TrackRow>();
}

function ok(env: Env, fmt: string, data: Record<string, unknown>) {
  const payload = {
    "subsonic-response": {
      status: "ok",
      version: env.SERVER_VERSION || "1.16.1",
      type: env.SERVER_NAME || "Relief",
      serverVersion: env.SERVER_VERSION || "0.2.0",
      openSubsonic: true,
      ...data,
    },
  };

  if (fmt === "json") {
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // XML Fallback representation
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function handleRestRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const actionWithExt = pathParts[pathParts.length - 1] || "";
  const action = actionWithExt.replace(/\.(view|json|xml)$/, "").toLowerCase();
  const fmt = str(url, "f") || "json";

  switch (action) {
    case "ping": {
      return ok(env, fmt, {});
    }

    case "getlyrics": {
      const artist = str(url, "artist") || "";
      const title = str(url, "title") || "";
      let lyricsText = "";

      if (artist && title) {
        const track = await env.DB.prepare(
          `SELECT t.lyrics FROM tracks t 
           JOIN artists ar ON ar.id = t.artist_id 
           WHERE ar.name LIKE ? AND t.title LIKE ? LIMIT 1`
        )
          .bind(`%${artist}%`, `%${title}%`)
          .first<{ lyrics: string | null }>();

        if (track?.lyrics) lyricsText = track.lyrics;
      }

      return ok(env, fmt, {
        lyrics: {
          artist,
          title,
          value: lyricsText,
        },
      });
    }

    case "getlyricsbysongid": {
      const id = parseId(str(url, "id"));
      const track = id?.kind === "tr" ? await trackById(env, id.n) : null;
      let lyricsText = "";

      if (track?.id) {
        const row = await env.DB.prepare("SELECT lyrics FROM tracks WHERE id = ? LIMIT 1")
          .bind(track.id)
          .first<{ lyrics: string | null }>();
        if (row?.lyrics) lyricsText = row.lyrics;
      }

      return ok(env, fmt, {
        lyricsList: {
          structuredLyrics: lyricsText
            ? [
                {
                  lang: "eng",
                  synced: false,
                  line: lyricsText.split("\n").map((line) => ({ value: line })),
                },
              ]
            : [],
        },
      });
    }

    default: {
      return ok(env, fmt, {});
    }
  }
}
