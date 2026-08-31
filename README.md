# Relief relief

Private OpenSubsonic music server for two people. Runs entirely on the Cloudflare free tier: **Workers + D1 + R2**. FLAC and MP3 only. Works with [Tempus](https://f-droid.org/packages/com.eddyizm.degoogled.tempus/) and other Subsonic clients.

No database IDs, bucket names, or R2 tokens are hardcoded. Fill the placeholders, then set secrets.

## 1. Fill named resources

Edit `wrangler.toml`:

```toml
database_name = "YOUR_D1_DATABASE_NAME"   # the D1 you already created
database_id   = "YOUR_D1_DATABASE_ID"
bucket_name   = "YOUR_R2_BUCKET_NAME"     # both [vars] and [[r2_buckets]]
R2_BUCKET_NAME = "YOUR_R2_BUCKET_NAME"
```

Bindings used in code (do not rename unless you change `src/types.ts`):

| Binding | Resource |
| --- | --- |
| `DB` | D1 |
| `MUSIC` | R2 |

## 2. Secrets (not in git)

```bash
npx wrangler secret put AUTH_SECRET      # long random string; encrypts stored passwords
npx wrangler secret put SETUP_SECRET     # one-time token to create the two users
```

Optional — only if you want S3 presigned uploads later. **Streaming does not need an R2 token.** The Worker uses the `MUSIC` binding.

```bash
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Local dev: copy `.dev.vars.example` to `.dev.vars`.

## 3. Migrate and deploy

```bash
npm install
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

## 4. Create the two users (once)

```bash
curl -X POST https://relief.<you>.workers.dev/api/setup \
  -H 'content-type: application/json' \
  -d '{
    "setupSecret": "YOUR_SETUP_SECRET",
    "users": [
      { "username": "you", "password": "pick-a-strong-one", "admin": true },
      { "username": "plus-one", "password": "another-strong-one" }
    ]
  }'
```

Save the returned `apiKey` values. Tempus accepts username/password **or** an API key.

## 5. Tempus

- Server: `https://relief.<you>.workers.dev` (or your custom domain)
- Username / password from setup
- Path: leave empty (API is `/rest/...`)

Do **not** put Cloudflare Access in front of `/rest/*`. Native apps cannot pass that login wall.

## 6. Upload music

Admin only. Browser UI at `/` after deploy, or:

```bash
curl -X POST 'https://relief.<you>.workers.dev/api/ingest?u=you&p=YOUR_PASSWORD' \
  -F 'file=@album/01-track.flac'
```

Tags are read from FLAC Vorbis comments / ID3, with filename fallback `Artist - Album - 01 Title.flac`. Max **100 MB per file** through the Worker (free-plan body limit). No transcoding: originals are streamed with HTTP Range.

## Layout

```
wrangler.toml          # YOUR_* placeholders
migrations/0001_init.sql
src/
  index.ts             # /rest/*  /api/*  static
  rest.ts              # OpenSubsonic 1.16.1
  media.ts             # stream / cover / Range
  api.ts               # setup + ingest
  auth.ts              # token, password, apiKey
public/                # listening-room web player
```
