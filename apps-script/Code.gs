/**
 * Video Editor Dashboard — Apps Script backend.
 *
 * Shows Joe every upcoming PREMIUM episode from the CISO Series Podcast and
 * Defense in Depth lists, with what he needs to edit it, and lets him turn in
 * the finished zip + thumbnail + a note. Everything lands on the MAIN podcast
 * task; the linked "Premium Video" tasks are only read as a fallback source.
 *
 * Script Properties:
 *   CLICKUP_TOKEN       Josh's token (used until Joe's exists)
 *   JOE_CLICKUP_TOKEN   Joe's personal token — once set, all writes come from Joe
 *   ALLOWED_EMAILS      comma-separated Google accounts allowed in
 *   OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET / OAUTH_REDIRECT_URI   (see Auth.gs)
 */

const CFG = {
  WORKSPACE_ID: '10608308',
  TZ: 'America/Los_Angeles',
  TURNAROUND_DAYS: 2, // video due back 48h before air date
  PREMIUM_VIDEOS_LIST: '901113502252',
  // Premium sponsors we don't make premium videos for. Matched case-insensitively
  // on the start of the sponsor name, so "Horizon3" also catches "Horizon3.ai".
  EXCLUDED_SPONSORS: ['Horizon3'],
  LISTS: [
    { id: '82137309', show: 'CISO Series Podcast', short: 'CSP',
      sponsorField: '7b6bedb2-ce90-4e2d-be07-8ef40adc40f2' },
    { id: '164147770', show: 'Defense in Depth', short: 'DID',
      sponsorField: '45cdf842-dbf4-4f15-b14f-5a021a4eb34d' },
  ],
  F: {
    SPONSORSHIP_STATUS: '1665009a-7cf9-4a1c-9e53-583413c54372',
    PREMIUM_OPTION: '679018cd-3de8-45d6-b5dd-a97fb9b6fb14',
    VIDEO_RAW: 'e2588150-f801-410a-b83e-7ac711dda490',
    VIDEO_NOTES: '10738402-c4db-4300-a429-5775bf0d3a35',
    VIDEO_TITLE: 'eb0d7c70-e0ba-40d9-a32a-73241315b09b',
    VIDEO_STATUS: 'c3f50673-8f0e-4e2d-8503-5656e437fda7',
    VIDEO_STATUS_IN_REVIEW: '0f683586-e130-456e-8ed0-88b6afda2905',
    FINISHED_FILE: '204e86f1-384a-4289-8ce5-9172d9789545',
    THUMBNAIL: '151639a4-0da1-435c-afee-d9b4e1b37d62',
    SPONSOR_TEXT: 'e1d58292-b000-4ec6-8f2d-f3063564645f', // on Premium Video tasks
  },
};

/* ------------------------------------------------------------- sign-in */
// Same pattern as the Testimonial Tool (see Auth.gs): doGet runs the Google
// OAuth redirect, then serves Index.html with the verified email baked in.
// Every function the page calls takes that email first and re-checks it.

const APP_TITLE = 'CISO Series — Video Editor Dashboard';

function doGet(e) {
  const code = e && e.parameter && e.parameter.code;
  if (!code) return HtmlService.createHtmlOutput(signInPage_(buildGoogleAuthUrl_())).setTitle(APP_TITLE);

  let email;
  try {
    email = exchangeCodeForEmail_(code);
  } catch (err) {
    return HtmlService.createHtmlOutput(signInPage_(buildGoogleAuthUrl_(), err.message)).setTitle(APP_TITLE);
  }
  if (!isUserAllowed_(email)) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Access denied for ' + escapeHtml_(email) +
      '. Ask Josh to add this email to ALLOWED_EMAILS.</p>').setTitle('Access Denied');
  }
  const template = HtmlService.createTemplateFromFile('Index');
  template.userEmail = email;
  return template.evaluate().setTitle(APP_TITLE).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// target="_top" is required: Google's sign-in page refuses to load inside Apps Script's iframe.
