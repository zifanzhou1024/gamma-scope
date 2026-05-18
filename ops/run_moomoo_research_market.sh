#!/bin/zsh
set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/sakura/WebstormProjects/gamma-scope"
DATA_DIR="/Users/sakura/local-ml-data/gamma-ml-research"
LOG_DIR="${DATA_DIR}/logs"
ARGS_FILE="${DATA_DIR}/moomoo-recorder.args"

mkdir -p "${LOG_DIR}"

cd "${REPO_DIR}" || {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') unable to cd into ${REPO_DIR}" >&2
  exit 1
}

load_extra_args() {
  local line
  EXTRA_ARGS=()
  if [[ ! -f "${ARGS_FILE}" ]]; then
    return
  fi
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "${line}" == \#* ]] && continue
    EXTRA_ARGS+=(${(z)line})
  done < "${ARGS_FILE}"
}

while true; do
  load_extra_args
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') starting moomoo research market recorder"
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') extra args: ${EXTRA_ARGS[*]:-(none)}"

  PYTHONPATH="services/collector:apps/api" \
    .venv/bin/python -m gammascope_collector.moomoo_research_recorder \
    --market-hours \
    --repeat-daily \
    "${EXTRA_ARGS[@]}"

  status=$?
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') recorder exited with status ${status}; restarting after 300 seconds" >&2
  sleep 300
done
