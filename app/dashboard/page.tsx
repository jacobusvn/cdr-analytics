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
  const [activeTab, setActiveTab] = useState<"analytics" | "records">("analytics");
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

    // Default date range: last 30 days
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
    // Reset file input
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

  // Analytics computations
  const totalCalls = filtered.length;
  const answeredCalls = filtered.filter((r) => r.status === "answered").length;
  const missedCalls = filtered.filter((r) => r.status === "missed").length;
  const totalDuration = filtered.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = answeredCalls > 0 ? Math.round(totalDuration / answeredCalls) : 0;
  const totalCost = filtered.reduce((sum, r) => sum + r.cost, 0);
  const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

  // Charts data
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

  // Calls per day for line chart
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

  // Hourly distribution
  const hourlyMap = new Array(24).fill(0);
  filtered.forEach((r) => {
    const h = new Date(r.timestamp).getHours();
    if (!isNaN(h)) hourlyMap[h]++;
  });
  const hourlyData = hourlyMap.map((count, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    calls: count,
  }));

  // Top callers
  const callerMap = new Map<string, number>();
  filtered.forEach((r) => {
    callerMap.set(r.caller, (callerMap.get(r.caller) || 0) + 1);
  });
  const topCallers = Array.from(callerMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([number, calls]) => ({ number, calls }));

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

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
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[
            { label: "Total Calls", value: totalCalls.toLocaleString(), color: "text-indigo-600" },
            { label: "Answered", value: answeredCalls.toLocaleString(), color: "text-green-600" },
            { label: "Missed", value: missedCalls.toLocaleString(), color: "text-red-600" },
            { label: "Answer Rate", value: `${answerRate}%`, color: answerRate >= 80 ? "text-green-600" : "text-amber-600" },
            { label: "Avg Duration", value: formatDuration(avgDuration), color: "text-blue-600" },
            { label: "Total Cost", value: `R${totalCost.toFixed(2)}`, color: "text-purple-600" },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 font-medium">{kpi.label}</p>
              <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Tab selector */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => setActiveTab("analytics")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "analytics" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            Analytics
          </button>
          <button onClick={() => setActiveTab("records")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "records" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            Call Records
          </button>
        </div>

        {activeTab === "analytics" && (
          <div className="space-y-6">
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

              {/* Hourly Distribution */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Hourly Distribution</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="calls" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Status Pie */}
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

              {/* Direction Pie */}
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

              {/* Top Callers */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Top Callers</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {topCallers.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 font-mono text-xs">{c.number}</span>
                      <span className="font-semibold text-indigo-600">{c.calls}</span>
                    </div>
                  ))}
                  {topCallers.length === 0 && (
                    <p className="text-sm text-gray-400">No data</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

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
                  {filtered.slice(0, 100).map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
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
                      <td className="px-4 py-3 text-right text-gray-600">R{r.cost.toFixed(2)}</td>
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
