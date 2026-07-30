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
    # jeu plus complet : sert uniquement à combler les points manquants du précédent
    'spotter_full': 'https://chborel.ch/wp-content/uploads/2024/08/invader_spotter_data_clean_test.json',
    'manual': 'https://chborel.ch/wp-content/uploads/2024/08/manual_map.json',
}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'invader-hunt'})) as r:
        return json.loads(r.read().decode('utf-8-sig'))


def points_of(entry):
    try:
        return int(entry.get('point') or 0)
    except (ValueError, TypeError):
        return 0


def main():
    mi = fetch(SOURCES['mi'])
    spotter = fetch(SOURCES['spotter'])['invaders']
    spotter_full = fetch(SOURCES['spotter_full'])['invaders']
    manual = fetch(SOURCES['manual'])

    coords = {}
    for x in manual + mi:  # mi écrase manual en cas de doublon
        if x.get('obf_lat') is not None and x.get('obf_lng') is not None:
            coords[x['id']] = x

    out = []
    filled = 0
    for iid, x in sorted(coords.items()):
        sp = spotter.get(iid, {})
        pts = points_of(sp)
        if not pts:  # secours, sans jamais écraser une valeur connue
            pts = points_of(spotter_full.get(iid, {}))
            if pts:
                filled += 1
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
    # observations de terrain (data/overrides.json) : prioritaires sur les sources.
    # Une entrée peut corriger un invader existant ou en ajouter un que la source
    # ne localise pas encore, si elle porte "lat" et "lng".
    ov_path = ROOT / 'data/overrides.json'
    if ov_path.exists():
        overrides = {k: v for k, v in json.load(open(ov_path)).items() if not k.startswith('_')}
        connus = {x['id'] for x in out}
        corriges = ajoutes = 0
        for x in out:
            ov = overrides.get(x['id'])
            if not ov:
                continue
            if ov.get('status'):
                x['status'] = ov['status']
            if ov.get('lat') is not None and ov.get('lng') is not None:
                x['lat'], x['lng'] = round(float(ov['lat']), 6), round(float(ov['lng']), 6)
            if ov.get('pts'):
                x['pts'] = int(ov['pts'])
            corriges += 1
        for iid, ov in sorted(overrides.items()):
            if iid in connus:
                continue
            if ov.get('lat') is None or ov.get('lng') is None:
                print(f"  ignoré (ni dans la source, ni de coordonnées) : {iid}")
                continue
            out.append({
                'id': iid,
                'city': iid.split('_')[0] if '_' in iid else iid,
                'lat': round(float(ov['lat']), 6),
                'lng': round(float(ov['lng']), 6),
                'status': ov.get('status') or 'OK',
                'pts': int(ov.get('pts') or 0),
                'hint': ov.get('note') or '',
                'arr': None,
            })
            ajoutes += 1
        out.sort(key=lambda x: x['id'])
        print(f'observations de terrain : {corriges} corrigés, {ajoutes} ajoutés')

    json.dump(out, open(ROOT / 'data/invaders.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    pa = [x for x in out if x['city'] == 'PA']
    print(f'total: {len(out)} | PA: {len(pa)} | PA max: {max(int(x["id"].split("_")[1]) for x in pa)}')
    print(f'points comblés via spotter_full: {filled}')
    print(f'sans points: {sum(1 for x in out if not x["pts"])} | sans statut: {sum(1 for x in out if not x["status"])}')


if __name__ == '__main__':
    main()
