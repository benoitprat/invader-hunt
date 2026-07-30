'use strict';

const GALLERY_API = 'https://api.space-invaders.com/flashinvaders_v3_pas_trop_predictif/api/gallery?uid=';
const OSRM = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CORRIDOR_M = 200;        // écart max au trajet direct
const MAX_WAYPOINTS = 60;      // limite de points intermédiaires envoyés à OSRM
const FLASH_CACHE_TTL = 6 * 3600 * 1000;
const DEAD_STATUSES = new Set(['destroyed', 'hidden']);

let map, invaders = [], flashed = new Set(), playerName = '';
let officialCounts = null;
let userPos = null, startPoint = null, destPoint = null;
let userMarker = null, accCircle = null, startMarker = null, destMarker = null;
let directLine = null, routeLine = null, routeStopsLayer = null, randoCircle = null;
let layerUnflashed, layerFlashedGrp, layerDestroyed, layerHidden;
let watchId = null, firstFix = true;

const $ = id => document.getElementById(id);

// ---------- géométrie (approx. équirectangulaire, suffisant à l'échelle urbaine) ----------
const R = 6371000, RAD = Math.PI / 180;
function toXY(lat, lng, ref) {
  return [(lng - ref.lng) * RAD * R * Math.cos(ref.lat * RAD), (lat - ref.lat) * RAD * R];
}
// distance point-segment + abscisse curviligne du projeté
function projOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx, qy = a[1] + t * dy;
  return { d: Math.hypot(p[0] - qx, p[1] - qy), t };
}
function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// pour un point : distance mini à la polyligne + position le long de celle-ci
function distToLine(p, xy, cum) {
  let best = { d: Infinity, along: 0 };
  for (let i = 0; i < xy.length - 1; i++) {
    const r = projOnSegment(p, xy[i], xy[i + 1]);
    if (r.d < best.d) best = { d: r.d, along: cum[i] + r.t * (cum[i + 1] - cum[i]) };
  }
  return best;
}

// ---------- UI ----------
let toastTimer;
function toast(msg, ms = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function fmtDist(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km'; }
function fmtDur(s) {
  const min = Math.round(s / 60);
  return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
}

// ---------- flashs du joueur ----------
function getUid() { return localStorage.getItem('uid') || ''; }

async function loadFlashed(force = false) {
  const uid = getUid();
  if (!uid) { flashed = new Set(); playerName = ''; throw new Error('UID non renseigné'); }
  const cacheKey = 'flash_' + uid;
  const cached = localStorage.getItem(cacheKey);
  if (!force && cached) {
    try {
      const c = JSON.parse(cached);
      if (Date.now() - c.ts < FLASH_CACHE_TTL) {
        flashed = new Set(c.ids);
        playerName = c.name || '';
        officialCounts = c.counts || null;
        return;
      }
    } catch (e) { /* cache illisible → refetch */ }
  }
  const res = await fetch(GALLERY_API + encodeURIComponent(uid));
  if (!res.ok) throw new Error('API FlashInvaders : HTTP ' + res.status);
  const data = await res.json();
  if (!data.invaders) throw new Error('Réponse inattendue de FlashInvaders');
  flashed = new Set(Object.keys(data.invaders));
  playerName = (data.player && data.player.name) || '';
  // décompte officiel : sert à mesurer le retard de la base communautaire
  const paris = (data.cities || []).find(c => c.name === 'Paris');
  officialCounts = { monde: data.total_si_count || 0, paris: paris ? paris.si_count : 0 };
  localStorage.setItem(cacheKey, JSON.stringify({
    ts: Date.now(), ids: [...flashed], name: playerName, counts: officialCounts
  }));
}

// ---------- marqueurs ----------
// Le calque canvas vit dans le pane qui pivote : il suit donc la rotation tout seul.
// Le redessiner à chaque image du geste (plus de 4000 marqueurs) le faisait décrocher
// visuellement de la carte sur téléphone ; un seul redessin après le geste suffit.
const rendererGetEvents = L.Renderer.prototype.getEvents;
L.Renderer.include({
  getEvents: function () {
    const events = rendererGetEvents.apply(this, arguments);
    const renderer = this;
    let timer;
    events.rotate = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { renderer._update(); }, 150);
    };
    return events;
  }
});

// marge élargie : pendant la rotation, le canvas n'est pas redessiné, il doit donc
// déjà couvrir les coins que la rotation amène dans le champ
const canvasRenderer = () => L.canvas({ padding: 0.5 });

