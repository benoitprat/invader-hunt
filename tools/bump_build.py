#!/usr/bin/env python3
"""Stampe un nouveau numéro de build dans version.js et sw.js.
À lancer avant chaque commit destiné au déploiement : le changement de nom de
cache force les PWA installées à récupérer la nouvelle version."""
import datetime
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
build = datetime.datetime.now().strftime('%Y-%m-%d.%H%M')

(ROOT / 'version.js').write_text(f"const BUILD = '{build}';\n")

sw = ROOT / 'sw.js'
sw.write_text(re.sub(r"const CACHE = 'invader-hunt-[^']*';",
                     f"const CACHE = 'invader-hunt-{build}';",
                     sw.read_text(), count=1))
print('build:', build)
