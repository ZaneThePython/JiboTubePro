"""Package only the app, documentation, and store metadata for BEacon upload."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent
output = root.parent / 'JiboTube.zip'
with ZipFile(output, 'w', ZIP_DEFLATED, strict_timestamps=False) as archive:
    for name in ('manifest.json', 'icon.png', 'README.md'):
        archive.write(root / name, name)
    for file in sorted((root / 'jibotube').rglob('*')):
        if file.is_file() and 'tests' not in file.relative_to(root).parts:
            archive.write(file, file.relative_to(root).as_posix())
print(output)