// mode « valeur » : échelle chaude selon les points, statuts recolorés pour ne pas la parasiter
const VALUE_RAMP = [
  { min: 100, fill: '#991b1b', r: 11, ring: '#fbbf24' },
  { min: 50, fill: '#ef4444', r: 8.5 },
  { min: 40, fill: '#f97316', r: 7 },
  { min: 30, fill: '#fb923c', r: 6 },
  { min: 20, fill: '#fcd34d', r: 5 },
  { min: 1, fill: '#fde68a', r: 4 }
];
const VALUE_STATUS = {
  flashed: { radius: 4, color: '#16a34a', fillColor: '#bbf7d0', fillOpacity: .85, weight: 1 },
  destroyed: { radius: 4, color: '#000000', fillColor: '#171717', fillOpacity: .8, weight: 1 },
  hidden: { radius: 5, color: '#6b7280', fillColor: '#9ca3af', fillOpacity: .8, weight: 1.5 },
  unknown: { radius: 4, color: '#6b7280', fillColor: '#f9fafb', fillOpacity: .9, weight: 1 }
};

function colorMode() { return localStorage.getItem('colorMode') === 'value' ? 'value' : 'status'; }

function markerStyle(inv, isFl) {
  if (colorMode() === 'value') {
    if (inv.status === 'hidden') return VALUE_STATUS.hidden;
    if (isDead(inv)) return VALUE_STATUS.destroyed;
    if (isFl) return VALUE_STATUS.flashed;
    if (!inv.pts) return VALUE_STATUS.unknown;
    const t = VALUE_RAMP.find(v => inv.pts >= v.min);
    return { radius: t.r, color: t.ring || '#3f3f46', fillColor: t.fill, fillOpacity: .95, weight: t.ring ? 2.5 : 1 };
  }
  if (inv.status === 'hidden') return { radius: 5, color: '#000000', fillColor: '#1f2937', fillOpacity: .75, weight: 1.5 };
  if (isDead(inv)) return { radius: 4, color: '#b91c1c', fillColor: '#ef4444', fillOpacity: .5, weight: 1 };
  if (isFl) return { radius: 4, color: '#6b7280', fillColor: '#9ca3af', fillOpacity: .6, weight: 1 };
  if (isDamaged(inv)) return { radius: 6, color: '#c2410c', fillColor: '#fb923c', fillOpacity: .9, weight: 1.5 };
  return { radius: 6, color: '#5b21b6', fillColor: '#8b5cf6', fillOpacity: .9, weight: 1.5 };
}

function updateLegend() {
  const val = colorMode() === 'value';
  const paint = (id, s) => {
    const e = $(id);
    e.style.background = s.fillColor;
    e.style.borderColor = s.color;
  };
  paint('sw-todo', val ? { fillColor: '#f97316', color: '#3f3f46' } : { fillColor: '#8b5cf6', color: '#5b21b6' });
  paint('sw-flashed', val ? VALUE_STATUS.flashed : { fillColor: '#9ca3af', color: '#6b7280' });
  paint('sw-dead', val ? VALUE_STATUS.destroyed : { fillColor: '#ef4444', color: '#b91c1c' });
  paint('sw-hidden', val ? VALUE_STATUS.hidden : { fillColor: '#1f2937', color: '#000000' });
  const leg = $('value-legend');
  if (val && !leg.dataset.built) {
    leg.innerHTML = VALUE_RAMP.slice().reverse().map(t => {
      const d = Math.round(t.r * 2);
      return `<div><i style="width:${d}px;height:${d}px;background:${t.fill};border:1px solid ${t.ring || '#3f3f46'}"></i>${t.min === 1 ? 10 : t.min}</div>`;
    }).join('');
    leg.dataset.built = '1';
  }
  leg.hidden = !val;
}
function isDead(inv) { return DEAD_STATUSES.has(inv.status); }
function isDamaged(inv) { return inv.status.includes('damaged'); }

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
// sur iOS le schéma instagram:// lance directement l'app sur le hashtag ; ailleurs, page web
function instaUrl(id) {
  const tag = id.toLowerCase();
  return IS_IOS ? 'instagram://tag?name=' + tag
                : 'https://www.instagram.com/explore/tags/' + tag + '/';
}

function invaderPopup(inv) {
  const state = flashed.has(inv.id) ? '✅ déjà flashé' : '🎯 à flasher';
  const st = inv.status || 'inconnu';
  const hint = inv.hint ? `<br>💡 ${inv.hint}` : '';
  return `<div class="inv-popup"><b>${inv.id}</b> · ${inv.pts} pts<br>${state} · état : ${st}${hint}
    <br><a href="${instaUrl(inv.id)}" target="_blank" rel="noopener">📷 Visuels #${inv.id} sur Instagram</a>
    <button onclick="goToInvader('${inv.id}')">🎯 Y aller</button></div>`;
}

