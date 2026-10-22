// Crownward – Einstiegspunkt: Stile laden, App aufbauen, Debug-API bereitstellen, starten.
import './styles.css';
import { App } from './app/app';
import { installDebug } from './app/debug';

const root = document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));
root.id = 'app';
const app = new App(root);
installDebug(app);
document.documentElement.classList.add('js-ready');
void app.boot();
