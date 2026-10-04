// Web Push via OneSignal (not email — see CLAUDE.md). OneSignal handles the
// VAPID signing + payload encryption that raw Web Push requires; Apps
// Script just POSTs a message to OneSignal's REST API (see Code.gs).
//
// These ids are not secret (unlike the OneSignal REST API key, which stays
// server-side in Script Properties) — safe to commit.
const ONESIGNAL_APP_ID = '64af6421-6490-41c3-bbf0-089957d1f430';
const SAFARI_WEB_ID = 'web.onesignal.auto.0d123f70-12e5-49b1-a758-f1abcc853120';

// Single-user app: every subscribed device is tagged with the same fixed
// external id so the backend can target "me" without storing per-device
// subscriptions anywhere.
const EXTERNAL_ID = 'me';

function deferred(fn) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  return new Promise((resolve, reject) => {
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        resolve(await fn(OneSignal));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// serviceWorkerPath is resolved from the domain root, not from the current
// page's directory, so on a GitHub Pages project site (e.g. .../Dietz/)
// it needs the subpath spelled out, with a matching scope — otherwise
// OneSignal tries to register at the domain root, finds nothing there, and
// the push subscription silently never completes (notifications stay
// permission: granted but with no actual push token). Computed from
// location so this stays correct whether served from a domain root or a
// project subpath, matching the same reasoning as the SW registration
// comment in app.js.
const SCOPE = new URL('.', location.href).pathname;

export function initPush() {
  deferred((OneSignal) =>
    OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      safari_web_id: SAFARI_WEB_ID,
      serviceWorkerPath: SCOPE.replace(/^\//, '') + 'sw.js',
      serviceWorkerParam: { scope: SCOPE },
    })
  );
}

export function notificationPermission() {
  return window.Notification ? window.Notification.permission : 'unsupported';
}

export async function enableNotifications() {
  await deferred(async (OneSignal) => {
    await OneSignal.login(EXTERNAL_ID);
    await OneSignal.Notifications.requestPermission();
  });
  return notificationPermission();
}
