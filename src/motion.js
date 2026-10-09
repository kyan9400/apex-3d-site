/* ==========================================================================
   MOTION PREFERENCE
   Operating systems can ask websites for less motion (Windows: Settings →
   Accessibility → Visual effects → Animation effects). We respect that by
   default, but many people turn animations off for speed, not comfort, so the
   visitor can switch full motion back on. The choice is remembered.
     ?motion=full / ?motion=reduced in the URL also works (handy for testing).
   ========================================================================== */

const KEY = 'apex-motion';
const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function readChoice() {
  const fromUrl = new URLSearchParams(window.location.search).get('motion');
  if (fromUrl === 'full' || fromUrl === 'reduced') return fromUrl;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage blocked (private mode etc.)
  }
}

// Returns false when storage is blocked (private mode, some sandboxed embeds)
function saveChoice(value) {
  try {
    localStorage.setItem(KEY, value);
    return true;
  } catch {
    return false;
  }
}

// Save the choice and reload. If storage is blocked, the choice rides in the URL instead.
// The URL's ?motion= is removed when saving works, otherwise it would beat the saved choice.
// (replaceState + reload, because a URL that only differs by #hash would not reload)
function applyChoice(value) {
  const url = new URL(window.location.href);
  if (saveChoice(value)) url.searchParams.delete('motion');
  else url.searchParams.set('motion', value);
  try {
    history.replaceState(null, '', url);
    window.location.reload();
  } catch {
    window.location.href = url.href;
  }
}

const choice = readChoice();
export const reducedMotion = choice === 'full' ? false : choice === 'reduced' ? true : systemReduced;

// CSS uses this class instead of the media query, so the visitor's choice wins
document.documentElement.classList.toggle('reduce-motion', reducedMotion);

export function motionControls() {
  const toggle = document.getElementById('motion-toggle');
  toggle.textContent = reducedMotion ? 'Turn on full motion' : 'Reduce motion';
  toggle.addEventListener('click', () => applyChoice(reducedMotion ? 'full' : 'reduced'));

  // First visit with the system setting on: say why things are calm, offer full motion
  if (systemReduced && !choice) {
    const toast = document.getElementById('motion-toast');
    toast.hidden = false;
    document.getElementById('motion-full').addEventListener('click', () => applyChoice('full'));
    document.getElementById('motion-dismiss').addEventListener('click', () => {
      if (!saveChoice('reduced')) {
        // storage blocked: keep the choice in the URL so a refresh doesn't ask again
        const url = new URL(window.location.href);
        url.searchParams.set('motion', 'reduced');
        try {
          history.replaceState(null, '', url);
        } catch {
          /* ignore: the toast will just come back next time */
        }
      }
      // Hiding a focused button would drop keyboard focus to <body>: move it somewhere sensible
      const hadFocus = toast.contains(document.activeElement);
      toast.hidden = true;
      if (hadFocus) document.querySelector('.nav__logo').focus({ preventScroll: true });
    });
  }
}
