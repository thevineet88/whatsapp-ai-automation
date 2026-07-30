#!/usr/bin/env sh
if [ -z "$HUSKY" ]; then
  echo "HUSKY=0" > "$1/.husky/_/skip"
  exit 0
fi
