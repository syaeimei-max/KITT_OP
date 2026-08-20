// ==========================================
// KITT Web MVP - 雲端後端 API (Google Apps Script)
// 忠實移植自 engine_taifex_lite.py (542行 → JavaScript)
// ==========================================

// ===== 入口函數 =====

function doGet(e) {
  var type = (e && e.parameter && e.parameter.type) || "chakra";
  var props = PropertiesService.getScriptProperties();

  // 測試模式：確認 GAS 能否成功從期交所抓 CSV
  if (type === "test") {
    return testFetch();
  }

  // 手動觸發更新 (首次部署後請先呼叫此端點)
  if (type === "refresh") {
    try {
      scheduledFetch();
      return jr({ status: "success", message: "✅ 資料已從期交所即時更新完成！" });
    } catch (e) {
      return jr({ status: "error", message: "更新失敗: " + e.toString(), stack: e.stack });
    }
  }

  // 財經日曆轉發 (正確的來源：ForexFactory JSON，快取 3 小時避免 Rate Limit)
  if (type === "calendar") {
    try {
      var cache = CacheService.getScriptCache();
      var cached = cache.get("KITT_CALENDAR");
      
      if (cached) {
        return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
      }
      
      var calUrl = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
      var resp = UrlFetchApp.fetch(calUrl, { muteHttpExceptions: true });
      var text = resp.getContentText();
      
      // 檢查是否為有效 JSON 陣列（避免 Rate Limit 的 HTML 錯誤頁面）
      if (resp.getResponseCode() !== 200 || text.charAt(0) !== '[') {
        return jr({ status: "error", message: "ForexFactory 暫時無法存取，請稍後再試" });
      }
      
      // 快取 3 小時 (10800 秒)
      cache.put("KITT_CALENDAR", text, 10800);
      return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
    } catch (e) {
      return jr({ status: "error", message: e.toString() });
    }
  }

  // 正常模式：回傳已快取的計算結果
  if (type === "chakra") {
    var d = props.getProperty("KITT_CHAKRA");
    return d ? jr(JSON.parse(d)) : jr({ status: "error", message: "尚無資料，請先呼叫 ?type=refresh" });
  }
  if (type === "wave") {
    var d = props.getProperty("KITT_WAVE");
    return d ? jr(JSON.parse(d)) : jr({ status: "error", message: "尚無資料，請先呼叫 ?type=refresh" });
  }

  // 讀取十年歷史大數據 (請先將 1998_2026.json 貼在 KITT_Web_Database 的 A1 儲存格)
  if (type === "history") {
    var year = e.parameter.year;
    
    // 此為您上傳至 Google Drive 的 1998_2026.json 檔案 ID
    var fileId = "1ArlSEugGT4OjlVN6NWy1-fXrT6u5DsG0"; 
    
    try {
      // 用 UrlFetchApp 直接下載公開檔案（繞過 DriveApp 的 OAuth 權限限制）
      var downloadUrl = "https://drive.google.com/uc?export=download&id=" + fileId;
      var resp = UrlFetchApp.fetch(downloadUrl, { muteHttpExceptions: true });
      
      if (resp.getResponseCode() !== 200) {
         return jr({ status: "error", message: "Google Drive 下載失敗，HTTP " + resp.getResponseCode() + "。請確認檔案已設為「知道連結的人都能檢視」" });
      }
      
      var rawJsonStr = resp.getContentText("utf-8");
      
      var allData = JSON.parse(rawJsonStr);
      var yearStr = year ? year.toString() : "2025";
      
      // 將 Object 陣列轉換為前端預期的純陣列，並在後端過濾好年份，減少傳輸量
      var toArrAndFilter = function(arr) {
        var filtered = (arr || []).filter(function(obj){
          var y = obj["月份"] || "";
          return String(y).indexOf(yearStr) === 0; 
        });
        
        return filtered.map(function(obj) {
          return [
            obj["月份"], obj["日期"], obj["契約"],
            obj["三日"], obj["三夜"], obj["四日"], obj["四夜"], obj["五日"],
            obj["五夜"], obj["一日"], obj["一夜"], obj["二日"], obj["二夜"]
          ];
        });
      };
      
      var respData = {
        P2: toArrAndFilter(allData.P2),
        P3: toArrAndFilter(allData.P3),
        P4: toArrAndFilter(allData.P4)
      };
      var p5 = toArrAndFilter(allData.P5);
      var vixData = fetchVixFromSheet(yearStr, null, null);
      
      return jr({ status: "success", data: { chakra: respData, wave: p5, vix: vixData } });
      
    } catch(err) {
      return jr({ status: "error", message: "歷史資料庫讀取失敗: " + err.toString() });
    }
  }

  // 區間查詢 (雲端直連期交所，一次抓選擇權+期貨+VIX)
  if (type === "range") {
    var start_date = e.parameter.start_date; // YYYY-MM-DD
    var end_date = e.parameter.end_date;     // YYYY-MM-DD
    
    if (!start_date || !end_date) {
      return jr({ status: "error", message: "缺少 start_date 或 end_date 參數" });
    }
    
    try {
      var optCsv = fetchCSVByDates("TXO", "optDataDown", start_date, end_date);
      var optResult = processOptions(optCsv);
      var futCsv = fetchCSVByDates("TX", "futDataDown", start_date, end_date);
      var futResult = processFutures(futCsv);
      var vixResult = fetchVixFromSheet(null, start_date, end_date);
      return jr({ status: "success", data: { chakra: optResult.data, wave: futResult.data, vix: vixResult } });
    } catch(err) {
      return jr({ status: "error", message: "期交所雲端直連失敗: " + err.toString() });
    }
  }

  // 會員登入記錄 (Google Identity Services)
  if (type === "login") {
    var email = e.parameter.email;
    var name = e.parameter.name;
    var picture = e.parameter.picture;
    
    if (!email) return jr({ status: "error", message: "缺少 email 參數" });
    
    try {
      var sheetId = "1ZBfpxVKxgU5_StYL9ZMSr3tcZ2UtGm7u-cqsCMljPPg";
      var ss = SpreadsheetApp.openById(sheetId);
      var sheet = ss.getSheetByName("Member_DB");
      
      if (!sheet) {
        sheet = ss.insertSheet("Member_DB");
        sheet.appendRow(["姓名", "Email", "照片", "首次註冊時間", "最後登入時間"]);
      }
      
      var data = sheet.getDataRange().getValues();
      var foundRow = -1;
      
      for (var i = 0; i < data.length; i++) {
        if (data[i][1] === email) {
          foundRow = i + 1;
          break;
        }
      }
      
      var nowStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
      
      if (foundRow !== -1) {
        sheet.getRange(foundRow, 1).setValue(name);
        sheet.getRange(foundRow, 3).setValue(picture);
        sheet.getRange(foundRow, 5).setValue(nowStr);
        return jr({ status: "success", message: "登入成功" });
      } else {
        if (data.length === 1 && data[0][0] === "") {
          sheet.getRange(1, 1, 1, 5).setValues([["姓名", "Email", "照片", "首次註冊時間", "最後登入時間"]]);
        }
        sheet.appendRow([name, email, picture, nowStr, nowStr]);
        return jr({ status: "success", message: "註冊成功" });
      }
    } catch(err) {
      return jr({ status: "error", message: "會員資料庫連線失敗: " + err.toString() });
    }
  }

  return jr({ status: "error", message: "無效的 type 參數" });
}