function signInPage_(authUrl, errorMessage) {
  const errHtml = errorMessage ? '<p style="color:#c2341b;font-size:13px;margin-bottom:16px">' + escapeHtml_(errorMessage) + '</p>' : '';
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f6f8;color:#15181d;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
    '@media (prefers-color-scheme: dark){body{background:#0f1115;color:#e9ecf1}}' +
    '.box{text-align:center;max-width:340px;padding:24px}' +
    'a.btn{display:inline-block;margin-top:12px;background:#2f5bea;color:#fff;text-decoration:none;' +
    'padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600}</style></head><body>' +
    '<div class="box"><h2>Video Editor Dashboard</h2>' + errHtml +
    '<a class="btn" href="' + authUrl + '" target="_top">Sign in with Google</a></div></body></html>';
}

function escapeHtml_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Run once from the editor after setting Script Properties. Checks config and
// that the ClickUp token can read both podcast lists (read-only).
function runSetupCheck() {
  const p = PropertiesService.getScriptProperties();
  ['CLICKUP_TOKEN', 'JOE_CLICKUP_TOKEN', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET'].forEach(k => Logger.log(k + ' set: ' + !!p.getProperty(k)));
  Logger.log('ALLOWED_EMAILS: ' + (p.getProperty('ALLOWED_EMAILS') || '(not set — nobody will get in)'));
  Logger.log('OAUTH_REDIRECT_URI: ' + (p.getProperty('OAUTH_REDIRECT_URI') || '(not set yet — fine until after first deploy)'));
  try {
    const data = getEpisodesData_();
    Logger.log('ClickUp OK — ' + data.episodes.length + ' upcoming premium episodes, ' +
      data.episodes.filter(x => x.raw).length + ' with raw footage. Acting as: ' + data.actingAs);
  } catch (e) {
    Logger.log('ClickUp read FAILED: ' + e.message);
  }
}

/* ------------------------------------------------------------------ reads */

function getEpisodes(email) {
  assertAllowed_(email);
  return getEpisodesData_();
}

function getEpisodesData_() {
  const today = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  const startOfToday = Utilities.parseDate(today + ' 00:00', CFG.TZ, 'yyyy-MM-dd HH:mm').getTime();
  const premiumFilter = JSON.stringify([{ field_id: CFG.F.SPONSORSHIP_STATUS, operator: '=', value: CFG.F.PREMIUM_OPTION }]);

  const pvTasks = listTasks_(CFG.PREMIUM_VIDEOS_LIST, {});
  const pvById = {};
  pvTasks.forEach(t => { pvById[t.id] = t; });

  const episodes = [];
  CFG.LISTS.forEach(list => {
    // One day of slack on the timestamp filter; the exact cut is made on the name-based air date.
    const tasks = listTasks_(list.id, { custom_fields: premiumFilter, due_date_gt: startOfToday - 864e5 });
    tasks.map(t => buildEpisode_(t, list, pvTasks, pvById))
      .filter(ep => ep.airDate >= today && !isExcludedSponsor_(ep.sponsor))
      .forEach(ep => episodes.push(ep));
  });
  episodes.sort((a, b) => a.airDate.localeCompare(b.airDate));
  return { today: today, turnaroundDays: CFG.TURNAROUND_DAYS, actingAs: actingAs_(), episodes: episodes };
}

function buildEpisode_(t, list, pvTasks, pvById) {
  const airDate = airDate_(t);
  const p = airDate.split('-').map(Number);
  const dueBack = Utilities.formatDate(new Date(p[0], p[1] - 1, p[2] - CFG.TURNAROUND_DAYS, 12), CFG.TZ, 'yyyy-MM-dd');
  const pv = findPremiumVideoTask_(t, airDate, pvTasks, pvById);

  const mainRaw = cf_(t, CFG.F.VIDEO_RAW);
  const pvRaw = pv && cf_(pv, CFG.F.VIDEO_RAW);
  const sponsorRel = (cf_(t, list.sponsorField) || []).map(s => s.name).join(', ');
  const notes = [];
  pushNote_(notes, 'Video notes', 'main', cf_(t, CFG.F.VIDEO_NOTES));
  if (pv) {
    const pvNotes = cf_(pv, CFG.F.VIDEO_NOTES);
    pushNote_(notes, 'Video notes', 'premium', pvNotes);
    const desc = (pv.markdown_description || pv.text_content || '').trim();
    if (desc && desc !== String(pvNotes || '').trim()) pushNote_(notes, 'Premium Video task description', 'premium', desc);
  }

  return {
    id: t.id,
    url: t.url,
    name: t.name,
    show: list.show,
    showShort: list.short,
    airDate: airDate,
    dueBack: dueBack,
    sponsor: sponsorRel || (pv && cf_(pv, CFG.F.SPONSOR_TEXT)) || '',
    videoTitle: String(cf_(t, CFG.F.VIDEO_TITLE) || (pv && cf_(pv, CFG.F.VIDEO_TITLE)) || '').trim(),
    videoStatus: dropdownName_(t, CFG.F.VIDEO_STATUS),
    raw: mainRaw ? { url: mainRaw, source: 'main' } : pvRaw ? { url: pvRaw, source: 'premium' } : null,
    notes: notes,
    premiumTask: pv ? { id: pv.id, name: pv.name, url: pv.url } : null,
    finishedFiles: (cf_(t, CFG.F.FINISHED_FILE) || []).map(a => ({ title: a.title, url: a.url })),
    thumbnails: (cf_(t, CFG.F.THUMBNAIL) || []).map(a => ({ title: a.title, url: a.url })),
  };
}

// The "(MM-DD-YY)" in the task name is the reliable air date; ClickUp due-date
// timestamps on these lists are stored at mixed times of day and can land on the
// previous day in Pacific time. Fall back to the due date if the name has none.
function airDate_(t) {
  const m = /\((\d{2})-(\d{2})-(\d{2})\)/.exec(t.name);
  if (m) return '20' + m[3] + '-' + m[1] + '-' + m[2];
  return Utilities.formatDate(new Date(Number(t.due_date)), CFG.TZ, 'yyyy-MM-dd');
}

// Linked task in the Premium Videos list first; otherwise a Premium Videos task whose name carries the same (MM-DD-YY).
function findPremiumVideoTask_(t, airDate, pvTasks, pvById) {
  const linkedIds = (t.linked_tasks || []).map(l => (l.task_id === t.id ? l.link_id : l.task_id));
  const linked = linkedIds.map(id => pvById[id]).filter(Boolean)[0];
  if (linked) return linked;
  const p = airDate.split('-'); // yyyy-MM-dd -> (MM-DD-YY)
  const token = '(' + p[1] + '-' + p[2] + '-' + p[0].slice(2) + ')';
  return pvTasks.filter(x => x.name.indexOf(token) !== -1)[0] || null;
}

function isExcludedSponsor_(sponsor) {
  const s = String(sponsor || '').toLowerCase();
  return s && CFG.EXCLUDED_SPONSORS.some(x => s.indexOf(x.toLowerCase()) === 0);
}

function pushNote_(arr, label, source, text) {
  const clean = String(text || '').trim();
  // Skip the empty "L3: / Thumbnail title: / Notes:" template.
  if (!clean || !clean.replace(/^(L3|Thumbnail title|Notes):\s*$/gim, '').trim()) return;
  arr.push({ label: label, source: source, text: clean });
}

/* ----------------------------------------------------------------- writes */

// The browser uploads files straight to ClickUp (Apps Script caps payloads at ~50 MB),
// so it needs a token. That's Joe's own token once JOE_CLICKUP_TOKEN is set.
function getUploadConfig(email) {
  assertAllowed_(email);
  return {
    token: token_(),
    workspaceId: CFG.WORKSPACE_ID,
    fields: { finished: CFG.F.FINISHED_FILE, thumbnail: CFG.F.THUMBNAIL },
  };
}

/**
 * Called after the browser has uploaded files. Puts them into the custom
 * fields, flips Video - Status to In Review and posts Joe's note as a comment.
 * Returns per-step results so the UI can show exactly what still needs doing by hand.
 */
function finalizeDelivery(email, taskId, payload) {
  assertAllowed_(email);
  const results = {};
  if (payload.finishedAttachmentId) {
    results.finished = tryStep_(() => setAttachmentField_(taskId, CFG.F.FINISHED_FILE, payload.finishedAttachmentId));
  }
  if (payload.thumbnailAttachmentId) {
    results.thumbnail = tryStep_(() => setAttachmentField_(taskId, CFG.F.THUMBNAIL, payload.thumbnailAttachmentId));
  }
  if (payload.finishedAttachmentId || payload.thumbnailAttachmentId) {
    results.status = tryStep_(() => clickup_('post', '/api/v2/task/' + taskId + '/field/' + CFG.F.VIDEO_STATUS,
      { value: CFG.F.VIDEO_STATUS_IN_REVIEW }));
  }
  const lines = ['🎬 From the Video Editor Dashboard'];
  const failedTag = r => (!r || !r.ok ? ' (upload FAILED — Joe will add it to the field by hand)' : '');
  if (payload.finishedName) lines.push('Finished file: ' + payload.finishedName + failedTag(results.finished));
  if (payload.thumbnailName) lines.push('Thumbnail: ' + payload.thumbnailName + failedTag(results.thumbnail));
  if (payload.note) lines.push('', payload.note);
  if (lines.length > 1) {
    results.comment = tryStep_(() => clickup_('post', '/api/v2/task/' + taskId + '/comment', { comment_text: lines.join('\n'), notify_all: true }));
  }
  return results;
}

// VERIFY on first real run: ClickUp's docs say to pass the uploaded attachment's id
// to Set Custom Field Value. Try the add-style body first, then a plain array.
function setAttachmentField_(taskId, fieldId, attachmentId) {
  const path = '/api/v2/task/' + taskId + '/field/' + fieldId;
  try {
    return clickup_('post', path, { value: { add: [attachmentId] } });
  } catch (e) {
    return clickup_('post', path, { value: [attachmentId] });
  }
}

/* ---------------------------------------------------------------- helpers */

function listTasks_(listId, params) {
  const out = [];
  for (let page = 0; page < 20; page++) {
    const q = Object.assign({ include_markdown_description: 'true', page: page }, params);
    const qs = Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
    const res = clickup_('get', '/api/v2/list/' + listId + '/task?' + qs);
    out.push.apply(out, res.tasks || []);
    if (res.last_page !== false || !(res.tasks || []).length) break;
  }
  return out;
}

function clickup_(method, path, body) {
  const opts = { method: method, headers: { Authorization: token_() }, muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch('https://api.clickup.com' + path, opts);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('ClickUp ' + code + ': ' + res.getContentText().slice(0, 300));
  const text = res.getContentText();
  return text ? JSON.parse(text) : {};
}

function tryStep_(fn) {
  try { fn(); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

function cf_(task, fieldId) {
  const f = (task.custom_fields || []).filter(x => x.id === fieldId)[0];
  return f && f.value !== undefined && f.value !== null && f.value !== '' ? f.value : null;
}

function dropdownName_(task, fieldId) {
  const f = (task.custom_fields || []).filter(x => x.id === fieldId)[0];
  if (!f || f.value === undefined || f.value === null) return '';
  const opts = (f.type_config && f.type_config.options) || [];
  const hit = opts.filter(o => o.id === f.value || String(o.orderindex) === String(f.value))[0];
  return hit ? hit.name : '';
}

function token_() {
  const p = PropertiesService.getScriptProperties();
  return p.getProperty('JOE_CLICKUP_TOKEN') || p.getProperty('CLICKUP_TOKEN');
}

function actingAs_() {
  return PropertiesService.getScriptProperties().getProperty('JOE_CLICKUP_TOKEN') ? 'joe' : 'josh';
}
