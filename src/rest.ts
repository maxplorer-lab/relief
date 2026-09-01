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
