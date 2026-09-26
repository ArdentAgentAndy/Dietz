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

// Sheets auto-parses strings that look like dates unless the column is
// forced to plain text first — that would silently mangle date/dueDate/
// start/end values on write, so lock those columns down when the tab is created.
function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  var columns = TABLES[name].columns;
  sheet.appendRow(columns);
  columns.forEach(function (col, i) {
    if (/date|start|end/i.test(col)) {
      sheet.getRange(1, i + 1, 1000, 1).setNumberFormat('@');
    }
  });
  return sheet;
}

function readTable_(name) {
  var sheet = getSheet_(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];

  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return v !== ''; }); })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
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
  var rowArray = headers.map(function (h) { return row[h] !== undefined ? row[h] : ''; });

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

  return jsonOut_({ error: 'unknown action' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ error: 'invalid body' });
  }

  if (!checkToken_(body.token)) return jsonOut_({ error: 'unauthorized' });

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
