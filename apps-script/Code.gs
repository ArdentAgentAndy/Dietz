// Dietz backend. One Google Sheet is the database, one tab per table.
// See CLAUDE.md §1 and §2 for the API contract and schema this implements.

var TABLES = {
  Courses: { columns: ['id', 'code', 'name', 'credits', 'term', 'status', 'finalLetter', 'configJson', 'sortOrder'], key: ['id'] },
  Items: { columns: ['id', 'courseId', 'componentId', 'name', 'earned', 'possible', 'excused', 'dueDate', 'note'], key: ['id'] },
  CourseState: { columns: ['courseId', 'key', 'value'], key: ['courseId', 'key'] },
  Categories: { columns: ['id', 'group', 'name', 'courseId', 'archived'], key: ['id'] },
  Sessions: { columns: ['id', 'categoryId', 'date', 'start', 'end', 'minutes', 'source', 'note'], key: ['id'] },
  PastTerms: { columns: ['id', 'term', 'credits', 'gpa'], key: ['id'] },
  Settings: { columns: ['key', 'value'], key: ['key'] },
  // Complete/urgent flags for Canvas events marked in the UI without being
  // linked to a Notion task (see js/canvas.js) — id is the Canvas event id.
  // Column names match the Notion task fields they mirror (`mark`/`urgent`,
  // not e.g. "completed") since js/views/canvas.js's HIGHLIGHT_KINDS reuses
  // the same field name for both the linked and unlinked path. Synced like
  // any other table so the digest/reminder triggers below can see a
  // Canvas-only item's done state too, not just linked tasks' `mark`.
  CanvasFlags: { columns: ['id', 'mark', 'urgent'], key: ['id'] },
};

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return Boolean(expected) && token === expected;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  sheet.appendRow(TABLES[name].columns);
  return sheet;
}

// Sheets auto-parses strings that look like dates into real Date values on
// write — a pre-set plain-text column format is not reliable enough to stop
// it. Prefixing with an apostrophe is Sheets' own documented way to force
// literal text; the apostrophe itself never appears when reading the value
// back, so no read-side unwrapping is needed.
function isDateLikeColumn_(tableName, col) {
  // Settings' single 'value' column holds arbitrary strings (URLs, tokens,
  // dates) — Sheets will just as happily auto-parse "2026-08-25" there as
  // anywhere else, so it always needs the literal-text guard too.
  return tableName === 'Settings' || /date|start|end/i.test(col);
}

function forSheetValue_(tableName, col, value) {
  if (isDateLikeColumn_(tableName, col) && value !== '' && value !== undefined && value !== null) {
    return "'" + value;
  }
  return value;
}

// Tables keyed by something other than 'id' (Settings: 'key'; CourseState:
// 'courseId'+'key') don't have an id column in the Sheet at all — the
// frontend synthesizes one (see setSetting/rowId) so its generic
// store.upsert(match-by-id) works. That synthetic id must be rebuilt here
// on every read, or it's lost after the first bootstrap pull and the next
// edit silently creates a duplicate row instead of updating the existing one.
function readTable_(name) {
  var sheet = getSheet_(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var keyCols = TABLES[name].key;

  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return v !== ''; }); })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      if (!('id' in obj)) {
        obj.id = keyCols.map(function (k) { return obj[k]; }).join(':');
      }
      return obj;
    });
}

function findRow_(sheet, headers, keyCols, keyValues) {
  var values = sheet.getDataRange().getValues();
  var keyIdxs = keyCols.map(function (k) { return headers.indexOf(k); });
  for (var r = 1; r < values.length; r++) {
    var match = keyIdxs.every(function (idx, i) { return String(values[r][idx]) === String(keyValues[i]); });
    if (match) return r + 1; // 1-based sheet row
  }
  return -1;
}

function upsertRow_(tableName, row) {
  var config = TABLES[tableName];
  if (!config) throw new Error('Unknown table: ' + tableName);
  var sheet = getSheet_(tableName);
  var headers = config.columns;
  var keyValues = config.key.map(function (k) { return row[k]; });
  var rowArray = headers.map(function (h) { return forSheetValue_(tableName, h, row[h] !== undefined ? row[h] : ''); });

  var foundRow = findRow_(sheet, headers, config.key, keyValues);
  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, headers.length).setValues([rowArray]);
  } else {
    sheet.appendRow(rowArray);
  }
}