function doPost(e) {
  return doGet(e);
}

function jr(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== 測試函數：只抓 5 天期貨 CSV 確認連線 =====

function testFetch() {
  try {
    var csv = fetchCSV("TX", "futDataDown", 5);
    var lines = csv.split('\n');
    var dataLines = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('TX') !== -1) dataLines++;
    }
    return jr({
      status: "success",
      message: "🎉 成功從期交所抓到 CSV！",
      total_lines: lines.length,
      data_lines: dataLines,
      first_200: csv.substring(0, 200)
    });
  } catch (e) {
    return jr({ status: "error", message: "抓取失敗: " + e.toString() });
  }
}

// ===== 定時觸發器 =====
// (在 GAS 左側「觸發條件」中設定每天 14:30 和 15:00 各執行一次)

function scheduledFetch() {
  var SLOTS = ['三日', '三夜', '四日', '四夜', '五日', '五夜', '一日', '一夜', '二日', '二夜'];

  // 1. 從期交所抓取原始 CSV 與 VIX
  var optCsv = fetchCSV("TXO", "optDataDown", 45);
  var futCsv = fetchCSV("TX", "futDataDown", 45);
  var vixResult = processVixWeb(45);

  // 2. 處理選擇權 (週三選 W + 週五選 F，一次完成)
  var optResult = processOptions(optCsv);

  // 3. 處理期貨振幅
  var futResult = processFutures(futCsv);

  // 4. 組合 chakra JSON
  var chakraResp = { status: "success", data: optResult.data, latest_info: optResult.li };
  
  // 5. 將 VIX 加入 waveResp
  var waveResp = { 
    status: "success", 
    data: futResult.data, 
    vix: vixResult,
    latest_info: futResult.li 
  };

  // 6. 存入 ScriptProperties (免費微型雲端資料庫)
  var props = PropertiesService.getScriptProperties();
  props.setProperty("KITT_CHAKRA", JSON.stringify(chakraResp));
  props.setProperty("KITT_WAVE", JSON.stringify(waveResp));
}

