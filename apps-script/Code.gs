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

  return jsonOut_({ error: 'unknown action' });
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
