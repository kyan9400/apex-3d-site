// The lineup the configurator shows. Plain data only (no three.js import), so the 2D page can
// use it without downloading the 3D code. Every model is a separate file, loaded when it is first needed.
export const MODELS = [
  { id: 'speedster', name: 'GT Speedster', note: 'Open top, twin humps, tan cockpit', load: async () => (await import('./variant-a.js')).createCar },
  { id: 'coupe', name: 'GT Coupé', note: 'Glass canopy, louvred engine cover', load: async () => (await import('./variant-c.js')).createCar },
  { id: 'endurance', name: 'R Endurance', note: 'Track-bred, swan-neck wing', load: async () => (await import('./variant-d.js')).createCar },
  { id: 'electric', name: 'E Electric', note: 'One seamless shell, light blades', load: async () => (await import('./variant-e.js')).createCar },
  { id: 'tourer', name: 'Grand Tourer', note: 'Long bonnet, quad round tail lamps', load: async () => (await import('./variant-f.js')).createCar },
];
