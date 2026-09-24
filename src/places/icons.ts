// The page's icons: Tabler Icons (MIT, tabler.io/icons, licence in ./icons/LICENSE), copied in one
// file at a time so only these are bundled.
import alert from './icons/alert-triangle.svg?raw';
import back from './icons/arrow-left.svg?raw';
import move from './icons/arrows-move.svg?raw';
import check from './icons/check.svg?raw';
import cube from './icons/cube-3d-sphere.svg?raw';
import here from './icons/current-location.svg?raw';
import download from './icons/download.svg?raw';
import info from './icons/info-circle.svg?raw';
import spinner from './icons/loader-2.svg?raw';
import pin from './icons/map-pin.svg?raw';
import fit from './icons/maximize.svg?raw';
import minus from './icons/minus.svg?raw';
import play from './icons/player-play.svg?raw';
import plus from './icons/plus.svg?raw';
import refresh from './icons/refresh.svg?raw';
import search from './icons/search.svg?raw';
import trash from './icons/trash.svg?raw';
import close from './icons/x.svg?raw';

const ICONS = { alert, back, move, check, cube, here, download, info, spinner, pin, fit, minus, play, plus, refresh, search, trash, close };
export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, cls = 'ic') =>
  ICONS[name].replace(/\s*class="[^"]*"/, '').replace('<svg', `<svg class="${cls}" aria-hidden="true" focusable="false"`).replace(/\s*width="24"\s*height="24"/, '');
