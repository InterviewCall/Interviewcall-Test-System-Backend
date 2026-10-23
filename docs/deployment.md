# Deployment

Everything runs on one EC2 server in Docker: the API, the worker, MariaDB, Redis and Caddy (HTTPS).
GitHub Actions tests every push to `main`, builds the images, and releases them on the server over SSH.

```
 browser ──► Vercel (candidate-web / console-web)
                │  /api/*  forwarded by the Next.js rewrite
                ▼
        test-api.interviewcall.club ──► Caddy ──► api ──► MariaDB
                                                    │
 SES ──► SNS ──► /api/v1/mail-events/ses ───────────┤
                                                    ▼
                                                  Redis ◄── worker ──► SES, AiSensy
```

## What a push to `main` does

1. **CI** (`.github/workflows/ci.yml`, also runs on pull requests): lint, type-check, unit tests, every migration applied to
   an empty MariaDB 10.11, the seed, the end-to-end tests against that real database and a real Redis, and the build.
2. **Build**: two images pushed to GitHub Container Registry, for x86 and Graviton: `runtime` (API and worker) and
   `tools` (migrations and seeding). Tags are `sha-<7 characters of the commit>`.
3. **Release** (`deploy/deploy.sh` on the server): pull, start the database and Redis, run the migrations, replace the API
   and worker, wait for the API to report healthy. If the migration fails nothing running is touched. If the new API
   never becomes healthy, the previous version is started again.

## One-time setup

### AWS

- **Server**: Ubuntu 24.04, t4g.medium (4 GB) is enough to start, t4g.large (8 GB) is comfortable. 30 GB gp3 disk.
  Allocate an **Elastic IP** so the address survives a stop and start.
- **Security group**: allow 80 and 443 from anywhere, and 22 (key login only; GitHub's runners have no fixed addresses).
  Never open 3306, 6379 or 4000. The database listens on the server's own loopback only.
- **Email permission**: give the instance an IAM role (EC2, Actions, Modify IAM role) with this policy, so no keys are stored:

  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": [
        "arn:aws:ses:ap-south-1:983194205581:identity/*",
        "arn:aws:ses:ap-south-1:983194205581:configuration-set/interviewcall-tests"
      ]
    }]
  }
  ```

  Containers reach the instance's credentials only if the metadata hop limit is 2 (the default, 1, stops at the host):

  ```
  aws ec2 modify-instance-metadata-options --instance-id <id> --http-put-response-hop-limit 2 --http-tokens required
  ```

  Without a role, put `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the server's `.env` instead.
- **DNS**: an A record for `test-api.interviewcall.club` pointing at the Elastic IP.
- **SNS**: after the first deploy, subscribe `https://test-api.interviewcall.club/api/v1/mail-events/ses` to the
  `ses-events` topic (see `docs/mail-delivery-tracking.md`).

### The server

```
scp -r deploy ubuntu@<server>:/tmp/deploy
ssh ubuntu@<server> 'sudo bash /tmp/deploy/bootstrap-ec2.sh'
```

This installs Docker, adds 2 GB of swap, creates `/opt/interviewcall-tests`, generates the database, Redis and queue
secrets into `/opt/interviewcall-tests/.env`, and schedules the nightly backup. Then edit that `.env`:

- `ACME_EMAIL`, `AISENSY_API_KEY` (production will not start with the WhatsApp console driver, so a key is needed even
  though WhatsApp messages are not built yet), and the AWS keys only if the server has no IAM role.
- Check `API_DOMAIN`, `ALLOWED_ORIGINS`, `TEST_PORTAL_URL`, `STAFF_CONSOLE_URL`.
- Set `DB_BUFFER_POOL` to about a quarter of the server's memory (`2G` on 8 GB).

### GitHub

The two workflow files are in `deploy/github-workflows/`. GitHub only reads them from `.github/workflows/`, so copy them
there once, from the repo root, and commit them:

```
mkdir -p .github/workflows && cp deploy/github-workflows/*.yml .github/workflows/
```

