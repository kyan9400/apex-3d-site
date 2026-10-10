// The Apex lineup. Every model is a procedural design in this folder that follows CONTRACT.md.
// The first one ships in the main bundle (so the page opens fast); the others are separate
// files that the browser downloads only when a visitor picks them in the configurator.
import { createCar as createSpeedster } from './variant-a.js';

export const MODELS = [
  { id: 'speedster', name: 'GT Speedster', note: 'Open top, twin humps, tan cockpit', load: async () => createSpeedster },
  { id: 'coupe', name: 'GT Coupé', note: 'Glass canopy, louvred engine cover', load: async () => (await import('./variant-c.js')).createCar },
  { id: 'endurance', name: 'R Endurance', note: 'Track-bred, swan-neck wing', load: async () => (await import('./variant-d.js')).createCar },
  { id: 'electric', name: 'E Electric', note: 'One seamless shell, light blades', load: async () => (await import('./variant-e.js')).createCar },
  { id: 'tourer', name: 'Grand Tourer', note: 'Long bonnet, quad round tail lamps', load: async () => (await import('./variant-f.js')).createCar },
];

// The car the page starts with
export const createCar = createSpeedster;