// ===== VIX 波動率指數爬蟲 =====
function processVixWeb(days) {
  var endDate = new Date();
  var startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  
  var requests = [];
  var current = new Date(endDate);
  
  while (current >= startDate) {
    var wd = current.getDay();
    if (wd > 0 && wd < 6) { // 只要週一到週五
      var yyyy = current.getFullYear();
      var mm = String(current.getMonth() + 1).padStart(2, '0');
      var dd = String(current.getDate()).padStart(2, '0');
      var dateStr = yyyy + mm + dd;
      var dateKey = yyyy + '/' + mm + '/' + dd;
      
      requests.push({
        url: "https://www.taifex.com.tw/cht/7/getVixData?filesname=" + dateStr,
        method: "get",
        muteHttpExceptions: true,
        dateKey: dateKey,
        dtReal: new Date(current)
      });
    }
    current.setDate(current.getDate() - 1);
  }
  
  // 平行非同步抓取 45 天資料，約 1~2 秒完成
  var responses = UrlFetchApp.fetchAll(requests);
  var rawVix = {};
  
  for (var i = 0; i < responses.length; i++) {
    var res = responses[i];
    if (res.getResponseCode() === 200) {
      var text = res.getContentText();
      if (text.indexOf('Last 1 min AVG') !== -1) {
        var lines = text.trim().split('\n');
        for (var j = lines.length - 1; j >= 0; j--) {
          if (lines[j].indexOf('Last 1 min AVG') !== -1) {
            var parts = lines[j].trim().split('\t');
            var val = parseFloat(parts[parts.length - 1]);
            if (!isNaN(val)) {
              rawVix[requests[i].dateKey] = { val: val, dt: requests[i].dtReal };
            }
            break;
          }
        }
      }
    }
  }
  
  var weeksData = {};
  var slotsOrder = ['三日', '四日', '五日', '一日', '二日'];
  
  for (var key in rawVix) {
    var dtReal = rawVix[key].dt;
    var dayMap = {1: 5, 2: 6, 3: 0, 4: 1, 5: 2}; 
    var daysToSubtract = dayMap[dtReal.getDay()];
    var weekStart = new Date(dtReal);
    weekStart.setDate(dtReal.getDate() - daysToSubtract);
    
    var yyyy = weekStart.getFullYear();
    var mm = String(weekStart.getMonth() + 1).padStart(2, '0');
    var dd = String(weekStart.getDate()).padStart(2, '0');
    var weekKey = yyyy + '/' + mm + '/' + dd;
    
    var slot = null;
    var wDay = dtReal.getDay();
    if (wDay === 3) slot = '三日';
    else if (wDay === 4) slot = '四日';
    else if (wDay === 5) slot = '五日';
    else if (wDay === 1) slot = '一日';
    else if (wDay === 2) slot = '二日';
    
    if (slot) {
      if (!weeksData[weekKey]) weeksData[weekKey] = {};
      weeksData[weekKey][slot] = rawVix[key].val;
    }
  }
  
  var sortedKeys = Object.keys(weeksData).sort().reverse().slice(0, 6);
  var finalVix = {};
  
  for (var i = 0; i < sortedKeys.length; i++) {
    var weekKey = sortedKeys[i];
    var slotData = weeksData[weekKey];
    var rel = weekKey.substring(2).replace(/\//g, '');
    var weekRes = { rel: rel };
    
    for (var s = 0; s < slotsOrder.length; s++) {
      var slotName = slotsOrder[s];
      if (slotData[slotName] !== undefined) {
        weekRes[slotName] = slotData[slotName];
      }
    }
    finalVix[weekKey] = weekRes;
  }
  
  return finalVix;
}

// 用於區間查詢 (指定特定日期) 的 VIX 爬蟲
function fetchVixByDates(startDateStr, endDateStr) {
  var startDate = new Date(startDateStr);
  var endDate = new Date(endDateStr);
  
  var requests = [];
  var current = new Date(endDate);
  
  while (current >= startDate) {
    var wd = current.getDay();
    if (wd > 0 && wd < 6) { 
      var yyyy = current.getFullYear();
      var mm = String(current.getMonth() + 1).padStart(2, '0');
      var dd = String(current.getDate()).padStart(2, '0');
      var dateStr = yyyy + mm + dd;
      var dateKey = yyyy + '/' + mm + '/' + dd;
      
      requests.push({
        url: "https://www.taifex.com.tw/cht/7/getVixData?filesname=" + dateStr,
        method: "get",
        muteHttpExceptions: true,
        dateKey: dateKey,
        dtReal: new Date(current)
      });
    }
    current.setDate(current.getDate() - 1);
  }
  
  var responses = UrlFetchApp.fetchAll(requests);
  var rawVix = {};
  
  for (var i = 0; i < responses.length; i++) {
    var res = responses[i];
    if (res.getResponseCode() === 200) {
      var text = res.getContentText();
      if (text.indexOf('Last 1 min AVG') !== -1) {
        var lines = text.trim().split('\n');
        for (var j = lines.length - 1; j >= 0; j--) {
          if (lines[j].indexOf('Last 1 min AVG') !== -1) {
            var parts = lines[j].trim().split('\t');
            var val = parseFloat(parts[parts.length - 1]);
            if (!isNaN(val)) {
              rawVix[requests[i].dateKey] = { val: val, dt: requests[i].dtReal };
            }
            break;
          }
        }
      }
    }
  }
  
  var weeksData = {};
  var slotsOrder = ['三日', '四日', '五日', '一日', '二日'];
  
  for (var key in rawVix) {
    var dtReal = rawVix[key].dt;
    var dayMap = {1: 5, 2: 6, 3: 0, 4: 1, 5: 2}; 
    var daysToSubtract = dayMap[dtReal.getDay()];
    var weekStart = new Date(dtReal);
    weekStart.setDate(dtReal.getDate() - daysToSubtract);
    
    var yyyy = weekStart.getFullYear();
    var mm = String(weekStart.getMonth() + 1).padStart(2, '0');
    var dd = String(weekStart.getDate()).padStart(2, '0');
    var weekKey = yyyy + '/' + mm + '/' + dd;
    
    var slot = null;
    var wDay = dtReal.getDay();
    if (wDay === 3) slot = '三日';
    else if (wDay === 4) slot = '四日';
    else if (wDay === 5) slot = '五日';
    else if (wDay === 1) slot = '一日';
    else if (wDay === 2) slot = '二日';
    
    if (slot) {
      if (!weeksData[weekKey]) weeksData[weekKey] = {};
      weeksData[weekKey][slot] = rawVix[key].val;
    }
  }
  
  var sortedKeys = Object.keys(weeksData).sort().reverse();
  var finalVix = {};
  
  for (var i = 0; i < sortedKeys.length; i++) {
    var weekKey = sortedKeys[i];
    var slotData = weeksData[weekKey];
    var rel = weekKey.substring(2).replace(/\//g, '');
    var weekRes = { rel: rel };
    
    for (var s = 0; s < slotsOrder.length; s++) {
      var slotName = slotsOrder[s];
      if (slotData[slotName] !== undefined) {
        weekRes[slotName] = slotData[slotName];
      }
    }
    finalVix[weekKey] = weekRes;
  }
  
  return finalVix;
}

// 新增從試算表讀取 VIX 歷史資料的函數
function fetchVixFromSheet(yearStr, startDateStr, endDateStr) {
  try {
    var ss = SpreadsheetApp.openById("1J9odh01mA8LFqtX8cGzWkkjEOafdjtIq18EypnPtRO0");
    var sheet = ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    
    var rawVix = {};
    
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      // 掃描每一列，尋找第一個8位數日期，與最後一個數字 (防呆邏輯)
      var dateStr = null;
      var vixVal = null;
      
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c]).trim();
        if (!dateStr && /^20\d{6}$/.test(cell)) {
          dateStr = cell;
        }
        var num = parseFloat(cell);
        if (!isNaN(num) && cell.length > 0 && cell !== dateStr) {
          vixVal = num;
        }
      }
      
      if (dateStr && vixVal !== null) {
        if (yearStr && dateStr.indexOf(yearStr) !== 0) continue;
        
        var y = parseInt(dateStr.substring(0, 4));
        var m = parseInt(dateStr.substring(4, 6)) - 1;
        var d = parseInt(dateStr.substring(6, 8));
        var dt = new Date(y, m, d);
        
        if (startDateStr) {
           var sDt = new Date(startDateStr);
           sDt.setHours(0,0,0,0);
           if (dt < sDt) continue;
        }
        if (endDateStr) {
           var eDt = new Date(endDateStr);
           eDt.setHours(23,59,59,999);
           if (dt > eDt) continue;
        }
        
        var dateKey = dateStr.substring(0, 4) + '/' + dateStr.substring(4, 6) + '/' + dateStr.substring(6, 8);
        rawVix[dateKey] = { val: vixVal, dt: dt };
      }
    }
    
    var weeksData = {};
    var slotsOrder = ['三日', '四日', '五日', '一日', '二日'];
    
    for (var key in rawVix) {
      var dtReal = rawVix[key].dt;
      var dayMap = {1: 5, 2: 6, 3: 0, 4: 1, 5: 2}; 
      var daysToSubtract = dayMap[dtReal.getDay()];
      if (daysToSubtract === undefined) continue;
      
      var weekStart = new Date(dtReal);
      weekStart.setDate(dtReal.getDate() - daysToSubtract);
      
      var yyyy = weekStart.getFullYear();
      var mm = String(weekStart.getMonth() + 1).padStart(2, '0');
      var dd = String(weekStart.getDate()).padStart(2, '0');
      var weekKey = yyyy + '/' + mm + '/' + dd;
      
      var slot = null;
      var wDay = dtReal.getDay();
      if (wDay === 3) slot = '三日';
      else if (wDay === 4) slot = '四日';
      else if (wDay === 5) slot = '五日';
      else if (wDay === 1) slot = '一日';
      else if (wDay === 2) slot = '二日';
      
      if (slot) {
        if (!weeksData[weekKey]) weeksData[weekKey] = {};
        weeksData[weekKey][slot] = rawVix[key].val;
      }
    }
    
    var sortedKeys = Object.keys(weeksData).sort().reverse();
    var finalVix = {};
    
    for (var j = 0; j < sortedKeys.length; j++) {
      var weekKey = sortedKeys[j];
      var slotData = weeksData[weekKey];
      var rel = weekKey.substring(2).replace(/\//g, '');
      var weekRes = { rel: rel };
      
      for (var s = 0; s < slotsOrder.length; s++) {
        var slotName = slotsOrder[s];
        if (slotData[slotName] !== undefined) {
          weekRes[slotName] = slotData[slotName];
        }
      }
      finalVix[weekKey] = weekRes;
    }
    
    return finalVix;
  } catch (e) {
    return {};
  }
}

