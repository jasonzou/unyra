/**
 * 生成提供给移动端浏览器访问的单页 H5。
 * 无需外网连接，全部样式与脚本内联，支持离线局域网快速加载。
 */
export function getMobileHtml(serverName = '归一 Unyra'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${serverName} · 局域网互联传输</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.7);
      --card-border: rgba(255, 255, 255, 0.1);
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --primary-glow: rgba(56, 189, 248, 0.25);
      --success: #34d399;
      --danger: #f87171;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --radius: 16px;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    body {
      background: var(--bg);
      background-image: radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.12) 0px, transparent 50%),
                        radial-gradient(at 100% 100%, rgba(99, 102, 241, 0.12) 0px, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      color: #0f172a;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--card-border);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #94a3b8;
    }
    .status-dot.online {
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
    }
    .status-dot.offline {
      background: var(--danger);
    }

    .main-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(16px);
      border-radius: var(--radius);
      padding: 24px 20px;
      margin-bottom: 20px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    }

    .upload-zone {
      border: 2px dashed rgba(56, 189, 248, 0.35);
      border-radius: 12px;
      padding: 32px 16px;
      background: rgba(56, 189, 248, 0.04);
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .upload-zone:active {
      background: rgba(56, 189, 248, 0.1);
      border-color: var(--primary);
      transform: scale(0.99);
    }
    .upload-icon {
      width: 48px;
      height: 48px;
      color: var(--primary);
    }
    .upload-zone h3 {
      font-size: 16px;
      font-weight: 600;
    }
    .upload-zone p {
      font-size: 12px;
      color: var(--text-muted);
    }

    .action-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 16px;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 16px;
      border-radius: 10px;
      border: 1px solid var(--card-border);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:active {
      background: rgba(255, 255, 255, 0.12);
      transform: scale(0.98);
    }
    .btn-primary {
      background: var(--primary);
      color: #0f172a;
      font-weight: 600;
      border: none;
      box-shadow: 0 4px 14px var(--primary-glow);
    }
    .btn-primary:active {
      background: var(--primary-hover);
    }
    .btn-danger {
      background: rgba(248, 113, 113, 0.15);
      color: var(--danger);
      border-color: rgba(248, 113, 113, 0.3);
    }

    /* 上传进度 */
    .progress-box {
      margin-top: 16px;
      padding: 12px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.25);
      display: none;
      text-align: left;
    }
    .progress-box.show {
      display: block;
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 6px;
      color: var(--text-muted);
    }
    .progress-bar-bg {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      width: 0%;
      transition: width 0.15s ease;
    }

    /* 历史列表 */
    .history-card {
      flex: 1;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(16px);
      border-radius: var(--radius);
      padding: 18px 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .history-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .history-list {
      list-style: none;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .history-item {
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
    }
    .history-item-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 65%;
      font-weight: 500;
    }
    .history-item-meta {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* 意图请求弹窗 (Intent Modal) */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 1000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }
    .modal-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }
    .modal-card {
      background: #1e293b;
      border: 1px solid rgba(56, 189, 248, 0.4);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 24px var(--primary-glow);
      border-radius: 20px;
      padding: 24px;
      width: 100%;
      max-width: 360px;
      text-align: center;
      transform: translateY(20px) scale(0.95);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .modal-overlay.active .modal-card {
      transform: translateY(0) scale(1);
    }
    .modal-header-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.3);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
      margin-bottom: 12px;
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
      70% { box-shadow: 0 0 0 14px rgba(56, 189, 248, 0); }
      100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
    }
    .modal-title {
      font-size: 17px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .modal-prompt {
      font-size: 14px;
      color: #e2e8f0;
      background: rgba(0, 0, 0, 0.25);
      border-radius: 10px;
      padding: 12px;
      margin: 14px 0 20px;
      line-height: 1.5;
      text-align: left;
    }
    .modal-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    input[type="file"] {
      display: none;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo-icon">U</div>
      <div class="brand-title">${serverName} 传输</div>
    </div>
    <div class="status-badge">
      <div id="statusDot" class="status-dot"></div>
      <span id="statusText">连接中...</span>
    </div>
  </header>

  <div class="main-card">
    <div class="upload-zone" id="uploadZone">
      <svg class="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <h3>点击选择或拖入文件</h3>
      <p>支持照片、视频、音频、PDF 与文档</p>
    </div>

    <div class="action-grid">
      <button class="btn" id="btnCamera">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        拍照/相册
      </button>
      <button class="btn" id="btnBrowse">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        浏览文件
      </button>
    </div>

    <div class="progress-box" id="progressBox">
      <div class="progress-info">
        <span id="progressName">准备上传...</span>
        <span id="progressPercent">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="progressBar"></div>
      </div>
    </div>
  </div>

  <div class="history-card">
    <div class="history-title">
      <span>传输记录</span>
      <span id="historyCount">0 项</span>
    </div>
    <ul class="history-list" id="historyList">
      <li style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px 0;">暂无上传记录</li>
    </ul>
  </div>

  <!-- 电脑端意图请求弹窗 -->
  <div class="modal-overlay" id="intentModal">
    <div class="modal-card">
      <div class="modal-header-icon">
        <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
        </svg>
      </div>
      <div class="modal-title">电脑端请求上传文件</div>
      <div class="modal-prompt" id="intentPrompt">电脑端正在等待您上传一份文件</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="btnIntentCamera">📷 拍照 / 相册</button>
        <button class="btn" id="btnIntentFile">📁 选择文档文件</button>
        <button class="btn btn-danger" id="btnIntentReject">暂不上传</button>
      </div>
    </div>
  </div>

  <!-- 隐藏的文件选择器 -->
  <input type="file" id="generalFileInput" multiple>
  <input type="file" id="cameraFileInput" accept="image/*" capture="environment">
  <input type="file" id="intentFileInput">

  <script>
    (function() {
      // 生成或恢复本地设备标识
      let deviceId = localStorage.getItem('unyra_device_id');
      if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).slice(2, 9);
        localStorage.setItem('unyra_device_id', deviceId);
      }

      function getDeviceName() {
        const ua = navigator.userAgent;
        if (/iPhone/i.test(ua)) return 'iPhone 手机';
        if (/iPad/i.test(ua)) return 'iPad 平板';
        if (/Android/i.test(ua)) return 'Android 移动设备';
        if (/Mac/i.test(ua)) return 'Mac 电脑';
        if (/Windows/i.test(ua)) return 'Windows 电脑';
        return '移动设备';
      }

      const statusDot = document.getElementById('statusDot');
      const statusText = document.getElementById('statusText');
      const uploadZone = document.getElementById('uploadZone');
      const btnCamera = document.getElementById('btnCamera');
      const btnBrowse = document.getElementById('btnBrowse');
      const generalFileInput = document.getElementById('generalFileInput');
      const cameraFileInput = document.getElementById('cameraFileInput');
      const intentFileInput = document.getElementById('intentFileInput');
      const progressBox = document.getElementById('progressBox');
      const progressName = document.getElementById('progressName');
      const progressPercent = document.getElementById('progressPercent');
      const progressBar = document.getElementById('progressBar');
      const historyList = document.getElementById('historyList');
      const historyCount = document.getElementById('historyCount');

      const intentModal = document.getElementById('intentModal');
      const intentPrompt = document.getElementById('intentPrompt');
      const btnIntentCamera = document.getElementById('btnIntentCamera');
      const btnIntentFile = document.getElementById('btnIntentFile');
      const btnIntentReject = document.getElementById('btnIntentReject');

      let currentIntent = null;
      let historyItems = [];
      let ws = null;
      let reconnectTimer = null;

      function updateStatus(online) {
        if (online) {
          statusDot.className = 'status-dot online';
          statusText.textContent = '已连接电脑';
        } else {
          statusDot.className = 'status-dot offline';
          statusText.textContent = '连接中断，重连中...';
        }
      }

      function connectWs() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = proto + '//' + location.host + '/ws';
        try {
          ws = new WebSocket(wsUrl);
          ws.onopen = function() {
            updateStatus(true);
            ws.send(JSON.stringify({
              type: 'device_join',
              deviceId: deviceId,
              deviceName: getDeviceName(),
              userAgent: navigator.userAgent
            }));
          };
          ws.onmessage = function(e) {
            try {
              const msg = JSON.parse(e.data);
              if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
              } else if (msg.type === 'request_file') {
                handleIntentRequest(msg);
              } else if (msg.type === 'file_ack') {
                // 文件已被服务端确认
              }
            } catch (err) {
              console.error('WS parse error', err);
            }
          };
          ws.onclose = function() {
            updateStatus(false);
            scheduleReconnect();
          };
          ws.onerror = function() {
            updateStatus(false);
            ws.close();
          };
        } catch (e) {
          updateStatus(false);
          scheduleReconnect();
        }
      }

      function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(function() {
          reconnectTimer = null;
          connectWs();
        }, 2000);
      }

      // 响应电脑端的意图请求
      function handleIntentRequest(req) {
        currentIntent = req;
        intentPrompt.textContent = req.prompt || '电脑端请求您上传一份文件';
        if (req.accept) {
          intentFileInput.accept = req.accept;
          cameraFileInput.accept = req.accept;
        } else {
          intentFileInput.removeAttribute('accept');
          cameraFileInput.accept = 'image/*';
        }

        // 震动提醒
        if (navigator.vibrate) {
          try { navigator.vibrate([100, 60, 100]); } catch (e) {}
        }

        intentModal.classList.add('active');
      }

      btnIntentReject.addEventListener('click', function() {
        if (currentIntent && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'intent_rejected',
            requestId: currentIntent.requestId,
            reason: '用户在移动端取消了上传'
          }));
        }
        currentIntent = null;
        intentModal.classList.remove('active');
      });

      btnIntentCamera.addEventListener('click', function() {
        cameraFileInput.click();
      });

      btnIntentFile.addEventListener('click', function() {
        intentFileInput.click();
      });

      // 绑定上传事件
      uploadZone.addEventListener('click', () => generalFileInput.click());
      btnCamera.addEventListener('click', () => cameraFileInput.click());
      btnBrowse.addEventListener('click', () => generalFileInput.click());

      generalFileInput.addEventListener('change', function() {
        if (this.files && this.files.length) {
          uploadFiles(Array.from(this.files));
          this.value = '';
        }
      });

      cameraFileInput.addEventListener('change', function() {
        if (this.files && this.files.length) {
          const reqId = currentIntent ? currentIntent.requestId : undefined;
          uploadFiles(Array.from(this.files), reqId);
          if (currentIntent) {
            currentIntent = null;
            intentModal.classList.remove('active');
          }
          this.value = '';
        }
      });

      intentFileInput.addEventListener('change', function() {
        if (this.files && this.files.length) {
          const reqId = currentIntent ? currentIntent.requestId : undefined;
          uploadFiles(Array.from(this.files), reqId);
          if (currentIntent) {
            currentIntent = null;
            intentModal.classList.remove('active');
          }
          this.value = '';
        }
      });

      // 拖拽支持
      uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); });
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files) {
          uploadFiles(Array.from(e.dataTransfer.files));
        }
      });

      function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      }

      function addHistory(file) {
        historyItems.unshift(file);
        renderHistory();
      }

      function renderHistory() {
        historyCount.textContent = historyItems.length + ' 项';
        if (historyItems.length === 0) {
          historyList.innerHTML = '<li style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px 0;">暂无上传记录</li>';
          return;
        }
        historyList.innerHTML = historyItems.map(function(item) {
          const time = new Date(item.uploadTime || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return '<li class="history-item">' +
            '<div class="history-item-name">' + (item.name || '未命名') + '</div>' +
            '<div class="history-item-meta">' + formatSize(item.size || 0) + ' · ' + time + '</div>' +
          '</li>';
        }).join('');
      }

      function uploadFiles(files, requestId) {
        if (!files || files.length === 0) return;
        let index = 0;

        function next() {
          if (index >= files.length) {
            setTimeout(function() {
              progressBox.classList.remove('show');
            }, 1200);
            return;
          }
          const file = files[index];
          index++;
          uploadSingle(file, requestId, next);
        }

        progressBox.classList.add('show');
        next();
      }

      function uploadSingle(file, requestId, onDone) {
        progressName.textContent = '正在上传: ' + file.name;
        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';

        const xhr = new XMLHttpRequest();
        let uploadUrl = '/api/upload?filename=' + encodeURIComponent(file.name) +
          '&deviceId=' + encodeURIComponent(deviceId) +
          '&deviceName=' + encodeURIComponent(getDeviceName());
        if (requestId) {
          uploadUrl += '&requestId=' + encodeURIComponent(requestId);
        }

        xhr.upload.onprogress = function(e) {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = pct + '%';
            progressPercent.textContent = pct + '%';
          }
        };

        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            progressBar.style.width = '100%';
            progressPercent.textContent = '完成';
            try {
              const res = JSON.parse(xhr.responseText);
              if (res.ok && res.file) {
                addHistory(res.file);
              }
            } catch (err) {}
          } else {
            progressPercent.textContent = '失败';
          }
          setTimeout(onDone, 300);
        };

        xhr.onerror = function() {
          progressPercent.textContent = '网络错误';
          setTimeout(onDone, 500);
        };

        xhr.open('POST', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      }

      // 启动 WebSocket 连接
      connectWs();
    })();
  </script>
</body>
</html>`;
}