function buildMarkers() {
  if (layerUnflashed) { layerUnflashed.remove(); layerFlashedGrp.remove(); layerDestroyed.remove(); layerHidden.remove(); }
  layerUnflashed = L.layerGroup();
  layerFlashedGrp = L.layerGroup();
  layerDestroyed = L.layerGroup();
  layerHidden = L.layerGroup();
  const rend = canvasRenderer();
  const minPts = +$('min-pts').value;
  for (const inv of invaders) {
    const isFl = flashed.has(inv.id);
    // le filtre de valeur ne concerne que les cibles restantes
    if (minPts && !isFl && !isDead(inv) && inv.status !== 'hidden' && inv.pts < minPts) continue;
    const layer = inv.status === 'hidden' ? layerHidden
      : isDead(inv) ? layerDestroyed
      : isFl ? layerFlashedGrp
      : layerUnflashed;
    L.circleMarker([inv.lat, inv.lng], { ...markerStyle(inv, isFl), renderer: rend })
      .bindPopup(() => invaderPopup(inv))
      .addTo(layer);
  }
  if ($('chk-unflashed').checked) layerUnflashed.addTo(map);
  if ($('chk-flashed').checked) layerFlashedGrp.addTo(map);
  if ($('chk-destroyed').checked) layerDestroyed.addTo(map);
  if ($('chk-hidden').checked) layerHidden.addTo(map);
}