// id: plain id string for single-key tables. For CourseState (composite key),
// the frontend's synthetic id is "courseId:key" — split it back apart.
function deleteRow_(tableName, id) {
  var config = TABLES[tableName];
  if (!config) throw new Error('Unknown table: ' + tableName);
  var sheet = getSheet_(tableName);
  var headers = config.columns;

  var keyValues;
  if (tableName === 'CourseState') {
    var sep = id.indexOf(':');
    keyValues = [id.slice(0, sep), id.slice(sep + 1)];
  } else {
    keyValues = [id];
  }

  var foundRow = findRow_(sheet, headers, config.key, keyValues);
  if (foundRow > 0) sheet.deleteRow(foundRow);
}

function doGet(e) {
  var token = e.parameter.token;
  if (!checkToken_(token)) return jsonOut_({ error: 'unauthorized' });

  if (e.parameter.action === 'bootstrap') {
    var data = {};
    Object.keys(TABLES).forEach(function (name) { data[name] = readTable_(name); });
    return jsonOut_(data);
  }

  if (e.parameter.action === 'notion-tasks') {
    return jsonOut_(notionQueryTasks_());
  }

  if (e.parameter.action === 'canvas-events') {
    return jsonOut_(canvasEvents_());
  }

  return jsonOut_({ error: 'unknown action' });
}

// --- Canvas (Google Calendar) proxy ------------------------------------
// Separate from Notion entirely. Apps Script has built-in access to
// Google Calendar for whichever account owns this script — no OAuth/token
// setup needed, unlike Notion. CANVAS_CALENDAR_ID is a Script Property
// (not secret, just keeps the personal calendar ID out of the public repo).

// Canvas titles end in "[subject_number_term_assignmentid]" — strip it for
// a clean task name, and separately parse "subject number" as the course.
function canvasStripTitle_(title) {
  return title.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
}

function canvasParseCourse_(title) {
  var m = title.match(/\[([a-zA-Z]+)_([a-zA-Z0-9]+)_/);
  if (!m) return '';
  return m[1].toUpperCase() + ' ' + m[2].toUpperCase();
}

// Canvas represents a due date as a zero-duration event at that moment.
function canvasEventDeadline_(event) {
  if (event.isAllDayEvent()) {
    return Utilities.formatDate(event.getAllDayStartDate(), 'UTC', 'yyyy-MM-dd');
  }
  return event.getStartTime().toISOString();
}

function canvasEvents_() {
  var calendarId = PropertiesService.getScriptProperties().getProperty('CANVAS_CALENDAR_ID');
  if (!calendarId) return { error: 'canvas calendar not configured', events: [] };

  // An uncaught exception here (e.g. Calendar access not yet authorized)
  // makes Apps Script return an error page without CORS headers, which the
  // browser reports as an opaque "Failed to fetch" instead of a readable
  // error — catch it so the frontend gets a normal JSON error instead.
  try {
    var calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) return { error: 'canvas calendar not found (check CANVAS_CALENDAR_ID)', events: [] };

    var start = new Date();
    start.setDate(start.getDate() - 30);
    var end = new Date();
    end.setDate(end.getDate() + 180);

    var events = calendar.getEvents(start, end).map(function (e) {
      var title = e.getTitle();
      return {
        id: e.getId(),
        name: canvasStripTitle_(title),
        course: canvasParseCourse_(title),
        deadline: canvasEventDeadline_(e),
      };
    });

    return { events: events };
  } catch (err) {
    return { error: 'canvas calendar error: ' + err.message, events: [] };
  }
}

// --- Notion proxy -----------------------------------------------------
// Phase 1 (view only): the frontend calls this same Apps Script backend
// (already gated by the TOKEN above) to read tasks from a Notion database.
// The Notion integration secret lives only in Script Properties as
// NOTION_TOKEN — it never reaches the frontend or localStorage.

