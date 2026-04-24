/**
 * DealLens - Google Apps Script Web App
 *
 * === セットアップ ===
 * 1. 対象スプレッドシートを開く
 * 2. 拡張機能 → Apps Script で新規プロジェクト作成
 * 3. このコード全体を Code.gs に貼り付け
 * 4. プロジェクトの設定 → スクリプトプロパティ で以下を追加:
 *    - SPREADSHEET_ID: 対象シートのID
 *    - SHARED_SECRET:  ランダムな文字列(32文字以上推奨)
 * 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 * 6. 発行されたウェブアプリ URL を .env.local の GAS_WEB_APP_URL にセット
 * 7. SHARED_SECRET を .env.local の GAS_SHARED_SECRET にセット
 */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('SHARED_SECRET');
    const spreadsheetId = props.getProperty('SPREADSHEET_ID');

    if (!secret || !spreadsheetId) {
      return json({ ok: false, error: 'server not configured' });
    }
    if (body.secret !== secret) {
      return json({ ok: false, error: 'unauthorized' });
    }

    switch (body.action) {
      case 'upsert':
        upsertRow(spreadsheetId, body.payload);
        return json({ ok: true });
      case 'ping':
        return json({ ok: true, pong: true });
      default:
        return json({ ok: false, error: 'unknown action: ' + body.action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 業界別シートに 1行 upsert (job_id 一致があれば update、無ければ append)
 * payload: { sheetTitle, headerRow, jobId, row }
 */
function upsertRow(spreadsheetId, payload) {
  const sheetTitle = payload.sheetTitle || '未分類';
  const headerRow = payload.headerRow;
  const jobId = payload.jobId;
  const row = payload.row;

  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetTitle);
  if (!sheet) {
    sheet = ss.insertSheet(sheetTitle);
    sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  } else {
    const lastCol = Math.max(1, sheet.getLastColumn());
    const first = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const isEmpty = first.every(function (v) { return v === '' || v == null; });
    if (isEmpty) {
      sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    }
  }

  const lastRow = sheet.getLastRow();
  let foundRow = -1;
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === jobId) {
        foundRow = i + 2;
        break;
      }
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
  }
}
