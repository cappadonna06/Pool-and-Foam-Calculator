"use client";

import React, { useMemo, useState } from "react";

// Maintenance Hydration protocol
// Run time: 5 min per zone, sequentially; then a break depending on # zones.
// Breaks (minutes): 1→30, 2→25, 3→20, 4→15, 5→10, 6→5, 7→2, 8→2, 9→2

const MAX_ZONES = 9;
const MAX_SYSTEMS = 5;

const BREAK_MAP: Record<number, number> = {
  1: 30,
  2: 25,
  3: 20,
  4: 15,
  5: 10,
  6: 5,
  7: 2,
  8: 2,
  9: 2
};

const FOAM_TANK_OPTIONS = [25, 50, 100, 150];
const FOAM_DEFAULT = 50;
const FOAM_MIX_RATIO = 0.0025; // 0.25%

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeSystem(zones: number, gpmValues: number[]) {
  const z = clamp(zones || 1, 1, MAX_ZONES);
  const breakMin = BREAK_MAP[z];
  const runPerZoneMin = 5;

  const activeGpm = gpmValues
    .slice(0, z)
    .map((g) => (isFinite(g) && g >= 0 ? g : 0));

  const totalRunMin = runPerZoneMin * z;
  const totalGallonsPerCycle =
    runPerZoneMin * activeGpm.reduce((sum, g) => sum + g, 0);
  const cycleMin = totalRunMin + breakMin;

  const dutyCycle = cycleMin > 0 ? totalRunMin / cycleMin : 0;
  const avgGpm = cycleMin > 0 ? totalGallonsPerCycle / cycleMin : 0;

  return {
    z,
    breakMin,
    runPerZoneMin,
    totalRunMin,
    totalGallonsPerCycle,
    cycleMin,
    dutyCycle,
    avgGpm,
    activeGpm
  };
}

function computeFoamRuntime(avgGpm: number, foamTankGallons: number) {
  const avgUseGpm = Math.max(0, avgGpm || 0);
  const foamTank = Math.max(0, Number(foamTankGallons) || 0);

  if (!foamTank || !avgUseGpm) {
    return { foamUseGpm: 0, minutes: null as number | null, label: "N/A" };
  }

  const foamUseGpm = avgUseGpm * FOAM_MIX_RATIO;
  if (foamUseGpm <= 0) return { foamUseGpm, minutes: null, label: "N/A" };

  const minutes = foamTank / foamUseGpm;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes - hours * 60);

  return {
    foamUseGpm,
    minutes,
    label: `${hours}h ${mins}m`
  };
}

type SystemConfig = {
  zones: number;
  gpmValues: number[];
  foamTankGallons: number;
};