function propTitle_(prop) {
  return ((prop && prop.title) || []).map(function (t) { return t.plain_text; }).join('');
}

function propRichText_(prop) {
  return ((prop && prop.rich_text) || []).map(function (t) { return t.plain_text; }).join('');
}

function propSelect_(prop) {
  return (prop && prop.select) ? prop.select.name : '';
}

function propStatus_(prop) {
  return (prop && prop.status) ? prop.status.name : '';
}

// name+color together, for the properties the frontend colors chips by.
function propSelectColor_(prop) {
  return { name: (prop && prop.select) ? prop.select.name : '', color: (prop && prop.select) ? prop.select.color : '' };
}

function propStatusColor_(prop) {
  return { name: (prop && prop.status) ? prop.status.name : '', color: (prop && prop.status) ? prop.status.color : '' };
}

function propCheckbox_(prop) {
  return Boolean(prop && prop.checkbox);
}

function propNumber_(prop) {
  return (prop && prop.number != null) ? prop.number : null;
}

function propDate_(prop) {
  if (!prop || !prop.date) return null;
  return { start: prop.date.start, end: prop.date.end || null };
}

function notionTaskFromPage_(page) {
  var p = page.properties;
  var category = propStatusColor_(p.Category);
  var course = propSelectColor_(p.Course);
  var project = propSelectColor_(p.Project);
  var lead = propSelectColor_(p.Lead);

  return {
    id: page.id,
    url: page.url,
    name: propTitle_(p.Name),
    category: category.name,
    categoryColor: category.color,
    course: course.name,
    courseColor: course.color,
    class: propSelect_(p.Class),
    project: project.name,
    projectColor: project.color,
    lead: lead.name,
    leadColor: lead.color,
    type: propSelect_(p.Type),
    task: propSelect_(p.Task),
    select: propSelect_(p.Select),
    date: propDate_(p.Date),
    deadline: propDate_(p.Deadline),
    // Canvas's own stable event id (Google Calendar event id), stamped on a
    // task when it's linked from the Canvas tab — the match Canvas uses to
    // find its way back to this task, independent of either side's Name
    // (see notionFieldsToProperties_ below and canvas.js's taskByCanvasId).
    canvasId: propRichText_(p.CanvasId),
    duration: propNumber_(p.Duration),
    location: propRichText_(p.Location),
    room: propRichText_(p.Room),
    credit: propRichText_(p.Credit),
    score: propRichText_(p.Score),
    display: propCheckbox_(p.Display),
    mark: propCheckbox_(p['?']),
    urgent: propCheckbox_(p.Urgent),
  };
}

// Phase 2 (write, narrow slice): flip a checkbox property on specific pages.
// Still gated by the frontend's own TOKEN (checked by the caller) — this
// uses NOTION_TOKEN to talk to Notion, same as the read path. Property name
// is whitelisted rather than trusted verbatim from the request body.
var WRITABLE_CHECKBOX_PROPS_ = { Urgent: true, '?': true };

function notionUpdateCheckbox_(property, updates) {
  if (!WRITABLE_CHECKBOX_PROPS_[property]) return { error: 'property not writable: ' + property };

  var notionToken = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!notionToken) return { error: 'notion not configured' };

  var results = (updates || []).map(function (u) {
    var properties = {};
    properties[property] = { checkbox: Boolean(u.value) };
    var response = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + u.pageId, {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + notionToken, 'Notion-Version': '2022-06-28' },
      payload: JSON.stringify({ properties: properties }),
      muteHttpExceptions: true,
    });
    var ok = response.getResponseCode() === 200;
    return { pageId: u.pageId, ok: ok, error: ok ? null : response.getContentText() };
  });

  return { ok: results.every(function (r) { return r.ok; }), results: results };
}

