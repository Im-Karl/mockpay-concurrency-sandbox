import React, { useState, useEffect } from 'react';

export default function App() {
  const [walletId, setWalletId] = useState('test_wallet');
  const [balance, setBalance] = useState(0);
  const [initialBalance, setInitialBalance] = useState(10000000); // 10M VND
  const [amount, setAmount] = useState(200000); // 200k VND
  const [concurrentRequests, setConcurrentRequests] = useState(200);
  const [deductMethod, setDeductMethod] = useState('atomic');
  const [latency, setLatency] = useState(0);
  const [bypassRedis, setBypassRedis] = useState(false);
  const [activeTab, setActiveTab] = useState('stress'); // 'stress' or 'idempotency'

  // Test states
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [progress, setProgress] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [redisBlockedCount, setRedisBlockedCount] = useState(0);
  const [postgresBlockedCount, setPostgresBlockedCount] = useState(0);
  const [resultsList, setResultsList] = useState([]);
  const [avgLatency, setAvgLatency] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [logMessages, setLogMessages] = useState([]);

  useEffect(() => {
    fetchWalletInfo();
  }, [walletId]);

  const addLog = (message) => {
    setLogMessages(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev.slice(0, 29)]);
  };

  const fetchWalletInfo = async () => {
    try {
      const res = await fetch(`http://localhost:3000/gateway/wallets/${walletId}`);
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance);
      } else {
        const createRes = await fetch(`http://localhost:3000/gateway/wallets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: walletId, initialBalance: 0 })
        });
        if (createRes.ok) {
          const createData = await createRes.json();
          setBalance(createData.balance);
        }
      }
    } catch (err) {
      addLog(`Gateway connection offline: ${err.message}`);
    }
  };

  const handleResetWallet = async () => {
    try {
      addLog(`Resetting wallet ${walletId} to ${initialBalance.toLocaleString()} VND...`);
      const res = await fetch(`http://localhost:3000/gateway/wallets/${walletId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: initialBalance })
      });
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance);
        addLog(`Reset successful. Balance: ${parseFloat(data.balance).toLocaleString()} VND`);
      }
    } catch (err) {
      addLog(`Error resetting wallet: ${err.message}`);
    }
  };

  const runOversellingTest = async () => {
    if (isRunningTest) return;
    setIsRunningTest(true);
    setProgress(0);
    setSuccessCount(0);
    setRedisBlockedCount(0);
    setPostgresBlockedCount(0);
    setResultsList([]);
    setLogMessages([]);
    addLog(`Starting overselling stress test using ${deductMethod.toUpperCase()} (Latency: ${latency}ms, requests: ${concurrentRequests})...`);

    const startTotal = performance.now();
    let completed = 0;
    let localSuccess = 0;
    let localFailure = 0;
    let totalLatency = 0;
    const items = [];

    const requestPromises = Array.from({ length: concurrentRequests }).map(async (_, index) => {
      const reqId = index + 1;
      const startReq = performance.now();
      const key = `oversell_${walletId}_${Date.now()}_${index}_${Math.random()}`;

      try {
        const res = await fetch(`http://localhost:3000/gateway/wallets/${walletId}/deduct?method=${deductMethod}&latency=${latency}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': key
          },
          body: JSON.stringify({ amount: parseFloat(amount) })
        });
        const reqLatency = performance.now() - startReq;
        totalLatency += reqLatency;
        completed++;

        const isOk = res.ok;
        const status = res.status;
        let data = {};
        try {
          data = await res.json();
        } catch (e) { }

        if (isOk) {
          localSuccess++;
        } else {
          localFailure++;
        }

        const resultItem = {
          id: reqId,
          status,
          latency: Math.round(reqLatency),
          success: isOk,
          errorMessage: data.error || (isOk ? '' : `HTTP ${status}`),
          newBalance: data.balance !== undefined ? data.balance : null
        };

        items.push(resultItem);
        setProgress(Math.round((completed / concurrentRequests) * 100));
        setSuccessCount(localSuccess);

        if (status === 409) {
          setRedisBlockedCount(prev => prev + 1);
        } else if (!isOk) {
          setPostgresBlockedCount(prev => prev + 1);
        }

        setResultsList([...items]);
        return resultItem;
      } catch (err) {
        const reqLatency = performance.now() - startReq;
        totalLatency += reqLatency;
        completed++;
        localFailure++;

        const resultItem = {
          id: reqId,
          status: 'Network Error',
          latency: Math.round(reqLatency),
          success: false,
          errorMessage: err.message,
          newBalance: null
        };

        items.push(resultItem);
        setProgress(Math.round((completed / concurrentRequests) * 100));
        setPostgresBlockedCount(prev => prev + 1);
        setResultsList([...items]);
        return resultItem;
      }
    });

    await Promise.all(requestPromises);
    const endTotal = performance.now();

    setTotalTime(Math.round(endTotal - startTotal));
    setAvgLatency(Math.round(totalLatency / concurrentRequests));
    setIsRunningTest(false);
    await fetchWalletInfo();
    addLog(`Test finished. Total time: ${Math.round(endTotal - startTotal)}ms.`);
  };

  const runIdempotencyTest = async () => {
    if (isRunningTest) return;
    setIsRunningTest(true);
    setProgress(0);
    setSuccessCount(0);
    setRedisBlockedCount(0);
    setPostgresBlockedCount(0);
    setResultsList([]);
    setLogMessages([]);

    const key = `idempotency_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    addLog(`Starting idempotency test (Bypass Redis: ${bypassRedis}, Key: ${key})...`);

    const startTotal = performance.now();
    let completed = 0;
    let localSuccess = 0;
    let localRedisBlock = 0;
    let localPostgresBlock = 0;
    let totalLatency = 0;
    const items = [];

    const requestPromises = Array.from({ length: concurrentRequests }).map(async (_, index) => {
      const reqId = index + 1;
      const startReq = performance.now();
      try {
        const res = await fetch(`http://localhost:3000/gateway/wallets/${walletId}/deduct?method=${deductMethod}&latency=${latency}&bypassRedis=${bypassRedis}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': key
          },
          body: JSON.stringify({ amount: parseFloat(amount) })
        });
        const reqLatency = performance.now() - startReq;
        totalLatency += reqLatency;
        completed++;

        const status = res.status;
        const isOk = res.ok;
        let data = {};
        try {
          data = await res.json();
        } catch (e) { }

        if (isOk) {
          localSuccess++;
        } else if (status === 409) {
          localRedisBlock++;
        } else {
          localPostgresBlock++;
        }

        const resultItem = {
          id: reqId,
          status,
          latency: Math.round(reqLatency),
          success: isOk,
          errorMessage: data.error || (isOk ? '' : status === 409 ? 'Blocked by Redis' : 'Blocked by PostgreSQL'),
          newBalance: data.balance !== undefined ? data.balance : null
        };

        items.push(resultItem);
        setProgress(Math.round((completed / concurrentRequests) * 100));
        setSuccessCount(localSuccess);
        setRedisBlockedCount(localRedisBlock);
        setPostgresBlockedCount(localPostgresBlock);
        setResultsList([...items]);

        return resultItem;
      } catch (err) {
        const reqLatency = performance.now() - startReq;
        totalLatency += reqLatency;
        completed++;
        localPostgresBlock++;

        const resultItem = {
          id: reqId,
          status: 'Network Error',
          latency: Math.round(reqLatency),
          success: false,
          errorMessage: err.message,
          newBalance: null
        };

        items.push(resultItem);
        setProgress(Math.round((completed / concurrentRequests) * 100));
        setPostgresBlockedCount(localPostgresBlock);
        setResultsList([...items]);
        return resultItem;
      }
    });

    await Promise.all(requestPromises);
    const endTotal = performance.now();

    setTotalTime(Math.round(endTotal - startTotal));
    setAvgLatency(Math.round(totalLatency / concurrentRequests));
    setIsRunningTest(false);
    await fetchWalletInfo();
    addLog(`Test finished.`);
  };

  const totalResults = successCount + redisBlockedCount + postgresBlockedCount;
  const successPct = totalResults > 0 ? (successCount / totalResults) * 100 : 0;
  const redisBlockedPct = totalResults > 0 ? (redisBlockedCount / totalResults) * 100 : 0;
  const postgresBlockedPct = totalResults > 0 ? (postgresBlockedCount / totalResults) * 100 : 0;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 24px', color: '#e4e4e7' }}>

      {/* Top minimal bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', borderBottom: '1px solid #27272a', paddingBottom: '24px' }}>
        <div>
          <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#71717a' }}>Developer Tool</span>
          <h1 style={{ margin: '4px 0 0 0', fontSize: '20px', fontWeight: 600, color: '#f4f4f5' }}>Mock-Pay Concurrency Sandbox</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#a1a1aa' }}>
          <span>I'm-Karl</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '32px' }}>

        {/* Sidebar Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Wallet Info Container */}
          <div className="flat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>User Wallet</span>
              <button
                onClick={fetchWalletInfo}
                style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: '12px', padding: 0 }}
              >
                Refresh
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#71717a', marginBottom: '6px' }}>Wallet ID</span>
              <input
                type="text"
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                className="flat-input"
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>Current Balance</span>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#f4f4f5', fontFamily: 'monospace' }}>
                {parseFloat(balance).toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 400, color: '#a1a1aa' }}>VND</span>
              </div>
            </div>
          </div>

          {/* Reset Balance Container */}
          <div className="flat-card">
            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>Reset Balance</span>
            <div style={{ marginBottom: '16px' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#71717a', marginBottom: '6px' }}>Target Amount (VND)</span>
              <input
                type="number"
                value={initialBalance}
                onChange={(e) => setInitialBalance(parseInt(e.target.value))}
                className="flat-input"
                style={{ fontFamily: 'monospace' }}
              />
            </div>
            <button
              onClick={handleResetWallet}
              className="flat-btn-outline"
              style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}
            >
              Update Balance
            </button>
          </div>

          {/* Parameters */}
          <div className="flat-card">
            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>Parameters</span>

            <div style={{ marginBottom: '16px' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#71717a', marginBottom: '6px' }}>Amount per transaction (VND)</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(parseInt(e.target.value))}
                className="flat-input"
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#71717a', marginBottom: '6px' }}>Parallel Requests</span>
              <input
                type="number"
                value={concurrentRequests}
                onChange={(e) => setConcurrentRequests(parseInt(e.target.value))}
                className="flat-input"
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#71717a', marginBottom: '6px' }}>
                <span>Simulated Network Latency:</span>
                <span style={{ color: '#ef4444', fontWeight: 600 }}>{latency}ms</span>
              </div>
              <input
                type="range"
                min="0"
                max="5000"
                step="100"
                value={latency}
                onChange={(e) => setLatency(parseInt(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: '#4f46e5' }}
              />
            </div>
          </div>

        </div>

        {/* Main Work Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

          {/* Tabbed Test Runner Panel */}
          <div className="flat-card" style={{ padding: '0', overflow: 'hidden' }}>
            {/* Tabs Header */}
            <div style={{ display: 'flex', borderBottom: '1px solid #27272a', background: '#0f0f11' }}>
              <button
                onClick={() => setActiveTab('stress')}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: activeTab === 'stress' ? '#18181b' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'stress' ? '2px solid #4f46e5' : 'none',
                  color: activeTab === 'stress' ? '#f4f4f5' : '#71717a',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                Overselling Stress Test
              </button>
              <button
                onClick={() => setActiveTab('idempotency')}
                style={{
                  flex: 1,
                  padding: '14px',
                  background: activeTab === 'idempotency' ? '#18181b' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'idempotency' ? '2px solid #4f46e5' : 'none',
                  color: activeTab === 'idempotency' ? '#f4f4f5' : '#71717a',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                Idempotency Test
              </button>
            </div>

            {/* Tabs Content */}
            <div style={{ padding: '24px' }}>
              {activeTab === 'stress' ? (
                <div>
                  <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#a1a1aa', lineHeight: '1.6' }}>
                    Simulates multiple concurrent threads attempting to deduct money from the wallet. Helps test race conditions across different database locking strategies.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '400px' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '11px', color: '#71717a', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Select Lock Strategy</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {['traditional', 'pessimistic', 'atomic'].map((method) => (
                          <button
                            key={method}
                            onClick={() => setDeductMethod(method)}
                            style={{
                              flex: 1,
                              padding: '8px',
                              borderRadius: '4px',
                              border: '1px solid',
                              borderColor: deductMethod === method ? '#4f46e5' : '#27272a',
                              background: deductMethod === method ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
                              color: deductMethod === method ? '#f4f4f5' : '#a1a1aa',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textTransform: 'capitalize',
                              fontSize: '12px'
                            }}
                          >
                            {method}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={runOversellingTest}
                      disabled={isRunningTest}
                      className="flat-btn-primary"
                      style={{ padding: '12px', fontSize: '13px', marginTop: '10px' }}
                    >
                      {isRunningTest ? 'Executing...' : 'Run Stress Test'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#a1a1aa', lineHeight: '1.6' }}>
                    Sends duplicate requests containing the same <code style={{ color: '#6366f1' }}>X-Idempotency-Key</code> concurrently. Compare the Redis Fast-path cache lock and the PostgreSQL Slow-path database constraint.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '400px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#f4f4f5' }}>
                      <input
                        type="checkbox"
                        checked={bypassRedis}
                        onChange={(e) => setBypassRedis(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#4f46e5' }}
                      />
                      <span>Bypass Redis Idempotency Guard (Force DB check)</span>
                    </label>

                    <button
                      onClick={runIdempotencyTest}
                      disabled={isRunningTest}
                      className="flat-btn-primary"
                      style={{ padding: '12px', fontSize: '13px' }}
                    >
                      {isRunningTest ? 'Executing...' : 'Run Idempotency Test'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Results Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1.3fr', gap: '32px' }}>

            {/* Distribution Analysis */}
            <div className="flat-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '380px' }}>
              <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '20px' }}>
                Test Output Distribution
              </span>

              {/* Stacked Progress Bar */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifySelf: 'stretch', height: '12px', width: '100%', borderRadius: '2px', overflow: 'hidden', backgroundColor: '#27272a' }}>
                  {successCount > 0 && <div style={{ width: `${successPct}%`, backgroundColor: '#10b981' }} />}
                  {redisBlockedCount > 0 && <div style={{ width: `${redisBlockedPct}%`, backgroundColor: '#ef4444' }} />}
                  {postgresBlockedCount > 0 && <div style={{ width: `${postgresBlockedPct}%`, backgroundColor: '#f59e0b' }} />}
                </div>

                {/* Clean Simple Legend */}
                <div style={{ display: 'flex', gap: '20px', marginTop: '12px', fontSize: '11px', color: '#a1a1aa' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }}></span>
                    <span>Success: <strong style={{ color: '#f4f4f5', fontFamily: 'monospace' }}>{successCount}</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block' }}></span>
                    <span>Redis Blocked: <strong style={{ color: '#f4f4f5', fontFamily: 'monospace' }}>{redisBlockedCount}</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b', display: 'inline-block' }}></span>
                    <span>DB Blocked: <strong style={{ color: '#f4f4f5', fontFamily: 'monospace' }}>{postgresBlockedCount}</strong></span>
                  </div>
                </div>
              </div>

              {/* Simple Metrics Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div style={{ padding: '12px', border: '1px solid #27272a', borderRadius: '6px', backgroundColor: '#09090b', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '11px', color: '#71717a' }}>Avg Latency</span>
                  <span style={{ fontSize: '15px', fontWeight: 600, color: '#f4f4f5', fontFamily: 'monospace' }}>{avgLatency}ms</span>
                </div>
                <div style={{ padding: '12px', border: '1px solid #27272a', borderRadius: '6px', backgroundColor: '#09090b', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '11px', color: '#71717a' }}>Duration</span>
                  <span style={{ fontSize: '15px', fontWeight: 600, color: '#f4f4f5', fontFamily: 'monospace' }}>{totalTime}ms</span>
                </div>
              </div>

              {/* Flat Results Table */}
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: '180px', border: '1px solid #27272a', borderRadius: '6px', background: '#09090b' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #27272a', color: '#71717a', background: '#18181b' }}>
                      <th style={{ padding: '8px 12px', fontWeight: 500 }}>ID</th>
                      <th style={{ padding: '8px 12px', fontWeight: 500 }}>Status</th>
                      <th style={{ padding: '8px 12px', fontWeight: 500 }}>Latency</th>
                      <th style={{ padding: '8px 12px', fontWeight: 500 }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultsList.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ padding: '24px', textAlign: 'center', color: '#71717a' }}>No test results available.</td>
                      </tr>
                    ) : (
                      resultsList.slice(-100).reverse().map((res) => (
                        <tr key={res.id} style={{ borderBottom: '1px solid #27272a' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 500 }}>#{res.id}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              fontWeight: 600,
                              fontSize: '11px',
                              color: res.success ? '#10b981' : res.status === 409 ? '#ef4444' : '#f59e0b'
                            }}>
                              {res.status}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', color: '#a1a1aa', fontFamily: 'monospace' }}>{res.latency}ms</td>
                          <td style={{ padding: '8px 12px', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '200px', color: '#71717a' }} title={res.errorMessage}>
                            {res.success ? 'Success' : res.errorMessage}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Simple Logs Console */}
            <div className="flat-card" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '380px', boxSizing: 'border-box' }}>
              <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '20px' }}>
                Console Logs
              </span>

              <div style={{
                flex: 1,
                backgroundColor: '#09090b',
                border: '1px solid #27272a',
                borderRadius: '6px',
                padding: '12px',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: '#34d399',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column-reverse',
                gap: '8px',
                height: '240px'
              }}>
                {logMessages.length === 0 ? (
                  <div style={{ color: '#71717a', textAlign: 'center', padding: '20px' }}>Logs ready...</div>
                ) : (
                  logMessages.map((log, index) => (
                    <div key={index} style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