export default function Page() {
  const [systemCount, setSystemCount] = useState<number>(1);

  const [systems, setSystems] = useState<SystemConfig[]>(() =>
    Array.from({ length: MAX_SYSTEMS }, () => ({
      zones: 6,
      gpmValues: Array.from({ length: MAX_ZONES }, () => 20),
      foamTankGallons: FOAM_DEFAULT
    }))
  );

  // Backup water source
  const [sourceGallons, setSourceGallons] = useState<number>(20000);
  const [sourceRefillGpm, setSourceRefillGpm] = useState<number>(0);

  // Pool / tank helper
  const [poolShape, setPoolShape] = useState<"rect" | "circle">("rect");
  const [poolLength, setPoolLength] = useState<number>(30);
  const [poolWidth, setPoolWidth] = useState<number>(15);
  const [poolDiameter, setPoolDiameter] = useState<number>(20);
  const [poolShallow, setPoolShallow] = useState<number>(3.5);
  const [poolDeep, setPoolDeep] = useState<number>(6);

  // Collapsibles
  const [showSourceDetails, setShowSourceDetails] = useState<boolean>(false);
  const [showFoamDetails, setShowFoamDetails] = useState<boolean>(false);

  // Per-system math
  const systemStats = useMemo(
    () => systems.map((s) => computeSystem(s.zones, s.gpmValues)),
    [systems]
  );

  const activeCount = clamp(systemCount, 1, MAX_SYSTEMS);
  const activeStats = useMemo(
    () => systemStats.slice(0, activeCount),
    [systemStats, activeCount]
  );

  // Combined average demand
  const totalAvgGpm = useMemo(
    () => activeStats.reduce((sum, s) => sum + s.avgGpm, 0),
    [activeStats]
  );

  // Pool / tank volume helper
  const poolGallons = useMemo(() => {
    const shallow = Math.max(0, Number(poolShallow) || 0);
    const deep = Math.max(0, Number(poolDeep) || 0);
    const avgDepth = (shallow + deep) / 2;
    if (!isFinite(avgDepth) || avgDepth <= 0) return 0;

    const G_PER_FT3 = 7.48;

    if (poolShape === "rect") {
      const L = Math.max(0, Number(poolLength) || 0);
      const W = Math.max(0, Number(poolWidth) || 0);
      if (!L || !W) return 0;
      return Math.round(L * W * avgDepth * G_PER_FT3);
    } else {
      const D = Math.max(0, Number(poolDiameter) || 0);
      if (!D) return 0;
      const r = D / 2;
      return Math.round(Math.PI * r * r * avgDepth * G_PER_FT3);
    }
  }, [poolShape, poolLength, poolWidth, poolDiameter, poolShallow, poolDeep]);

  // Backup water runtime (all active systems)
  const sharedRuntime = useMemo(() => {
    const avgUseGpm = Math.max(0, totalAvgGpm || 0);
    const refill = Math.max(0, Number(sourceRefillGpm) || 0);
    const vol = Math.max(0, Number(sourceGallons) || 0);
    const netDraw = avgUseGpm - refill;

    if (!vol || !avgUseGpm) {
      return {
        netDraw,
        label: "N/A",
        minutes: null as number | null
      };
    }
    if (netDraw <= 0) {
      return {
        netDraw,
        label: "Unlimited (refill ≥ total demand)",
        minutes: null as number | null
      };
    }

    const minutes = vol / netDraw;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes - hours * 60);

    return {
      netDraw,
      minutes,
      label: `${hours}h ${mins}m`
    };
  }, [totalAvgGpm, sourceGallons, sourceRefillGpm]);

  // Foam runtimes per active system
  const foamRuntimes = useMemo(
    () =>
      activeStats.map((s, i) =>
        computeFoamRuntime(s.avgGpm, systems[i].foamTankGallons)
      ),
    [activeStats, systems]
  );

  // --- Actions ---
  const updateSystem = (index: number, patch: Partial<SystemConfig>) => {
    setSystems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const setAllZonesGpm = (index: number, value: number) => {
    setSystems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        gpmValues: Array.from({ length: MAX_ZONES }, () => value)
      };
      return next;
    });
  };

  const updateZoneGpm = (
    systemIndex: number,
    zoneIndex: number,
    value: number
  ) => {
    setSystems((prev) => {
      const next = [...prev];
      const sys = next[systemIndex];
      const g = [...sys.gpmValues];
      g[zoneIndex] = isFinite(value) && value >= 0 ? value : 0;
      next[systemIndex] = { ...sys, gpmValues: g };
      return next;
    });
  };

  const applyPoolToSource = () => {
    if (poolGallons && isFinite(poolGallons)) {
      setSourceGallons(poolGallons);
      setShowSourceDetails(true);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 flex items-start justify-center p-6">
      <div className="w-full max-w-6xl space-y-6">
        {/* TITLE */}
        <header className="space-y-1 flex flex-col gap-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Back-up Water & Foam Runtime Calculator
            </h1>
            <p className="text-sm text-slate-600">
              Configure up to 5 systems, a backup water source, and individual foam
              tanks to understand continuous runtime capacity.
            </p>
          </div>
        </header>

        {/* SYSTEM CONFIGURATION BLOCK + BACKUP SOURCE CARD */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">
            System and Back-up Water Source Configuration
          </h2>
          <p className="text-[10px] text-slate-600">
            Configure each system and the backup water source. Foam tank size is set
            per system. If multiple systems are configured, they are assumed to draw
            from the same backup source. Detailed per-zone GPM editors are below.
          </p>
          <div className="flex items-center gap-2 mt-1 text-[10px]">
            <span className="uppercase text-slate-500 font-semibold">
              Number of systems
            </span>
            <select
              value={activeCount}
              onChange={(e) =>
                setSystemCount(
                  clamp(parseInt(e.target.value || "1", 10), 1, MAX_SYSTEMS)
                )
              }
              className="rounded-md bg-white border border-slate-300 px-2 py-1 text-[10px] shadow-sm"
            >
              {Array.from({ length: MAX_SYSTEMS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {/* Backup water source card */}
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                Backup Water Source
              </div>
              <div className="space-y-1 text-[10px] text-slate-700">
                <label className="block text-[9px] font-semibold uppercase text-slate-500">
                  Volume (gal)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={sourceGallons}
                  onChange={(e) =>
                    setSourceGallons(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full rounded-md bg-white border border-sky-200 px-2 py-1.5 text-[11px]"
                />
              </div>
              <div className="space-y-1 text-[10px] text-slate-700">
                <label className="block text-[9px] font-semibold uppercase text-slate-500">
                  Refill (GPM)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={sourceRefillGpm}
                  onChange={(e) =>
                    setSourceRefillGpm(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full rounded-md bg-white border border-sky-200 px-2 py-1.5 text-[11px]"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowSourceDetails((v) => !v)}
                className="mt-2 px-3 py-1.5 rounded-md border border-sky-300 text-sky-800 bg-white hover:bg-sky-50 text-[9px] font-medium inline-flex items-center gap-1"
              >
                {showSourceDetails ? (
                  <>
                    <span>Hide pool / tank helper</span>
                    <span>▲</span>
                  </>
                ) : (
                  <>
                    <span>Show pool / tank helper</span>
                    <span>▼</span>
                  </>
                )}
              </button>
              <p className="text-[9px] text-slate-500 mt-1">
                If multiple systems are configured, this assumes they all draw from
                this same backup source.
              </p>
            </div>

            {/* System cards */}
            {Array.from({ length: activeCount }, (_, sIdx) => {
              const stats = activeStats[sIdx];
              const cfg = systems[sIdx];
              const all20 = cfg.gpmValues
                .slice(0, cfg.zones)
                .every((v) => v === 20);

              return (
                <div
                  key={sIdx}
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-700">
                        System {sIdx + 1}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Avg flow: {stats.avgGpm.toFixed(2)} GPM
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[10px]">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Zones</span>
                      <input
                        type="range"
                        min={1}
                        max={MAX_ZONES}
                        value={cfg.zones}
                        onChange={(e) =>
                          updateSystem(sIdx, {
                            zones: clamp(
                              parseInt(e.target.value, 10),
                              1,
                              MAX_ZONES
                            )
                          })
                        }
                        className="w-24"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-slate-500">
                        # of Zones
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={MAX_ZONES}
                        value={cfg.zones}
                        onChange={(e) =>
                          updateSystem(sIdx, {
                            zones: clamp(
                              parseInt(e.target.value || "1", 10),
                              1,
                              MAX_ZONES
                            )
                          })
                        }
                        className="w-16 rounded-md bg-slate-50 border border-slate-300 px-2 py-1 text-[10px]"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-slate-500">
                        Set all zones to (GPM)
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        placeholder="e.g. 20"
                        className="w-24 rounded-md bg-slate-50 border border-slate-300 px-2 py-1 text-[10px]"
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value || "0");
                          if (v > 0) setAllZonesGpm(sIdx, v);
                        }}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => setAllZonesGpm(sIdx, 20)}
                      className={
                        "px-2 py-1 h-8 self-end rounded-md border text-[9px] " +
                        (all20
                          ? "border-emerald-400 bg-emerald-50 text-emerald-700 font-semibold"
                          : "border-slate-300 text-slate-700 bg-slate-50 hover:bg-slate-100")
                      }
                    >
                      All 20 GPM
                    </button>
                  </div>

                  <div className="mt-1 text-[10px]">
                    <div className="font-semibold text-slate-700">Foam tank</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <select
                        value={systems[sIdx].foamTankGallons}
                        onChange={(e) =>
                          updateSystem(sIdx, {
                            foamTankGallons: Math.max(
                              0,
                              Number(e.target.value) || 0
                            )
                          })
                        }
                        className="w-full max-w-[150px] rounded-md bg-white border border-slate-300 px-2 py-1.5 text-[11px]"
                      >
                        <option value={0}>No foam</option>
                        {FOAM_TANK_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size} gal{size === FOAM_DEFAULT ? " (std)" : ""}
                          </option>
                        ))}
                      </select>
                      <span className="text-slate-500">
                        0.25% mix when foam is on
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 text-[9px] text-slate-500">
                    Set individual zone flow rates in the section below if you need
                    more granularity.
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* KEY RUNTIME SUMMARY */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Key Runtime Summary
          </h2>
          <p className="text-[10px] text-slate-600">
            Primary takeaways: how long the backup water lasts, and how long foam
            lasts for each system based on its tank setting.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3">
            <HighlightCard
              variant="water"
              title="Backup water runtime"
              value={sharedRuntime.label}
              subtitle={
                sharedRuntime.netDraw > 0
                  ? `Net draw ${sharedRuntime.netDraw.toFixed(2)} GPM`
                  : sharedRuntime.label === "N/A"
                  ? "Enter source & flows to calculate"
                  : "Refill ≥ total demand (no drawdown)"
              }
            />
            {foamRuntimes.map((foam, i) => {
              const tank = systems[i].foamTankGallons;
              const hasFoam = tank > 0;
              const value = hasFoam ? foam.label : "No foam";
              const subtitle = hasFoam
                ? `Tank ${tank} gal · Foam use ${foam.foamUseGpm.toFixed(3)} GPM`
                : "No foam configured for this system";
              return (
                <HighlightCard
                  key={i}
                  variant="foam"
                  title={`Foam runtime – System ${i + 1}`}
                  value={value}
                  subtitle={subtitle}
                />
              );
            })}
            <HighlightCard
              variant="neutral"
              title="Total average system flow"
              value={`${totalAvgGpm.toFixed(2)} GPM`}
              subtitle={`Sum of ${activeCount} system(s)`}
            />
          </div>
        </section>

        {/* PER-ZONE GPM EDITORS */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Detailed Per-Zone GPM Editors
          </h2>
          <p className="text-[10px] text-slate-600">
            Fine-tune each zone's GPM to reflect actual installed loads. These values
            drive the average flow and all runtime calculations above.
          </p>
          <div className="space-y-3">
            {Array.from({ length: activeCount }, (_, sIdx) => {
              const stats = activeStats[sIdx];
              const cfg = systems[sIdx];
              return (
                <div
                  key={sIdx}
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2"
                >
                  <div className="text-[10px] font-semibold text-slate-700 mb-1">
                    System {sIdx + 1} – {stats.z} zones · Avg{" "}
                    {stats.avgGpm.toFixed(2)} GPM · Duty{" "}
                    {(stats.dutyCycle * 100).toFixed(1)}%
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {Array.from({ length: stats.z }, (_, zIdx) => (
                      <div key={zIdx} className="flex flex-col gap-1">
                        <span className="text-[9px] uppercase tracking-wide text-slate-500">
                          S{sIdx + 1}-Z{zIdx + 1}
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={cfg.gpmValues[zIdx] ?? 0}
                          onChange={(e) =>
                            updateZoneGpm(
                              sIdx,
                              zIdx,
                              parseFloat(e.target.value || "0")
                            )
                          }
                          className="w-full rounded-md bg-slate-50 border border-slate-300 px-2 py-1 text-[11px]"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-1 text-[9px] text-slate-600">
                    <div>
                      <div className="font-semibold text-slate-700">Break</div>
                      <div>{stats.breakMin} min</div>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-700">
                        Cycle length
                      </div>
                      <div>{stats.cycleMin} min</div>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-700">
                        Duty cycle
                      </div>
                      <div>{(stats.dutyCycle * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* POOL / TANK HELPER & WATER MATH (COLLAPSIBLE) */}
        <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              Pool / Tank Volume Helper & Water Math
            </h2>
            <button
              className="text-[10px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
              onClick={() => setShowSourceDetails((v) => !v)}
            >
              {showSourceDetails ? (
                <>
                  <span>Hide details</span>
                  <span>▲</span>
                </>
              ) : (
                <>
                  <span>Show details</span>
                  <span>▼</span>
                </>
              )}
            </button>
          </div>

          {!showSourceDetails && (
            <p className="text-[10px] text-slate-600">
              Use this helper to estimate pool or tank gallons from dimensions and
              push that volume into the backup water source. Click "Show details" to
              expand.
            </p>
          )}

          {showSourceDetails && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-slate-700">
              <div className="space-y-1">
                <div className="font-semibold text-slate-800">
                  Water source math (all active systems)
                </div>
                <p>
                  Total avg demand = sum of each system&apos;s avg GPM. Net draw =
                  total demand − refill. Runtime = source gallons ÷ net draw when net
                  draw &gt; 0.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-600">
                  <li>Total avg demand: {totalAvgGpm.toFixed(2)} GPM</li>
                  <li>Refill: {sourceRefillGpm.toFixed(2)} GPM</li>
                  <li>Net draw: {sharedRuntime.netDraw.toFixed(2)} GPM</li>
                  <li>Backup runtime: {sharedRuntime.label}</li>
                </ul>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-slate-800">
                  Pool / tank volume
                </div>
                <p className="text-slate-600">
                  Estimate a pool or tank volume with average depth and apply it to
                  the backup water source.
                </p>
                <div className="flex items-center gap-3 text-[10px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={poolShape === "rect"}
                      onChange={() => setPoolShape("rect")}
                    />
                    Rectangular
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={poolShape === "circle"}
                      onChange={() => setPoolShape("circle")}
                    />
                    Circular
                  </label>
                </div>

                {poolShape === "rect" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Length (ft)"
                      value={poolLength}
                      onChange={setPoolLength}
                    />
                    <NumberField
                      label="Width (ft)"
                      value={poolWidth}
                      onChange={setPoolWidth}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Diameter (ft)"
                      value={poolDiameter}
                      onChange={setPoolDiameter}
                    />
                    <div className="flex items-end text-[9px] text-slate-500">
                      Uses πr² × avg depth
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 mt-1">
                  <NumberField
                    label="Shallow depth (ft)"
                    value={poolShallow}
                    onChange={setPoolShallow}
                  />
                  <NumberField
                    label="Deep depth (ft)"
                    value={poolDeep}
                    onChange={setPoolDeep}
                  />
                </div>

                <div className="flex items-baseline justify-between gap-2 mt-2">
                  <div>
                    <div className="text-[10px] text-slate-500">
                      Estimated volume
                    </div>
                    <div className="text-lg font-semibold text-slate-900">
                      {poolGallons ? poolGallons.toLocaleString() : "0"}
                      <span className="text-[9px] text-slate-500 ml-1">
                        gal
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={applyPoolToSource}
                    disabled={!poolGallons}
                    className="px-3 py-1.5 rounded-full text-[9px] border border-slate-300 text-slate-800 bg-slate-50 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Use as backup source
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* FOAM MATH & ASSUMPTIONS (OPTIONAL) */}
        {showFoamDetails && (
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 text-[11px] text-slate-700">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">
                Foam Math & Assumptions
              </h2>
              <button
                className="text-[10px] text-slate-500 hover:text-slate-800"
                onClick={() => setShowFoamDetails(false)}
              >
                Close
              </button>
            </div>
            <p>
              Foam concentrate is injected at 0.25% of each system&apos;s average
              solution flow. Each foam runtime is calculated independently from its
              own tank and does not depend on the backup water volume.
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-600">
              {activeStats.map((s, i) => {
                const foam = foamRuntimes[i];
                const tank = systems[i].foamTankGallons;
                if (tank <= 0) {
                  return (
                    <li key={i}>System {i + 1}: No foam configured.</li>
                  );
                }
                return (
                  <li key={i}>
                    System {i + 1}: Qavg = {s.avgGpm.toFixed(2)} GPM → foam use =
                    {` ${foam.foamUseGpm.toFixed(3)} `}GPM → runtime = {foam.label}.
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <footer className="pt-1 text-[9px] text-slate-500">
          For more than {MAX_SYSTEMS} systems, extend the same pattern: sum all
          average flows for backup water runtime; compute each foam runtime from its
          own tank.
        </footer>
      </div>
    </div>
  );
}

function HighlightCard({
  title,
  value,
  subtitle,
  variant = "neutral"
}: {
  title: string;
  value: string;
  subtitle?: string;
  variant?: "neutral" | "water" | "helper" | "foam";
}) {
  let base =
    "rounded-2xl p-4 flex flex-col justify-between shadow-sm border text-xs";
  let titleClass = "text-[10px] font-semibold uppercase tracking-wide";
  let valueClass = "mt-1 text-2xl md:text-3xl font-bold";
  let subtitleClass = "mt-1 text-[10px]";

  if (variant === "water") {
    base += " bg-emerald-50 border-emerald-200";
    titleClass += " text-emerald-700";
    valueClass += " text-emerald-800";
    subtitleClass += " text-emerald-700";
  } else if (variant === "helper") {
    base += " bg-sky-50 border-sky-200";
    titleClass += " text-sky-700";
    valueClass += " text-sky-800";
    subtitleClass += " text-sky-700";
  } else if (variant === "foam") {
    base += " bg-indigo-50 border-indigo-200";
    titleClass += " text-indigo-700";
    valueClass += " text-indigo-800";
    subtitleClass += " text-indigo-700";
  } else {
    base += " bg-white border-slate-200";
    titleClass += " text-slate-600";
    valueClass += " text-slate-900";
    subtitleClass += " text-slate-500";
  }

  return (
    <div className={base}>
      <div className={titleClass}>{title}</div>
      <div className={valueClass}>{value}</div>
      {subtitle && <div className={subtitleClass}>{subtitle}</div>}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block mb-1 text-[9px] text-slate-500">{label}</label>
      <input
        type="number"
        min={0}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full rounded-md bg-slate-50 border border-slate-300 px-2 py-1.5 text-[11px] text-slate-900"
      />
    </div>
  );
}
