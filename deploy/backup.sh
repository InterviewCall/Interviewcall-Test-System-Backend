#!/usr/bin/env bash
# Dumps the database to backups/db-<date>.sql.gz and keeps the last 14. Runs from cron (see bootstrap-ec2.sh).
# Set BACKUP_S3_URI=s3://bucket/path in .env (and install the AWS CLI) to copy each dump off the server too.
set -euo pipefail
cd "$(dirname "$0")"

DIR=backups
KEEP_DAYS=14
FILE="$DIR/db-$(date -u +%Y%m%d-%H%M%S).sql.gz"
mkdir -p "$DIR"

# The credentials are already inside the container's environment, so they never touch this shell.
docker compose exec -T mariadb sh -c \
  'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --quick --routines --triggers --databases "$MARIADB_DATABASE"' \
  | gzip -9 > "$FILE.partial"

gzip -t "$FILE.partial"
[ "$(stat -c %s "$FILE.partial")" -gt 1024 ] || { echo "Backup is suspiciously small; keeping it as $FILE.partial" >&2; exit 1; }
mv "$FILE.partial" "$FILE"
echo "$(date -u +%FT%TZ) wrote $FILE ($(du -h "$FILE" | cut -f1))"

find "$DIR" -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

S3_URI="$(grep -E '^BACKUP_S3_URI=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
if [ -n "$S3_URI" ]; then
  aws s3 cp "$FILE" "${S3_URI%/}/" --only-show-errors && echo "copied to $S3_URI"
fi