// Phase 3 (add/edit): build a Notion "properties" payload from the flat
// field names the frontend uses (matching notionTaskFromPage_'s output).
// A field is only touched if the caller included it — omitted fields are
// left alone, letting a category-change edit set just the one sub-value
// (course/project/lead) that applies without clobbering the others.
function notionFieldsToProperties_(fields) {
  var properties = {};
  if ('name' in fields) properties.Name = { title: fields.name ? [{ text: { content: fields.name } }] : [] };
  if ('category' in fields) properties.Category = { status: fields.category ? { name: fields.category } : null };
  if ('course' in fields) properties.Course = { select: fields.course ? { name: fields.course } : null };
  if ('project' in fields) properties.Project = { select: fields.project ? { name: fields.project } : null };
  if ('lead' in fields) properties.Lead = { select: fields.lead ? { name: fields.lead } : null };
  if ('duration' in fields) properties.Duration = { number: (fields.duration === '' || fields.duration == null) ? null : Number(fields.duration) };
  if ('date' in fields) {
    if (!fields.date) {
      properties.Date = { date: null };
    } else {
      var dateValue = { start: fields.date };
      if (fields.dateEnd) dateValue.end = fields.dateEnd;
      properties.Date = { date: dateValue };
    }
  }
  if ('deadline' in fields) {
    properties.Deadline = fields.deadline ? { date: { start: fields.deadline } } : { date: null };
  }
  if ('canvasId' in fields) {
    properties.CanvasId = { rich_text: fields.canvasId ? [{ text: { content: fields.canvasId } }] : [] };
  }
  if ('mark' in fields) properties['?'] = { checkbox: Boolean(fields.mark) };
  if ('urgent' in fields) properties.Urgent = { checkbox: Boolean(fields.urgent) };
  return properties;
}

function notionCreateTask_(fields) {
  var props = PropertiesService.getScriptProperties();
  var notionToken = props.getProperty('NOTION_TOKEN');
  var databaseId = props.getProperty('NOTION_DATABASE_ID');
  if (!notionToken || !databaseId) return { error: 'notion not configured' };

  var response = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + notionToken, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify({ parent: { database_id: databaseId }, properties: notionFieldsToProperties_(fields || {}) }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) return { error: 'notion api error: ' + response.getContentText() };
  return { ok: true, task: notionTaskFromPage_(JSON.parse(response.getContentText())) };
}

function notionUpdateTask_(pageId, fields) {
  var notionToken = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!notionToken) return { error: 'notion not configured' };

  var response = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + notionToken, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify({ properties: notionFieldsToProperties_(fields || {}) }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) return { error: 'notion api error: ' + response.getContentText() };
  return { ok: true, task: notionTaskFromPage_(JSON.parse(response.getContentText())) };
}

// "Delete" = archive (Notion's own trash, recoverable there) — the REST API
// doesn't offer a permanent-delete action, and archived:true is exactly
// what clicking Delete in the Notion UI does.
function notionDeleteTask_(pageId) {
  var notionToken = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!notionToken) return { error: 'notion not configured' };

  var response = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + notionToken, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify({ archived: true }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) return { error: 'notion api error: ' + response.getContentText() };
  return { ok: true };
}

function notionQueryTasks_() {
  var props = PropertiesService.getScriptProperties();
  var notionToken = props.getProperty('NOTION_TOKEN');
  var databaseId = props.getProperty('NOTION_DATABASE_ID');
  if (!notionToken || !databaseId) {
    return { error: 'notion not configured', tasks: [] };
  }

  var tasks = [];
  var cursor = null;
  var maxPages = 10; // 10 * 100 rows = 1000 rows ceiling, plenty for this database

  for (var i = 0; i < maxPages; i++) {
    var payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;

    var response = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + databaseId + '/query', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + notionToken,
        'Notion-Version': '2022-06-28',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      return { error: 'notion api error ' + code + ': ' + response.getContentText(), tasks: tasks };
    }

    var body = JSON.parse(response.getContentText());
    tasks = tasks.concat(body.results.map(notionTaskFromPage_));

    if (!body.has_more) break;
    cursor = body.next_cursor;
  }

  return { tasks: tasks };
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ error: 'invalid body' });
  }

  if (!checkToken_(body.token)) return jsonOut_({ error: 'unauthorized' });

  if (body.action === 'notion-update-checkbox') {
    return jsonOut_(notionUpdateCheckbox_(body.property, body.updates));
  }

  if (body.action === 'notion-create-task') {
    return jsonOut_(notionCreateTask_(body.fields));
  }

  if (body.action === 'notion-update-task') {
    return jsonOut_(notionUpdateTask_(body.pageId, body.fields));
  }

  if (body.action === 'notion-delete-task') {
    return jsonOut_(notionDeleteTask_(body.pageId));
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    (body.ops || []).forEach(function (op) {
      if (op.op === 'upsert') upsertRow_(op.table, op.row);
      else if (op.op === 'delete') deleteRow_(op.table, op.id);
    });
  } finally {
    lock.releaseLock();
  }

  return jsonOut_({ ok: true, updatedAt: new Date().toISOString() });
}

