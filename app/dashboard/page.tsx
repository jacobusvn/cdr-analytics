"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  ComposedChart,
} from "recharts";

interface CDRRecord {
  id: string;
  timestamp: string;
  caller: string;
  callee: string;
  duration: number;
  status: string;
  direction: string;
  cost: number;
}

const COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

type TabKey = "overview" | "missed" | "monthly" | "hourly" | "dayofweek" | "records";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function answerRateBadge(rate: number): string {
  if (rate >= 80) return "bg-green-50 text-green-700";
  if (rate >= 70) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

function peakBadge(level: string): string {
  if (level === "PEAK") return "bg-red-50 text-red-700 font-bold";
  if (level === "High") return "bg-amber-50 text-amber-700";
  if (level === "LOW") return "bg-blue-50 text-blue-700";
  return "bg-gray-50 text-gray-600";
}

export default function Dashboard() {
  const [records, setRecords] = useState<CDRRecord[]>([]);
  const [filtered, setFiltered] = useState<CDRRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantName, setTenantName] = useState("");
  const [source, setSource] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const fetchCDR = useCallback(async () => {
    const token = sessionStorage.getItem("token");
    if (!token) {
      router.push("/");
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);

      const res = await fetch(`/api/cdr?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        sessionStorage.clear();
        router.push("/");
        return;
      }

      const data = await res.json();
      setRecords(data.records || []);
      setSource(data.source || "");
    } catch {
      console.error("Failed to fetch CDR data");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, router]);

  useEffect(() => {
    const name = sessionStorage.getItem("tenantName");
    if (!name) {
      router.push("/");
      return;
    }
    setTenantName(name);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setDateFrom(thirtyDaysAgo.toISOString().split("T")[0]);
    setDateTo(now.toISOString().split("T")[0]);
  }, [router]);

  useEffect(() => {
    if (dateFrom && dateTo) fetchCDR();
  }, [dateFrom, dateTo, fetchCDR]);

  // Apply filters
  useEffect(() => {
    let data = [...records];
    if (statusFilter !== "all") data = data.filter((r) => r.status === statusFilter);
    if (directionFilter !== "all") data = data.filter((r) => r.direction === directionFilter);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      data = data.filter(
        (r) =>
          r.caller.toLowerCase().includes(term) ||
          r.callee.toLowerCase().includes(term)
      );
    }
    setFiltered(data);
  }, [records, statusFilter, directionFilter, searchTerm]);

  function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const mapped: CDRRecord[] = results.data.map((row, i) => ({
          id: String(i),
          timestamp: row.timestamp || row.date || row.connect_time || row.bill_time || "",
          caller: row.caller || row.CLI || row.source || row.from || "",
          callee: row.callee || row.CLD || row.destination || row.to || "",
          duration: Number(row.duration || row.charged_quantity || 0),
          status: (row.status || row.disconnect_cause || "answered").toLowerCase(),
          direction: (row.direction || row.call_class || "inbound").toLowerCase(),
          cost: Number(row.cost || row.charged_amount || 0),
        }));
        setRecords(mapped);
        setSource("csv");
      },
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function exportCSV() {
    const csv = Papa.unparse(filtered);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cdr-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function logout() {
    sessionStorage.clear();
    router.push("/");
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  // Analytics computations - cost calculated client-side as duration * 0.01
  const totalCalls = filtered.length;
  const answeredCalls = filtered.filter((r) => r.status === "answered").length;
  const missedCalls = filtered.filter((r) => r.status === "missed").length;
  const totalDuration = filtered.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = answeredCalls > 0 ? Math.round(totalDuration / answeredCalls) : 0;
  const totalCost = filtered.reduce((sum, r) => sum + r.duration * 0.01, 0);
  const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

  // Days in range for daily average
  const daysInRange =
    dateFrom && dateTo
      ? Math.max(
          1,
          Math.ceil(
            (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24)
          ) + 1
        )
      : 1;
  const dailyAverage = Math.round(totalCalls / daysInRange);
  const totalTalkHours = (totalDuration / 3600).toFixed(1);

  // Status pie data
  const statusData = ["answered", "missed", "voicemail", "busy"]
    .map((s) => ({
      name: s.charAt(0).toUpperCase() + s.slice(1),
      value: filtered.filter((r) => r.status === s).length,
    }))
    .filter((d) => d.value > 0);

  const directionData = ["inbound", "outbound"].map((d) => ({
    name: d.charAt(0).toUpperCase() + d.slice(1),
    value: filtered.filter((r) => r.direction === d).length,
  }));

  // Daily call volume
  const dailyMap = new Map<string, { date: string; inbound: number; outbound: number; total: number }>();
  filtered.forEach((r) => {
    const day = r.timestamp.split("T")[0];
    if (!day) return;
    const entry = dailyMap.get(day) || { date: day, inbound: 0, outbound: 0, total: 0 };
    entry.total++;
    if (r.direction === "inbound") entry.inbound++;
    else entry.outbound++;
    dailyMap.set(day, entry);
  });
  const dailyData = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Top callers
  const callerMap = new Map<string, number>();
  filtered.forEach((r) => {
    callerMap.set(r.caller, (callerMap.get(r.caller) || 0) + 1);
  });
  const topCallers = Array.from(callerMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([number, calls]) => ({ number, calls }));

  // Missed calls (inbound + missed status)
  const missedCallRecords = filtered
    .filter((r) => r.status === "missed" && r.direction === "inbound")
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Monthly breakdown
  const monthlyMap = new Map<
    string,
    { month: string; total: number; answered: number; notAnswered: number; totalDuration: number }
  >();
  filtered.forEach((r) => {
    const d = new Date(r.timestamp);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthlyMap.get(key) || {
      month: key,
      total: 0,
      answered: 0,
      notAnswered: 0,
      totalDuration: 0,
    };
    entry.total++;
    if (r.status === "answered") {
      entry.answered++;
      entry.totalDuration += r.duration;
    } else {
      entry.notAnswered++;
    }
    monthlyMap.set(key, entry);
  });
  const monthlyData = Array.from(monthlyMap.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  // Hourly breakdown
  const hourlyBreakdown = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    slot: `${String(h).padStart(2, "0")}:00-${String(h + 1 === 24 ? 0 : h + 1).padStart(2, "0")}:00`,
    total: 0,
    answered: 0,
    answerRate: 0,
    peakLevel: "Moderate" as string,
  }));
  filtered.forEach((r) => {
    const h = new Date(r.timestamp).getHours();
    if (!isNaN(h)) {
      hourlyBreakdown[h].total++;
      if (r.status === "answered") hourlyBreakdown[h].answered++;
    }
  });
  hourlyBreakdown.forEach((h) => {
    h.answerRate = h.total > 0 ? Math.round((h.answered / h.total) * 100) : 0;
  });

  // Peak level logic
  const sortedByCount = [...hourlyBreakdown].sort((a, b) => b.total - a.total);
  const peakHours = new Set(sortedByCount.slice(0, 2).map((h) => h.hour));
  const highHours = new Set(sortedByCount.slice(2, 5).map((h) => h.hour));
  const lowCandidates = sortedByCount.slice(-2).filter((h) => h.answerRate < 50 && h.total > 0);
  const lowHours = new Set(lowCandidates.map((h) => h.hour));
  hourlyBreakdown.forEach((h) => {
    if (peakHours.has(h.hour)) h.peakLevel = "PEAK";
    else if (highHours.has(h.hour)) h.peakLevel = "High";
    else if (lowHours.has(h.hour)) h.peakLevel = "LOW";
    else h.peakLevel = "Moderate";
  });

  const hourlyChartData = hourlyBreakdown.map((h) => ({
    slot: `${String(h.hour).padStart(2, "0")}:00`,
    total: h.total,
    answered: h.answered,
    answerRate: h.answerRate,
  }));

  // Day of week breakdown
  const dowMap = new Map<
    string,
    { day: string; total: number; answered: number; totalDuration: number }
  >();
  DAY_ORDER.forEach((d) => dowMap.set(d, { day: d, total: 0, answered: 0, totalDuration: 0 }));
  filtered.forEach((r) => {
    const d = new Date(r.timestamp);
    if (isNaN(d.getTime())) return;
    const dayName = DAY_NAMES[d.getDay()];
    const entry = dowMap.get(dayName)!;
    entry.total++;
    if (r.status === "answered") {
      entry.answered++;
      entry.totalDuration += r.duration;
    }
  });
  const dowData = DAY_ORDER.map((d) => dowMap.get(d)!);

  // Generate PDF report
  function generateReport() {
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) return;

    const monthlyRows = monthlyData
      .map((m) => {
        const rate = m.total > 0 ? Math.round((m.answered / m.total) * 100) : 0;
        const hours = (m.totalDuration / 3600).toFixed(1);
        return `<tr>
          <td>${m.month}</td>
          <td>${m.total}</td>
          <td>${m.answered}</td>
          <td>${m.notAnswered}</td>
          <td style="color: ${rate >= 80 ? "#10b981" : rate >= 70 ? "#f59e0b" : "#ef4444"}; font-weight: 600;">${rate}%</td>
          <td>${hours}</td>
        </tr>`;
      })
      .join("");

    const hourlyRows = hourlyBreakdown
      .map((h) => {
        return `<tr>
          <td>${h.slot}</td>
          <td>${h.total}</td>
          <td>${h.answered}</td>
          <td style="color: ${h.answerRate >= 80 ? "#10b981" : h.answerRate >= 70 ? "#f59e0b" : "#ef4444"}; font-weight: 600;">${h.answerRate}%</td>
          <td>${h.peakLevel}</td>
        </tr>`;
      })
      .join("");

    const dowRows = dowData
      .map((d) => {
        const rate = d.total > 0 ? Math.round((d.answered / d.total) * 100) : 0;
        const hours = (d.totalDuration / 3600).toFixed(1);
        return `<tr>
          <td>${d.day}</td>
          <td>${d.total}</td>
          <td>${d.answered}</td>
          <td style="color: ${rate >= 80 ? "#10b981" : rate >= 70 ? "#f59e0b" : "#ef4444"}; font-weight: 600;">${rate}%</td>
          <td>${hours}</td>
        </tr>`;
      })
      .join("");

    const topCallerRows = topCallers
      .map(
        (c, i) =>
          `<tr><td>${i + 1}</td><td>${c.number}</td><td>${c.calls}</td></tr>`
      )
      .join("");

    const missedSummary = missedCallRecords.length;

    const html = `<!DOCTYPE html>
<html>
<head>
<title>NexysAnalytics CDR Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; padding: 20px; }
  .header { border-bottom: 3px solid #1e3a5f; padding-bottom: 15px; margin-bottom: 20px; }
  .header h1 { color: #1e3a5f; font-size: 24px; margin-bottom: 4px; }
  .header h2 { color: #00a7e1; font-size: 16px; font-weight: normal; margin-bottom: 8px; }
  .header .meta { color: #6b7280; font-size: 11px; }
  .section { margin-bottom: 20px; page-break-inside: avoid; }
  .section h3 { color: #1e3a5f; font-size: 14px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 8px; }
  .summary { background: #f8fafc; border: 1px solid #e5e7eb; padding: 12px; border-radius: 4px; line-height: 1.6; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; }
  th { background: #1e3a5f; color: white; padding: 6px 8px; text-align: left; font-weight: 600; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f8fafc; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .stat-box { border: 1px solid #e5e7eb; padding: 8px; text-align: center; border-radius: 4px; }
  .stat-box .label { font-size: 10px; color: #6b7280; text-transform: uppercase; }
  .stat-box .value { font-size: 18px; font-weight: bold; color: #1e3a5f; }
  @media print {
    body { padding: 0; }
    .section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>NexysAnalytics</h1>
    <h2>CDR Analysis Report</h2>
    <div class="meta">
      <strong>Tenant:</strong> ${tenantName} &nbsp; | &nbsp;
      <strong>Period:</strong> ${dateFrom} to ${dateTo} &nbsp; | &nbsp;
      <strong>Report Date:</strong> ${new Date().toISOString().split("T")[0]}
    </div>
  </div>

  <div class="section">
    <h3>1. Executive Summary</h3>
    <div class="summary">
      During the reporting period from <strong>${dateFrom}</strong> to <strong>${dateTo}</strong>,
      a total of <strong>${totalCalls.toLocaleString()}</strong> calls were processed.
      Of these, <strong>${answeredCalls.toLocaleString()}</strong> were answered
      (${answerRate}% answer rate) and <strong>${missedCalls.toLocaleString()}</strong> were missed.
      The average call duration was <strong>${formatDuration(avgDuration)}</strong>
      with a total talk time of <strong>${totalTalkHours} hours</strong>.
      Total estimated cost was <strong>R${totalCost.toFixed(2)}</strong>.
      The daily average was <strong>${dailyAverage}</strong> calls per day.
    </div>
  </div>

  <div class="section">
    <h3>2. Overall Statistics</h3>
    <div class="stats-grid">
      <div class="stat-box"><div class="label">Total Calls</div><div class="value">${totalCalls.toLocaleString()}</div></div>
      <div class="stat-box"><div class="label">Answered</div><div class="value">${answeredCalls.toLocaleString()}</div></div>
      <div class="stat-box"><div class="label">Missed</div><div class="value">${missedCalls.toLocaleString()}</div></div>
      <div class="stat-box"><div class="label">Answer Rate</div><div class="value">${answerRate}%</div></div>
      <div class="stat-box"><div class="label">Avg Duration</div><div class="value">${formatDuration(avgDuration)}</div></div>
      <div class="stat-box"><div class="label">Total Hours</div><div class="value">${totalTalkHours}</div></div>
      <div class="stat-box"><div class="label">Daily Average</div><div class="value">${dailyAverage}</div></div>
      <div class="stat-box"><div class="label">Total Cost</div><div class="value">R${totalCost.toFixed(2)}</div></div>
    </div>
  </div>

  <div class="section">
    <h3>3. Monthly Breakdown</h3>
    <table>
      <thead><tr><th>Month</th><th>Total Calls</th><th>Answered</th><th>Not Answered</th><th>Answer Rate</th><th>Total Hours</th></tr></thead>
      <tbody>${monthlyRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h3>4. Hourly Breakdown</h3>
    <table>
      <thead><tr><th>Time Slot</th><th>Total Calls</th><th>Answered</th><th>Answer Rate</th><th>Peak Level</th></tr></thead>
      <tbody>${hourlyRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h3>5. Day of Week</h3>
    <table>
      <thead><tr><th>Day</th><th>Total Calls</th><th>Answered</th><th>Answer Rate</th><th>Total Hours</th></tr></thead>
      <tbody>${dowRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h3>6. Top 10 Callers</h3>
    <table>
      <thead><tr><th>#</th><th>Number</th><th>Calls</th></tr></thead>
      <tbody>${topCallerRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h3>7. Missed Calls Summary</h3>
    <p>Total missed inbound calls: <strong>${missedSummary}</strong></p>
  </div>

  <script>
    setTimeout(function() { window.print(); }, 500);
  </script>
</body>
</html>`;

    reportWindow.document.write(html);
    reportWindow.document.close();
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "missed", label: "Missed Calls" },
    { key: "monthly", label: "Monthly" },
    { key: "hourly", label: "Hourly" },
    { key: "dayofweek", label: "Day of Week" },
    { key: "records", label: "Call Records" },
  ];

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading call data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-gray-900">CDR Analytics</h1>
              <p className="text-xs text-gray-500">{tenantName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {source === "demo" && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                Demo Data
              </span>
            )}
            {source === "csv" && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                CSV Upload
              </span>
            )}
            <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="all">All</option>
                <option value="answered">Answered</option>
                <option value="missed">Missed</option>
                <option value="voicemail">Voicemail</option>
                <option value="busy">Busy</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Direction</label>
              <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="all">All</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input type="text" placeholder="Search by phone number..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div className="flex gap-2">
              <label className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors cursor-pointer">
                Upload CSV
                <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
              </label>
              <button onClick={exportCSV}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                Export CSV
              </button>
              <button onClick={generateReport}
                className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#162d4a] transition-colors">
                Download Report
              </button>
            </div>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ==================== OVERVIEW TAB ==================== */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
              {[
                { label: "Total Calls", value: totalCalls.toLocaleString(), color: "text-indigo-600" },
                { label: "Answered", value: answeredCalls.toLocaleString(), color: "text-green-600" },
                { label: "Missed", value: missedCalls.toLocaleString(), color: "text-red-600" },
                { label: "Answer Rate", value: `${answerRate}%`, color: answerRate >= 80 ? "text-green-600" : answerRate >= 70 ? "text-amber-600" : "text-red-600" },
                { label: "Avg Duration", value: formatDuration(avgDuration), color: "text-blue-600" },
                { label: "Total Cost", value: `R${totalCost.toFixed(2)}`, color: "text-purple-600" },
                { label: "Daily Average", value: dailyAverage.toLocaleString(), color: "text-cyan-600" },
                { label: "Total Talk Time", value: `${totalTalkHours} hrs`, color: "text-teal-600" },
              ].map((kpi) => (
                <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 font-medium">{kpi.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Calls */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Daily Call Volume</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="inbound" stroke="#4f46e5" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="outbound" stroke="#10b981" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Status & Direction Pies side by side */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-gray-900 mb-4">Call Status</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                          outerRadius={70} label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                          labelLine={false} fontSize={11}>
                          {statusData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-gray-900 mb-4">Call Direction</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={directionData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                          outerRadius={70} label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                          labelLine={false} fontSize={11}>
                          {directionData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Callers */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Top 10 Callers</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {topCallers.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg p-2">
                    <span className="text-gray-600 font-mono text-xs truncate mr-2">{c.number}</span>
                    <span className="font-semibold text-indigo-600">{c.calls}</span>
                  </div>
                ))}
                {topCallers.length === 0 && (
                  <p className="text-sm text-gray-400">No data</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== MISSED CALLS TAB ==================== */}
        {activeTab === "missed" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Missed Inbound Calls</h3>
              <p className="text-sm text-gray-500 mt-1">{missedCallRecords.length} missed inbound calls</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Date/Time</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">From</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">To</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {missedCallRecords.map((r, i) => (
                    <tr key={r.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                      <td className="px-4 py-3 text-gray-600">
                        {new Date(r.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.caller}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.callee}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                          {r.direction}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {missedCallRecords.length === 0 && (
                <div className="px-4 py-12 text-center text-gray-400">
                  No missed inbound calls found.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== MONTHLY TAB ==================== */}
        {activeTab === "monthly" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Monthly Call Volume</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="answered" stackId="a" fill="#10b981" name="Answered" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="notAnswered" stackId="a" fill="#ef4444" name="Not Answered" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Month</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Total Calls</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Answered</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Not Answered</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Answer Rate</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Total Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyData.map((m, i) => {
                      const rate = m.total > 0 ? Math.round((m.answered / m.total) * 100) : 0;
                      return (
                        <tr key={m.month} className={`border-b border-gray-100 ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                          <td className="px-4 py-3 font-medium text-gray-900">{m.month}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{m.total}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{m.answered}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{m.notAnswered}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${answerRateBadge(rate)}`}>
                              {rate}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">{(m.totalDuration / 3600).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {monthlyData.length === 0 && (
                  <div className="px-4 py-12 text-center text-gray-400">No data available.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== HOURLY TAB ==================== */}
        {activeTab === "hourly" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Hourly Call Distribution</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={hourlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="slot" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="total" fill="#4f46e5" name="Total Calls" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="answerRate" stroke="#10b981" strokeWidth={2} name="Answer Rate %" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Time Slot</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Total Calls</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Answered</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Answer Rate</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Peak Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourlyBreakdown.map((h, i) => (
                      <tr key={h.hour} className={`border-b border-gray-100 ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                        <td className="px-4 py-3 font-medium text-gray-900">{h.slot}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{h.total}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{h.answered}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${answerRateBadge(h.answerRate)}`}>
                            {h.answerRate}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${peakBadge(h.peakLevel)}`}>
                            {h.peakLevel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== DAY OF WEEK TAB ==================== */}
        {activeTab === "dayofweek" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Calls by Day of Week</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dowData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="total" fill="#4f46e5" name="Total Calls" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="answered" fill="#10b981" name="Answered" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Day</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Total Calls</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Answered</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Answer Rate</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Total Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dowData.map((d, i) => {
                      const rate = d.total > 0 ? Math.round((d.answered / d.total) * 100) : 0;
                      return (
                        <tr key={d.day} className={`border-b border-gray-100 ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                          <td className="px-4 py-3 font-medium text-gray-900">{d.day}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{d.total}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{d.answered}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${answerRateBadge(rate)}`}>
                              {rate}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">{(d.totalDuration / 3600).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== CALL RECORDS TAB ==================== */}
        {activeTab === "records" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Date/Time</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Caller</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Callee</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Direction</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Duration</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((r, i) => (
                    <tr key={r.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                      <td className="px-4 py-3 text-gray-600">
                        {new Date(r.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.caller}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.callee}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.direction === "inbound"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}>
                          {r.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.status === "answered" ? "bg-green-50 text-green-700"
                            : r.status === "missed" ? "bg-red-50 text-red-700"
                            : r.status === "voicemail" ? "bg-amber-50 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatDuration(r.duration)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">R{(r.duration * 0.01).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 100 && (
                <div className="px-4 py-3 bg-gray-50 text-sm text-gray-500 text-center">
                  Showing 100 of {filtered.length} records. Export CSV for full data.
                </div>
              )}
              {filtered.length === 0 && (
                <div className="px-4 py-12 text-center text-gray-400">
                  No records match your filters.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
