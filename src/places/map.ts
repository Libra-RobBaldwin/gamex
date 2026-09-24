// The area picker: an OpenStreetMap base map, a pin on the postcode, and a square the player moves.
// Moving the square never fights the map. The square covers most of the screen, so its inside
// belongs to the map: one finger pans, two pinch. The square moves by its handle (a finger on the
// handle moves the square and the map stays put), by a tap anywhere (the square jumps there), or
// by "Square here" (to the middle of the view).

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { squareBbox } from './area';
import { icon } from './icons';
import type { LatLon } from '../proto/osm/projection';
import type { Bbox } from '../proto/osm/fetch';

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export class AreaMap {
  readonly map: L.Map;
  private square: L.Rectangle;
  private handle: L.Marker;
  private pin?: L.Marker;
  centre: LatLon;
  sizeKm: number;
  onChange: () => void = () => {};
  /** What covers the map: the sheet below it in portrait, or beside it on a phone on its side. */
  cover: () => { bottom: number; right: number } = () => ({ bottom: 0, right: 0 });

  constructor(el: HTMLElement, centre: LatLon, sizeKm: number) {
    this.centre = centre; this.sizeKm = sizeKm;
    this.map = L.map(el, { zoomControl: false, attributionControl: true, doubleClickZoom: false, tapTolerance: 12, worldCopyJump: false, maxBoundsViscosity: 1, maxBounds: [[-85, -180], [85, 180]] });
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.tileLayer(TILE_URL, { maxZoom: 19, minZoom: 3, attribution: TILE_CREDIT, crossOrigin: false, referrerPolicy: 'strict-origin-when-cross-origin' } as L.TileLayerOptions).addTo(this.map);
    L.control.zoom({ position: 'topright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(this.map);

    this.square = L.rectangle(this.bounds(), { color: '#5cb83a', weight: 3, fillColor: '#5cb83a', fillOpacity: 0.12, interactive: false, className: 'area-square' }).addTo(this.map);
    this.handle = L.marker([centre.lat, centre.lon], {
      icon: L.divIcon({ className: 'area-handle', html: icon('move'), iconSize: [44, 44], iconAnchor: [22, 22] }),
      keyboard: true, title: 'Drag to move the square', zIndexOffset: 1000, interactive: true, bubblingMouseEvents: false,
    }).addTo(this.map);
    this.map.setView([centre.lat, centre.lon], 14);
    this.makeDraggable(this.handle.getElement() ?? null);
    // arrow keys move the square when its handle has focus
    this.handle.getElement()?.addEventListener('keydown', (e) => {
      const step = (this.sizeKm * 1000) / 10 / 111_320, k = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] }[e.key];
      if (!k) return;
      e.preventDefault(); e.stopPropagation();
      this.moveTo({ lat: this.centre.lat + k[0], lon: this.centre.lon + k[1] / Math.cos((this.centre.lat * Math.PI) / 180) });
    });
    this.map.on('click', (e: L.LeafletMouseEvent) => this.moveTo({ lat: e.latlng.lat, lon: e.latlng.lng }));
    this.fit();
  }

  setPin(at: LatLon) {
    this.pin?.remove();
    this.pin = L.marker([at.lat, at.lon], { icon: L.divIcon({ className: 'area-pin', html: icon('pin'), iconSize: [36, 36], iconAnchor: [18, 34] }), interactive: false, keyboard: false }).addTo(this.map);
  }

  bbox(): Bbox { return squareBbox(this.centre, this.sizeKm); }
  private bounds(): L.LatLngBoundsExpression { const b = this.bbox(); return [[b[0], b[1]], [b[2], b[3]]]; }

  setSize(km: number) { this.sizeKm = km; this.redraw(); this.fit(); }
  moveTo(c: LatLon) {
    this.centre = { lat: Math.max(-84, Math.min(84, c.lat)), lon: Math.max(-179, Math.min(179, c.lon)) };
    this.redraw();
  }
  /** The square to the middle of what's on screen. */
  here() {
    // the middle of the part of the map that isn't under the sheet
    const c = this.cover(), sz = this.map.getSize();
    const ll = this.map.containerPointToLatLng([(sz.x - c.right) / 2, (sz.y - c.bottom) / 2]);
    this.moveTo({ lat: ll.lat, lon: ll.lng });
  }
  fit() { const c = this.cover(); this.map.fitBounds(this.bounds(), { paddingTopLeft: [20, 20], paddingBottomRight: [20 + c.right, 20 + c.bottom], maxZoom: 16, animate: false }); }
  resize() { this.map.invalidateSize(); }

  private redraw() {
    this.square.setBounds(this.bounds() as L.LatLngBoundsLiteral);
    this.handle.setLatLng([this.centre.lat, this.centre.lon]);
    this.onChange();
  }

  private makeDraggable(el: HTMLElement | null) {
    if (!el) return;
    el.style.touchAction = 'none';
    // Leaflet listens for touches and mouse presses on its container: stop them here, so the map
    // never sees a gesture that started on the square
    L.DomEvent.on(el, 'touchstart mousedown dblclick click', L.DomEvent.stopPropagation);
    let grab: { id: number; dLat: number; dLon: number } | undefined;
    const at = (e: PointerEvent) => this.map.mouseEventToLatLng(e as unknown as MouseEvent);
    el.addEventListener('pointerdown', (e) => {
      if (grab || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.stopPropagation(); e.preventDefault();
      const p = at(e);
      grab = { id: e.pointerId, dLat: this.centre.lat - p.lat, dLon: this.centre.lon - p.lng };
      el.setPointerCapture?.(e.pointerId);
      this.map.dragging.disable(); this.map.touchZoom.disable();
      document.body.classList.add('dragging-square');
    });
    el.addEventListener('pointermove', (e) => {
      if (!grab || e.pointerId !== grab.id) return;
      e.stopPropagation();
      const p = at(e);
      this.moveTo({ lat: p.lat + grab.dLat, lon: p.lng + grab.dLon });
    });
    const end = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.id) return;
      grab = undefined;
      this.map.dragging.enable(); this.map.touchZoom.enable();
      document.body.classList.remove('dragging-square');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  destroy() { this.map.remove(); }
}
