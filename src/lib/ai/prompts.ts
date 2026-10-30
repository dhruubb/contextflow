import { z } from 'zod';

const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().trim() : v);
const str = z.string().trim();
const optStr = z.string().trim().nullish().transform((v) => v || null);
const strList = z.array(z.string().trim()).catch([]);

export const PriorityZ = z.preprocess(lower, z.enum(['low', 'medium', 'high', 'urgent'])).catch('medium');
const SeverityZ = z.preprocess(lower, z.enum(['low', 'medium', 'high'])).catch('medium');

// ---------------------------------------------------------------------------
// 1. Meeting extraction
// ---------------------------------------------------------------------------
export const MeetingExtractionZ = z.object({
  summary: str.min(1),
  decisions: z
    .array(z.object({ title: str.min(1), description: optStr, rationale: optStr }))
    .catch([]),
  action_items: z
    .array(
      z.object({
        title: str.min(1),
        description: optStr,
        owner_id: optStr,
        owner_name: optStr,
        deadline: optStr,
        priority: PriorityZ,
        evidence: optStr,
      }),
    )
    .catch([]),
  open_questions: strList,
});
export type MeetingExtraction = z.infer<typeof MeetingExtractionZ>;

export function meetingExtractionPrompt(input: {
  title: string;
  date: string;
  agenda: string | null;
  notes: string;
  members: { id: string; name: string; role: string }[];
  participants: { name: string; attended: boolean }[];
}) {
  return {
    system: `You are a meticulous meeting analyst for a B2B team workspace.
Extract a concise summary, explicit decisions, and concrete action items from raw meeting notes.
Rules:
- Only include decisions and action items that are clearly stated or strongly implied in the notes.
- owner_id MUST be one of the provided member ids, or null if the notes do not clearly name an owner. Never guess.
- owner_name: the name as written in the notes (or null).
- deadline: ISO date YYYY-MM-DD, resolving relative phrases ("Friday", "next week") against the meeting date. null if no deadline is stated.
- priority: low | medium | high | urgent, based on language in the notes (default medium).
- evidence: a short quote from the notes supporting the action item.
JSON shape: {"summary": string, "decisions": [{"title","description","rationale"}], "action_items": [{"title","description","owner_id","owner_name","deadline","priority","evidence"}], "open_questions": [string]}`,
    user: JSON.stringify({
      meeting: { title: input.title, date: input.date, agenda: input.agenda },
      workspace_members: input.members,
      participants: input.participants,
      raw_notes: input.notes,
    }),
  };
}

// ---------------------------------------------------------------------------
// 2. Catch-up brief
// ---------------------------------------------------------------------------
export const CatchUpZ = z.object({
  headline: str.min(1),
  summary: str.min(1),
  key_decisions: z.array(z.object({ title: str, why_it_matters: optStr })).catch([]),
  your_action_items: z.array(z.object({ task_id: optStr, title: str, deadline: optStr, note: optStr })).catch([]),
  changes: strList,
  suggested_next_steps: strList,
  references: z
    .array(z.object({ type: z.preprocess(lower, z.enum(['meeting', 'document', 'task'])).catch('meeting'), id: str, title: str }))
    .catch([]),
});
export type CatchUpBrief = z.infer<typeof CatchUpZ>;

export function catchUpPrompt(input: unknown) {
  return {
    system: `You write personalized catch-up briefs for an employee who missed a meeting.
Write in simple, plain English: short sentences, no jargon. Prioritise what this person must know and do.
- headline: max 10 words, e.g. "What you missed in the Meridian onboarding retro".
- summary: 2-3 short sentences.
- changes: max 4 items, each one short sentence that names the task by its TITLE (never print ids or UUIDs).
- suggested_next_steps: max 4 items; each is ONE concrete action the reader can do, written as a short imperative task title (max 10 words, no dates), e.g. "Request uptime export from monitoring vendor".
- Write dates like "31 Oct", never "2026-10-31".
Only put ids in task_id / references fields, and only ids that appear in the input.
JSON shape: {"headline": string, "summary": string, "key_decisions": [{"title","why_it_matters"}], "your_action_items": [{"task_id","title","deadline","note"}], "changes": [string], "suggested_next_steps": [string], "references": [{"type":"meeting"|"document"|"task","id","title"}]}`,
    user: JSON.stringify(input),
  };
}

// ---------------------------------------------------------------------------
// 3. Handover context
// ---------------------------------------------------------------------------
export const HandoverZ = z.object({
  overview: str.min(1),
  tasks: z
    .array(z.object({ task_id: str, context: str, current_state: optStr, next_steps: strList, risks: strList }))
    .catch([]),
  open_questions: strList,
});
export type HandoverContext = z.infer<typeof HandoverZ>;

