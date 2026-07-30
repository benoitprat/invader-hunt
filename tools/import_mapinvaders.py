#!/usr/bin/env python3
"""Reconstruit data/invaders.json depuis les sources de MapInvaders (chborel.ch),
plus à jour que le dataset goguelnikov d'origine :
  - mi_invaders.json : coordonnées + statut + hint
  - invader_spotter2_data_clean.json : points + statut de secours
  - manual_map.json : ajouts manuels de coordonnées
Lancer ensuite tools/add_arrondissements.py puis tools/bump_build.py."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    'mi': 'https://chborel.ch/mapinvaders/json/invaders.json',
    'spotter': 'https://chborel.ch/wp-content/uploads/2024/08/invader_spotter2_data_clean.json',
    'manual': 'https://chborel.ch/wp-content/uploads/2024/08/manual_map.json',
}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'invader-hunt'})) as r:
        return json.loads(r.read().decode('utf-8-sig'))


def main():
    mi = fetch(SOURCES['mi'])
    spotter = fetch(SOURCES['spotter'])['invaders']
    manual = fetch(SOURCES['manual'])

    coords = {}
    for x in manual + mi:  # mi écrase manual en cas de doublon
        if x.get('obf_lat') is not None and x.get('obf_lng') is not None:
            coords[x['id']] = x

    out = []
    for iid, x in sorted(coords.items()):
        sp = spotter.get(iid, {})
        try:
            pts = int(sp.get('point') or 0)
        except ValueError:
            pts = 0
        out.append({
            'id': iid,
            'city': iid.split('_')[0] if '_' in iid else iid,
            'lat': round(float(x['obf_lat']), 6),
            'lng': round(float(x['obf_lng']), 6),
            'status': x.get('status') or sp.get('status') or '',
            'pts': pts,
            'hint': x.get('hint') or '',
            'arr': None,  # rempli par add_arrondissements.py
        })
    # observations de terrain (data/overrides.json) : prioritaires sur les sources
    ov_path = ROOT / 'data/overrides.json'
    if ov_path.exists():
        overrides = {k: v for k, v in json.load(open(ov_path)).items() if not k.startswith('_')}
        applied = 0
        for x in out:
            if x['id'] in overrides:
                x['status'] = overrides[x['id']]['status']
                applied += 1
        print(f'overrides appliqués: {applied}/{len(overrides)}')

    json.dump(out, open(ROOT / 'data/invaders.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    pa = [x for x in out if x['city'] == 'PA']
    print(f'total: {len(out)} | PA: {len(pa)} | PA max: {max(int(x["id"].split("_")[1]) for x in pa)}')
    print(f'sans points: {sum(1 for x in out if not x["pts"])} | sans statut: {sum(1 for x in out if not x["status"])}')


if __name__ == '__main__':
    main()
