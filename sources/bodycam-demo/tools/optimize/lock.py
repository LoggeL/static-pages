#!/usr/bin/env python3
"""Keep an advisory work-directory lock open across the shell pipeline."""
import fcntl
import os
from pathlib import Path
import sys

work = Path(sys.argv[1]).resolve()
repo = Path(__file__).resolve().parents[4]
if work.is_relative_to(repo):
    raise SystemExit('C7 work directory must be outside the repository')
work.mkdir(parents=True, exist_ok=True)
handle = os.open(work / 'run.lock', os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('Another C7 pipeline owns this work directory')
os.set_inheritable(handle, True)
environment = dict(os.environ, C7_LOCKED='1')
os.execvpe(sys.argv[2], sys.argv[2:], environment)
