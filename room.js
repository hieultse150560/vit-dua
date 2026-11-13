(function (root) {
  'use strict';
  // Race room: the host's browser keeps the tournament and publishes a snapshot; players open
  // ?phong=CODE&ten=NAME, follow the snapshot and send pick requests the host validates.
  // Transport: Firebase Realtime Database when window.VIT_DUA_FIREBASE holds a web config,
  // otherwise a BroadcastChannel (tabs of one browser: enough to try a room on one machine).
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const config = () => root.VIT_DUA_FIREBASE || null;
  const validCode = code => typeof code === 'string' && /^[A-Z0-9]{4,12}$/.test(code);

  function newCode(length = 6) {
    const bytes = root.crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = root.document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Không tải được ${src}`));
      root.document.head.append(s);
    });
  }
  let firebaseReady = null;
  function firebaseDb() {
    firebaseReady ??= (async () => {
      for (const file of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js']) await loadScript(SDK + file);
      const fb = root.firebase;
      if (!fb.apps.length) fb.initializeApp(config());
      const { user } = await fb.auth().signInAnonymously();
      const db = fb.database();
      let offset = 0;
      db.ref('.info/serverTimeOffset').on('value', snap => { offset = Number(snap.val()) || 0; });
      return { fb, db, uid: user.uid, now: () => Date.now() + offset };
    })();
    return firebaseReady;
  }

  // ---- Firebase transport ----
  async function hostFirebase(code, { onRequest }) {
    const { fb, db, uid, now } = await firebaseDb();
    const room = db.ref(`rooms/${code}`);
    await room.child('host').set(uid); // the rules refuse this when another browser already owns the code
    const requests = room.child('requests');
    const onAdded = snap => { const req = snap.val(); snap.ref.remove().catch(() => {}); if (req) onRequest(req); };
    requests.on('child_added', onAdded);
    return {
      now,
      publish: state => room.child('state').set({ json: JSON.stringify(state), at: fb.database.ServerValue.TIMESTAMP }),
      close: async () => { requests.off('child_added', onAdded); await room.child('state').remove().catch(() => {}); }
    };
  }
  async function joinFirebase(code, { onState }) {
    const { fb, db, now } = await firebaseDb();
    const room = db.ref(`rooms/${code}`);
    const onValue = snap => { const v = snap.val(); try { onState(v ? JSON.parse(v.json) : null); } catch { onState(null); } };
    room.child('state').on('value', onValue);
    return {
      now,
      send: req => room.child('requests').push({ ...req, at: fb.database.ServerValue.TIMESTAMP }),
      close: async () => room.child('state').off('value', onValue)
    };
  }

  // ---- BroadcastChannel transport (same browser) ----
  async function hostLocal(code, { onRequest }) {
    const channel = new root.BroadcastChannel(`vit-dua-room-${code}`);
    let last = null;
    channel.onmessage = ({ data }) => {
      if (data?.kind === 'request') onRequest(data.req);
      if (data?.kind === 'hello' && last) channel.postMessage({ kind: 'state', state: last });
    };
    return {
      now: () => Date.now(),
      publish: async state => { last = state; channel.postMessage({ kind: 'state', state }); },
      close: async () => { channel.postMessage({ kind: 'state', state: null }); channel.close(); }
    };
  }
  async function joinLocal(code, { onState }) {
    const channel = new root.BroadcastChannel(`vit-dua-room-${code}`);
    channel.onmessage = ({ data }) => { if (data?.kind === 'state') onState(data.state); };
    channel.postMessage({ kind: 'hello' });
    return {
      now: () => Date.now(),
      send: async req => channel.postMessage({ kind: 'request', req }),
      close: async () => channel.close()
    };
  }

  async function host(code, handlers) {
    if (!validCode(code)) throw new Error('Mã phòng không hợp lệ.');
    return config() ? hostFirebase(code, handlers) : hostLocal(code, handlers);
  }
  async function join(code, handlers) {
    if (!validCode(code)) throw new Error('Mã phòng không hợp lệ.');
    return config() ? joinFirebase(code, handlers) : joinLocal(code, handlers);
  }
  // Names are matched loosely: case, accents' Unicode form and extra spaces do not matter.
  const sameName = (a, b) => String(a).normalize('NFC').trim().toLocaleLowerCase('vi-VN') === String(b).normalize('NFC').trim().toLocaleLowerCase('vi-VN');
  const link = (code, name, base = root.location.href.split(/[?#]/)[0]) => `${base}?phong=${encodeURIComponent(code)}&ten=${encodeURIComponent(name)}`;

  root.DuckRoom = Object.freeze({ host, join, newCode, validCode, sameName, link, online: () => !!config() });
})(typeof window !== 'undefined' ? window : globalThis);
