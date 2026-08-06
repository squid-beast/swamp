// The synthetic payload used by the webhook "test" button and the sample-body
// preview. Same shape the trigger enqueues (see the platform migration), so a
// receiver built against a sample keeps working against the real thing.
//
// Pure and free of `server-only`, like webhook-format.ts, so it unit-tests.

export function samplePayload(
  baseId: string,
  tableId: string | null
): Record<string, unknown> {
  return {
    event: "record.created",
    test: true, // receivers can tell a rehearsal from the real thing
    baseId,
    tableId,
    recordId: "00000000-0000-0000-0000-000000000000",
    record: {
      id: "00000000-0000-0000-0000-000000000000",
      fields: {
        fld_example: "A sample value",
        fld_number: 42,
      },
    },
    changes: { fld_example: { from: null, to: "A sample value" } },
    actor: null,
    timestamp: new Date().toISOString(),
  };
}
