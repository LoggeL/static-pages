#!/usr/bin/env python3
"""Exercise MIME migration, manifests and reproducibility with real images."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image
from image_paths import image_format

spec = importlib.util.spec_from_file_location('pipeline', Path(__file__).with_name('pipeline.py'))
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


class TextureExtensions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bodycam-c21-textures-')
        self.root = Path(self.temp.name)
        self.originals, self.output = self.root / 'originals', self.root / 'output'
        self.reference = self.root / 'normal-reference'
        for directory in (self.originals / 'tile', self.originals / 'decals', self.reference / 'tile'):
            directory.mkdir(parents=True)
        Image.new('RGB', (32, 32), (130, 140, 150)).save(self.originals / 'tile/albedo.jpg', format='WEBP', lossless=True)
        Image.new('RGB', (32, 32), (128, 128, 255)).save(self.originals / 'tile/normal.webp', format='WEBP', lossless=True)
        Image.new('RGB', (32, 32), (255, 180, 0)).save(self.originals / 'tile/orm.jpeg', format='JPEG')
        Image.new('RGB', (64, 64), (128, 128, 255)).save(self.reference / 'tile/normal.jpg', format='JPEG')
        Image.new('RGBA', (32, 32), (130, 140, 150, 100)).save(self.originals / 'decals/grime.png', format='WEBP', lossless=True)
        Image.new('RGBA', (32, 32), (128, 128, 255, 100)).save(self.originals / 'decals/grime_normal.png', format='PNG')
        index = {'tile': {'maps': ['albedo', 'normal', 'orm'], 'tileMeters': 2, 'size': 32,
                          'files': {'albedo': 'albedo.jpg', 'normal': 'normal.webp', 'orm': 'orm.jpeg'}},
                 'decals': {'grime': {'file': 'decals/grime.png', 'normal': 'decals/grime_normal.png'}}}
        (self.originals / 'index.json').write_text(json.dumps(index))
        self.config = self.root / 'config.json'
        config = json.loads(Path(__file__).with_name('config.json').read_text())
        config['textures']['minimumNormalSize'] = 32
        self.config.write_text(json.dumps(config))

    def tearDown(self):
        self.temp.cleanup()

    def run_optimizer(self, reference=False):
        command = [sys.executable, str(Path(__file__).with_name('textures.py')), '--originals', str(self.originals),
                   '--output', str(self.output), '--report', str(self.root / 'report.json'), '--config', str(self.config)]
        if reference:
            command += ['--normal-originals', str(self.reference)]
        subprocess.run(command, check=True, capture_output=True, text=True)
        return json.loads((self.output / 'index.json').read_text())

    def test_actual_formats_define_paths_and_index_without_changing_bytes(self):
        before = pipeline.manifest(self.originals)
        index = self.run_optimizer()
        self.assertEqual(index['tile']['files'], {'albedo': 'albedo.webp', 'normal': 'normal.webp', 'orm': 'orm.jpeg'})
        self.assertEqual(index['decals']['grime'], {'file': 'decals/grime.webp', 'normal': 'decals/grime_normal.png'})
        report = json.loads((self.root / 'report.json').read_text())
        for row in report['images']:
            self.assertEqual((self.originals / row['sourcePath']).read_bytes(), (self.output / row['path']).read_bytes())
            format = image_format((self.output / row['path']).read_bytes())
            self.assertEqual(row['afterFormat'], format)
        first = pipeline.manifest(self.output)
        self.run_optimizer()
        self.assertEqual(first, pipeline.manifest(self.output))
        self.assertEqual(before, pipeline.manifest(self.originals))

    def test_verified_jpeg_normal_replaces_webp_path_and_dimensions(self):
        index = self.run_optimizer(reference=True)
        self.assertEqual(index['tile']['files']['normal'], 'normal.jpg')
        self.assertEqual(index['tile']['sizes']['normal'], 64)
        self.assertEqual(index['tile']['size'], 64)
        self.assertEqual((self.output / 'tile/normal.jpg').read_bytes(), (self.reference / 'tile/normal.jpg').read_bytes())

    def test_legacy_index_and_reused_staging_do_not_leave_old_aliases(self):
        index = json.loads((self.originals / 'index.json').read_text())
        del index['tile']['files']
        (self.originals / 'index.json').write_text(json.dumps(index))
        (self.output / 'tile').mkdir(parents=True)
        (self.output / 'tile/albedo.jpg').write_bytes(b'stale legacy staging')
        self.run_optimizer()
        self.assertFalse((self.output / 'tile/albedo.jpg').exists())
        self.assertTrue((self.output / 'tile/albedo.webp').is_file())

    def test_duplicate_stem_blocks_before_output(self):
        Image.new('RGB', (32, 32)).save(self.originals / 'tile/albedo.png', format='PNG')
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_optimizer()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
