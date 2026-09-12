/** @jsxImportSource preact */

import {
  defineComponentRegistry,
  defineComponentSurface,
} from "@casys/mcp-view-components";
import {
  definePreactComponent,
  type PreactSurfaceComponentProps,
  type PreactSurfaceContext,
} from "@casys/mcp-view-components/preact";
import {
  ElementBody,
  ElementIdent,
  ElementProvenance,
  ElementSection,
  ElementVerdict,
  InlineCode,
  KeyValueList,
  MetricGrid,
  SemanticElement,
} from "@casys/mcp-view-components/preact/components";
import type { ComponentChild } from "preact";
import { QUALITY_UNAVAILABLE_REASON } from "../../../viewer-session.ts";
import type {
  DfmRawEnvelopeResult,
  DfmRawOverhangResult,
  DfmRawThicknessResult,
  DfmRawToolResult,
  DfmRecordedChecksResult,
  DfmZone,
} from "../../../viewer-session.ts";
import {
  type DfmResultsViewData,
  digitalThreadReasonSummaries,
  isRecordedChecks,
} from "./model.ts";

export const DFM_COMPONENT_KEYS = {
  measuredChecks: "dfm.measured-checks",
} as const;

type DfmComponentProps = PreactSurfaceComponentProps<DfmResultsViewData>;

interface Fact {
  readonly id: string;
  readonly label: string;
  readonly value: ComponentChild;
}

const MeasuredChecks = ({ data, context }: DfmComponentProps) => {
  const locale = context.hostContext.locale;
  if (isRecordedChecks(data)) {
    return <RecordedChecksCard data={data} locale={locale} />;
  }
  return <RawCheckCard data={data} locale={locale} />;
};

