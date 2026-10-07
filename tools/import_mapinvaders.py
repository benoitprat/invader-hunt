#!/usr/bin/env python3
"""Reconstruit data/invaders.json depuis les sources de MapInvaders (chborel.ch),
plus à jour que le dataset goguelnikov d'origine :
  - mi_invaders.json : coordonnées + statut + hint
  - invader_spotter2_data_clean.json : points + statut de secours
  - manual_map.json : ajouts manuels de coordonnées
  - findvaders.json : coordonnées de dernier recours, comme sur la carte MapInvaders
    (y arrivent souvent en premier les invasions récentes, ex. Stockholm 2026)
Lancer ensuite tools/add_arrondissements.py puis tools/bump_build.py."""
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    'mi': 'https://chborel.ch/mapinvaders/json/invaders.json',
    'spotter': 'https://chborel.ch/wp-content/uploads/2024/08/invader_spotter2_data_clean.json',
    # jeu plus complet : sert uniquement à combler les points manquants du précédent
    'spotter_full': 'https://chborel.ch/wp-content/uploads/2024/08/invader_spotter_data_clean_test.json',
    'manual': 'https://chborel.ch/wp-content/uploads/2024/08/manual_map.json',
    'findvaders': 'https://chborel.ch/mapinvaders/json/findvaders.json',
}

# Les sources mélangent les casses (destroyed / DESTROYED…) alors que l'app ne
# reconnaît que les formes minuscules : sans cette table, un « DESTROYED »
# restait affiché comme cible à flasher.
STATUTS = {'ok': 'OK', 'destroyed': 'destroyed', 'damaged': 'damaged', 'degraded': 'damaged',
           'hidden': 'hidden', 'notvisible': 'hidden', 'unknown': ''}


def statut(s):
    s = (s or '').strip()
    return STATUTS.get(s.lower(), s.lower())


def fetch(url, essais=4):
    # chborel.ch coupe parfois la connexion en plein transfert : on réessaie
    for n in range(essais):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'invader-hunt'}), timeout=120) as r:
                return json.loads(r.read().decode('utf-8-sig'))
        except Exception:
            if n == essais - 1:
                raise
            time.sleep(3 * (n + 1))


def points_of(entry):
    try:
        return int(entry.get('point') or 0)
    except (ValueError, TypeError):
        return 0


# Premier relevé de l'historique invader-spotter : un instantané de toute la base,
# pas une date d'apparition.
INSTANTANE = '2024-10-09'
MORTS = {'destroyed', 'hidden'}


def date_fv(s):
    """'27/09/26' (Findvaders) -> '2026-09-27', ou '' si absente."""
    try:
        j, m, a = s.split('/')
        return f'20{a}-{m}-{j}'
    except (AttributeError, ValueError):
        return ''


def derniere_observation(iid, spotter_full, fv):
    """(date, statut) de la dernière observation datée, si invader-spotter et Findvaders
    la donnent tous deux et s'accordent sur vivant / disparu ; sinon None."""
    hist = [h for h in (spotter_full.get(iid) or {}).get('status_history') or [] if h.get('update_date')]
    f = fv.get(iid) or {}
    df = date_fv(f.get('LastStatusUpdate'))
    if not hist or not df:
        return None
    h = max(hist, key=lambda h: h['update_date'])
    sp, sf = statut(h.get('status')), statut(f.get('status'))
    if (sp in MORTS) != (sf in MORTS):
        return None
    return max((h['update_date'], sp), (df, sf))


