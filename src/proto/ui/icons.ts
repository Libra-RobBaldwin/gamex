// The HUD's icons: Tabler Icons (MIT, tabler.io/icons, licence in ./icons/LICENSE), copied into
// ./icons one file at a time so only these are bundled and the page works offline. Two are our
// own in the same style: the UK motorway symbol (motorway-uk.svg) and the ground-hugging line for
// Auto height (height-auto.svg). They're vector, so crisp at any pixel density.
import activity from './icons/activity.svg?raw';
import adjustments from './icons/adjustments-horizontal.svg?raw';
import alert from './icons/alert-triangle.svg?raw';
import angle from './icons/angle.svg?raw';
import arrowsCross from './icons/arrows-cross.svg?raw';
import arrowsDownUp from './icons/arrows-down-up.svg?raw';
import bike from './icons/bike.svg?raw';
import bolt from './icons/bolt.svg?raw';
import branch from './icons/git-branch.svg?raw';
import bridge from './icons/building-bridge.svg?raw';
import bulldozer from './icons/bulldozer.svg?raw';
import bus from './icons/bus.svg?raw';
import busStop from './icons/bus-stop.svg?raw';
import car from './icons/car.svg?raw';
import check from './icons/check.svg?raw';
import clock from './icons/clock.svg?raw';
import cog from './icons/settings.svg?raw';
import curve from './icons/vector-bezier-2.svg?raw';
import finger from './icons/hand-finger.svg?raw';
import handStop from './icons/hand-stop.svg?raw';
import heightAuto from './icons/height-auto.svg?raw';
import home from './icons/home.svg?raw';
import line from './icons/line.svg?raw';
import map from './icons/map-2.svg?raw';
import minus from './icons/minus.svg?raw';
import motorway from './icons/motorway-uk.svg?raw';
import mountain from './icons/mountain.svg?raw';
import giveWay from './icons/triangle-inverted.svg?raw';
import parking from './icons/parking.svg?raw';
import pause from './icons/player-pause-filled.svg?raw';
import play from './icons/player-play.svg?raw';
import plus from './icons/plus.svg?raw';
import ramp from './icons/arrow-ramp-left.svg?raw';
import refresh from './icons/refresh.svg?raw';
import restore from './icons/restore.svg?raw';
import road from './icons/road.svg?raw';
import rotL from './icons/rotate-2.svg?raw';
import rotR from './icons/rotate-clockwise-2.svg?raw';
import roundabout from './icons/arrow-roundabout-right.svg?raw';
import route from './icons/route-2.svg?raw';
import ruler from './icons/ruler-measure.svg?raw';
import smooth from './icons/vector-spline.svg?raw';
import sparkles from './icons/sparkles.svg?raw';
import tree from './icons/tree.svg?raw';
import trees from './icons/trees.svg?raw';
import lights from './icons/traffic-lights.svg?raw';
import train from './icons/train.svg?raw';
import trendUp from './icons/trending-up.svg?raw';
import trendDown from './icons/trending-down.svg?raw';
import tunnel from './icons/building-tunnel.svg?raw';
import users from './icons/users.svg?raw';
import wheat from './icons/wheat.svg?raw';
import x from './icons/x.svg?raw';
import arrowLeft from './icons/arrow-left.svg?raw';
import building from './icons/building.svg?raw';
import chevronDown from './icons/chevron-down.svg?raw';
import droplet from './icons/droplet.svg?raw';
import floppy from './icons/device-floppy.svg?raw';
import hammer from './icons/hammer.svg?raw';
import info from './icons/info-circle.svg?raw';
import layers from './icons/stack-2.svg?raw';
import menu from './icons/menu-2.svg?raw';
import pin from './icons/map-pin.svg?raw';
import transport from './icons/route.svg?raw';
import trash from './icons/trash.svg?raw';
import undo from './icons/arrow-back-up.svg?raw';
import warehouse from './icons/building-warehouse.svg?raw';

const RAW = {
  activity, adjustments, alert, angle, arrowsCross, arrowsDownUp, bike, bolt, branch, bridge, bulldozer, bus, busStop, car, check, clock, cog, curve,
  finger, giveWay, handStop, heightAuto, home, line, map, minus, motorway, mountain, parking, pause, play, plus, ramp, refresh, restore, road, rotL, rotR,
  roundabout, route, ruler, smooth, sparkles, tree, trees, lights, train, trendUp, trendDown, tunnel, users, wheat, x,
  arrowLeft, building, chevronDown, droplet, floppy, hammer, info, layers, menu, pin, transport, trash, undo, warehouse,
};
export type Icon = keyof typeof RAW;

// Tabler files carry a fixed 24 px size, their own classes and an invisible bounding path: drop
// those so CSS sizes the icon from the text around it, and hide it from screen readers (the
// button or label beside it says what it is).
const SVG = Object.fromEntries(Object.entries(RAW).map(([k, s]) => [k, s
  .replace(/\s(width|height|class)="[^"]*"/g, '')
  .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, '')
  .replace(/\s+/g, ' ')
  .replace('<svg', '<svg class="ic" aria-hidden="true" focusable="false"')])) as Record<Icon, string>;

export const icon = (name: Icon, cls = '') => (cls ? SVG[name].replace('class="ic"', `class="ic ${cls}"`) : SVG[name]);

// What stands for each kind of road and railway in chips, lists and filters. Each icon means one
// thing: the mountain is height (the blueprint's climb readout), so rack railways get the cog
// they climb with, and Auto height its own line.
const FAMILY: Record<string, Icon> = { Street: 'home', Avenue: 'trees', Boulevard: 'tree', Arterial: 'bus', Rural: 'wheat', Dual: 'arrowsDownUp', Motorway: 'motorway', Rail: 'train' };
const RAIL: Record<string, Icon> = { 'rail-branch': 'branch', 'rail-main': 'train', 'rail-hs': 'bolt', 'rail-light': 'route', 'rail-rack': 'cog' };
const TRAIN: Record<string, Icon> = { dmu: 'train', intercity: 'train', hs: 'bolt', tram: 'route', rack: 'cog' };
export const roadIcon = (d: { id: string; family: string }) => RAIL[d.id] ?? FAMILY[d.family] ?? 'road';
export const trainIcon = (id: string) => TRAIN[id] ?? 'train';
// junction forms: the give-way triangle, signals, and a roundabout arrow that goes round clockwise
const FORM: Record<string, Icon> = { priority: 'giveWay', signals: 'lights', mini: 'roundabout', roundabout: 'roundabout' };
export const formIcon = (form: string) => FORM[form] ?? 'lights';