// ---------- géolocalisation ----------
function startGeoloc() {
  if (!navigator.geolocation) { toast('Géolocalisation non disponible'); return; }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const acc = pos.coords.accuracy;
    if (!userMarker) {
      userMarker = L.circleMarker(userPos, { radius: 8, color: '#fff', fillColor: '#2563eb', fillOpacity: 1, weight: 3 }).addTo(map);
      accCircle = L.circle(userPos, { radius: acc, color: '#2563eb', weight: 1, fillOpacity: .08 }).addTo(map);
    } else {
      userMarker.setLatLng(userPos);
      accCircle.setLatLng(userPos).setRadius(acc);
    }
    if (firstFix) { map.setView(userPos, 16); firstFix = false; }
  }, err => {
    toast('Position indisponible — appui long sur la carte pour définir un départ 🚩');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

// ---------- recherche d'adresse ou d'invader ----------
let searchTimer;

// "PA_123", "pa 123", "PA-1" (zéro-padding géré), ou nombre seul → Paris
function findInvaderQuery(q) {
  q = q.trim().toUpperCase().replace(/\s+/g, '');
  let m = q.match(/^([A-Z]+)[_-]?(\d+)$/);
  if (!m && /^\d+$/.test(q)) m = [null, 'PA', q];
  if (!m) return null;
  const [, city, num] = m;
  for (const pad of [num, num.padStart(2, '0'), num.padStart(3, '0')]) {
    const inv = invaders.find(i => i.id === city + '_' + pad);
    if (inv) return inv;
  }
  return null;
}

function goToFoundInvader(inv) {
  $('search-results').hidden = true;
  $('search').blur();
  const notes = [];
  if (flashed.has(inv.id)) notes.push('déjà flashé ✅');
  if (isDead(inv)) notes.push('statut : ' + inv.status + ' ⚠️');
  if (notes.length) toast(`${inv.id} — ${notes.join(' · ')}`, 4000);
  setDestination({ lat: inv.lat, lng: inv.lng }, inv.id);
}

async function doSearch(q, direct) {
  const inv = findInvaderQuery(q);
  const box = $('search-results');
  if (inv && direct) { goToFoundInvader(inv); return; }
  box.innerHTML = '';
  if (inv) {
    const div = document.createElement('div');
    const st = flashed.has(inv.id) ? ' · déjà flashé ✅' : (isDead(inv) ? ` · ${inv.status} ⚠️` : '');
    div.textContent = `👾 ${inv.id} — ${inv.pts || '?'} pts${st}`;
    div.onclick = () => goToFoundInvader(inv);
    box.appendChild(div);
    box.hidden = false;
    return; // un id d'invader n'est pas une adresse : inutile d'interroger Nominatim
  }
  const url = `${NOMINATIM}?format=jsonv2&limit=5&accept-language=fr&countrycodes=fr&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  const results = await res.json();
  if (!results.length) { box.hidden = true; toast('Aucun résultat'); return; }
  for (const r of results) {
    const div = document.createElement('div');
    div.textContent = r.display_name;
    div.onclick = () => {
      box.hidden = true;
      $('search').blur();
      setDestination({ lat: +r.lat, lng: +r.lon }, r.display_name.split(',')[0]);
    };
    box.appendChild(div);
  }
  box.hidden = false;
}

// ---------- départ / destination ----------
function setStart(p) {
  startPoint = p;
  if (startMarker) startMarker.remove();
  startMarker = L.marker(p, { title: 'Départ' }).addTo(map);
  const div = document.createElement('div');
  div.className = 'ctx-popup';
  div.innerHTML = '🚩 Départ manuel (prioritaire sur le GPS)';
  const b = document.createElement('button');
  b.textContent = '✖️ Supprimer, revenir à ma position';
  b.onclick = clearStart;
  div.appendChild(b);
  startMarker.bindPopup(div);
  if (destPoint) computeRoute();
}
function clearStart() {
  startPoint = null;
  if (startMarker) { startMarker.remove(); startMarker = null; }
  map.closePopup();
  toast('Départ : ma position 📍');
  if (destPoint) computeRoute();
}
function setDestination(p, label) {
  destPoint = p;
  if (destMarker) destMarker.remove();
  destMarker = L.marker(p, { title: 'Destination' }).addTo(map).bindPopup('🎯 ' + (label || 'Destination'));
  computeRoute();
}
window.goToInvader = function (id) {
  const inv = invaders.find(i => i.id === id);
  if (inv) { map.closePopup(); setDestination({ lat: inv.lat, lng: inv.lng }, id); }
};

// ---------- calcul d'itinéraire ----------
async function osrmRoute(points) {
  const coords = points.map(p => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
  const res = await fetch(`${OSRM}${coords}?overview=full&geometries=geojson&steps=false`);
  if (!res.ok) throw new Error('Routage : HTTP ' + res.status);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes.length) throw new Error('Pas d’itinéraire trouvé');
  return data.routes[0];
}

// tournée optimisée (TSP) : renvoie {trip, order} où order[i] = rang de visite du i-e point d'entrée
async function osrmTrip(points, roundtrip) {
  const base = OSRM.replace('/route/', '/trip/');
  const coords = points.map(p => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
  const res = await fetch(`${base}${coords}?roundtrip=${roundtrip}&source=first${roundtrip ? '' : '&destination=last'}&overview=full&geometries=geojson&steps=false`);
  if (!res.ok) throw new Error('Routage : HTTP ' + res.status);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.trips.length) throw new Error('Pas de tournée trouvée');
  return { trip: data.trips[0], order: data.waypoints.map(w => w.waypoint_index) };
}

function clearRoute() {
  for (const l of [directLine, routeLine, routeStopsLayer, randoCircle]) if (l) l.remove();
  directLine = routeLine = routeStopsLayer = randoCircle = null;
  if (destMarker) { destMarker.remove(); destMarker = null; }
  destPoint = null;
  $('route-panel').hidden = true;
}

async function computeRoute() {
  const start = startPoint || userPos; // un départ posé manuellement prime sur le GPS
  if (!start) { toast('Position inconnue : appuyez sur 📍 ou faites un appui long sur la carte pour poser un départ 🚩'); return; }
  if (!destPoint) return;
  toast('Calcul de l’itinéraire… 👾', 8000);
  try {
    // 1. trajet direct
    const direct = await osrmRoute([start, destPoint]);
    const ref = start;
    const xy = direct.geometry.coordinates.map(c => toXY(c[1], c[0], ref));
    const cum = [0];
    for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));

    // 2. invaders candidats dans le corridor
    let candidates = [];
    for (const inv of invaders) {
      if (flashed.has(inv.id) || isDead(inv)) continue;
      const r = distToLine(toXY(inv.lat, inv.lng, ref), xy, cum);
      if (r.d <= CORRIDOR_M) candidates.push({ inv, along: r.along, gap: r.d });
    }
    // si trop nombreux : on garde les plus proches du chemin (détour minimal)
    if (candidates.length > MAX_WAYPOINTS) {
      candidates.sort((a, b) => a.gap - b.gap);
      candidates = candidates.slice(0, MAX_WAYPOINTS);
    }
    candidates.sort((a, b) => a.along - b.along);

    // 3. itinéraire optimisé via les invaders
    let route = direct, stops = [];
    if (candidates.length) {
      const pts = [start, ...candidates.map(c => ({ lat: c.inv.lat, lng: c.inv.lng })), destPoint];
      route = await osrmRoute(pts);
      stops = candidates;
    }

    drawRoute(direct, route, stops, '👾');
  } catch (e) {
    toast('Erreur : ' + e.message, 5000);
  }
}

function drawRoute(direct, route, stops, emoji) {
  for (const l of [directLine, routeLine, routeStopsLayer]) if (l) l.remove();
  directLine = null;
  if (direct) {
    const directCoords = direct.geometry.coordinates.map(c => [c[1], c[0]]);
    directLine = L.polyline(directCoords, { color: '#6b7280', weight: 3, dashArray: '6 8', opacity: .7 }).addTo(map);
  }
  const routeCoords = route.geometry.coordinates.map(c => [c[1], c[0]]);
  routeLine = L.polyline(routeCoords, { color: '#7c3aed', weight: 5, opacity: .85 }).addTo(map);
  routeStopsLayer = L.layerGroup().addTo(map);
  stops.forEach((s, i) => {
    L.marker([s.inv.lat, s.inv.lng], {
      icon: L.divIcon({
        className: '', iconSize: [22, 22],
        html: `<div style="background:#7c3aed;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${i + 1}</div>`
      })
    }).bindPopup(() => invaderPopup(s.inv)).addTo(routeStopsLayer);
  });
  map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

  const pts = stops.reduce((s, c) => s + c.inv.pts, 0);
  let line2 = `🚶 ${fmtDist(route.distance)} · ${fmtDur(route.duration)}`;
  if (direct) {
    const extraD = route.distance - direct.distance;
    const extraT = route.duration - direct.duration;
    line2 += ` <span class="muted">(direct : ${fmtDist(direct.distance)}, +${fmtDist(Math.max(0, extraD))} / +${fmtDur(Math.max(0, extraT))})</span>`;
  }
  $('route-summary').innerHTML =
    `${emoji} <b>${stops.length} invader${stops.length > 1 ? 's' : ''}</b> à flasher · <b>${pts} pts</b><br>` + line2;
  const list = $('route-list');
  list.innerHTML = '';
  stops.forEach((s, i) => {
    const div = document.createElement('div');
    div.innerHTML = `<span>${i + 1}. ${s.inv.id}${isDamaged(s.inv) ? ' ⚠️' : ''}</span>` +
      `<span><a class="ig-link" href="${instaUrl(s.inv.id)}" target="_blank" rel="noopener" title="Visuels sur Instagram">📷</a> ${s.inv.pts} pts</span>`;
    div.onclick = () => { map.setView([s.inv.lat, s.inv.lng], 18); };
    div.querySelector('.ig-link').onclick = e => e.stopPropagation();
    list.appendChild(div);
  });
  $('route-panel').classList.remove('min');
  $('btn-route-min').textContent = '▾';
  $('route-panel').hidden = false;
  if (!stops.length) toast('Aucun nouvel invader à moins de 200 m du chemin 😢', 4000);
}

