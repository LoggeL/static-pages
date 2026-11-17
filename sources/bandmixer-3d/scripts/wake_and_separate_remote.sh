#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WAKE_BIN="${WAKE_BIN:-/Users/logge/.local/bin/wake-logge-pc}"

HOST="logge-pc"
TIMEOUT=45
INPUT_FILE=""
SLUG=""
TITLE=""
ARTIST=""
YOUTUBE_ID=""
OUT_DIR=""
SHIFTS=4
OVERLAP=0.25
SEGMENT=""
FORCE_5_STEMS=0

usage() {
  cat <<'EOF'
Usage: wake_and_separate_remote.sh --input <audio> --slug <slug> --title <title> --artist <artist> [options]

Wake logge-pc via Wake-on-LAN if asleep, upload audio + separate_song.py, run RTX CUDA separation,
download stem MP3s + song.json into --out-dir, and clean up temporary remote job files.

Options:
  --input <path>        Input audio file (required)
  --slug <slug>         Song slug/id (required)
  --title <title>       Song display title (required)
  --artist <artist>     Song artist (required)
  --youtube-id <id>     Source YouTube ID (default: "")
  --out-dir <dir>       Output directory (default: site/songs/<slug>)
  --shifts <int>        Demucs random shifts (default: 4)
  --overlap <float>     Demucs chunk overlap (default: 0.25)
  --segment <float>     Optional Demucs segment duration in seconds
  --auto-stems          Enable bleed gate (default)
  --force-5-stems       Force all 5 stems including keys
  --host <ssh-host>     SSH host alias (default: logge-pc)
  --timeout <seconds>   Wake-on-LAN SSH poll timeout in seconds (default: 45)
  -h, --help            Show this help message and exit
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) INPUT_FILE="${2:-}"; shift 2 ;;
    --slug) SLUG="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --artist) ARTIST="${2:-}"; shift 2 ;;
    --youtube-id) YOUTUBE_ID="${2:-}"; shift 2 ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 ;;
    --shifts) SHIFTS="${2:-}"; shift 2 ;;
    --overlap) OVERLAP="${2:-}"; shift 2 ;;
    --segment) SEGMENT="${2:-}"; shift 2 ;;
    --auto-stems) FORCE_5_STEMS=0; shift ;;
    --force-5-stems) FORCE_5_STEMS=1; shift ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "${INPUT_FILE}" || -z "${SLUG}" || -z "${TITLE}" || -z "${ARTIST}" ]]; then
  echo "Error: --input, --slug, --title, and --artist are required." >&2
  usage >&2
  exit 2
fi

