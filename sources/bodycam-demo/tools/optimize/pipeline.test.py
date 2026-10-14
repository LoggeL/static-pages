#!/usr/bin/env python3
"""Regression tests for backup ownership, conflicts and budget enforcement."""
import contextlib
import importlib.util
import io
import json
import struct
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('c7_pipeline', Path(__file__).with_name('pipeline.py'))
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


def fixture_glb(document):
    encoded = json.dumps(document).encode()
    encoded += b' ' * (-len(encoded) % 4)
    return struct.pack('<4sIIII', b'glTF', 2, 20 + len(encoded), len(encoded), 0x4E4F534A) + encoded


class PipelineSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bodycam-c7-test-')
        self.root = Path(self.temp.name)
        self.public, self.work = self.root / 'public', self.root / 'work'
        for name in ('models', 'textures', 'lightmaps', 'data'):
            (self.public / name).mkdir(parents=True)
            (self.public / name / 'fixture.bin').write_bytes(b'original data')
        (self.public / 'textures/tile').mkdir()
        self.webp = b'RIFF\x10\x00\x00\x00WEBPVP8Lfixture'
        (self.public / 'textures/tile/albedo.jpg').write_bytes(self.webp)
        (self.public / 'textures/tile/orm.jpg').write_bytes(b'\xff\xd8\xfffixture JPEG')
        (self.public / 'textures/tile/normal.png').write_bytes(b'\x89PNG\r\n\x1a\nfixture PNG')
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps({'budgetBytes': 1000}))
        self.args = SimpleNamespace(public=self.public, work=self.work, config=self.config, stage_only=False, allow_over_budget=False)
        self.work.mkdir()
        pipeline.snapshot(self.args)
        for stage in ('staging', 'meshopt-staging'):
            for name in ('models', 'textures'):
                (self.work / stage / name).mkdir(parents=True)
                (self.work / stage / name / 'fixture.bin').write_bytes(b'optimized')
        (self.work / 'staging/textures/tile').mkdir()
        for name, blob in [('albedo.webp', self.webp), ('orm.jpg', b'\xff\xd8\xfffixture JPEG'),
                           ('normal.png', b'\x89PNG\r\n\x1a\nfixture PNG')]:
            (self.work / 'staging/textures/tile' / name).write_bytes(blob)

    def tearDown(self):
        self.temp.cleanup()

    def finish(self):
        with contextlib.redirect_stdout(io.StringIO()):
            pipeline.finish(self.args)

    def test_rerun_is_byte_identical_and_preserves_originals(self):
        self.finish()
        first = pipeline.manifest(self.public)
        self.finish()
        self.assertEqual(first, pipeline.manifest(self.public))
        self.assertEqual((self.work / 'originals/textures/fixture.bin').read_bytes(), b'original data')
        self.assertEqual((self.public / 'lightmaps/fixture.bin').read_bytes(), b'original data')

    def test_budget_blocks_before_any_write(self):
        self.config.write_text('{"budgetBytes": 1}')
        before = pipeline.manifest(self.public)
        with self.assertRaisesRegex(RuntimeError, 'budget'):
            self.finish()
        self.assertEqual(before, pipeline.manifest(self.public))
        self.args.allow_over_budget = True
        self.finish()
        report = json.loads((self.work / 'reports/budget.json').read_text())
        self.assertFalse(report['compatibleBudgetPassed'])
        self.assertTrue(report['applied'])

    def test_other_workers_changes_are_never_overwritten(self):
        (self.public / 'textures/fixture.bin').write_bytes(b'new external revision')
        before = pipeline.manifest(self.public)
        with self.assertRaisesRegex(RuntimeError, 'Concurrent'):
            self.finish()
        self.assertEqual(before, pipeline.manifest(self.public))

    def test_original_tampering_is_detected(self):
        (self.work / 'originals/models/fixture.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError, 'backup changed'):
            self.finish()

    def test_stage_only_does_not_install(self):
        self.args.stage_only = True
        before = pipeline.manifest(self.public)
        self.finish()
        self.assertEqual(before, pipeline.manifest(self.public))
        self.assertFalse((self.work / 'installed-manifest.json').exists())

    def test_unexpected_staged_asset_is_rejected(self):
        (self.work / 'staging/models/new.glb').write_bytes(b'unexpected')
        with self.assertRaisesRegex(RuntimeError, 'paths differ'):
            self.finish()

    def test_dev_and_audio_do_not_consume_delivery_budget(self):
        before = pipeline.total(self.public)
        for name in ('audio', '_dev'):
            (self.public / name).mkdir()
            (self.public / name / 'large.bin').write_bytes(b'x' * 10000)
        self.assertEqual(before, pipeline.total(self.public))
        self.finish()
        self.assertTrue(json.loads((self.work / 'reports/budget.json').read_text())['budgetPassed'])

    def test_fresh_bake_and_lightmaps_are_preserved(self):
        # A bake after the optimization snapshot is expected, not a conflict.
        bake = fixture_glb({'asset': {'version': '2.0'}, 'extras': {'fixture': 'fresh bake'}})
        for name in ('house.glb', 'house_collision.glb'):
            (self.public / 'models' / name).write_bytes(bake)
        (self.public / 'lightmaps/fixture.bin').write_bytes(b'fresh RGBM bytes')
        (self.public / 'data/fixture.bin').write_bytes(b'fresh metadata')
        self.finish()
        self.assertEqual((self.public / 'models/house.glb').read_bytes(), bake)
        self.assertEqual((self.public / 'lightmaps/fixture.bin').read_bytes(), b'fresh RGBM bytes')
        self.assertEqual((self.work / 'staging/models/house.glb').read_bytes(), bake)
        self.assertEqual((self.work / 'staging/lightmaps/fixture.bin').read_bytes(), b'fresh RGBM bytes')
        installed = json.loads((self.work / 'installed-manifest.json').read_text())['files']
        self.assertNotIn('models/house.glb', installed)
        self.assertNotIn('models/house_collision.glb', installed)

    def test_verified_normal_reference_cannot_silently_change(self):
        reference = self.root / 'normal-reference'
        (reference / 'tile').mkdir(parents=True)
        (reference / 'tile/normal.jpg').write_bytes(b'\xff\xd8\xfffull resolution')
        self.args.reference_textures = reference
        pipeline.snapshot(self.args)
        (self.work / 'normal-originals').mkdir(exist_ok=True)
        (self.work / 'normal-originals/unexpected.jpg').write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError, 'reference backup changed'):
            pipeline.snapshot(self.args)

    def test_webp_is_renamed_byte_exactly_and_real_formats_keep_paths(self):
        self.finish()
        self.assertFalse((self.public / 'textures/tile/albedo.jpg').exists())
        self.assertEqual((self.public / 'textures/tile/albedo.webp').read_bytes(), self.webp)
        self.assertTrue((self.public / 'textures/tile/orm.jpg').is_file())
        self.assertTrue((self.public / 'textures/tile/normal.png').is_file())
        self.assertEqual((self.work / 'originals/textures/tile/albedo.jpg').read_bytes(), self.webp)
        report = json.loads((self.work / 'reports/budget.json').read_text())
        self.assertEqual(report['renamedTextures'], {'textures/tile/albedo.jpg': 'textures/tile/albedo.webp'})
        self.assertEqual(report['readbackBytes'], report['candidateBytes'])

    def test_unrecognized_rename_destination_blocks_before_writes(self):
        (self.public / 'textures/tile/albedo.webp').write_bytes(b'foreign output')
        before = pipeline.manifest(self.public)
        with self.assertRaisesRegex(RuntimeError, 'Concurrent'):
            self.finish()
        self.assertEqual(before, pipeline.manifest(self.public))

    def test_byte_exact_external_extension_migration_is_recognized(self):
        (self.public / 'textures/tile/albedo.jpg').rename(self.public / 'textures/tile/albedo.webp')
        self.finish()
        self.assertEqual((self.public / 'textures/tile/albedo.webp').read_bytes(), self.webp)

    def test_interrupted_new_old_pair_can_finish_and_rerun(self):
        (self.public / 'textures/tile/albedo.webp').write_bytes(self.webp)
        self.finish()
        expected = pipeline.manifest(self.public)
        self.finish()
        self.assertEqual(expected, pipeline.manifest(self.public))
        self.assertFalse((self.public / 'textures/tile/albedo.jpg').exists())

    def test_new_staged_path_requires_matching_content_extension(self):
        (self.work / 'staging/textures/tile/albedo.webp').rename(self.work / 'staging/textures/tile/albedo.jpg')
        before = pipeline.manifest(self.public)
        with self.assertRaisesRegex(RuntimeError, 'extension disagrees'):
            self.finish()
        self.assertEqual(before, pipeline.manifest(self.public))

    def test_real_jpeg_name_cannot_silently_change(self):
        (self.work / 'staging/textures/tile/orm.jpg').rename(self.work / 'staging/textures/tile/orm.jpeg')
        before = pipeline.manifest(self.public)
        with self.assertRaisesRegex(RuntimeError, 'extension disagrees'):
            self.finish()
        self.assertEqual(before, pipeline.manifest(self.public))

    def test_legacy_path_changed_during_install_is_never_removed(self):
        replace = pipeline.os.replace

        def concurrent_change(temporary, target):
            replace(temporary, target)
            if target.name == 'albedo.webp':
                (self.public / 'textures/tile/albedo.jpg').write_bytes(b'foreign edit during install')

        with patch.object(pipeline.os, 'replace', side_effect=concurrent_change):
            with self.assertRaisesRegex(RuntimeError, 'Legacy input changed'):
                self.finish()
        self.assertEqual((self.public / 'textures/tile/albedo.jpg').read_bytes(), b'foreign edit during install')
        self.assertFalse((self.work / 'installed-manifest.json').exists())

    def test_protected_bake_legacy_image_uri_blocks_before_install(self):
        (self.public / 'models/house.glb').write_bytes(fixture_glb({'images': [{'uri': '../textures/tile/albedo.jpg'}]}))
        before = pipeline.manifest(self.public)
        with self.assertRaisesRegex(RuntimeError, 'model image reference missing'):
            self.finish()
        self.assertEqual(before, pipeline.manifest(self.public))
        (self.public / 'models/house.glb').write_bytes(fixture_glb({'images': [{'uri': '../textures/tile/albedo.webp'}]}))
        self.finish()


if __name__ == '__main__':
    unittest.main()