// ===== 爬蟲模組 (忠實移植自 fetch_taifex_data_range) =====

// 用於年度區間查詢 (指定特定日期)
function fetchCSVByDates(commodity, endpoint, startDateStr, endDateStr) {
  var url = "https://www.taifex.com.tw/cht/3/" + endpoint;
  var startDate = new Date(startDateStr);
  var endDate = new Date(endDateStr);

  var csvParts = [];
  var currentEnd = new Date(endDate);

  while (currentEnd >= startDate) {
    var segStart = new Date(Math.max(startDate.getTime(), currentEnd.getTime() - 30 * 86400000));
    var options = {
      method: "post",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      payload: {
        down_type: "1",
        commodity_id: commodity,
        queryStartDate: fmtDate(segStart),
        queryEndDate: fmtDate(currentEnd)
      },
      muteHttpExceptions: true
    };
    var resp = UrlFetchApp.fetch(url, options);
    var text = resp.getContentText("big5");
    if (text.indexOf(commodity) !== -1) {
      if (csvParts.length > 0) {
        var lines = text.trim().split('\n');
        if (lines.length > 1) csvParts.push(lines.slice(1).join('\n'));
      } else {
        csvParts.push(text.trim());
      }
    }
    currentEnd = new Date(segStart.getTime() - 86400000);
  }
  return csvParts.join('\n');
}