def apparition(iid, spotter, spotter_full, fv, fv_seuls, ov, mort_avant=False):
    """(date, réactivé) de la dernière (ré)apparition connue de l'invader, ou (None, False).

    Pose : date_pos d'invader-spotter, sinon première date de l'historique si elle
    est postérieure à l'instantané initial. Réactivation : dernier passage d'un état
    mort à OK, à condition que l'invader ait été vu en place avant. Les nouveaux
    arrivent parfois avec une première entrée « détruit » factice (Stockholm), qui
    ne doit pas compter comme réactivation."""
    pose = (spotter.get(iid) or {}).get('date_pos') or None
    hist = sorted((h for h in (spotter_full.get(iid) or {}).get('status_history') or [] if h.get('update_date')),
                  key=lambda h: h['update_date'])
    if not pose and hist and hist[0]['update_date'] > INSTANTANE:
        pose = hist[0]['update_date']
    react = None
    # un invader déjà présent dans l'instantané existait avant : ses réactivations sont réelles
    vu_en_place = bool(hist) and hist[0]['update_date'] == INSTANTANE and (pose or '') <= INSTANTANE
    for a, b in zip(hist, hist[1:]):
        if (a.get('status') or '').lower() not in MORTS:
            vu_en_place = True
        if (a.get('status') or '').lower() in MORTS and b.get('status') == 'OK' and vu_en_place:
            react = b['update_date']
    # observations de terrain : un « OK » daté sur un invader que les sources disaient
    # disparu, sans réactivation connue, est une réactivation constatée sur place. Sinon
    # c'est une confirmation, qui ne doit pas déplacer la vraie date de réactivation.
    # Une position datée sans date de pose connue vaut date d'apparition.
    if ov and ov.get('date'):
        if statut(ov.get('status')) == 'OK':
            if not react and mort_avant:
                react = ov['date']
        elif not pose and ov.get('lat') is not None:
            pose = ov['date']
    # invaders connus du seul Findvaders : sa date de dernier changement, à défaut
    if not pose and not react and iid in fv_seuls:
        pose = date_fv((fv.get(iid) or {}).get('LastStatusUpdate')) or None
    if react and react >= (pose or ''):
        return react, True
    return pose, False