// --- Push notifications -------------------------------------------------
// All three (morning digest, evening digest, due-soon reminders) fire from
// time-driven triggers (installed once by running installNotificationTriggers
// below from the Apps Script editor — see SETUP.md), not from any request
// the frontend makes — neither the static site nor this backend is
// otherwise watched proactively, so a scheduled trigger is the only way to
// get a notification without the app being open.

// "Today"/"tomorrow" as yyyy-mm-dd in the script's own timezone (see
// appsscript.json). Canvas event deadlines are matched by slicing their
// first 10 characters the same way the frontend's own eventDay() does (see
// canvas.js) — for an all-day event canvasEventDeadline_ already formats
// that in UTC specifically so it reproduces the calendar day Canvas meant,
// independent of script timezone, so this stays consistent with it.
function digestDateRange_() {
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  var tomorrow = Utilities.formatDate(tomorrowDate, tz, 'yyyy-MM-dd');
  return { today: today, tomorrow: tomorrow };
}

// A Canvas deadline (plain yyyy-mm-dd or ISO string) or a Notion date/
// deadline property ({start,end} or null) -> yyyy-mm-dd, or null. Matches
// the frontend's own deadline.slice(0,10)/eventDay() convention (see
// canvas.js/calendar.js) so this never disagrees with what the app shows.
function digestDay_(value) {
  var start = typeof value === 'string' ? value : (value && value.start);
  return start ? start.slice(0, 10) : null;
}

// Same input -> "h:mm a" if it carries a time, else '' (an all-day value
// has no time to show).
function digestTime_(value) {
  var start = typeof value === 'string' ? value : (value && value.start);
  if (!start || start.length <= 10) return '';
  return Utilities.formatDate(new Date(start), Session.getScriptTimeZone(), 'h:mm a');
}

// Same input -> a short date, plus the time if it has one. For urgent items,
// which aren't already grouped under a "today"/"tomorrow" heading.
function digestDateTime_(value) {
  var start = typeof value === 'string' ? value : (value && value.start);
  if (!start) return '';
  var tz = Session.getScriptTimeZone();
  if (start.length <= 10) return Utilities.formatDate(new Date(start + 'T00:00:00'), tz, 'EEE M/d');
  return Utilities.formatDate(new Date(start), tz, 'EEE M/d, h:mm a');
}

function digestBullet_(label, when) {
  return '- ' + label + (when ? ' — ' + when : '');
}

// Reads the CanvasFlags sheet (see TABLES above) into a lookup of Canvas
// event id -> true for events marked completed in the Canvas tab's UI
// without being linked to a Notion task, which syncs through the normal
// outbox like any other table (see js/canvas.js) so this backend can see
// it too — needed below so a completed-but-unlinked Canvas item doesn't
// show up in the digest or get a due-soon reminder.
function canvasDoneIds_() {
  var done = {};
  readTable_('CanvasFlags').forEach(function (f) { if (f.mark) done[f.id] = true; });
  return done;
}

