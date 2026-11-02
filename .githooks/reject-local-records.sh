#!/bin/sh
# Reject private development records while preserving the files on disk.
set -eu
failed=0
while IFS= read -r path; do
  case "$path" in
    changelog.d/README.md) continue ;;
    TASKS.md|.local-work/*|*.log|remote/.env.production)
      printf 'Private development record cannot be uploaded: %s\n' "$path" >&2
      failed=1
      ;;
  esac
done
exit "$failed"