def main():
    mi = fetch(SOURCES['mi'])
    spotter = fetch(SOURCES['spotter'])['invaders']
    spotter_full = fetch(SOURCES['spotter_full'])['invaders']
    manual = fetch(SOURCES['manual'])
    fv = {x['Invader_ID']: x for x in fetch(SOURCES['findvaders'])['invaders'] if x.get('Invader_ID')}

    def fv_points(iid):
        try:
            return int(fv.get(iid, {}).get('points') or 0)
        except (ValueError, TypeError):
            return 0

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
            pts = points_of(spotter_full.get(iid, {})) or fv_points(iid)
            if pts:
                filled += 1
        out.append({
            'id': iid,
            'city': iid.split('_')[0] if '_' in iid else iid,
            'lat': round(float(x['obf_lat']), 6),
            'lng': round(float(x['obf_lng']), 6),
            'status': statut(x.get('status') or sp.get('status')),
            'pts': pts,
            'hint': x.get('hint') or '',
            'arr': None,  # rempli par add_arrondissements.py
        })
    # Findvaders en dernier recours (même priorité que la carte MapInvaders) :
    # seulement les invaders qu'aucune autre source ne localise
    via_fv = 0
    fv_seuls = set()
    for iid, x in sorted(fv.items()):
        if iid in coords or not x.get('Latitude') or not x.get('Longitude'):
            continue
        out.append({
            'id': iid,
            'city': iid.split('_')[0] if '_' in iid else iid,
            'lat': round(float(x['Latitude']), 6),
            'lng': round(float(x['Longitude']), 6),
            'status': statut(x.get('status') or spotter.get(iid, {}).get('status')),
            'pts': points_of(spotter.get(iid, {})) or points_of(spotter_full.get(iid, {})) or fv_points(iid),
            'hint': '',
            'arr': None,
        })
        via_fv += 1
        fv_seuls.add(iid)
    out.sort(key=lambda x: x['id'])
    # Statut : MapInvaders n'est pas daté et prend parfois des semaines de retard
    # (réactivations parisiennes de septembre 2026 encore « détruites »). Quand les
    # deux sources datées, invader-spotter et Findvaders, s'accordent sur une
    # observation de moins de 90 jours qui contredit MapInvaders, on les suit.
    recent = time.strftime('%Y-%m-%d', time.localtime(time.time() - 90 * 86400))
    rattrapes = 0
    for x in out:
        obs = derniere_observation(x['id'], spotter_full, fv)
        if obs and obs[0] >= recent and (obs[1] in MORTS) != (x['status'] in MORTS):
            x['status'] = obs[1]
            rattrapes += 1
    # observations de terrain (data/overrides.json) : prioritaires sur les sources.
    # Une entrée peut corriger un invader existant ou en ajouter un que la source
    # ne localise pas encore, si elle porte "lat" et "lng".
    # statut d'après les sources, avant les relevés de terrain (sert à dater les réactivations)
    avant = {x['id']: x['status'] for x in out}
    ov_path = ROOT / 'data/overrides.json'
    overrides = {}
    if ov_path.exists():
        overrides = {k: v for k, v in json.load(open(ov_path)).items() if not k.startswith('_')}
        connus = {x['id'] for x in out}
        corriges = ajoutes = 0
        for x in out:
            ov = overrides.get(x['id'])
            if not ov:
                continue
            if ov.get('status'):
                x['status'] = statut(ov['status'])
            if ov.get('lat') is not None and ov.get('lng') is not None:
                x['lat'], x['lng'] = round(float(ov['lat']), 6), round(float(ov['lng']), 6)
                if not x['hint'] and ov.get('note'):
                    x['hint'] = ov['note']  # position venue du terrain : on le dit dans la fiche
            if ov.get('pts'):
                x['pts'] = int(ov['pts'])
            corriges += 1
        for iid, ov in sorted(overrides.items()):
            if iid in connus:
                continue
            if ov.get('lat') is None or ov.get('lng') is None:
                print(f"  ignoré (ni dans la source, ni de coordonnées) : {iid}")
                continue
            # points : ceux du relevé, sinon ceux que les sources connaissent déjà
            pts = int(ov.get('pts') or 0) or points_of(spotter.get(iid, {})) or points_of(spotter_full.get(iid, {})) or fv_points(iid)
            out.append({
                'id': iid,
                'city': iid.split('_')[0] if '_' in iid else iid,
                'lat': round(float(ov['lat']), 6),
                'lng': round(float(ov['lng']), 6),
                'status': statut(ov.get('status')) or 'OK',
                'pts': pts,
                'hint': ov.get('note') or '',
                'arr': None,
            })
            ajoutes += 1
        out.sort(key=lambda x: x['id'])
        print(f'observations de terrain : {corriges} corrigés, {ajoutes} ajoutés')

    # Date de (ré)apparition, pour mettre en avant dans l'app les invaders récents
    # (« seen », et « react »: 1 si c'est une réactivation). Seulement sur la dernière
    # année : l'app propose des périodes de 30 à 180 jours, et la base reste légère.
    limite = time.strftime('%Y-%m-%d', time.localtime(time.time() - 365 * 86400))
    recents = reactives = 0
    for x in out:
        seen, react = apparition(x['id'], spotter, spotter_full, fv, fv_seuls, overrides.get(x['id']),
                                 avant.get(x['id']) in MORTS)
        if seen and seen >= limite:
            x['seen'] = seen
            if react:
                x['react'] = 1
                reactives += 1
            recents += 1
    print(f'apparus ou réactivés depuis un an: {recents} (dont {reactives} réactivations)')

    json.dump(out, open(ROOT / 'data/invaders.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    pa = [x for x in out if x['city'] == 'PA']
    print(f'total: {len(out)} | PA: {len(pa)} | PA max: {max(int(x["id"].split("_")[1]) for x in pa)}')
    print(f'points comblés via spotter_full / findvaders: {filled}')
    print(f'localisés uniquement par findvaders: {via_fv}')
    print(f'statuts rattrapés sur les sources datées (< 90 j): {rattrapes}')
    print(f'sans points: {sum(1 for x in out if not x["pts"])} | sans statut: {sum(1 for x in out if not x["status"])}')


if __name__ == '__main__':
    main()
