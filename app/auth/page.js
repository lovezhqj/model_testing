'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/**
 * Format a date to MM-DD HH:mm:ss
 */
function formatFullDateTime(dateStr) {
  if (!dateStr) return '无';
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function AuthPage() {
  const [authStatus, setAuthStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState({ type: '', message: '' });
  const [testing, setTesting] = useState(false);
  const [polling, setPolling] = useState(false);

  // Fetch status from API
  const fetchStatus = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch('/api/auth');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setAuthStatus(json);
      }
    } catch (err) {
      console.error('获取授权状态失败:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling logic when authorization window is open
  const startPolling = (popupWindow, initialTimestamp) => {
    setPolling(true);
    setTestResult({ type: 'info', message: '正在等待您在登录窗口完成登录...' });
    
    const interval = setInterval(async () => {
      try {
        // Query status without blocking UI
        const res = await fetch('/api/auth');
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            // Check if status changed (authorized is true and timestamp is newer)
            const isNewer = !initialTimestamp || (json.updated_at && json.updated_at !== initialTimestamp);
            if (json.authorized && isNewer) {
              clearInterval(interval);
              setPolling(false);
              setAuthStatus(json);
              setTestResult({ type: 'success', message: '🎉 登录成功！系统已捕获并保存了您的授权信息。' });
              
              if (popupWindow && !popupWindow.closed) {
                popupWindow.close();
              }
              return;
            }
          }
        }
      } catch (e) {
        console.error('轮询出错:', e);
      }

      // Check if popup was closed manually
      if (popupWindow && popupWindow.closed) {
        clearInterval(interval);
        setPolling(false);
        fetchStatus(false);
        setTestResult(prev => 
          prev.type === 'info' 
            ? { type: 'warning', message: '登录窗口已被关闭。如未成功授权，请重试。' }
            : prev
        );
      }
    }, 2000);

    // Safety timeout: 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      setPolling(false);
    }, 5 * 60 * 1000);

    return interval;
  };

  // Listen for postMessage from the popup's injected interceptor script
  useEffect(() => {
    let popupRef = null;
    let pollingInterval = null;

    function handleMessage(event) {
      if (event.data?.type === 'kkdmx_auth_success') {
        const { token, userId } = event.data;
        console.log('[Auth] Received postMessage credentials:', { userId, token: token ? 'PRESENT' : 'EMPTY' });
        
        // Save credentials to Supabase via PUT /api/auth
        fetch('/api/auth', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, userId }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              setPolling(false);
              if (pollingInterval) clearInterval(pollingInterval);
              setTestResult({ type: 'success', message: '🎉 登录成功！系统已捕获并保存了您的授权信息。' });
              fetchStatus(false);
              
              // Close the popup after a short delay
              setTimeout(() => {
                if (popupRef && !popupRef.closed) {
                  popupRef.close();
                }
              }, 500);
            } else {
              setTestResult({ type: 'error', message: '保存凭据失败: ' + (data.error || '未知错误') });
            }
          })
          .catch(err => {
            console.error('[Auth] Failed to save credentials:', err);
            setTestResult({ type: 'error', message: '保存凭据时发生网络错误' });
          });
      }
    }

    window.addEventListener('message', handleMessage);
    
    // Expose refs so handleAuthorize can set them
    window.__authPopupRef = (ref) => { popupRef = ref; };
    window.__authPollingRef = (ref) => { pollingInterval = ref; };

    return () => {
      window.removeEventListener('message', handleMessage);
      delete window.__authPopupRef;
      delete window.__authPollingRef;
    };
  }, [fetchStatus]);

  // Open authorization popup
  const handleAuthorize = () => {
    const width = 800;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const initialTimestamp = authStatus?.updated_at || null;
    
    // Open targeted login page — /login goes through the fallback rewrite to /api/proxy/login
    const popup = window.open(
      '/login',
      'kkdmx_auth',
      `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`
    );

    if (popup) {
      popup.focus();
      // Store ref for postMessage handler
      if (window.__authPopupRef) window.__authPopupRef(popup);
      const interval = startPolling(popup, initialTimestamp);
      if (window.__authPollingRef) window.__authPollingRef(interval);
    } else {
      setTestResult({ type: 'error', message: '弹窗被浏览器拦截，请允许本站弹出窗口后重试。' });
    }
  };

  // Test current connection
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult({ type: 'info', message: '正在测试与 kkdmx.com 接口的连通性...' });
    try {
      const res = await fetch('/api/auth', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setTestResult({ type: 'success', message: json.message });
      } else {
        setTestResult({ type: 'error', message: json.error || '测试失败' });
      }
    } catch (err) {
      setTestResult({ type: 'error', message: '网络错误: ' + err.message });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="main-container">
        <div className="loading-container">
          <div className="loading-spinner" />
          <div className="loading-text">正在加载授权配置...</div>
        </div>
      </div>
    );
  }

  const isAuthorized = authStatus?.authorized;

  return (
    <div className="main-container">
      {/* Header */}
      <header className="header" id="auth-header">
        <div className="header-left">
          <div className="logo-icon">🔐</div>
          <div>
            <h1 className="header-title">KK大模型授权中心</h1>
            <div className="header-subtitle">捕获并管理第三方服务调用凭证</div>
          </div>
        </div>
        <div className="header-right">
          <Link href="/" className="refresh-btn" style={{ textDecoration: 'none' }}>
            ← 返回主面板
          </Link>
        </div>
      </header>

      {/* Main Card */}
      <div className="model-grid" style={{ maxWidth: '640px', margin: '0 auto', gap: '20px' }}>
        <div className="stat-card" style={{ width: '100%', padding: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <span className="stat-label" style={{ fontSize: '14px' }}>当前状态</span>
            <div className="status-badge" style={{ padding: '6px 14px' }}>
              <span className={`status-dot ${isAuthorized ? '' : 'offline'}`} />
              <span style={{ fontWeight: '600', color: isAuthorized ? 'var(--green-glow)' : 'var(--red-glow)' }}>
                {isAuthorized ? '已授权连接' : '未授权 / 授权失效'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>用户ID (New-Api-User)</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {authStatus?.details?.user_id || '—'}
              </span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>JWT 令牌</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {authStatus?.details?.token_preview || '—'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Cookie 信息</span>
              <span style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
                {authStatus?.details?.has_cookies ? '已获取 (HttpOnly)' : '未获取'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>最后更新时间</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {formatFullDateTime(authStatus?.updated_at)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <button 
              className="refresh-btn" 
              onClick={handleAuthorize} 
              disabled={polling || testing}
              style={{ 
                flex: '1', 
                justifyContent: 'center', 
                background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
                color: '#fff',
                borderColor: 'transparent',
                padding: '12px 24px',
                borderRadius: 'var(--radius-md)',
                fontSize: '14px',
                fontWeight: '600'
              }}
            >
              🔑 {polling ? '登录授权中...' : '点击开启授权'}
            </button>
            
            <button 
              className="refresh-btn" 
              onClick={handleTestConnection} 
              disabled={!isAuthorized || polling || testing}
              style={{ 
                padding: '12px 24px',
                borderRadius: 'var(--radius-md)',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              🔄 {testing ? '测试中...' : '测试接口连通性'}
            </button>
          </div>
        </div>

        {/* Message Alert Area */}
        {testResult.message && (
          <div 
            className="stat-card" 
            style={{ 
              width: '100%', 
              padding: '16px 20px', 
              fontSize: '14px',
              backgroundColor: 
                testResult.type === 'success' ? 'rgba(34, 197, 94, 0.08)' :
                testResult.type === 'error' ? 'rgba(239, 68, 68, 0.08)' :
                testResult.type === 'warning' ? 'rgba(234, 179, 8, 0.08)' :
                'rgba(78, 124, 255, 0.08)',
              borderColor: 
                testResult.type === 'success' ? 'var(--green-border)' :
                testResult.type === 'error' ? 'var(--red-border)' :
                testResult.type === 'warning' ? 'var(--yellow-border)' :
                'rgba(78, 124, 255, 0.25)',
              color: 
                testResult.type === 'success' ? 'var(--green-glow)' :
                testResult.type === 'error' ? 'var(--red-glow)' :
                testResult.type === 'warning' ? 'var(--yellow-glow)' :
                'var(--accent-cyan)'
            }}
          >
            {testResult.message}
          </div>
        )}

        {/* Steps Card */}
        <div className="stat-card" style={{ width: '100%', padding: '24px 28px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px', color: 'var(--accent-cyan)' }}>使用步骤说明：</h3>
          <ol style={{ paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li>点击上面的 <strong>“点击开启授权”</strong> 按钮，系统会打开弹窗载入 <code>kkdmx.com</code> 的登录页面。</li>
            <li>在弹窗中，输入您在 kkdmx 的<strong>账号与密码</strong>并点击登录。</li>
            <li>登录成功后，我们的反向代理拦截器会自动捕获成功的 Cookie 及 Token。</li>
            <li>系统捕获凭证后，弹窗会<strong>自动关闭</strong>，授权页面会自动显示“已授权连接”。</li>
            <li>授权成功后，建议点击 <strong>“测试接口连通性”</strong> 按钮，验证授权信息是否有效。</li>
            <li>此后，后台定时抓取接口 (Cron Job) 将自动读取并直接使用该授权凭据。</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
