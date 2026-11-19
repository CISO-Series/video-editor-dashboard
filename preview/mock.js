// Local-preview stand-in for the Apps Script backend.
// Episode data is a snapshot of the real ClickUp lists taken 2026-11-18.
// Nothing here talks to ClickUp: uploads and sends are simulated.
(function () {
  const CSP = { show: 'CISO Series Podcast', showShort: 'CSP' };
  const DID = { show: 'Defense in Depth', showShort: 'DID' };
  const base = (id, meta, mmddyy, extra) => {
    const [m, d, y] = mmddyy.split('-');
    const air = `20${y}-${m}-${d}`;
    const dt = new Date(+('20' + y), +m - 1, +d - 2);
    const dueBack = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return Object.assign({
      id, url: `https://app.clickup.com/t/${id}`, name: `${meta.show} (${mmddyy})`, airDate: air, dueBack,
      sponsor: '', videoTitle: '', videoStatus: '', raw: null, notes: [],
      premiumTask: null, finishedFiles: [], thumbnails: [],
    }, meta, extra || {});
  };

  const episodes = [
    base('868edqud1', DID, '11-19-26', { sponsor: 'Horizon3.ai', }),
    base('868edqn4p', CSP, '12-01-26', { sponsor: 'ThreatLocker', videoStatus: 'Not scheduled',
      premiumTask: { id: '868hug79t', name: '⚠️ Premium Video (12-01-26)', url: 'https://app.clickup.com/t/868hug79t' },
      notes: [{ label: 'Video notes', source: 'premium', text: 'Interviewee: Martin Bruenn, CEO, Advanced Systemhaus GMBH\nType: Customer testimonial (MSP, Germany)\nTopic: MSP perspective on ThreatLocker\n⚠️ BACK BURNER — David notes broken English, will need to be cut down significantly to be usable' }] }),
    base('868hux4m2', DID, '12-03-26', { sponsor: 'ThreatDown' }),
    base('868edquer', DID, '12-10-26', { sponsor: 'ThreatLocker',
      videoTitle: "Join CISO Series at ThreatLocker's Zero Trust World 2027 in Orlando",
      raw: { url: 'https://drive.google.com/drive/folders/1b2-zDWlbs8wB4KojT27BeRSicMWvRFQh?usp=drive_link', source: 'premium' },
      premiumTask: { id: '868j7ba9b', name: 'PV - Defense in Depth (12-10-26)', url: 'https://app.clickup.com/t/868j7ba9b' },
      notes: [{ label: 'Video notes', source: 'premium', text: 'L3: Rob Allen, Chief Product Officer, ThreatLocker\n\nMake sure to include the following graphics on screen. You can put them up multiple times once referenced. Put this information up when appropriate.\n\nZero Trust World\nOrlando, FL\nFebruary 17th-19th, 2027\nREGISTER: ztw.com\nUse ZTWCISO27 for $200 off\n\nTHUMBNAIL: Zero Trust World 2-17 to 2-19-26 in Orlando, FL' }] }),
    ...[
      ['868edqn31', CSP, '01-05-27'], ['868hux4qz', DID, '01-14-27'], ['868huwzxu', CSP, '01-19-27'], ['868huwzzb', CSP, '01-26-27'],
      ['868hux01q', CSP, '02-02-27'], ['868hux057', CSP, '02-09-27'], ['868hux4y8', DID, '02-18-27'], ['868hux09e', CSP, '03-09-27'],
      ['868hux53m', DID, '03-18-27'], ['868hux0ez', CSP, '04-06-27'], ['868hux59q', DID, '04-15-27'], ['868hux0gw', CSP, '05-04-27'],
      ['868hux5fg', DID, '05-13-27'], ['868hux0mq', CSP, '06-01-27'], ['868hux5mm', DID, '06-10-27'], ['868hux0rp', CSP, '06-29-27'],
      ['868hux5tb', DID, '07-08-27'], ['868hux0zw', CSP, '07-27-27'], ['868hux5xc', DID, '08-05-27'], ['868hux12y', CSP, '08-24-27'],
      ['868hux609', DID, '09-02-27'], ['868hux15g', CSP, '09-21-27'], ['868hux65v', DID, '09-30-27'], ['868hux19f', CSP, '10-19-27'],
      ['868hux6ax', DID, '10-28-27'], ['868hux1g3', CSP, '11-16-27'], ['868hux6du', DID, '11-18-27'],
    ].map(([id, meta, date]) => base(id, meta, date)),
  ];

  const wait = ms => new Promise(r => setTimeout(r, ms));

  window.PREVIEW = {
    snapshotDate: 'Nov 18, 2026',
    failUploads: false,
    async api(fn, ...args) {
      await wait(350);
      if (fn === 'getEpisodes') {
        // Mirrors CFG.EXCLUDED_SPONSORS in Code.gs.
        // Preview "today" is the real date; add ?today=YYYY-MM-DD to the URL to see other states.
        const now = new Date();
        const today = new URLSearchParams(location.search).get('today') ||
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const kept = episodes.filter(e => !/^horizon3/i.test(e.sponsor) && e.airDate >= today);
        return { today, turnaroundDays: 2, actingAs: 'josh', episodes: JSON.parse(JSON.stringify(kept)) };
      }
      if (fn === 'getUploadConfig') return { token: 'preview', workspaceId: '10608308', fields: { finished: 'f', thumbnail: 't' } };
      if (fn === 'finalizeDelivery') {
        const [taskId, p] = args;
        console.log('[preview] finalizeDelivery', taskId, p);
        const r = {};
        if (p.finishedAttachmentId) r.finished = { ok: true };
        if (p.thumbnailAttachmentId) r.thumbnail = { ok: true };
        if (p.finishedAttachmentId || p.thumbnailAttachmentId) r.status = { ok: true };
        if (p.note || p.finishedName || p.thumbnailName) r.comment = { ok: true };
        return r;
      }
      throw new Error('Unknown preview call: ' + fn);
    },
    async upload(file, onProgress) {
      for (let i = 1; i <= 20; i++) {
        await wait(60);
        onProgress(i / 20);
        if (this.failUploads && i === 12) throw new Error('Simulated failure (preview)');
      }
      return 'preview-' + Math.random().toString(36).slice(2);
    },
  };
})();