if [[ ! "${SLUG}" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Error: --slug must contain only [a-zA-Z0-9._-]: ${SLUG}" >&2
  exit 2
fi

if [[ ! -f "${INPUT_FILE}" ]]; then
  echo "Error: input file not found: ${INPUT_FILE}" >&2
  exit 1
fi

if [[ -z "${OUT_DIR}" ]]; then
  OUT_DIR="${PROJECT_ROOT}/site/songs/${SLUG}"
fi

check_ssh() {
  ssh -o ConnectTimeout=3 -o BatchMode=yes "${HOST}" "echo UP" >/dev/null 2>&1
}

if ! check_ssh; then
  echo "[remote] ${HOST} is not reachable yet; sending Wake-on-LAN packet..."
  if [[ -x "${WAKE_BIN}" ]]; then
    "${WAKE_BIN}" || true
  elif [[ -f "${WAKE_BIN}" ]]; then
    python3 "${WAKE_BIN}" || true
  else
    echo "[remote] Warning: wake script not found at ${WAKE_BIN}" >&2
  fi

  deadline=$(( $(date +%s) + TIMEOUT ))
  awake=0
  while [[ $(date +%s) -lt ${deadline} ]]; do
    if check_ssh; then
      awake=1
      break
    fi
    sleep 2
  done

  if [[ ${awake} -ne 1 ]]; then
    echo "Error: ${HOST} did not respond on SSH within ${TIMEOUT}s after Wake-on-LAN." >&2
    exit 3
  fi
fi

echo "[remote] Connected to ${HOST}:"
ssh -o ConnectTimeout=5 -o BatchMode=yes "${HOST}" \
  "nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader"

EXT="${INPUT_FILE##*.}"
if [[ -z "${EXT}" || "${EXT}" == "${INPUT_FILE}" ]]; then
  EXT="wav"
fi

REMOTE_JOB_REL="stem-stage/jobs/${SLUG}"
REMOTE_OUT_REL="${REMOTE_JOB_REL}/out"
REMOTE_INPUT_REL="${REMOTE_JOB_REL}/input.${EXT}"
REMOTE_SCRIPT_REL="stem-stage/scripts/separate_song.py"

echo "[remote] Preparing job workspace on ${HOST}..."
ssh -o BatchMode=yes "${HOST}" \
  "%USERPROFILE%\stem-stage\.venv\Scripts\python.exe -c \"import os; h=os.path.expanduser('~'); os.makedirs(os.path.join(h,'stem-stage','scripts'), exist_ok=True); os.makedirs(os.path.join(h,'stem-stage','jobs','${SLUG}','out'), exist_ok=True)\""

echo "[remote] Uploading separate_song.py and audio over LAN..."
scp -O -q -o BatchMode=yes \
  "${SCRIPT_DIR}/separate_song.py" \
  "${HOST}:${REMOTE_SCRIPT_REL}"
scp -O -q -o BatchMode=yes \
  "${INPUT_FILE}" \
  "${HOST}:${REMOTE_INPUT_REL}"

ARGS_B64="$(
  INPUT_REL="${REMOTE_INPUT_REL}" \
  OUT_REL="${REMOTE_OUT_REL}" \
  SLUG="${SLUG}" \
  TITLE="${TITLE}" \
  ARTIST="${ARTIST}" \
  YOUTUBE_ID="${YOUTUBE_ID}" \
  SHIFTS="${SHIFTS}" \
  OVERLAP="${OVERLAP}" \
  SEGMENT="${SEGMENT}" \
  FORCE_5_STEMS="${FORCE_5_STEMS}" \
  python3 -c '
import base64, json, os
payload = {
    "input_rel": os.environ["INPUT_REL"],
    "out_rel": os.environ["OUT_REL"],
    "slug": os.environ["SLUG"],
    "title": os.environ["TITLE"],
    "artist": os.environ["ARTIST"],
    "youtube_id": os.environ["YOUTUBE_ID"],
    "shifts": int(os.environ["SHIFTS"]),
    "overlap": float(os.environ["OVERLAP"]),
    "segment": os.environ["SEGMENT"],
    "force_5_stems": os.environ["FORCE_5_STEMS"] == "1",
}
print(base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii"))
'
)"

echo "[remote] Running RTX CUDA stem separation on ${HOST}..."
ssh -o BatchMode=yes "${HOST}" \
  "%USERPROFILE%\stem-stage\.venv\Scripts\python.exe -c \"import base64,json,os,subprocess,sys; p=json.loads(base64.b64decode('${ARGS_B64}')); home=os.path.expanduser('~'); cmd=[sys.executable,'-u',os.path.join(home,'stem-stage','scripts','separate_song.py'),'--input',os.path.join(home,p['input_rel']),'--slug',p['slug'],'--title',p['title'],'--artist',p['artist'],'--youtube-id',p['youtube_id'],'--out-dir',os.path.join(home,p['out_rel']),'--device','cuda','--shifts',str(p['shifts']),'--overlap',str(p['overlap'])]; cmd.extend(['--segment',str(p['segment'])] if p['segment'] else []); cmd.append('--force-5-stems' if p['force_5_stems'] else '--auto-stems'); raise SystemExit(subprocess.call(cmd))\""

TMP_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/stem-stage-dl-${SLUG}-XXXXXX")"
cleanup() {
  rm -rf "${TMP_STAGE}"
}
trap cleanup EXIT

echo "[remote] Downloading separated stems and song.json..."
scp -O -r -q -o BatchMode=yes \
  "${HOST}:${REMOTE_OUT_REL}" \
  "${TMP_STAGE}/"

DL_DIR="${TMP_STAGE}/out"
if [[ ! -f "${DL_DIR}/song.json" ]]; then
  echo "Error: downloaded output missing song.json from ${HOST}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"
if [[ ! -f "${DL_DIR}/keys.mp3" && -f "${OUT_DIR}/keys.mp3" ]]; then
  rm -f "${OUT_DIR}/keys.mp3"
fi
cp -f "${DL_DIR}/song.json" "${OUT_DIR}/song.json"
for mp3 in "${DL_DIR}"/*.mp3; do
  [[ -e "${mp3}" ]] && cp -f "${mp3}" "${OUT_DIR}/"
done

echo "[remote] Cleaning up temporary job files on ${HOST}..."
ssh -o BatchMode=yes "${HOST}" \
  "%USERPROFILE%\stem-stage\.venv\Scripts\python.exe -c \"import os, shutil; shutil.rmtree(os.path.join(os.path.expanduser('~'),'stem-stage','jobs','${SLUG}'), ignore_errors=True)\"" >/dev/null 2>&1 || true

echo "[remote] Done! Wrote outputs to ${OUT_DIR}"
