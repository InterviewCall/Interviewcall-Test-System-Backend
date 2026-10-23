#!/usr/bin/env bash
# Run on the server by the GitHub Actions deploy job (or by hand to roll back):
#
#   ./deploy.sh sha-1a2b3c4                     the images are already public to this server's docker login
#   echo "$TOKEN" | ./deploy.sh sha-1a2b3c4 <github-user>   log in to GHCR first, token on stdin
#
# Order: pull -> start the database and Redis -> migrate -> swap API and worker -> wait until healthy.
# If the migration fails nothing running is touched. If the new API never becomes healthy the previous
# tag is started again. Migrations are forward-only, so keep them compatible with the previous version.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?usage: deploy.sh <image-tag> [github-user]  (token on stdin when a user is given)}"
GH_USER="${2:-}"
[ -f .env ] || { echo ".env is missing in $(pwd); run bootstrap-ec2.sh first." >&2; exit 1; }

if [ -n "$GH_USER" ]; then
  read -r GH_TOKEN
  printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GH_USER" --password-stdin
fi

current_tag() { grep -E '^IMAGE_TAG=' .env | tail -n1 | cut -d= -f2- || true; }
set_tag() {
  if grep -qE '^IMAGE_TAG=' .env; then sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" .env; else echo "IMAGE_TAG=$1" >> .env; fi
}

PREVIOUS="$(current_tag)"
# "latest" is only the placeholder from the example .env: nothing was ever deployed to go back to.
[ "$PREVIOUS" = latest ] && PREVIOUS=""
SWAPPED=false
# Until the running containers are replaced, a failure must leave .env pointing at what is actually running.
trap 'if [ "$SWAPPED" = false ] && [ -n "$PREVIOUS" ]; then set_tag "$PREVIOUS"; fi' ERR

echo "==> Deploying $TAG (was: ${PREVIOUS:-nothing})"
set_tag "$TAG"

echo "==> Pulling images"
docker compose --profile tools pull --quiet

echo "==> Database and Redis"
docker compose up -d mariadb redis

echo "==> Migrating"
docker compose run --rm migrate

echo "==> Starting API, worker and proxy"
SWAPPED=true
docker compose up -d --remove-orphans api worker caddy

echo "==> Waiting for the API to be healthy"
API_ID="$(docker compose ps -q api)"
for _ in $(seq 1 45); do
  state="$(docker inspect -f '{{.State.Health.Status}}' "$API_ID" 2>/dev/null || echo starting)"
  [ "$state" = healthy ] && break
  [ "$state" = unhealthy ] && break
  sleep 4
done

if [ "${state:-}" != healthy ]; then
  echo "!! The API did not become healthy. Last logs:" >&2
  docker compose logs --tail 60 api worker >&2 || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TAG" ]; then
    echo "!! Going back to $PREVIOUS" >&2
    set_tag "$PREVIOUS"
    docker compose up -d api worker caddy
  fi
  exit 1
fi

echo "==> Cleaning up old images (kept: anything used in the last 7 days, for rollbacks)"
docker image prune -af --filter "until=168h" >/dev/null || true

echo "==> Deployed $TAG"
docker compose ps