function RecordedChecksCard(
  { data, locale }: {
    readonly data: DfmRecordedChecksResult;
    readonly locale: string | undefined;
  },
) {
  const envelopeFail = data.envelope.violations.length > 0;
  return (
    <SemanticElement
      className="dfm-result-card"
      reference={{
        domain: "dfm",
        kind: data.kind,
        id: data.capture.fingerprint.slice("sha256:".length),
        basisFingerprint: data.capture.fingerprint.slice("sha256:".length),
      }}
      density="card"
      tone={data.evaluations.status === "fail" ? "warning" : "info"}
      ident={
        <ElementIdent
          marker="Digital Thread"
          label="Recorded measured checks"
          detail="Digital Thread-owned evaluations · provider does not declare manufacturable"
        />
      }
      verdict={
        <ElementVerdict
          label="Digital Thread evaluations"
          value={data.evaluations.status}
        />
      }
      body={
        <ElementBody>
          <CheckSection
            title="Envelope"
            locale={locale}
            metrics={[
              metric(
                "x",
                "Measured X",
                data.envelope.measured.xMm,
                "mm",
                locale,
              ),
              metric(
                "y",
                "Measured Y",
                data.envelope.measured.yMm,
                "mm",
                locale,
              ),
              metric(
                "z",
                "Measured Z",
                data.envelope.measured.zMm,
                "mm",
                locale,
              ),
              metric(
                "volume",
                "Measured volume",
                data.envelope.measured.volumeMm3,
                "mm³",
                locale,
              ),
            ]}
            facts={[
              {
                id: "declared-volume",
                label: "Declared build volume",
                value: `${formatNumber(data.envelope.declaredVolumeMm.x, locale)} × ${
                  formatNumber(data.envelope.declaredVolumeMm.y, locale)
                } × ${formatNumber(data.envelope.declaredVolumeMm.z, locale)} mm`,
              },
              {
                id: "dt-envelope",
                label: "Digital Thread verdict",
                value: data.evaluations.verdicts[0]?.status ?? "unavailable",
              },
              {
                id: "dt-envelope-reasons",
                label: "Digital Thread reasons",
                value: digitalThreadReasonSummaries(
                  data.evaluations.verdicts[0],
                ),
              },
              {
                id: "raw-envelope",
                label: "Raw provider violations",
                value: envelopeFail
                  ? data.envelope.violations.map((item) =>
                    `${item.axis.toUpperCase()} ${
                      formatNumber(item.measured_mm, locale)
                    } > ${formatNumber(item.limit_mm, locale)} mm`
                  ).join("; ")
                  : "none",
              },
              qualityFact("volume-status", "Volume status"),
              qualityFact("mesh-topology", "Mesh topology"),
            ]}
            evidence={data.envelope.notChecked}
          />
          <CheckSection
            title="Minimum thickness"
            locale={locale}
            metrics={[
              metric(
                "min-thickness",
                "Measured minimum",
                data.thickness.measured.minThicknessMm,
                "mm",
                locale,
                `threshold ${formatNumber(data.thickness.thresholdMm, locale)} mm`,
              ),
              metric(
                "samples",
                "Samples",
                data.thickness.measured.sampleCount,
                undefined,
                locale,
                `${
                  formatCount(data.thickness.measured.validRayCount, locale)
                } valid rays`,
              ),
            ]}
            facts={[
              {
                id: "dt-thickness",
                label: "Digital Thread verdict",
                value: data.evaluations.verdicts[1]?.status ?? "unavailable",
              },
              {
                id: "dt-thickness-reasons",
                label: "Digital Thread reasons",
                value: digitalThreadReasonSummaries(
                  data.evaluations.verdicts[1],
                ),
              },
              {
                id: "raw-thickness",
                label: "Raw provider violations",
                value: data.thickness.violations.length > 0
                  ? zoneSummary(data.thickness.violations, locale)
                  : "none",
              },
              qualityFact("min-status", "Minimum thickness status"),
              qualityFact("ray-coverage", "Ray coverage"),
            ]}
            evidence={data.thickness.notChecked}
          />
          <CheckSection
            title="Overhangs"
            locale={locale}
            metrics={[
              metric(
                "overhang-area",
                "Overhang area",
                data.overhang.measured.overhangAreaMm2,
                "mm²",
                locale,
              ),
              metric(
                "threshold",
                "Declared threshold",
                data.overhang.thresholdDeg,
                "°",
                locale,
                `build direction [${
                  data.overhang.buildDirection.map((item) => formatNumber(item, locale))
                    .join(", ")
                }]`,
              ),
            ]}
            facts={[
              {
                id: "dt-overhangs",
                label: "Digital Thread verdict",
                value: data.evaluations.verdicts[2]?.status ?? "unavailable",
              },
              {
                id: "dt-overhangs-reasons",
                label: "Digital Thread reasons",
                value: digitalThreadReasonSummaries(
                  data.evaluations.verdicts[2],
                ),
              },
              {
                id: "raw-overhangs",
                label: "Raw provider zones",
                value: zoneSummary(data.overhang.violations, locale),
              },
              {
                id: "zmin",
                label: "Declared Z-min filter",
                value: zMinSummary(data, locale),
              },
            ]}
            evidence={data.overhang.notChecked}
          />
          <ElementSection title="Limitations">
            <Expandable
              summary={`${data.limitations.length} recorded limitations`}
              items={data.limitations}
            />
          </ElementSection>
        </ElementBody>
      }
      provenance={
        <ElementProvenance
          label="Capture"
          value={data.capture.fingerprint}
        />
      }
    />
  );
}

function RawCheckCard(
  { data, locale }: {
    readonly data: DfmRawToolResult;
    readonly locale: string | undefined;
  },
) {
  return (
    <SemanticElement
      className="dfm-result-card"
      reference={{
        domain: "dfm",
        kind: data.kind,
        id: data.inputArtifact.sha256,
        basisFingerprint: data.inputArtifact.sha256,
      }}
      density="card"
      ident={
        <ElementIdent
          marker="Tool result"
          label={rawTitle(data)}
          detail="Single measured check · no whole-case verdict"
        />
      }
      body={
        <ElementBody>
          {data.kind === "dfm-envelope-raw" && (
            <RawEnvelope data={data} locale={locale} />
          )}
          {data.kind === "dfm-min-thickness-raw" && (
            <RawThickness data={data} locale={locale} />
          )}
          {data.kind === "dfm-overhangs-raw" && (
            <RawOverhang data={data} locale={locale} />
          )}
        </ElementBody>
      }
      provenance={
        <ElementProvenance
          label="Input SHA-256"
          value={`sha256:${data.inputArtifact.sha256}`}
        />
      }
    />
  );
}

