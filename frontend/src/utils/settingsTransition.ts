let finishRouteUpdate: (() => void) | undefined;

export function notifySettingsRouteCommit() {
  finishRouteUpdate?.();
}

export function slideSettingsPage(direction: "forward" | "back", navigate: () => void) {
  if (!document.startViewTransition || !window.matchMedia("(width < 48rem) and (prefers-reduced-motion: no-preference)").matches) {
    navigate();
    return;
  }

  const root = document.documentElement;
  if (root.hasAttribute("data-settings-slide")) return;
  root.dataset.settingsSlide = direction;
  const transition = document.startViewTransition(() => new Promise<void>((resolve, reject) => {
    // Wait for the router to commit, including asynchronous history traversal.
    const cleanup = () => {
      window.clearTimeout(timeout);
      finishRouteUpdate = undefined;
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const timeout = window.setTimeout(finish, 350);
    finishRouteUpdate = finish;
    try {
      navigate();
    } catch (error) {
      cleanup();
      reject(error);
    }
  }));
  void transition.finished.then(clear, clear);

  function clear() {
    delete root.dataset.settingsSlide;
  }
}
