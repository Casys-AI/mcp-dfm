/**
 * Exact View App manifest served next to the results-viewer HTML resource.
 */

import {
  VIEW_APP_MANIFEST_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "@casys/mcp-view-contracts";
import serializedViewAppManifest from "../ui/app-manifest.json" with {
  type: "json",
};
import {
  DFM_RESULT_SCHEMA_IDS,
  DFM_RESULTS_VIEWER_URI,
  DFM_VIEW_APP_ID,
  DFM_VIEW_APP_TITLE,
  DFM_VIEW_APP_VERSION,
  DFM_VIEWER_SESSION_SCHEMA,
} from "./identities.ts";
import { denseArray, exactRecord, literal } from "./json.ts";

export { VIEW_APP_MANIFEST_SCHEMA, VIEWER_SESSION_APPLY_ACTION };

export interface DfmViewAppManifest {
  readonly schemaVersion: typeof VIEW_APP_MANIFEST_SCHEMA;
  readonly app: {
    readonly id: typeof DFM_VIEW_APP_ID;
    readonly title: typeof DFM_VIEW_APP_TITLE;
    readonly version: typeof DFM_VIEW_APP_VERSION;
  };
  readonly resources: readonly [{
    readonly uri: typeof DFM_RESULTS_VIEWER_URI;
    readonly ownership: "whole-view";
    readonly resultSchemas: readonly string[];
    readonly acceptedActions: readonly [typeof VIEWER_SESSION_APPLY_ACTION];
    readonly sessionSchemas: readonly [typeof DFM_VIEWER_SESSION_SCHEMA];
  }];
}

export const DFM_VIEW_APP_MANIFEST: DfmViewAppManifest = parseDfmViewAppManifest(
  serializedViewAppManifest,
);

export const DFM_VIEW_APP_MANIFEST_JSON: string = `${
  JSON.stringify(DFM_VIEW_APP_MANIFEST)
}\n`;

function parseDfmViewAppManifest(value: unknown): DfmViewAppManifest {
  const root = exactRecord(
    value,
    ["schemaVersion", "app", "resources"],
    "DFM View App manifest",
  );
  literal(
    root.schemaVersion,
    VIEW_APP_MANIFEST_SCHEMA,
    "DFM View App manifest.schemaVersion",
  );
  const app = exactRecord(
    root.app,
    ["id", "title", "version"],
    "DFM View App manifest.app",
  );
  literal(app.id, DFM_VIEW_APP_ID, "DFM View App manifest.app.id");
  literal(app.title, DFM_VIEW_APP_TITLE, "DFM View App manifest.app.title");
  literal(
    app.version,
    DFM_VIEW_APP_VERSION,
    "DFM View App manifest.app.version",
  );
  const resources = denseArray(root.resources, "DFM View App manifest.resources");
  if (resources.length !== 1) {
    throw new TypeError(
      "DFM View App manifest.resources must contain exactly one whole view.",
    );
  }
  const resource = exactRecord(
    resources[0],
    [
      "uri",
      "ownership",
      "resultSchemas",
      "acceptedActions",
      "sessionSchemas",
    ],
    "DFM View App manifest.resources[0]",
  );
  literal(
    resource.uri,
    DFM_RESULTS_VIEWER_URI,
    "DFM View App manifest.resources[0].uri",
  );
  literal(
    resource.ownership,
    "whole-view",
    "DFM View App manifest.resources[0].ownership",
  );
  const expectedResultSchemas = Object.values(DFM_RESULT_SCHEMA_IDS);
  const resultSchemas = denseArray(
    resource.resultSchemas,
    "DFM View App manifest.resources[0].resultSchemas",
  );
  if (
    resultSchemas.length !== expectedResultSchemas.length ||
    resultSchemas.some((schema, index) => schema !== expectedResultSchemas[index])
  ) {
    throw new TypeError(
      "DFM View App manifest result schemas do not match the provider contracts.",
    );
  }
  const acceptedActions = denseArray(
    resource.acceptedActions,
    "DFM View App manifest.resources[0].acceptedActions",
  );
  if (
    acceptedActions.length !== 1 ||
    acceptedActions[0] !== VIEWER_SESSION_APPLY_ACTION
  ) {
    throw new TypeError(
      "DFM View App manifest must accept viewer.session.apply exactly.",
    );
  }
  const sessionSchemas = denseArray(
    resource.sessionSchemas,
    "DFM View App manifest.resources[0].sessionSchemas",
  );
  if (
    sessionSchemas.length !== 1 ||
    sessionSchemas[0] !== DFM_VIEWER_SESSION_SCHEMA
  ) {
    throw new TypeError(
      "DFM View App manifest must bind the recorded checks session schema exactly.",
    );
  }
  return {
    schemaVersion: VIEW_APP_MANIFEST_SCHEMA,
    app: {
      id: DFM_VIEW_APP_ID,
      title: DFM_VIEW_APP_TITLE,
      version: DFM_VIEW_APP_VERSION,
    },
    resources: [{
      uri: DFM_RESULTS_VIEWER_URI,
      ownership: "whole-view",
      resultSchemas: expectedResultSchemas,
      acceptedActions: [VIEWER_SESSION_APPLY_ACTION],
      sessionSchemas: [DFM_VIEWER_SESSION_SCHEMA],
    }],
  };
}
