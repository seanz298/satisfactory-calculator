#!/usr/bin/env python3
"""Build an offline-capable index.html using Python 3 standard libraries only."""
from pathlib import Path
import base64
import gzip
import json

ROOT = Path(__file__).resolve().parents[1]
DATA_KEYS = ('translations', 'data', 'icons', 'map', 'terrain', 'optimization')

def build():
    bundle = {key: json.loads((ROOT / 'data' / f'{key}.json').read_text(encoding='utf-8')) for key in DATA_KEYS}
    bundle['optimizerRuntime'] = {'loader': (ROOT / 'vendor/highs/highs.js').read_text(), 'wasm': base64.b64encode((ROOT / 'vendor/highs/highs.wasm').read_bytes()).decode('ascii'), 'core': (ROOT / 'src/optimizer-core.js').read_text()}
    payload = json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    encoded = base64.b64encode(gzip.compress(payload, compresslevel=9, mtime=0)).decode('ascii')
    read = lambda name: (ROOT / 'src' / name).read_text(encoding='utf-8')
    bootstrap = read('bootstrap.js')
    if bootstrap.count('__BUNDLE_BASE64__') != 1:
        raise ValueError('Expected one bundle placeholder in bootstrap.js')
    pieces = {
        '<!--APP_STYLES-->': '<style>\n' + read('styles.css') + '\n</style>',
        '<!--SOLVER-->': '<script>\n' + read('solver.js') + '\n</script>',
        '<!--APP_CODE-->': '<script id="factorySource" type="text/plain">\n' + (read('plan-files.js') + '\n' + read('optimizer-core.js') + '\n' + read('app.js') + '\n' + read('optimizer-ui.js')) + '\n</script>',
        '<!--BOOTSTRAP-->': '<script>\n' + bootstrap.replace('__BUNDLE_BASE64__', encoded) + '\n</script>',
    }
    html = read('template.html')
    for marker, value in pieces.items():
        if html.count(marker) != 1:
            raise ValueError(f'Expected one {marker} in template.html')
        html = html.replace(marker, value)
    target = ROOT / 'index.html'
    target.write_text(html, encoding='utf-8')
    print(f'Built {target.name}: {target.stat().st_size:,} bytes')

if __name__ == '__main__':
    build()