// Merged, deduplicated, done-filtered items due on one given day (yyyy-MM-dd
// — see digestDateRange_). Each item is { id, label, due }, where `due` is
// the raw deadline/date value (string or {start,end}) — callers format it
// themselves (digestBullet_/digestTime_ for a display line, or raw
// date math for the due-soon reminder check). A Canvas item linked (by
// CanvasId) to a Notion task is represented once, as that task; an
// unlinked one is prefixed [C] since it exists only in Canvas, not yet
// tracked in Calendar. A done item — a Notion task with mark: true, or an
// unlinked Canvas event flagged completed in canvasDoneIds — is skipped
// entirely.
function digestDayItems_(day, events, tasks, canvasDoneIds) {
  var taskByCanvasId = {};
  tasks.forEach(function (t) { if (t.canvasId) taskByCanvasId[t.canvasId] = t; });

  var items = [];
  var seen = {};

  events.forEach(function (e) {
    if (digestDay_(e.deadline) !== day) return;
    var linked = taskByCanvasId[e.id];
    if (linked) {
      if (linked.mark || seen[linked.id]) return;
      seen[linked.id] = true;
      var label = linked.course ? linked.course + ': ' + linked.name : linked.name;
      items.push({ id: linked.id, label: label, due: linked.deadline || e.deadline });
    } else {
      if (canvasDoneIds[e.id] || seen[e.id]) return;
      seen[e.id] = true;
      var cLabel = '[C] ' + (e.course ? e.course + ': ' + e.name : e.name);
      items.push({ id: e.id, label: cLabel, due: e.deadline });
    }
  });

  // A task's own Date (when it's scheduled on the Calendar) is independent
  // of its Deadline (when it's due) — checked separately so a task
  // scheduled for today but due tomorrow counts on both days, not just one.
  tasks.forEach(function (t) {
    if (t.mark || seen[t.id]) return;
    if (digestDay_(t.date) !== day) return;
    seen[t.id] = true;
    var label = t.course ? t.course + ': ' + t.name : t.name;
    items.push({ id: t.id, label: label, due: t.date });
  });

  return items;
}

// Thin formatting wrapper over digestDayItems_ for the morning digest's
// two day-buckets (see sendMorningDigest below).
function digestDueLists_(events, tasks, range, canvasDoneIds) {
  function format(day) {
    return digestDayItems_(day, events, tasks, canvasDoneIds).map(function (item) {
      return digestBullet_(item.label, digestTime_(item.due));
    });
  }
  return { today: format(range.today), tomorrow: format(range.tomorrow) };
}

// Sends a Web Push notification via OneSignal's REST API instead of email —
// OneSignal does the VAPID signing + payload encryption raw Web Push
// requires, so this is just a plain HTTPS POST. ONESIGNAL_APP_ID/
// ONESIGNAL_REST_API_KEY are set in Script Properties (see SETUP.md §7);
// if either is missing this is a no-op so the digest/reminder functions
// below still run clean before OneSignal is set up. Targets the fixed
// external id "me" that the frontend assigns every subscribed device to in
// push.js (single-user app,
// so no per-device subscription storage is needed).
function oneSignalSend_(subject, body, url) {
  var props = PropertiesService.getScriptProperties();
  var appId = props.getProperty('ONESIGNAL_APP_ID');
  var apiKey = props.getProperty('ONESIGNAL_REST_API_KEY');
  if (!appId || !apiKey) return;

  UrlFetchApp.fetch('https://api.onesignal.com/notifications', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Key ' + apiKey },
    payload: JSON.stringify({
      app_id: appId,
      target_channel: 'push',
      include_aliases: { external_id: ['me'] },
      headings: { en: subject },
      contents: { en: body },
      url: url,
    }),
  });
}

// Opens straight to Calendar (not Canvas) since that's the merged
// Canvas+Notion view every notification below is built from.
var CALENDAR_URL_ = 'https://ardentagentandy.github.io/Dietz/#/calendar';

// 6am: the full picture — today, tomorrow, and urgent.
function sendMorningDigest() {
  var range = digestDateRange_();
  var events = canvasEvents_().events || [];
  var tasks = notionQueryTasks_().tasks || [];
  var canvasDoneIds = canvasDoneIds_();

  var due = digestDueLists_(events, tasks, range, canvasDoneIds);

  var urgent = tasks.filter(function (t) { return t.urgent && !t.mark; });
  var urgentLines = urgent.map(function (t) {
    var label = t.course ? t.course + ': ' + t.name : t.name;
    return digestBullet_(label, digestDateTime_(t.date) || digestDateTime_(t.deadline));
  });

  var sections = [];
  if (due.today.length) sections.push('DUE TODAY\n' + due.today.join('\n'));
  if (due.tomorrow.length) sections.push('DUE TOMORROW\n' + due.tomorrow.join('\n'));
  if (urgentLines.length) sections.push('URGENT\n' + urgentLines.join('\n'));

  var subject = 'Daily Digest';
  var counts = due.today.length + ' today, ' + due.tomorrow.length + ' tomorrow, ' + urgent.length + ' urgent';
  var body = counts + (sections.length ? '\n\n' + sections.join('\n\n') : '');

  oneSignalSend_(subject, body, CALENDAR_URL_);
}

