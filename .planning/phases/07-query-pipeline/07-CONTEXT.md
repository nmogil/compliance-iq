# Phase 7: Query Pipeline - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

RAG system that converts natural language compliance questions into cited regulatory answers. Includes address-to-jurisdiction resolution, Pinecone retrieval, Claude-based answer generation with citations, and permit/license identification. Streaming responses and feedback are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Response Structure
- Separate sections for each jurisdiction layer (Federal, State, County, Municipal)
- Each section contains relevant regulations for that jurisdiction
- Clear delineation helps lawyers understand which level imposes which requirements

### Citation Format
- Claude's discretion on citation formatting
- Should be appropriate for legal compliance context
- Bluebook format available from existing citation generators

### Permit/License Presentation
- Dedicated "Required Permits" section at end of response
- Each permit listed with: permit name, issuing agency, link to agency/application
- Not inline — separate section for easy scanning

### Confidence Indication
- Explicit confidence score or label (High/Medium/Low)
- Based on source coverage for the jurisdiction + topic
- Helps lawyers know when to dig deeper themselves

### Claude's Discretion
- Exact citation formatting approach (inline brackets, full Bluebook, etc.)
- Answer tone and structure within jurisdiction sections
- How to synthesize conflicting or overlapping regulations

</decisions>

<specifics>
## Specific Ideas

- Jurisdiction sections should make it clear which level of government imposes each requirement
- Permits section should be actionable — lawyers can hand it to clients

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-query-pipeline*
*Context gathered: 2026-02-03*