function fetchCSV(commodity, endpoint, days) {
  var url = "https://www.taifex.com.tw/cht/3/" + endpoint;
  var endDate = new Date();
  var startDate = new Date(endDate.getTime() - days * 86400000);

  var csvParts = [];
  var currentEnd = new Date(endDate);

  // 分段查詢 (每段最多 30 天，忠實複製 engine_taifex_lite.py 的邏輯)
  while (currentEnd >= startDate) {
    var segStart = new Date(Math.max(startDate.getTime(), currentEnd.getTime() - 30 * 86400000));

    var options = {
      method: "post",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      payload: {
        down_type: "1",
        commodity_id: commodity,
        queryStartDate: fmtDate(segStart),
        queryEndDate: fmtDate(currentEnd)
      },
      muteHttpExceptions: true
    };

    var resp = UrlFetchApp.fetch(url, options);
    var text = resp.getContentText("big5");

    // 確認是 CSV 而非錯誤 HTML (忠實移植：if commodity in full_text)
    if (text.indexOf(commodity) !== -1) {
      if (csvParts.length > 0) {
        // 後續段跳過 header
        var lines = text.trim().split('\n');
        if (lines.length > 1) csvParts.push(lines.slice(1).join('\n'));
      } else {
        csvParts.push(text.trim());
      }
    }

    currentEnd = new Date(segStart.getTime() - 86400000);
  }

  return csvParts.join('\n');
}

function fmtDate(d) {
  return Utilities.formatDate(d, "Asia/Taipei", "yyyy/MM/dd");
}

// ===== 合約分類 (忠實移植自 classify_rel) =====

function classifyRel(name) {
  name = name.trim();
  if (name.indexOf('W1') !== -1) return 'W1';
  if (name.indexOf('W2') !== -1) return 'W2';
  if (name.indexOf('W4') !== -1) return 'W4';
  if (name.indexOf('W5') !== -1) return 'W5';
  if (name.indexOf('F1') !== -1) return 'F1';
  if (name.indexOf('F2') !== -1) return 'F2';
  if (name.indexOf('F3') !== -1) return 'F3';
  if (name.indexOf('F4') !== -1) return 'F4';
  if (name.indexOf('F5') !== -1) return 'F5';
  return 'W0';
}

// ===== Slot 分配 (忠實移植自 process_options 中的 weekday→slot 對照) =====

function getSlot(pyWd, isNight) {
  // pyWd: Python weekday (0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri)
  // 忠實移植 web_engine_taifex.py 第 208-213 行：W 和 F 使用相同映射
  // F 系列的「視覺平移」由前端換表頭實現，後端不做任何平移
  var slotStr = null;
  if (pyWd === 2) slotStr = isNight ? '三夜' : '三日';
  if (pyWd === 3) slotStr = isNight ? '四夜' : '四日';
  if (pyWd === 4) slotStr = isNight ? '五夜' : '五日';
  if (pyWd === 0) slotStr = isNight ? '一夜' : '一日';
  if (pyWd === 1) slotStr = isNight ? '二夜' : '二日';
  return slotStr;
}

// JS getDay() → Python weekday() 轉換
function pyWeekday(jsDate) {
  return (jsDate.getDay() + 6) % 7;
  // Sun(0)→6, Mon(1)→0, Tue(2)→1, Wed(3)→2, Thu(4)→3, Fri(5)→4, Sat(6)→5
}

// ===== 選擇權處理 (忠實移植自 process_options) =====

