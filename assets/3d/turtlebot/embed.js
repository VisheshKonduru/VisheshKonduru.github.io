// Page embed for the TurtleBot demo. The page supplies the tabs, #stage and the control bar
// (same ids as index.html); this starts the simulation once the page's lazy loader imports it.
import { start } from './main.js';
const stage = document.querySelector('[data-tb3] #stage');
if (stage) start(stage);
