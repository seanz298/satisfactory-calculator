#!/usr/bin/env python3
"""Build and package only maintained sources and required runtime assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from build import build

ROOT = Path(__file__).resolve().parents[1]

def package():
    build()
    output = ROOT / 'dist' / 'satisfactory-calculator-source.zip'
    output.parent.mkdir(exist_ok=True)
    files = [ROOT / name for name in (
        '.gitignore', '.nojekyll', 'index.html', 'README.md', 'README.en.md',
        'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md',
    )]
    extensions = {'.js', '.cjs', '.json', '.css', '.html', '.py', '.wasm'}
    for folder in ('src', 'data', 'scripts', 'tests', 'tools', 'vendor'):
        files.extend(p for p in (ROOT / folder).rglob('*')
                     if p.is_file() and '__pycache__' not in p.parts
                     and (p.suffix in extensions or 'LICENSE' in p.name)
                     and not p.name.startswith(('generated-', 'failed-')))
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for path in sorted(set(files)):
            archive.write(path, 'satisfactory-calculator/' + path.relative_to(ROOT).as_posix())
    print(f'Packaged {output.name}: {output.stat().st_size:,} bytes')

if __name__ == '__main__':
    package()