function processOptions(csvText) {
  var SLOTS = ['三日', '三夜', '四日', '四夜', '五日', '五夜', '一日', '一夜', '二日', '二夜'];
  var F_SLOTS = ['五日', '五夜', '一日', '一夜', '二日', '二夜', '三日', '三夜', '四日', '四夜'];
  var TARGET = ['W1', 'W2', 'W0', 'W4', 'W5', 'F1', 'F2', 'F3', 'F4', 'F5'];

  if (!csvText) return { data: {}, li: {} };
  var lines = csvText.split('\n');
  if (lines.length < 2) return { data: {}, li: {} };

  // === Step 1: 收集交易日 & 原始記錄 ===
  var tradingDays = {};
  var recs = [];

  for (var i = 1; i < lines.length; i++) {
    var cols = lines[i].split(',');
    if (cols.length <= 17) continue;
    if (cols[1].trim() !== 'TXO') continue;

    var cStr = cols[8].trim();
    if (!cStr || cStr === '-') continue;
    var cv = parseFloat(cStr);
    if (isNaN(cv)) continue;

    var dt = cols[0].trim();
    var ses = cols[17].trim();

    if (ses.indexOf('一般') !== -1) tradingDays[dt] = true;

    recs.push({
      dt: dt, ses: ses,
      con: cols[2].trim(),
      str: parseFloat(cols[3]),
      cp: cols[4].trim(),
      cl: cv,
      exp: cols.length > 20 ? cols[20].trim() : ''
    });
  }

  var stds = Object.keys(tradingDays).sort();
  if (!stds.length) return { data: {}, li: {} };

  var lastTd = stds[stds.length - 1];
  var lastTdDate = pDate(lastTd);

  // 建立 dayMapPrev (忠實移植：夜盤日期校正用)
  var dmp = {};
  for (var i = 1; i < stds.length; i++) dmp[stds[i]] = stds[i - 1];

  // === Step 2: 夜盤日期校正 + 五層嵌套分組 ===
  var gd = {};
  var mdr = null; // max dt_real
  var mdrIsN = false; // max is night

  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var rel = classifyRel(r.con);
    if (TARGET.indexOf(rel) === -1) continue;

    var dtrs = r.dt;
    var isN = r.ses.indexOf('盤後') !== -1;

    // 夜盤：日期校正到前一個交易日 (忠實移植核心邏輯 A)
    if (isN) {
      if (dmp[dtrs]) {
        dtrs = dmp[dtrs];
      } else {
        var dto = pDate(dtrs);
        if (dto) {
          for (var j = 1; j <= 7; j++) {
            var pv = fmtDate(new Date(dto.getTime() - j * 86400000));
            if (tradingDays[pv]) { dtrs = pv; break; }
          }
        }
      }
    }

    // 追蹤最新日期 (用於高亮)
    var dtr = pDate(dtrs);
    if (dtr) {
      if (mdr === null || dtr > mdr) { mdr = dtr; mdrIsN = isN; }
      else if (dtr.getTime() === mdr.getTime() && isN) mdrIsN = true;
    }

    // 五層嵌套分組: gd[日期][時段][合約][履約價][買賣權]
    if (!gd[dtrs]) gd[dtrs] = {};
    if (!gd[dtrs][r.ses]) gd[dtrs][r.ses] = {};
    if (!gd[dtrs][r.ses][r.con]) gd[dtrs][r.ses][r.con] = {};
    if (!gd[dtrs][r.ses][r.con][r.str]) gd[dtrs][r.ses][r.con][r.str] = {};
    gd[dtrs][r.ses][r.con][r.str][r.cp] = r.cl;
    gd[dtrs][r.ses][r.con][r.str]['_exp'] = r.exp;
  }

  // === Step 3: 找 ATM (C-P差最小) → 填入 slot ===
  // 建立獨立收集機制：以合約名稱 (con) 為鍵，避免不同月合約互相粗暴污染
  var contractData = {};
  var cinfo = {};

  var sdks = Object.keys(gd).sort();

  for (var di = 0; di < sdks.length; di++) {
    var dtrs = sdks[di];
    var dtr = pDate(dtrs);
    if (!dtr) continue;
    var wd = pyWeekday(dtr);

    for (var ses in gd[dtrs]) {
      var isN = ses.indexOf('盤後') !== -1;

      for (var con in gd[dtrs][ses]) {
        var rel = classifyRel(con);
        if (TARGET.indexOf(rel) === -1) continue;
        var stks = gd[dtrs][ses][con];

        // 找價平 (ATM)：C-P 差值最小的履約價
        var minDiff = Infinity, bestSum = null, bestExp = null;
        for (var sk in stks) {
          var cpd = stks[sk];
          var ck = null, pk = null;
          for (var k in cpd) {
            if (k === '_exp') continue;
            if (k.indexOf('買') !== -1) ck = k;
            if (k.indexOf('賣') !== -1) pk = k;
          }
          if (ck && pk) {
            var df = Math.abs(cpd[ck] - cpd[pk]);
            if (df < minDiff) {
              minDiff = df;
              bestSum = cpd[ck] + cpd[pk];
              bestExp = cpd['_exp'];
            }
          }
        }

        // 用結算日過濾：只保留結算前 7 天內的資料 (忠實移植)
        if (bestSum !== null && bestExp) {
          var ed = pDateCompact(bestExp);
          if (!ed) continue;
          var dd = Math.floor((ed - dtr) / 86400000);

          if (dd > 0 && dd <= 7) {
            var slot = getSlot(wd, isN);
            if (slot) {
              if (!contractData[con]) contractData[con] = {};
              contractData[con][slot] = bestSum;
              cinfo[con] = { rel: rel, expire: ed };
            }
          }
        }
      }
    }
  }

  // === Step 4: 每個 rel 只保留最近到期的合約 (忠實移植) ===
  var rgs = {};
  for (var con in cinfo) {
    var rl = cinfo[con].rel;
    if (!rgs[rl]) rgs[rl] = [];
    rgs[rl].push({ con: con, exp: cinfo[con].expire });
  }

  // 十字交叉高亮邏輯 (忠實移植 K2 電腦版)：
  var nearest_W = null, nearest_F = null;
  var min_expire_W = null, min_expire_F = null;

  if (mdr) {
    var mdrDate = mdr;
    for (var con in cinfo) {
      var exp = cinfo[con].expire;
      var rel = cinfo[con].rel;
      var isF = rel.indexOf('F') !== -1;

      // 若最新資料是夜盤，且該合約剛好在今天結算，則合約已死亡，排除之
      if (mdrIsN && exp.getTime() === mdrDate.getTime()) continue;

      if (exp.getTime() >= mdrDate.getTime()) {
        if (isF) {
          if (min_expire_F === null || exp.getTime() < min_expire_F.getTime()) {
            min_expire_F = exp;
            nearest_F = con;
          }
        } else {
          if (min_expire_W === null || exp.getTime() < min_expire_W.getTime()) {
            min_expire_W = exp;
            nearest_W = con;
          }
        }
      }
    }
  }

  // 防呆機制：如果全數過期，至少抓最後到期的
  if (nearest_W === null) {
    for (var con in cinfo) {
      if (cinfo[con].rel.indexOf('F') === -1) {
        var exp = cinfo[con].expire;
        if (min_expire_W === null || exp.getTime() > min_expire_W.getTime()) {
          min_expire_W = exp;
          nearest_W = con;
        }
      }
    }
  }
  if (nearest_F === null) {
    for (var con in cinfo) {
      if (cinfo[con].rel.indexOf('F') !== -1) {
        var exp = cinfo[con].expire;
        if (min_expire_F === null || exp.getTime() > min_expire_F.getTime()) {
          min_expire_F = exp;
          nearest_F = con;
        }
      }
    }
  }

  // === Step 5: SMART MERGE 跨代縫合與轉換為陣列格式 ===
  // 1. 將合約依照 rel (如 W4, F3) 分組
  var relGroups = {};
  for (var con in cinfo) {
    var rl = cinfo[con].rel;
    if (!relGroups[rl]) relGroups[rl] = [];
    relGroups[rl].push(con);
  }

  var finalAtm = {};
  for (var k = 0; k < TARGET.length; k++) {
    var rl = TARGET[k];
    if (!relGroups[rl]) continue;
    var cons = relGroups[rl];

    // 2. 依結算日由新到舊排序
    cons.sort(function (a, b) {
      return cinfo[b].expire.getTime() - cinfo[a].expire.getTime();
    });

    // 3. 確立高亮基底：最新合約 (第1近)
    var newestCon = cons[0];
    // 使用淺拷貝以避免修改原始物件，確保縫合安全
    var newestData = Object.assign({}, contractData[newestCon]);

    // 4. 跨代繼承填補：尋找結算日次新的合約 (第2近，通常是上一週期的舊合約)
    if (cons.length > 1) {
      var oldData = contractData[cons[1]] || {};
      // 5. 無損縫合：將舊合約滿版的數據，填補進新合約空白格子
      for (var s = 0; s < SLOTS.length; s++) {
        var slotName = SLOTS[s];
        if (newestData[slotName] === undefined && oldData[slotName] !== undefined) {
          newestData[slotName] = oldData[slotName];
        }
      }
    }
    finalAtm[rl] = newestData;
  }

  // 轉換為陣列格式 (F 系列用 F_SLOTS 順序，配合前端 F 表頭 [五日,五夜,一日,...])
  var data = {};
  for (var k = 0; k < TARGET.length; k++) {
    var rl = TARGET[k];
    if (finalAtm[rl]) {
      var sd = finalAtm[rl];
      var isF = rl.indexOf('F') !== -1;
      var slotOrder = isF ? F_SLOTS : SLOTS;
      var arr = [];
      for (var s = 0; s < slotOrder.length; s++) {
        var v = sd[slotOrder[s]];
        arr.push(v !== undefined ? String(Math.round(v)) : "");
      }
      if (arr.some(function (x) { return x !== ""; })) data[rl] = arr;
    }
  }

  // === Step 6: 計算高亮資訊 ===
  var li = {};
  if (mdr) {
    var wd = pyWeekday(mdr);
    if (nearest_W && cinfo[nearest_W]) {
      var sn_W = getSlot(wd, mdrIsN);
      li.latest_W = cinfo[nearest_W].rel;
      li.latest_slot_idx_W = SLOTS.indexOf(sn_W);
    }
    if (nearest_F && cinfo[nearest_F]) {
      var sn_F = getSlot(wd, mdrIsN);
      li.latest_F = cinfo[nearest_F].rel;
      li.latest_slot_idx_F = F_SLOTS.indexOf(sn_F);
    }
  }

  return { data: data, li: li };
}

