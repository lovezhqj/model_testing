'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Get status color class based on response time in seconds
 */
function getStatusColor(responseTimeSec) {
  if (responseTimeSec < 5) return 'green';
  if (responseTimeSec < 20) return 'yellow';
  return 'red';
}

/**
 * Format a date to HH:mm
 */
function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Format a date to MM-DD HH:mm
 */
function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Generate time slot labels for the last 48 hours (every 30 minutes = 96 slots)
 */
function generateTimeSlots() {
  const slots = [];
  const now = new Date();
  for (let i = 95; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 30 * 60 * 1000);
    slots.push(t);
  }
  return slots;
}

/**
 * Calculate health score for sorting: more green = healthier
 * Score = greenCount * 3 - yellowCount * 1 - redCount * 5
 */
function calculateHealthScore(records, slots) {
  const slotData = mapRecordsToSlots(records, slots);
  let green = 0, yellow = 0, red = 0;
  slotData.forEach(record => {
    if (!record) return;
    const sec = record.response_time / 1000;
    if (sec < 5) green++;
    else if (sec < 20) yellow++;
    else red++;
  });
  return { score: green * 3 - yellow * 1 - red * 5, green, yellow, red };
}

/**
 * Assign records to nearest time slot
 */
function mapRecordsToSlots(records, slots) {
  const result = new Array(slots.length).fill(null);
  
  records.forEach(record => {
    const recordTime = new Date(record.create_time).getTime();
    let bestIdx = -1;
    let bestDist = Infinity;
    
    for (let i = 0; i < slots.length; i++) {
      const dist = Math.abs(recordTime - slots[i].getTime());
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    
    // Only assign if within 20 minutes of the slot
    if (bestIdx >= 0 && bestDist < 20 * 60 * 1000) {
      result[bestIdx] = record;
    }
  });
  
  return result;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [countdown, setCountdown] = useState(300); // 5 minute refresh
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, content: null });
  const tooltipRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(prev => prev === true ? true : false); // Don't show loading on refresh
      const res = await fetch('/api/models');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date());
      setCountdown(300);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto refresh countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchData();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchData]);

  // Handle tooltip positioning
  const handleBlockHover = (e, record, slotTime) => {
    if (!record) return;
    const rect = e.target.getBoundingClientRect();
    setTooltip({
      visible: true,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      content: {
        time: formatDateTime(record.create_time),
        responseTime: (record.response_time / 1000).toFixed(2),
        color: getStatusColor(record.response_time / 1000),
      },
    });
  };

  const handleBlockLeave = () => {
    setTooltip(prev => ({ ...prev, visible: false }));
  };

  // Calculate stats
  const timeSlots = generateTimeSlots();
  let totalModels = 0;
  let greenCount = 0;
  let yellowCount = 0;
  let redCount = 0;

  if (data?.data) {
    totalModels = data.data.length;
    data.data.forEach(model => {
      const latestRecord = model.records[model.records.length - 1];
      if (latestRecord) {
        const sec = latestRecord.response_time / 1000;
        if (sec < 5) greenCount++;
        else if (sec < 20) yellowCount++;
        else redCount++;
      }
    });
  }

  // Sort models by health score (healthiest first)
  const sortedData = data?.data ? [...data.data].sort((a, b) => {
    const scoreA = calculateHealthScore(a.records, timeSlots);
    const scoreB = calculateHealthScore(b.records, timeSlots);
    return scoreB.score - scoreA.score;
  }) : [];

  // Generate display time labels (show every 12 slots = 6 hours for 48h)
  const timeLabels = timeSlots.filter((_, i) => i % 12 === 0 || i === timeSlots.length - 1);

  if (loading && !data) {
    return (
      <div className="main-container">
        <div className="loading-container">
          <div className="loading-spinner" />
          <div className="loading-text">正在加载监控数据...</div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="main-container">
        <div className="error-container">
          <div className="error-icon">⚠️</div>
          <div className="error-text">数据加载失败</div>
          <div className="error-detail">{error}</div>
          <button className="refresh-btn" onClick={fetchData}>
            <span className="refresh-icon">↻</span> 重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="main-container">
      {/* Header */}
      <header className="header" id="dashboard-header">
        <div className="header-left">
          <div className="logo-icon">⚡</div>
          <div>
            <h1 className="header-title">Model Monitor</h1>
            <div className="header-subtitle">AI 模型服务状态监控面板</div>
          </div>
        </div>
        <div className="header-right">
          <div className="status-badge" id="status-badge">
            <span className={`status-dot ${data?.data?.length ? '' : 'offline'}`} />
            <span>
              {lastUpdate ? `更新于 ${formatTime(lastUpdate)}` : '未更新'}
              {' · '}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
              </span>
            </span>
          </div>
          <button className="refresh-btn" onClick={fetchData} disabled={loading} id="refresh-btn">
            <span className="refresh-icon">↻</span>
            {loading ? '加载中...' : '刷新数据'}
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="stats-bar" id="stats-bar">
        <div className="stat-card">
          <div className="stat-label">监控模型数</div>
          <div className="stat-value">{totalModels}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">正常 (&lt;5s)</div>
          <div className="stat-value green">{greenCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">偏慢 (5-20s)</div>
          <div className="stat-value yellow">{yellowCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">异常 (&gt;20s)</div>
          <div className="stat-value red">{redCount}</div>
        </div>
      </div>

      {/* Legend */}
      <div className="legend" id="legend">
        <div className="legend-item">
          <div className="legend-block green" />
          <span>正常 (&lt;5s)</span>
        </div>
        <div className="legend-item">
          <div className="legend-block yellow" />
          <span>偏慢 (5~20s)</span>
        </div>
        <div className="legend-item">
          <div className="legend-block red" />
          <span>异常 (&gt;20s)</span>
        </div>
        <div className="legend-item">
          <div className="legend-block gray" />
          <span>无数据</span>
        </div>
      </div>

      {/* Timeline Header */}
      <div className="timeline-header" id="timeline-header">
        <div className="timeline-name-col">模型名称</div>
        <div className="timeline-times">
          {timeLabels.map((t, i) => (
            <span key={i} className="timeline-time">{formatTime(t)}</span>
          ))}
        </div>
      </div>

      {/* Model Grid */}
      {sortedData.length > 0 ? (
        <div className="model-grid" id="model-grid">
          {sortedData.map((model) => {
            const slotData = mapRecordsToSlots(model.records, timeSlots);
            return (
              <div key={model.name} className="model-row">
                <div className="model-name" title={model.name}>{model.name}</div>
                <div className="status-blocks">
                  {slotData.map((record, idx) => {
                    const color = record 
                      ? getStatusColor(record.response_time / 1000) 
                      : 'empty';
                    return (
                      <div
                        key={idx}
                        className={`status-block ${color}`}
                        onMouseEnter={(e) => handleBlockHover(e, record, timeSlots[idx])}
                        onMouseLeave={handleBlockLeave}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-container" id="empty-state">
          <div className="empty-icon">📡</div>
          <div className="empty-title">暂无监控数据</div>
          <div className="empty-subtitle">
            数据将在下一次定时抓取后出现。您也可以手动触发一次数据抓取。
          </div>
        </div>
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={`tooltip ${tooltip.visible ? 'visible' : ''}`}
        style={{
          left: tooltip.x,
          top: tooltip.y,
          transform: 'translate(-50%, -100%)',
        }}
      >
        {tooltip.content && (
          <>
            <div className="tooltip-time">{tooltip.content.time}</div>
            <div className={`tooltip-value ${tooltip.content.color}`}>
              响应时间: {tooltip.content.responseTime}s
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="footer" id="dashboard-footer">
        <p>Model Monitor · 每 30 分钟自动采集 · 数据保留 48 小时</p>
      </footer>
    </div>
  );
}