Then Settings, Secrets and variables, Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `EC2_HOST` | The Elastic IP or the API domain |
| Secret | `EC2_SSH_KEY` | Private key of a key pair whose public half is in the server's `~/.ssh/authorized_keys` |
| Secret | `EC2_USER` | Optional, defaults to `ubuntu` |
| Secret | `EC2_KNOWN_HOSTS` | Optional. Output of `ssh-keyscan -H <host>`; without it the server's key is trusted on first sight |
| Variable | `API_HEALTH_URL` | Optional. `https://test-api.interviewcall.club/api/v1/health`, checked after each release |
| Variable | `PLATFORMS` | Optional. `linux/arm64` (Graviton) or `linux/amd64` builds for one architecture, which is faster |

Also: Settings, Actions, General, Workflow permissions, **Read and write permissions**, so the build can push images.
Use a dedicated deploy key pair (`ssh-keygen -t ed25519 -f deploy_key`), not your own.

### First deploy

1. Push to `main`, or run the Deploy workflow by hand. Watch it in the Actions tab.
2. Create the first admin and load the question bank (once, on the server). Put `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
   (10 to 128 characters), `SEED_ADMIN_FULL_NAME` and `SEED_ADMIN_PHONE` into `.env`, then:

   ```
   cd /opt/interviewcall-tests && docker compose run --rm seed
   ```

   It is safe to run again: it never overwrites a password that was changed since.
   Remove the `SEED_ADMIN_PASSWORD` line afterwards.
3. In Vercel, set `API_ORIGIN=https://test-api.interviewcall.club` on both projects and redeploy them (the rewrite is
   fixed at build time).
4. Subscribe SNS to the webhook, as above.

## Rate limiting

The API limits requests per visitor IP, in memory:

| Route | Limit |
| --- | --- |
| Staff login, change password | 5 per minute |
| Opening a candidate test link | 60 per minute |
| Everything else | 1,200 per minute |

The ceilings are generous on purpose: a whole class sitting a test behind one college router shares one IP, and every
answer they pick is a request. Caddy also caps request bodies at 1 MB.

It only works if the API sees the real visitor, not Vercel. Vercel puts the visitor in `X-Forwarded-For`; Caddy keeps it
and adds Vercel's address; `TRUST_PROXY_HOPS=2` tells the API to take the address two steps from the right. **Check it
once after the first login**: the address stored for your session must be your own, not a Vercel one.

```
cd /opt/interviewcall-tests
docker compose exec mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" -e "select ip, created_at from sessions order by id desc limit 3"'
```

Known limit: because Vercel has no fixed addresses, Caddy has to accept `X-Forwarded-For` from anyone. Someone who calls
the API directly (not through Vercel) can invent that header and sidestep the per-IP limits. Password guessing is still
slowed by the cost of hashing, and candidate links are long random secrets. If it ever matters, have the two Next.js
apps add a secret header when they forward, and have Caddy reject requests without it.

The counters live in the API process, so a restart resets them, and a second API instance would double the limits.

## Day to day

All from `/opt/interviewcall-tests` on the server.

```
docker compose ps                         # what is running and healthy
docker compose logs -f api worker         # live logs
docker compose logs --since 1h caddy      # proxy access log (JSON)
docker compose up -d                      # apply an edited .env
./backup.sh                               # backup now
```

- **Roll back**: Actions, Deploy, Run workflow, `rollback_tag` = an earlier `sha-…` (tags are on the Packages page, or
  in `docker images`). Migrations are forward-only, so keep each one compatible with the previous release.
- **Restore a backup** (this replaces the data):

  ```
  gunzip -c backups/db-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
  ```

- **Backups**: nightly at 02:00 IST into `backups/`, 14 kept. They live on the same disk, so also copy them off the server:
  set `BACKUP_S3_URI=s3://<bucket>/db/` in `.env`, install the AWS CLI, and give the role `s3:PutObject` on that bucket.
- **Look inside the database** from your laptop: `ssh -L 3307:127.0.0.1:3306 ubuntu@<server>`, then connect to `127.0.0.1:3307`.
- **Disk**: Docker logs rotate (20 MB x 5 per service). `docker system df` shows what the images use.

## Limits of this setup

- One server and one API instance: a reboot or a deploy means a few seconds of downtime. Queued emails wait in Redis
  (it is persisted to disk) and go out afterwards.
- The database is a container on the same server. The nightly dump is the safety net; take an EBS snapshot before risky changes.
- The image tags in the registry are the rollback history; old ones are pruned from the server after 7 days, not from GHCR.