// ===== 期貨處理 (忠實移植自 process_futures) =====

function processFutures(csvText) {
  var SLOTS = ['三日', '三夜', '四日', '四夜', '五日', '五夜', '一日', '一夜', '二日', '二夜'];

  if (!csvText) return { data: {}, li: {} };
  var lines = csvText.split('\n');
  if (lines.length < 2) return { data: {}, li: {} };

  // Step 1: 收集交易日 & 原始記錄
  var tradingDays = {};
  var recs = [];

  for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(',');
      if (cols.length <= 17) continue;
      var prod = cols[1].trim();
    // 忠實移植：只取 TX，排除 MTX
    if (!/TX$/.test(prod) || /MTX$/.test(prod)) continue;

    var hs = cols[4].trim(), ls = cols[5].trim();
    if (!hs || hs === '-' || !ls || ls === '-') continue;
    var hv = parseFloat(hs), lv = parseFloat(ls);
    if (isNaN(hv) || isNaN(lv)) continue;

    var dt = cols[0].trim();
    var ses = cols[17].trim();
    if (ses.indexOf('一般') !== -1) tradingDays[dt] = true;

    recs.push({ dt: dt, ses: ses, amp: hv - lv });
  }

  var stds = Object.keys(tradingDays).sort();
  if (!stds.length) return { data: {}, li: {} };

  var dmp = {};
  for (var i = 1; i < stds.length; i++) dmp[stds[i]] = stds[i - 1];

  // Step 2: 夜盤校正 + 追蹤最新日期
  var maxDt = null, maxIsN = false;
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var dtrs = r.dt;
    var isN = r.ses.indexOf('盤後') !== -1;

    if (isN) {
      if (dmp[dtrs]) {
        dtrs = dmp[dtrs];
      } else {
        var dto = pDate(dtrs);
        if (dto) {
          for (var j = 1; j <= 7; j++) {
            var pv = fmtDate(new Date(dto.getTime() - j * 86400000));
            if (tradingDays[pv]) { dtrs = pv; break; }
          }
        }
      }
    }
    r.dtReal = dtrs;

    var dtr = pDate(dtrs);
    if (dtr) {
      if (maxDt === null || dtr > maxDt) { maxDt = dtr; maxIsN = isN; }
      else if (dtr.getTime() === maxDt.getTime() && isN) maxIsN = true;
    }
  }

  // Step 3: 按週分組 (週三起始)
  var wd = {};
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var dtr = pDate(r.dtReal);
    if (!dtr) continue;
    var pw = pyWeekday(dtr);
    // 週起始日 = dt_real - ((weekday - 2) % 7) (忠實移植)
    var wStart = new Date(dtr.getTime() - ((pw - 2 + 7) % 7) * 86400000);
    var wKey = fmtDate(wStart);
    var isN = r.ses.indexOf('盤後') !== -1;
    var slot = getSlot(pw, isN);

    if (slot) {
      if (!wd[wKey]) wd[wKey] = {};
      if (!wd[wKey][slot]) wd[wKey][slot] = [];
      wd[wKey][slot].push(r.amp);
    }
  }

  // Step 4: 取最近 6 週 + 轉為陣列
  var wks = Object.keys(wd).sort().reverse().slice(0, 6);
  var data = {};
  for (var wi = 0; wi < wks.length; wi++) {
    var wKey = wks[wi];
    var sd = wd[wKey];
    var dateKey = wKey.replace(/\//g, '').substring(2); // "2026/08/12" → "260812"

    var arr = [];
    for (var s = 0; s < SLOTS.length; s++) {
      var vals = sd[SLOTS[s]];
      if (vals && vals.length > 0) {
        // 忠實移植：取最大值
        arr.push(String(Math.round(Math.max.apply(null, vals))));
      } else {
        arr.push("");
      }
    }
    data[dateKey] = arr;
  }

  // Step 5: (期貨不需要跨代縫合，保留空白即可)
  

  // Step 6: 高亮
  var li = {};
  if (maxDt) {
    var pw = pyWeekday(maxDt);
    var sn = getSlot(pw, maxIsN);
    li.wave_high_col = SLOTS.indexOf(sn);
  }

  return { data: data, li: li };
}

// ===== 日期工具 =====

function pDate(s) {
  // 解析 "2026/08/12" 格式
  if (!s) return null;
  var p = s.split('/');
  if (p.length !== 3) return null;
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
}

function pDateCompact(s) {
  // 解析 "20260812" 或 "2026/08/12" 格式
  if (!s) return null;
  s = s.trim();
  if (s.indexOf('/') !== -1) return pDate(s);
  if (s.length >= 8) {
    return new Date(parseInt(s.substring(0, 4)), parseInt(s.substring(4, 6)) - 1, parseInt(s.substring(6, 8)));
  }
  return null;
}
