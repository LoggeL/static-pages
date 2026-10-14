"""Lossless PNG filter search in separate system-Python worker processes."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True
VERSION = '0.2.3.post1'


def optimize_one(job):
    import numpy as np
    import zopfli.png
    from bake_validate import read_png
    path = Path(job['path']); original = path.read_bytes(); started = time.monotonic()
    candidate = zopfli.png.optimize(original, use_zopfli=False,
        filter_strategies=job['filters'], lossy_transparent=False, lossy_8bit=False)
    accepted = len(candidate) < len(original) and candidate[24:29] == bytes([8, 6, 0, 0, 0])
    if accepted:
        temporary = path.with_suffix('.optimized.png'); temporary.write_bytes(candidate)
        try:
            if not np.array_equal(read_png(path)[0], read_png(temporary)[0]):
                raise ValueError(f'PNG optimizer changed RGBM bytes: {path}')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    data = path.read_bytes()
    return job['id'], {'bytes':len(data), 'sha256':hashlib.sha256(data).hexdigest(),
        'pngBeforeOptimizationBytes':len(original), 'pngLosslessVerified':True,
        'pngOptimizer':f'ZopfliPNG {VERSION}, filter search with zlib',
        'pngOptimizationSeconds':time.monotonic()-started, 'pngOptimized':accepted}


def optimize_pngs(work, atlases, settings):
    """Blender calls this entry point; the extension uses system Python's ABI."""
    dependency_dir = work/'tools/python'; dependency_dir.mkdir(parents=True,exist_ok=True)
    environment = dict(os.environ)
    environment['PYTHONPATH'] = str(dependency_dir) + os.pathsep + environment.get('PYTHONPATH','')
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    check = subprocess.run(['python3','-c',
        f'import importlib.metadata; assert importlib.metadata.version("zopfli") == "{VERSION}"'],
        env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if check.returncode:
        subprocess.run(['python3','-m','pip','install','--target',str(dependency_dir),
            '--upgrade','--no-deps',f'zopfli=={VERSION}'],check=True,env=environment)
    jobs = work/'reports/png-jobs.json'; output = work/'reports/png-optimization.json'
    jobs.write_text(json.dumps({'workers':settings['workers'], 'jobs':[
        {'id':key,'path':str(work/'raw'/Path(item['path']).name),'filters':settings['filters']}
        for key,item in atlases.items()]}))
    subprocess.run(['python3',str(Path(__file__).resolve()),'--jobs',str(jobs),'--output',str(output)],
        check=True,env=environment)
    return json.loads(output.read_text())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs',type=Path,required=True); parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(); request=json.loads(args.jobs.read_text()); started=time.monotonic()
    with concurrent.futures.ProcessPoolExecutor(max_workers=request['workers']) as pool:
        results=dict(pool.map(optimize_one,request['jobs']))
    report={'seconds':time.monotonic()-started,'atlases':results}
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print('C6_PNG '+json.dumps({'seconds':report['seconds'],
        'beforeBytes':sum(v['pngBeforeOptimizationBytes'] for v in results.values()),
        'afterBytes':sum(v['bytes'] for v in results.values()),'pixelExact':True}),flush=True)


if __name__ == '__main__': main()
