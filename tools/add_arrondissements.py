#!/usr/bin/env python3
"""Ajoute le champ "arr" (n° d'arrondissement, ou null hors Paris) à data/invaders.json,
à partir des polygones officiels opendata.paris.fr (data/arrondissements.geojson)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def point_in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geom(lng, lat, geom):
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    for poly in polys:
        if point_in_ring(lng, lat, poly[0]) and not any(point_in_ring(lng, lat, hole) for hole in poly[1:]):
            return True
    return False


def main():
    arrs = json.load(open(ROOT / 'data/arrondissements.geojson'))['features']
    invaders = json.load(open(ROOT / 'data/invaders.json'))
    counts = {}
    for inv in invaders:
        inv['arr'] = None
        if inv['city'] == 'PA':
            for f in arrs:
                if point_in_geom(inv['lng'], inv['lat'], f['geometry']):
                    inv['arr'] = f['properties']['c_ar']
                    break
        if inv['city'] == 'PA':
            counts[inv['arr']] = counts.get(inv['arr'], 0) + 1
    json.dump(invaders, open(ROOT / 'data/invaders.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    print('PA par arrondissement:', dict(sorted(counts.items(), key=lambda x: (x[0] is None, x[0]))))


if __name__ == '__main__':
    main()