function RawEnvelope(
  { data, locale }: {
    readonly data: DfmRawEnvelopeResult;
    readonly locale: string | undefined;
  },
) {
  return (
    <CheckSection
      title="Envelope"
      locale={locale}
      metrics={[
        metric("x", "Measured X", data.measured.xMm, "mm", locale),
        metric("y", "Measured Y", data.measured.yMm, "mm", locale),
        metric("z", "Measured Z", data.measured.zMm, "mm", locale),
        metric(
          "volume",
          "Measured volume",
          data.measured.volumeMm3,
          "mm³",
          locale,
        ),
      ]}
      facts={[
        {
          id: "declared",
          label: "Declared build volume",
          value: `${formatNumber(data.declaredVolumeMm.x, locale)} × ${
            formatNumber(data.declaredVolumeMm.y, locale)
          } × ${formatNumber(data.declaredVolumeMm.z, locale)} mm`,
        },
        {
          id: "raw",
          label: "Raw provider violations",
          value: data.violations.length === 0
            ? "none"
            : data.violations.map((item) =>
              `${item.axis.toUpperCase()} ${formatNumber(item.measured_mm, locale)} > ${
                formatNumber(item.limit_mm, locale)
              } mm`
            ).join("; "),
        },
        qualityValue("volume-status", "Volume status", data.volumeStatus),
        qualityValue("mesh-topology", "Mesh topology", data.meshTopology),
      ]}
      evidence={data.notChecked}
    />
  );
}

function RawThickness(
  { data, locale }: {
    readonly data: DfmRawThicknessResult;
    readonly locale: string | undefined;
  },
) {
  return (
    <CheckSection
      title="Minimum thickness"
      locale={locale}
      metrics={[
        {
          id: "min-thickness",
          label: "Measured minimum",
          value: data.measured.minThicknessMm === null
            ? "unavailable"
            : formatNumber(data.measured.minThicknessMm, locale),
          unit: data.measured.minThicknessMm === null ? undefined : "mm",
          detail: `threshold ${formatNumber(data.thresholdMm, locale)} mm`,
        },
        metric(
          "samples",
          "Samples",
          data.measured.sampleCount,
          undefined,
          locale,
          `${formatCount(data.measured.validRayCount, locale)} valid rays`,
        ),
      ]}
      facts={[
        {
          id: "raw",
          label: "Raw provider violations",
          value: zoneSummary(data.violations, locale),
        },
        qualityValue(
          "min-status",
          "Minimum thickness status",
          data.minimumThicknessStatus,
        ),
        qualityValue("ray-coverage", "Ray coverage", data.rayCoverage),
      ]}
      evidence={data.notChecked}
    />
  );
}

function RawOverhang(
  { data, locale }: {
    readonly data: DfmRawOverhangResult;
    readonly locale: string | undefined;
  },
) {
  return (
    <CheckSection
      title="Overhangs"
      locale={locale}
      metrics={[
        metric(
          "overhang-area",
          "Overhang area",
          data.measured.overhangAreaMm2,
          "mm²",
          locale,
        ),
        metric(
          "threshold",
          "Declared threshold",
          data.thresholdDeg,
          "°",
          locale,
          `build direction [${
            data.buildDirection.map((item) => formatNumber(item, locale)).join(
              ", ",
            )
          }]`,
        ),
      ]}
      facts={[
        {
          id: "raw",
          label: "Raw provider zones",
          value: zoneSummary(data.violations, locale),
        },
        qualityValue("mesh-topology", "Mesh topology", data.meshTopology),
      ]}
      evidence={data.notChecked}
    />
  );
}

