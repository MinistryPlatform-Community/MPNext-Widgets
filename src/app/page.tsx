import { redirect } from 'next/navigation';

export { Home as default };

/**
 * `/` has no content of its own — the demo library is the app.
 *
 * This used to live in an `(app)` route group whose layout mounted
 * `TokenBridge`. `redirect()` aborts the render before a layout reaches the
 * client, so that layout (and the bridge with it) never mounted anywhere.
 * The redirect now sits at the root with no layout of its own; anything a
 * signed-in user needs belongs in `(demo)/layout.tsx`, where they land.
 */
function Home() {
  redirect('/demo');
}