// 10pm: whatever's due today and still not done — recomputed fresh at send
// time, so anything marked done since the morning digest naturally drops
// off. Always sends, even when nothing's left, so a quiet night still
// confirms the check actually ran.
function sendEveningDigest() {
  var range = digestDateRange_();
  var events = canvasEvents_().events || [];
  var tasks = notionQueryTasks_().tasks || [];
  var canvasDoneIds = canvasDoneIds_();

  var items = digestDayItems_(range.today, events, tasks, canvasDoneIds);
  var lines = items.map(function (item) { return digestBullet_(item.label, digestTime_(item.due)); });

  var subject = 'Remaining Today';
  var body = items.length + ' remaining' + (lines.length ? '\n\n' + lines.join('\n') : '');

  oneSignalSend_(subject, body, CALENDAR_URL_);
}

// Tracks which items already got a due-soon reminder today, in Script
// Properties (survives between the periodic trigger's stateless runs).
// Keyed by date so it resets itself the next day without any cleanup job.
function reminderState_() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var raw = PropertiesService.getScriptProperties().getProperty('DUE_SOON_REMINDED');
  var state = raw ? JSON.parse(raw) : null;
  if (!state || state.date !== today) state = { date: today, ids: [] };
  return state;
}

function saveReminderState_(state) {
  PropertiesService.getScriptProperties().setProperty('DUE_SOON_REMINDED', JSON.stringify(state));
}

// Runs every 15 minutes (see installNotificationTriggers): for anything due
// today with a specific time (an all-day item has no time to count down
// from, so it's skipped), not yet done, and due in the next 2 hours or
// less but not yet overdue, sends one reminder and remembers it so it never
// repeats that same day.
function sendDueSoonReminders() {
  var range = digestDateRange_();
  var events = canvasEvents_().events || [];
  var tasks = notionQueryTasks_().tasks || [];
  var canvasDoneIds = canvasDoneIds_();
  var state = reminderState_();
  var reminded = {};
  state.ids.forEach(function (id) { reminded[id] = true; });

  var items = digestDayItems_(range.today, events, tasks, canvasDoneIds);
  var now = new Date();
  var changed = false;

  items.forEach(function (item) {
    if (reminded[item.id]) return;
    var start = typeof item.due === 'string' ? item.due : (item.due && item.due.start);
    if (!start || start.length <= 10) return; // all-day — no specific time to be "2 hours before"

    var minutesUntil = (new Date(start) - now) / 60000;
    if (minutesUntil <= 0 || minutesUntil > 120) return;

    oneSignalSend_('Due Soon', item.label + ' is due at ' + digestTime_(start) + '.', CALENDAR_URL_);
    reminded[item.id] = true;
    state.ids.push(item.id);
    changed = true;
  });

  if (changed) saveReminderState_(state);
}

// One-time setup — select this function in the Apps Script editor's
// function dropdown and click Run once (see SETUP.md). Safe to re-run: it
// clears any existing triggers for these three handlers first, so changing
// the schedule below and re-running doesn't create duplicate triggers.
function installNotificationTriggers() {
  var handlers = { sendMorningDigest: true, sendEveningDigest: true, sendDueSoonReminders: true };
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return handlers[t.getHandlerFunction()]; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendMorningDigest').timeBased().atHour(6).everyDays(1).create();
  ScriptApp.newTrigger('sendEveningDigest').timeBased().atHour(22).everyDays(1).create();
  ScriptApp.newTrigger('sendDueSoonReminders').timeBased().everyMinutes(15).create();
}