function CheckSection({
  title,
  metrics,
  facts,
  evidence,
}: {
  readonly title: string;
  readonly locale: string | undefined;
  readonly metrics: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly unit?: string;
    readonly detail?: string;
  }[];
  readonly facts: readonly Fact[];
  readonly evidence: readonly string[];
}) {
  return (
    <ElementSection title={title}>
      <MetricGrid className="dfm-check-readings" items={[...metrics]} />
      <KeyValueList layout="facts" items={facts} />
      <Expandable summary="Evidence and not-checked limits" items={evidence} />
    </ElementSection>
  );
}

function Expandable(
  { summary, items }: {
    readonly summary: string;
    readonly items: readonly string[];
  },
) {
  if (items.length === 0) {
    return <p class="dfm-empty-evidence">No additional evidence recorded.</p>;
  }
  return (
    <details class="dfm-evidence">
      <summary>{summary}</summary>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </details>
  );
}

export const DFM_RESULTS_SURFACE = defineComponentSurface({
  layout: { type: "stack", gap: "none" },
  components: [
    {
      id: "measured-checks",
      component: DFM_COMPONENT_KEYS.measuredChecks,
    },
  ],
});

export const DFM_COMPONENT_REGISTRY = defineComponentRegistry<
  DfmResultsViewData,
  PreactSurfaceContext<DfmResultsViewData>
>({
  components: {
    [DFM_COMPONENT_KEYS.measuredChecks]: definePreactComponent(
      {
        title: "Measured checks",
        description:
          "Envelope, thickness and overhang measurements with Digital Thread-owned evaluations or a single raw tool result.",
      },
      MeasuredChecks,
    ),
  },
  defaultSurface: DFM_RESULTS_SURFACE,
});

function formatNumber(value: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 5 }).format(
    value,
  );
}

function formatCount(value: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale).format(value);
}

function metric(
  id: string,
  label: string,
  value: number,
  unit: string | undefined,
  locale: string | undefined,
  detail?: string,
) {
  return {
    id,
    label,
    value: formatNumber(value, locale),
    unit,
    detail,
  };
}

function qualityFact(id: string, label: string): Fact {
  return {
    id,
    label,
    value: QUALITY_UNAVAILABLE_REASON,
  };
}

function qualityValue(
  id: string,
  label: string,
  quality: { readonly status: "unavailable"; readonly reason: string } | {
    readonly status: "available";
    readonly value: unknown;
  },
): Fact {
  if (quality.status === "unavailable") {
    return { id, label, value: quality.reason };
  }
  if (typeof quality.value === "string") {
    return { id, label, value: quality.value };
  }
  return { id, label, value: <InlineCode>available</InlineCode> };
}

function zoneSummary(
  zones: readonly DfmZone[],
  locale: string | undefined,
): string {
  if (zones.length === 0) return "none";
  return `${formatCount(zones.length, locale)} zone(s): ${
    zones.map((zone) =>
      `${formatNumber(zone.area_mm2, locale)} mm² at [${
        zone.centroid_mm.map((item) => formatNumber(item, locale)).join(", ")
      }]`
    ).join("; ")
  }`;
}

function zMinSummary(
  data: DfmRecordedChecksResult,
  locale: string | undefined,
): string {
  const filter = data.zMinFilter;
  if (!filter.declared.enabled) {
    return "declared disabled; raw overhang zones are unfiltered";
  }
  return `${filter.applied ? "applied" : "not applied"} at Z ${
    formatNumber(filter.declared.planeZMm.value, locale)
  } mm ± ${formatNumber(filter.declared.toleranceMm.value, locale)} mm · ${
    formatCount(filter.filtered.length, locale)
  } filtered as bed contact · ${
    formatCount(filter.remaining.length, locale)
  } remaining`;
}

function rawTitle(data: DfmRawToolResult): string {
  if (data.kind === "dfm-envelope-raw") return "Envelope measurement";
  if (data.kind === "dfm-min-thickness-raw") {
    return "Minimum thickness measurement";
  }
  return "Overhang measurement";
}
