// Page embed for the TurtleBot demo: builds the shared demo layout into [data-tb3] and starts the
// simulation once the page's lazy loader imports this file.
import { createShell } from '../demo-shell.js';
import { start } from './main.js';
const root = document.querySelector('[data-tb3]');
if (root && !root.dataset.mounted) {
  root.dataset.mounted = '1';
  let onScene = () => {};
  const shell = createShell(root, {
    id: 'tb3', label: 'TurtleBot3 Burger in a maze',
    viewLabel: '3D scene: TurtleBot3 Burger in a maze with its lidar. In mapping, click the floor to send a goal, or focus here and drive with W A S D or the arrow keys. In localization, click to place the robot, then click to set the goal.',
    scenes: [{ id: 'A', label: 'Autonomous mapping' }, { id: 'B', label: 'Autonomous localization' }], scene: new URLSearchParams(location.search).get('scene') === 'loc' ? 'B' : 'A',
    onScene: (id) => onScene(id),
  });
  shell.view.append(Object.assign(document.createElement('p'), { className: 'ds-loading', id: 'loading', textContent: 'Loading scene' }));
  const api = start(shell);
  onScene = api.showScene;
}
