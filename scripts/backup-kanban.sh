#!/bin/bash
set -e

# Directory setup
PROJECT_DIR="/Users/dan/clawd/projects/openclaw-viz"
BACKUP_DIR="${PROJECT_DIR}/backups/kanban"

# Create backup dir if missing
mkdir -p "${BACKUP_DIR}"

# Date string
DATE=$(date +"%Y-%m-%d_%H%M%S")

# Backup kanban.json
if [ -f "${PROJECT_DIR}/kanban.json" ]; then
  cp "${PROJECT_DIR}/kanban.json" "${BACKUP_DIR}/kanban_${DATE}.json"
  echo "Backup created: ${BACKUP_DIR}/kanban_${DATE}.json"
  
  # Keep only last 14 backups
  ls -t "${BACKUP_DIR}"/kanban_*.json | tail -n +15 | xargs -I {} rm {}
else
  echo "kanban.json not found!"
  exit 1
fi
