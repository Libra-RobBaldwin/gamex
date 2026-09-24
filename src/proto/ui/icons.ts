// The HUD's icons: Tabler Icons (MIT, tabler.io/icons), imported one at a time as raw SVG so only
// these are bundled and the page works offline. They're vector, so crisp at any pixel density.
import activity from '@tabler/icons/outline/activity.svg?raw';
import adjustments from '@tabler/icons/outline/adjustments-horizontal.svg?raw';
import alert from '@tabler/icons/outline/alert-triangle.svg?raw';
import angle from '@tabler/icons/outline/angle.svg?raw';
import arrowsCross from '@tabler/icons/outline/arrows-cross.svg?raw';
import arrowsDownUp from '@tabler/icons/outline/arrows-down-up.svg?raw';
import bike from '@tabler/icons/outline/bike.svg?raw';
import bolt from '@tabler/icons/outline/bolt.svg?raw';
import branch from '@tabler/icons/outline/git-branch.svg?raw';
import bridge from '@tabler/icons/outline/building-bridge.svg?raw';
import bulldozer from '@tabler/icons/outline/bulldozer.svg?raw';
import bus from '@tabler/icons/outline/bus.svg?raw';
import busStop from '@tabler/icons/outline/bus-stop.svg?raw';
import car from '@tabler/icons/outline/car.svg?raw';
import check from '@tabler/icons/outline/check.svg?raw';
import clock from '@tabler/icons/outline/clock.svg?raw';
import curve from '@tabler/icons/outline/vector-bezier-2.svg?raw';
import finger from '@tabler/icons/outline/hand-finger.svg?raw';
import handStop from '@tabler/icons/outline/hand-stop.svg?raw';
import home from '@tabler/icons/outline/home.svg?raw';
import line from '@tabler/icons/outline/line.svg?raw';
import map from '@tabler/icons/outline/map-2.svg?raw';
import minus from '@tabler/icons/outline/minus.svg?raw';
import mountain from '@tabler/icons/outline/mountain.svg?raw';
import giveWay from '@tabler/icons/outline/triangle-inverted.svg?raw';
import parking from '@tabler/icons/outline/parking.svg?raw';
import pause from '@tabler/icons/filled/player-pause.svg?raw';
import play from '@tabler/icons/outline/player-play.svg?raw';
import plus from '@tabler/icons/outline/plus.svg?raw';
import ramp from '@tabler/icons/outline/arrow-ramp-left.svg?raw';
import refresh from '@tabler/icons/outline/refresh.svg?raw';
import road from '@tabler/icons/outline/road.svg?raw';
import roadSign from '@tabler/icons/outline/road-sign.svg?raw';
import rotL from '@tabler/icons/outline/rotate-2.svg?raw';
import rotR from '@tabler/icons/outline/rotate-clockwise-2.svg?raw';
import roundabout from '@tabler/icons/outline/arrow-roundabout-right.svg?raw';
import route from '@tabler/icons/outline/route-2.svg?raw';
import ruler from '@tabler/icons/outline/ruler-measure.svg?raw';
import smooth from '@tabler/icons/outline/vector-spline.svg?raw';
import sparkles from '@tabler/icons/outline/sparkles.svg?raw';
import tree from '@tabler/icons/outline/tree.svg?raw';
import trees from '@tabler/icons/outline/trees.svg?raw';
import lights from '@tabler/icons/outline/traffic-lights.svg?raw';
import train from '@tabler/icons/outline/train.svg?raw';
import trendUp from '@tabler/icons/outline/trending-up.svg?raw';
import tunnel from '@tabler/icons/outline/building-tunnel.svg?raw';
import users from '@tabler/icons/outline/users.svg?raw';
import wheat from '@tabler/icons/outline/wheat.svg?raw';
import x from '@tabler/icons/outline/x.svg?raw';

const RAW = {
  activity, adjustments, alert, angle, arrowsCross, arrowsDownUp, bike, bolt, branch, bridge, bulldozer, bus, busStop, car, check, clock, curve,
  finger, giveWay, handStop, home, line, map, minus, mountain, parking, pause, play, plus, ramp, refresh, road, roadSign, rotL, rotR, roundabout, route,
  ruler, smooth, sparkles, tree, trees, lights, train, trendUp, tunnel, users, wheat, x,
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

// What stands for each kind of road and railway in chips, lists and filters.
const FAMILY: Record<string, Icon> = { Street: 'home', Avenue: 'trees', Boulevard: 'tree', Arterial: 'bus', Rural: 'wheat', Dual: 'arrowsDownUp', Motorway: 'roadSign', Rail: 'train' };
const RAIL: Record<string, Icon> = { 'rail-branch': 'branch', 'rail-main': 'train', 'rail-hs': 'bolt', 'rail-light': 'route', 'rail-rack': 'mountain' };
const TRAIN: Record<string, Icon> = { dmu: 'train', intercity: 'train', hs: 'bolt', tram: 'route', rack: 'mountain' };
export const roadIcon = (d: { id: string; family: string }) => RAIL[d.id] ?? FAMILY[d.family] ?? 'road';
export const trainIcon = (id: string) => TRAIN[id] ?? 'train';
// junction forms: the give-way triangle, signals, and a roundabout arrow that goes round clockwise
const FORM: Record<string, Icon> = { priority: 'giveWay', signals: 'lights', mini: 'roundabout', roundabout: 'roundabout' };
export const formIcon = (form: string) => FORM[form] ?? 'lights';