export function handoverPrompt(input: unknown) {
  return {
    system: `You prepare work handover briefs so the incoming owner can continue without losing context.
For each task explain where it came from (meeting, decision), its current state, concrete next steps and risks.
Use only facts in the input. Use the exact task_id values provided.
JSON shape: {"overview": string, "tasks": [{"task_id","context","current_state","next_steps":[string],"risks":[string]}], "open_questions": [string]}`,
    user: JSON.stringify(input),
  };
}

// ---------------------------------------------------------------------------
// 4. Continuity risk analysis
// ---------------------------------------------------------------------------
export const ContinuityZ = z.object({
  narrative: str.min(1),
  risks: z
    .array(z.object({ task_id: optStr, severity: SeverityZ, title: str, explanation: str, recommendation: str }))
    .catch([]),
  agenda_suggestions: z.array(z.object({ task_id: str, reason: str })).catch([]),
});
export type ContinuityAnalysis = z.infer<typeof ContinuityZ>;

export function continuityPrompt(input: unknown) {
  return {
    system: `You are a delivery-risk analyst. You receive a deterministic Context Health Score with its components and the list of at-risk tasks.
Explain the main risks in plain language, recommend specific follow-up actions (who should do what), and suggest which unresolved tasks belong on the next meeting's agenda.
Do not change the score. Only use task ids from the input.
JSON shape: {"narrative": string, "risks": [{"task_id","severity":"low"|"medium"|"high","title","explanation","recommendation"}], "agenda_suggestions": [{"task_id","reason"}]}`,
    user: JSON.stringify(input),
  };
}

// ---------------------------------------------------------------------------
// 5. Knowledge linking
// ---------------------------------------------------------------------------
export const DocLinksZ = z.object({
  links: z
    .array(
      z.object({
        target_type: z.preprocess(lower, z.enum(['action_item', 'meeting', 'decision'])),
        target_id: str,
        relevance: z.coerce.number().min(0).max(1).catch(0.5),
        reason: str,
      }),
    )
    .catch([]),
});
export type DocLinks = z.infer<typeof DocLinksZ>;

export function docLinksPrompt(input: unknown) {
  return {
    system: `You link knowledge-base documents to the work they support.
Given a document excerpt and candidate tasks, meetings and decisions, return only genuinely relevant links (max 6) with a relevance between 0 and 1 and a one-sentence reason.
Only use target ids from the candidates. Return an empty list if nothing is relevant.
JSON shape: {"links": [{"target_type":"action_item"|"meeting"|"decision","target_id","relevance","reason"}]}`,
    user: JSON.stringify(input),
  };
}

// ---------------------------------------------------------------------------
// 6. Knowledge-base answers (RAG)
// ---------------------------------------------------------------------------
export const KbAnswerZ = z.object({
  answer: str.min(1),
  insufficient: z.boolean().catch(false),
  citations: z.array(z.string().trim()).catch([]),
});
export type KbAnswer = z.infer<typeof KbAnswerZ>;

export function kbAnswerPrompt(question: string, sources: { id: string; document: string; location: string; text: string }[]) {
  return {
    system: `You answer questions for a company team using ONLY the numbered sources provided (excerpts from their knowledge base).
Rules:
- Use only facts stated in the sources. Do not use outside knowledge, and never invent numbers, names, dates or policies.
- Cite every factual sentence inline with its source id in square brackets, e.g. "Use port 6543 [S2]." Cite only ids that exist.
- If the sources do not contain enough information to answer, set "insufficient": true and say clearly what is missing (you may still state any partial facts that are supported, with citations).
- Be concise: a direct answer first, then short supporting detail or bullet points if useful.
JSON shape: {"answer": string (markdown allowed), "insufficient": boolean, "citations": ["S1", ...]}`,
    user: JSON.stringify({ question, sources }),
  };
}

export const QueryExpansionZ = z.object({
  keywords: z.array(z.string().trim().min(2)).catch([]),
  rewritten: optStr,
});

export function queryExpansionPrompt(question: string) {
  return {
    system: `You turn a user's question into search terms for a full-text search over company documents (runbooks, policies, specs, meeting notes).
Return 6-15 short keywords or 2-3 word phrases: the key nouns from the question, likely synonyms, abbreviations and the technical terms a document would use.
Also return the question rewritten as a clear, standalone search query.
JSON shape: {"keywords": [string], "rewritten": string}`,
    user: question,
  };
}

export const RerankZ = z.object({
  relevant: z.array(z.object({ id: z.string().trim(), score: z.coerce.number().min(0).max(10).catch(5) })).catch([]),
});

export function rerankPrompt(question: string, candidates: { id: string; document: string; text: string }[]) {
  return {
    system: `You are a retrieval re-ranker. Score how useful each passage is for answering the question (0 = irrelevant, 10 = directly answers it).
Return only passages scoring 3 or more, best first, using the exact ids given.
JSON shape: {"relevant": [{"id": string, "score": number}]}`,
    user: JSON.stringify({ question, passages: candidates }),
  };
}
