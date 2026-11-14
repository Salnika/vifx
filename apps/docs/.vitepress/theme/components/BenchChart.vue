<script setup lang="ts">
// Horizontal bars comparing Metro and Vifx on the same measures. Each measure
// shows both values and the difference, colored by which tool comes out ahead.

interface BenchRow {
  label: string;
  metro: number;
  vifx: number;
  /** Overrides the chart's unit for this row. */
  unit?: string;
  /** Overrides the chart's number of decimals for this row. */
  decimals?: number;
  /**
   * The difference in percent, when the shown values are rounded and the
   * published difference was computed from the raw measurements.
   */
  delta?: number;
}

type Tone = "good" | "bad" | "level";

const props = withDefaults(
  defineProps<{
    rows: BenchRow[];
    caption?: string;
    unit?: string;
    decimals?: number;
    /** "chart": one scale for every row; "row": each row scaled on its own. */
    scale?: "chart" | "row";
    higherIsBetter?: boolean;
    /** A difference smaller than this percentage is shown as level. */
    levelWithin?: number;
  }>(),
  {
    caption: "",
    unit: "",
    decimals: 2,
    scale: "chart",
    higherIsBetter: false,
    levelWithin: 1,
  },
);

function chartMax(): number {
  return Math.max(...props.rows.flatMap((row) => [row.metro, row.vifx]));
}

function width(value: number, row: BenchRow): string {
  const top = props.scale === "row" ? Math.max(row.metro, row.vifx) : chartMax();
  const percent = top > 0 ? (value / top) * 100 : 0;
  return `${Math.max(percent, 1.5)}%`;
}

function format(value: number, row: BenchRow): string {
  const decimals = row.decimals ?? props.decimals;
  const number = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const unit = row.unit ?? props.unit;
  return unit ? `${number} ${unit}` : number;
}

function verdict(row: BenchRow): { text: string; tone: Tone } {
  const percent = row.delta ?? (row.metro === 0 ? 0 : ((row.vifx - row.metro) / row.metro) * 100);
  if (Math.abs(percent) < props.levelWithin) {
    return { text: "level", tone: "level" };
  }
  const vifxAhead = props.higherIsBetter ? percent > 0 : percent < 0;
  const sign = percent < 0 ? "−" : "+";
  return {
    text: `${sign}${Math.abs(percent).toFixed(1)} %`,
    tone: vifxAhead ? "good" : "bad",
  };
}
</script>

<template>
  <figure class="bench-chart">
    <figcaption v-if="caption" class="bench-chart__caption">{{ caption }}</figcaption>
    <div class="bench-chart__legend">
      <span class="bench-chart__key bench-chart__key--metro">Metro</span>
      <span class="bench-chart__key bench-chart__key--vifx">Vifx</span>
      <span class="bench-chart__hint">{{
        higherIsBetter ? "Higher is better" : "Lower is better"
      }}</span>
    </div>
    <div v-for="row in rows" :key="row.label" class="bench-chart__row">
      <div class="bench-chart__head">
        <span class="bench-chart__label">{{ row.label }}</span>
        <span :class="['bench-chart__delta', `bench-chart__delta--${verdict(row).tone}`]">{{
          verdict(row).text
        }}</span>
      </div>
      <div class="bench-chart__line">
        <span class="bench-chart__tool">Metro</span>
        <span class="bench-chart__track" aria-hidden="true">
          <span
            class="bench-chart__bar bench-chart__bar--metro"
            :style="{ width: width(row.metro, row) }"
          />
        </span>
        <span class="bench-chart__value">{{ format(row.metro, row) }}</span>
      </div>
      <div class="bench-chart__line">
        <span class="bench-chart__tool">Vifx</span>
        <span class="bench-chart__track" aria-hidden="true">
          <span
            class="bench-chart__bar bench-chart__bar--vifx"
            :style="{ width: width(row.vifx, row) }"
          />
        </span>
        <span class="bench-chart__value">{{ format(row.vifx, row) }}</span>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.bench-chart {
  margin: 20px 0;
  padding: 16px 20px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.bench-chart__caption {
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 15px;
  color: var(--vp-c-text-1);
}

.bench-chart__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.bench-chart__key::before {
  content: "";
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  border-radius: 3px;
  vertical-align: -1px;
}

.bench-chart__key--metro::before {
  background: var(--bench-metro);
}

.bench-chart__key--vifx::before {
  background: var(--bench-vifx);
}

.bench-chart__hint {
  margin-left: auto;
  font-style: italic;
}

.bench-chart__row {
  padding: 10px 0;
  border-top: 1px solid var(--vp-c-divider);
}

.bench-chart__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.bench-chart__delta {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  font-variant-numeric: tabular-nums;
}

.bench-chart__delta--good {
  color: var(--vp-c-green-1);
  background: var(--vp-c-green-soft);
}

.bench-chart__delta--bad {
  color: var(--vp-c-yellow-1);
  background: var(--vp-c-yellow-soft);
}

.bench-chart__delta--level {
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
}

.bench-chart__line {
  display: grid;
  grid-template-columns: 3.25rem 1fr 6.5rem;
  align-items: center;
  gap: 10px;
  margin: 3px 0;
  font-size: 13px;
}

.bench-chart__tool {
  color: var(--vp-c-text-2);
}

.bench-chart__track {
  height: 12px;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}

.bench-chart__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
}

.bench-chart__bar--metro {
  background: var(--bench-metro);
}

.bench-chart__bar--vifx {
  background: var(--bench-vifx);
}

.bench-chart__value {
  text-align: right;
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bench-chart {
  --bench-metro: color-mix(in srgb, var(--vp-c-text-2) 45%, transparent);
  --bench-vifx: linear-gradient(90deg, #22d3ee, #8b5cf6 55%, #ec4899);
}
</style>
