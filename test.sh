#!/usr/bin/env bash
#
# kunet_git.sh
#
# Helper script to talk to a bare Git repo on KUNet over SSH.
# Usage (from inside your local repo):
#   ./kunet_git.sh init-remote   # create remote bare repo on KUNet + add 'kunet' remote
#   ./kunet_git.sh push          # git push to KUNet (current branch)
#   ./kunet_git.sh pull          # git pull from KUNet (current branch)
#   ./kunet_git.sh ssh           # open an SSH shell on KUNet
#
# NOTE: This script does NOT hard-code your password. SSH will prompt
#       you for the KUNet password (phasheej) when needed.

set -euo pipefail

########################################
# CONFIG – EDIT THESE IF YOU NEED TO  #
########################################

# Your KUNet login
KUNET_USER="k2320835"
KUNET_HOST="kunet.uk"
KUNET_PORT=40702      # use 8080 instead if 40702 is blocked on your network

# Where the bare Git repo will live on KUNet.
# You can change the path/name if you like.
REMOTE_BARE_REPO="/home/${KUNET_USER}/git/ci6230-university.git"

# Name of the Git remote in your local repo
REMOTE_NAME="kunet"

########################################
# INTERNALS – YOU PROBABLY DON'T EDIT  #
########################################

# Build SSH URL for Git
REMOTE_URL="ssh://${KUNET_USER}@${KUNET_HOST}:${KUNET_PORT}${REMOTE_BARE_REPO}"

# Get current local branch name (e.g. main)
current_branch() {
  git rev-parse --abbrev-ref HEAD
}

init_remote() {
  echo ">>> Initialising bare repo on KUNet at ${REMOTE_BARE_REPO}"

  # Create directory for bare repo and initialise it (only if it doesn't exist)
  ssh -p "${KUNET_PORT}" "${KUNET_USER}@${KUNET_HOST}" "mkdir -p \"$(dirname "${REMOTE_BARE_REPO}")\"; \
    if [ ! -d \"${REMOTE_BARE_REPO}\" ]; then \
      git init --bare \"${REMOTE_BARE_REPO}\"; \
    fi"

  # Add or update the local Git remote
  if git remote | grep -q "^${REMOTE_NAME}\$"; then
    echo ">>> Remote '${REMOTE_NAME}' already exists – updating URL"
    git remote set-url "${REMOTE_NAME}" "${REMOTE_URL}"
  else
    echo ">>> Adding Git remote '${REMOTE_NAME}' -> ${REMOTE_URL}"
    git remote add "${REMOTE_NAME}" "${REMOTE_URL}"
  fi

  echo ">>> Done. You can now run: ./kunet_git.sh push"
}

do_push() {
  local branch
  branch="$(current_branch)"
  echo ">>> Pushing branch '${branch}' to '${REMOTE_NAME}'"
  git push "${REMOTE_NAME}" "${branch}"
}

do_pull() {
  local branch
  branch="$(current_branch)"
  echo ">>> Pulling branch '${branch}' from '${REMOTE_NAME}'"
  git pull "${REMOTE_NAME}" "${branch}"
}

open_ssh() {
  echo ">>> Opening SSH shell on ${KUNET_USER}@${KUNET_HOST}:${KUNET_PORT}"
  ssh -p "${KUNET_PORT}" "${KUNET_USER}@${KUNET_HOST}"
}

usage() {
  cat <<EOF
Usage: $0 {init-remote|push|pull|ssh}

  init-remote   Create a bare Git repo on KUNet and add/update the 'kunet' remote
  push          Push current branch to KUNet
  pull          Pull current branch from KUNet
  ssh           Open an SSH shell on KUNet

Run this script from inside your local Git repository.
EOF
}

cmd="${1-}"

case "${cmd}" in
  init-remote)
    init_remote
    ;;
  push)
    do_push
    ;;
  pull)
    do_pull
    ;;
  ssh)
    open_ssh
    ;;
  *)
    usage
    exit 1
    ;;
esac