// ---------- randos par arrondissement ----------
const WALK_FACTOR = 1.35; // rapport moyen distance à pied / vol d'oiseau

function ordinalArr(n) { return n === 1 ? '1er' : n + 'e'; }

function populateRandoArr() {
  const counts = {};
  for (const inv of invaders) {
    if (inv.arr && !flashed.has(inv.id) && !isDead(inv)) counts[inv.arr] = (counts[inv.arr] || 0) + 1;
  }
  const sel = $('rando-arr');
  const prev = sel.value;
  sel.innerHTML = '';
  for (let a = 1; a <= 20; a++) {
    const opt = document.createElement('option');
    opt.value = a;
    const n = counts[a] || 0;
    opt.textContent = `${ordinalArr(a)} arrondissement — ${n} à flasher`;
    opt.disabled = n === 0;
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
}

async function generateRando() {
  const budget = +$('rando-dist').value * 1000;
  const loop = document.querySelector('input[name="rando-type"]:checked').value === 'loop';
  const zoneRadius = document.querySelector('input[name="rando-zone"]:checked').value === 'radius';
  let cands, start, title, circle = null;

  if (zoneRadius) {
    // zone circulaire : centre = départ manuel > ma position > centre de la carte
    const radius = +$('rando-radius').value;
    let center, centerLabel;
    if (startPoint) { center = startPoint; centerLabel = 'départ manuel 🚩'; }
    else if (userPos) { center = userPos; centerLabel = 'ma position 📍'; }
    else { const c = map.getCenter(); center = { lat: c.lat, lng: c.lng }; centerLabel = 'centre de la carte'; }
    cands = invaders.filter(i => !flashed.has(i.id) && !isDead(i) && haversine(center, i) <= radius);
    if (!cands.length) { toast(`Aucun invader à flasher dans un rayon de ${fmtDist(radius)} 😢`); return; }
    start = center;
    circle = { center, radius };
    title = `🥾 rayon ${fmtDist(radius)} —`;
    toast(`Zone : ${fmtDist(radius)} autour du ${centerLabel}`, 3000);
  } else {
    const arr = +$('rando-arr').value;
    cands = invaders.filter(i => i.arr === arr && !flashed.has(i.id) && !isDead(i));
    if (!cands.length) { toast('Plus rien à flasher dans cet arrondissement 🎉'); return; }

    // point de départ : départ manuel, sinon ma position si proche de l'arrondissement, sinon le cœur du groupe
    start = startPoint || userPos;
    if (start && Math.min(...cands.map(c => haversine(start, c))) > 1500) start = null;
    if (!start) {
      start = cands.reduce((best, c) =>
        cands.reduce((s, o) => s + haversine(c, o), 0) < cands.reduce((s, o) => s + haversine(best, o), 0) ? c : best);
      start = { lat: start.lat, lng: start.lng };
      toast('Départ posé au cœur de l’arrondissement (vous êtes loin) 🚩', 4000);
    }
    title = `🥾 ${ordinalArr(arr)} —`;
  }

  // chaîne au plus proche voisin sous contrainte de distance estimée
  const chain = [];
  const remaining = [...cands];
  let cur = start, est = 0;
  while (remaining.length && chain.length < MAX_WAYPOINTS) {
    let bi = 0, bd = Infinity;
    remaining.forEach((c, i) => { const d = haversine(cur, c); if (d < bd) { bd = d; bi = i; } });
    const next = remaining[bi];
    const backHome = loop ? haversine(next, start) * WALK_FACTOR : 0;
    if (est + bd * WALK_FACTOR + backHome > budget && chain.length >= 2) break;
    est += bd * WALK_FACTOR;
    chain.push(next);
    remaining.splice(bi, 1);
    cur = next;
  }
  if (!chain.length) { toast('Aucun invader atteignable dans cette distance'); return; }

  $('rando-panel').hidden = true;
  toast('Calcul de la rando… 🥾', 8000);
  try {
    const { trip, order } = await osrmTrip([start, ...chain], loop);
    // order[k] = rang de visite du k-e point envoyé (0 = départ) → on réordonne les étapes
    const stops = chain
      .map((inv, k) => ({ inv, rank: order[k + 1] }))
      .sort((a, b) => a.rank - b.rank);
    clearRoute();
    if (startPoint && start === startPoint) {
      setStart(startPoint); // conserve le départ manuel et son bouton de suppression
    } else {
      startPoint = null; // départ auto (GPS ou cœur d'arrondissement) : on oublie l'éventuel départ manuel écarté
      if (startMarker) startMarker.remove();
      startMarker = L.marker(start, { title: 'Départ' }).addTo(map).bindPopup('🚩 Départ de la rando');
    }
    if (circle) {
      randoCircle = L.circle(circle.center, {
        radius: circle.radius, color: '#7c3aed', weight: 2, dashArray: '4 6', fillColor: '#8b5cf6', fillOpacity: .06
      }).addTo(map);
    }
    drawRoute(null, trip, stops, title);
  } catch (e) {
    toast('Erreur : ' + e.message, 5000);
  }
}

// ---------- relevés de terrain ----------
// Un invader repéré sur place mais absent de la base est enregistré sur le
// téléphone : il apparaît aussitôt sur la carte et survit aux mises à jour,
// en attendant d'être versé dans data/overrides.json.
function releveMode() { return localStorage.getItem('releveMode') === '1'; }

function loadReleves() {
  try { return JSON.parse(localStorage.getItem('releves') || '[]'); } catch (e) { return []; }
}
function saveReleves(list) { localStorage.setItem('releves', JSON.stringify(list)); }

function mergeReleves() {
  const connus = new Map(invaders.map(i => [i.id, i]));
  for (const r of loadReleves()) {
    const deja = connus.get(r.id);
    if (deja) { // relevé qui corrige une position existante
      deja.lat = r.lat; deja.lng = r.lng; deja.perso = true;
      continue;
    }
    // arrondissement repris de l'invader connu le plus proche
    let arr = null, best = Infinity;
    for (const i of invaders) {
      if (!i.arr) continue;
      const d = haversine(r, i);
      if (d < best) { best = d; arr = i.arr; }
    }
    const ajout = {
      id: r.id, city: r.id.split('_')[0], lat: r.lat, lng: r.lng,
      status: 'OK', pts: r.pts || 0, hint: 'relevé sur place',
      arr: best < 1000 ? arr : null, perso: true
    };
    invaders.push(ajout);
    connus.set(r.id, ajout);
  }
}

// prochain numéro parisien référencé mais non localisé (PA_1590 et suivants)
function nextMissingId() {
  const nums = invaders.filter(i => i.city === 'PA').map(i => +i.id.split('_')[1]);
  const max = nums.length ? Math.max(...nums) : 0;
  const total = officialCounts && officialCounts.paris ? officialCounts.paris : 0;
  return max < total ? 'PA_' + (max + 1) : '';
}

function showReleveForm(c) {
  const div = document.createElement('div');
  div.className = 'ctx-popup';
  const titre = document.createElement('div');
  titre.className = 'ctx-title';
  titre.textContent = '👾 Noter un invader ici';
  const id = document.createElement('input');
  id.className = 'releve-input'; id.type = 'text';
  id.value = nextMissingId(); id.placeholder = 'PA_1590';
  const pts = document.createElement('input');
  pts.className = 'releve-input'; pts.type = 'number'; pts.inputMode = 'numeric';
  pts.placeholder = 'points (facultatif)';
  const ok = document.createElement('button');
  ok.textContent = '✅ Enregistrer';
  ok.onclick = () => {
    const val = id.value.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!/^[A-Z]+_\d+$/.test(val)) { toast('Identifiant attendu, par exemple PA_1590'); return; }
    const list = loadReleves().filter(r => r.id !== val);
    list.push({
      id: val, lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6),
      pts: +pts.value || 0, date: new Date().toISOString().slice(0, 10)
    });
    saveReleves(list);
    map.closePopup();
    mergeReleves();
    buildMarkers();
    toast(`👾 ${val} enregistré — ${list.length} relevé${list.length > 1 ? 's' : ''} sur ce téléphone`, 5000);
  };
  div.append(titre, id, pts, ok);
  L.popup().setLatLng(c).setContent(div).openOn(map);
}

