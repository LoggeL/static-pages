"""Linear lightmap denoising and RGBM; build-time only, no pip dependencies."""
import ctypes
import math
from pathlib import Path
import struct
import sys
import zlib

import numpy as np


def write_png(path, pixels):
    """Write exact RGBA8 bytes, with no sRGB/gamma or alpha conversion."""
    height, width, channels = pixels.shape
    assert channels == 4 and pixels.dtype == np.uint8
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = []
    previous = np.zeros(width * 4, dtype=np.int16)
    for row in pixels:
        current = row.reshape(-1).astype(np.int16)
        left = np.pad(current[:-4], (4, 0))
        upper_left = np.pad(previous[:-4], (4, 0))
        p = left + previous - upper_left
        a, b, c = abs(p - left), abs(p - previous), abs(p - upper_left)
        paeth = np.where((a <= b) & (a <= c), left, np.where(b <= c, previous, upper_left))
        choices = [current, current-left, current-previous, current-(left+previous)//2, current-paeth]
        scores = [np.abs(((choice + 128) % 256) - 128).sum() for choice in choices]
        kind = int(np.argmin(scores))
        rows.append(bytes([kind]) + choices[kind].astype(np.uint8).tobytes())
        previous = current
    rows = b''.join(rows)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    Path(path).write_bytes(data)


class LightmapDenoiser:
    """OIDN's HDR color filter. CPU denoise; Cycles transport uses Metal."""
    def __init__(self):
        import bpy
        root = Path(bpy.app.binary_path).resolve().parent.parent / 'Resources' / 'lib'
        candidates = [root / 'libOpenImageDenoise.dylib', Path('/Applications/Blender.app/Contents/Resources/lib/libOpenImageDenoise.dylib')]
        library = next((p for p in candidates if p.exists()), None)
        if library is None:
            raise RuntimeError('Blender OpenImageDenoise library not found; denoising is required.')
        self.lib = ctypes.CDLL(str(library))
        ptr, cstr, size = ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t
        specs = {
            'oidnNewDevice': ([ctypes.c_int], ptr),
            'oidnCommitDevice': ([ptr], None),
            'oidnNewFilter': ([ptr, cstr], ptr),
            'oidnSetSharedFilterImage': ([ptr, cstr, ptr, ctypes.c_int, size, size, size, size, size], None),
            'oidnSetFilterInt': ([ptr, cstr, ctypes.c_int], None),
            'oidnSetFilterBool': ([ptr, cstr, ctypes.c_bool], None),
            'oidnCommitFilter': ([ptr], None),
            'oidnExecuteFilter': ([ptr], None),
            'oidnGetDeviceError': ([ptr, ctypes.POINTER(cstr)], ctypes.c_int),
            'oidnReleaseFilter': ([ptr], None),
            'oidnReleaseDevice': ([ptr], None),
        }
        for name, (args, result) in specs.items():
            function = getattr(self.lib, name); function.argtypes = args; function.restype = result
        self.device = self.lib.oidnNewDevice(1)  # OIDN_DEVICE_TYPE_CPU
        self.lib.oidnCommitDevice(self.device)
        self.filter = self.lib.oidnNewFilter(self.device, b'RT')
        self.lib.oidnSetFilterBool(self.filter, b'hdr', True)
        self.lib.oidnSetFilterInt(self.filter, b'quality', 6)  # OIDN_QUALITY_HIGH
        self.lib.oidnSetFilterInt(self.filter, b'maxMemoryMB', 2048)
        self.check()

    def check(self):
        message = ctypes.c_char_p()
        code = self.lib.oidnGetDeviceError(self.device, ctypes.byref(message))
        if code:
            raise RuntimeError(f'OIDN {code}: {message.value.decode() if message.value else "unknown error"}')

    def __call__(self, rgb):
        color = np.ascontiguousarray(rgb, dtype=np.float32)
        result = np.empty_like(color)
        height, width, _ = color.shape
        for name, array in [(b'color', color), (b'output', result)]:
            self.lib.oidnSetSharedFilterImage(self.filter, name, ctypes.c_void_p(array.ctypes.data), 3, width, height, 0, 0, 0)
        self.lib.oidnCommitFilter(self.filter); self.check()
        self.lib.oidnExecuteFilter(self.filter); self.check()
        return np.maximum(result, 0)

    def close(self):
        self.lib.oidnReleaseFilter(self.filter)
        self.lib.oidnReleaseDevice(self.device)


def encode_rgbm(rgb, minimum_range=1, color_bits=7, multiplier_steps='powersOfTwo', quadratic_above=4):
    if not np.isfinite(rgb).all():
        raise ValueError('Non-finite lightmap pixels')
    rgb = np.maximum(rgb, 0)
    peak = float(rgb.max())
    value_range = max(float(minimum_range), 2 ** math.ceil(math.log2(max(peak, 1e-12))))
    exponent = 2 if value_range >= quadratic_above else 1
    if not 5 <= color_bits <= 8: raise ValueError('RGBM color precision must be 5 to 8 bits')
    multiplier = np.clip(np.ceil((rgb.max(axis=2) / value_range)**(1/exponent) * 255), 1, 255)
    if multiplier_steps == 'powersOfTwo':
        multiplier = np.minimum(np.exp2(np.ceil(np.log2(multiplier))), 255)
    elif multiplier_steps != 'linear':
        raise ValueError('Unknown RGBM multiplier steps')
    multiplier = multiplier.astype(np.uint8)
    levels = 2**color_bits-1
    scale = (multiplier[..., None].astype(np.float32)/255)**exponent * value_range
    fraction = rgb / scale
    color = np.rint(np.rint(fraction*levels).clip(0,levels)/levels*255).astype(np.uint8)
    rgba = np.dstack((color, multiplier))
    decoded = color.astype(np.float32) / 255 * scale
    error = np.abs(decoded - rgb)
    return rgba, value_range, {
        'peakLinear': peak, 'meanLinear': float(rgb.mean()),
        'quantizationMaxAbs': float(error.max()), 'quantizationMeanAbs': float(error.mean()),
        'colorPrecisionBits': color_bits, 'multiplierSteps': multiplier_steps,
        'multiplierExponent': exponent,
        'clippedPixels': int((rgb.max(axis=2) > value_range).sum()),
    }
