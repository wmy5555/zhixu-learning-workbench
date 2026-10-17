import { initialReviewView } from './review-manifest.mjs';

export async function routeApplication(location, loadApp) {
  if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
    && location.port === '14318' && ['/', '/index.html'].includes(location.pathname)) {
    location.replace('/review.html#' + initialReviewView(location.hash));
    return 'review';
  }
  await loadApp();
  return 'application';
}
if (typeof window !== 'undefined') await routeApplication(window.location, () => import('./app.mjs'));