function majRelevesInfo() {
  const n = loadReleves().length;
  const actif = releveMode();
  $('releves-info').textContent = !actif && !n ? ''
    : n ? `${n} relevé${n > 1 ? 's' : ''} sur ce téléphone, en attente d'intégration à la base`
      : 'Appui long sur la carte pour noter un invader absent de la base.';
  $('releves-actions').hidden = n === 0;
}

// format prêt à coller dans data/overrides.json
function relevesEnJson() {
  return loadReleves().map(r =>
    `  "${r.id}": { "lat": ${r.lat}, "lng": ${r.lng}, "pts": ${r.pts}, "date": "${r.date}", "note": "relevé sur place" }`
  ).join(',\n');
}

// ---------- panneaux ----------
function closePanels() {
  for (const id of ['layers-panel', 'rando-panel', 'settings-panel', 'search-results']) $(id).hidden = true;
}

// ---------- orientation de la carte ----------
function updateNorthButton() {
  const deg = map.getBearing ? map.getBearing() : 0;
  const btn = $('btn-north');
  btn.hidden = Math.abs(((deg % 360) + 360) % 360) < 0.5;
  $('north-arrow').style.transform = `rotate(${deg}deg)`;
}

// ---------- init ----------
async function init() {
  map = L.map('map', {
    zoomControl: false,
    rotate: true,          // rotation de la carte…
    touchRotate: true,     // …au pincement à deux doigts
    rotateControl: false,  // on utilise notre propre bouton nord
    compassBearing: false  // jamais de boussole : le capteur viderait la batterie
  }).setView([48.8566, 2.3522], 13);

  map.on('rotate', updateNorthButton);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // appui long (contextmenu) : définir départ ou destination
  map.on('contextmenu', e => {
    const c = e.latlng;
    const div = document.createElement('div');
    div.className = 'ctx-popup';
    const b1 = document.createElement('button');
    b1.textContent = '🚩 Départ ici';
    b1.onclick = () => { map.closePopup(); setStart({ lat: c.lat, lng: c.lng }); };
    const b2 = document.createElement('button');
    b2.textContent = '🎯 Destination ici';
    b2.onclick = () => { map.closePopup(); setDestination({ lat: c.lat, lng: c.lng }); };
    div.append(b1, b2);
    if (releveMode()) { // relevé de terrain : désactivé par défaut
      const b3 = document.createElement('button');
      b3.textContent = '👾 Noter un invader ici';
      b3.onclick = () => showReleveForm(c);
      div.append(b3);
    }
    L.popup().setLatLng(c).setContent(div).openOn(map);
  });

  // données invaders
  try {
    const res = await fetch('data/invaders.json');
    invaders = await res.json();
    mergeReleves();
  } catch (e) { toast('Impossible de charger la base des invaders'); return; }

  // flashs
  try {
    await loadFlashed();
    const nb = flashed.size;
    $('flash-status').textContent = `${playerName ? playerName + ' · ' : ''}${nb} invaders flashés`;
    toast(`${playerName ? playerName + ' — ' : ''}${nb} flashés chargés 👾`, 2500);
  } catch (e) {
    if (!getUid()) {
      toast('⚙️ Renseignez votre UID FlashInvaders pour voir vos flashs', 6000);
      $('uid-input').value = '';
      $('flash-status').textContent = 'Aucun UID renseigné — tous les invaders sont affichés comme à flasher.';
      $('settings-panel').hidden = false;
    } else {
      toast('Flashs non chargés (' + e.message + ') — tous les invaders seront proposés', 5000);
    }
  }

  updateLegend();
  buildMarkers();
  startGeoloc();

  // listeners UI
  $('btn-locate').onclick = () => {
    firstFix = true;
    if (userPos) { map.setView(userPos, 16); firstFix = false; }
    startGeoloc();
  };
  $('btn-layers').onclick = () => {
    const ouvert = !$('layers-panel').hidden;
    closePanels();
    $('layers-panel').hidden = ouvert;
  };
  $('btn-layers-close').onclick = closePanels;
  map.on('click', closePanels); // un appui sur la carte referme les panneaux
  $('btn-rando').onclick = () => {
    const ouvert = !$('rando-panel').hidden;
    closePanels();
    populateRandoArr();
    $('rando-panel').hidden = ouvert;
  };
  $('btn-rando-close').onclick = () => { $('rando-panel').hidden = true; };
  $('btn-rando-go').onclick = generateRando;
  document.querySelectorAll('input[name="rando-zone"]').forEach(r => r.onchange = () => {
    const rad = document.querySelector('input[name="rando-zone"]:checked').value === 'radius';
    $('rando-arr-wrap').hidden = rad;
    $('rando-radius-wrap').hidden = !rad;
  });
  $('btn-north').onclick = () => { map.setBearing(0); updateNorthButton(); };
  // sur iOS, un <select> qui garde le focus après le sélecteur natif fait avaler
  // l'appui suivant : on lui retire le focus tout de suite
  $('min-pts').onchange = e => { e.target.blur(); buildMarkers(); };
  $('color-mode').value = colorMode();
  $('color-mode').onchange = e => {
    e.target.blur();
    localStorage.setItem('colorMode', e.target.value);
    updateLegend();
    buildMarkers();
  };
  $('chk-unflashed').onchange = e => e.target.checked ? layerUnflashed.addTo(map) : layerUnflashed.remove();
  $('chk-flashed').onchange = e => e.target.checked ? layerFlashedGrp.addTo(map) : layerFlashedGrp.remove();
  $('chk-destroyed').onchange = e => e.target.checked ? layerDestroyed.addTo(map) : layerDestroyed.remove();
  $('chk-hidden').onchange = e => e.target.checked ? layerHidden.addTo(map) : layerHidden.remove();

  $('btn-settings').onclick = () => {
    const ouvert = !$('settings-panel').hidden;
    closePanels();
    $('uid-input').value = getUid();
    $('build-info').textContent = 'Build ' + (typeof BUILD !== 'undefined' ? BUILD : 'inconnu');
    const paMax = invaders.reduce((m, i) => i.city === 'PA' ? Math.max(m, +i.id.split('_')[1] || 0) : m, 0);
    const nbPa = invaders.reduce((n, i) => i.city === 'PA' ? n + 1 : n, 0);
    let txt = `Base : ${invaders.length} invaders localisés, jusqu'à PA_${paMax}`;
    if (officialCounts && officialCounts.paris) {
      const retard = officialCounts.paris - nbPa;
      txt += `\nParis : ${nbPa} / ${officialCounts.paris} référencés`;
      txt += retard > 0 ? ` — ${retard} pas encore localisé${retard > 1 ? 's' : ''}` : ' — base complète 🎉';
    }
    $('db-info').textContent = txt;
    $('chk-releve').checked = releveMode();
    majRelevesInfo();
    $('settings-panel').hidden = ouvert;
  };
  $('btn-close-settings').onclick = () => { $('settings-panel').hidden = true; };
  $('chk-releve').onchange = e => {
    localStorage.setItem('releveMode', e.target.checked ? '1' : '0');
    majRelevesInfo();
  };
  $('btn-releves-copy').onclick = () => {
    const txt = relevesEnJson();
    const fini = ok => toast(ok ? '📋 Relevés copiés — collez-les dans la conversation' : txt, 9000);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => fini(true), () => fini(false));
    } else { fini(false); }
  };
  $('btn-releves-clear').onclick = () => {
    if (!confirm('Effacer les relevés enregistrés sur ce téléphone ?')) return;
    saveReleves([]);
    majRelevesInfo();
    toast('Relevés effacés — rechargez pour les retirer de la carte', 5000);
  };
  $('btn-refresh-flash').onclick = async () => {
    const uid = $('uid-input').value.trim();
    if (uid) localStorage.setItem('uid', uid);
    $('flash-status').textContent = 'Chargement…';
    try {
      await loadFlashed(true);
      $('flash-status').textContent = `${playerName ? playerName + ' · ' : ''}${flashed.size} invaders flashés`;
      buildMarkers();
      if (destPoint) computeRoute();
    } catch (e) { $('flash-status').textContent = 'Erreur : ' + e.message; }
  };

  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) doSearch(e.target.value.trim(), true);
  });
  $('search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 4) { $('search-results').hidden = true; return; }
    searchTimer = setTimeout(() => doSearch(q, false), 700);
  });

  $('btn-clear-route').onclick = clearRoute;
  $('btn-route-min').onclick = () => {
    const min = $('route-panel').classList.toggle('min');
    $('btn-route-min').textContent = min ? '▴' : '▾';
  };

  // service worker (PWA hors-ligne)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
