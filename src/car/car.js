// The Apex lineup. Every model is a procedural design in this folder that follows CONTRACT.md.
// The list itself lives in models.js (no three.js there, so the 2D page can read it too).
// The first car ships with the 3D scene code; the others are separate files that the browser
// downloads only when a visitor picks them in the configurator.
import { createCar as createSpeedster } from './variant-a.js';

export { MODELS } from './models.js';

// The car the page starts with
export const createCar = createSpeedster;
