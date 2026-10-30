# OpenCode Agent Execution Instructions — ContextFlow AI

You are operating as an autonomous coding agent **inside the current repository**, with permission to inspect, create and modify project files and run appropriate local commands. The full product specification follows. Treat it as the target scope, while following these execution instructions to maximize working output under a short time budget and limited/free-model context.

## How to operate

1. **Inspect first:** Check `pwd`, current files, `package.json`, git status, and existing conventions. If this is an existing project, preserve working code and uncommitted user changes. Never overwrite secrets or destructive-reset data.
2. **Implement, don't just advise:** Create actual files, install dependencies when possible, run commands, inspect errors and fix them. Do not stop after writing a plan or ask for permission for ordinary non-destructive work.
3. **Keep the first plan short:** State the next 3–5 concrete steps, then execute them. Do not spend the session generating long explanations.
4. **Use a vertical slice:** Establish app/auth/schema, then make a real meeting → AI recap → human approval → task persistence flow work before adding peripheral features. Continue in the original phase order as dependencies permit.
5. **Checkpoint frequently:** Maintain `PROGRESS.md` with completed items, files changed, verification results, blockers, exact next commands and next task. Update it after each phase or before stopping. Also maintain `AGENTS.md` with concise repo conventions and setup instructions for a future coding agent. Do not put secrets in either file.
6. **Conserve tokens:** Read relevant files selectively; avoid reprinting large files, repeated architecture discussion, or unnecessary rewrites. Prefer focused edits and small, testable changes.
7. **Validate each slice:** Run available typecheck, lint, tests and build commands. Fix errors caused by your edits. If external credentials are missing, verify everything locally that can be verified and record exactly what remains untested.
8. **Be truthful about blockers:** Do not fabricate Supabase connections, Groq outputs, Telegram delivery, accounts, environment variables or successful deployments. Create `.env.example` with placeholders and clearly state which real credentials and setup steps are needed. Never echo actual secrets.
9. **Protect data and access:** Implement server-side authorization, workspace isolation and RLS; use service-role credentials only server-side. Never run destructive database operations against an unknown or production environment.
10. **Finish usefully:** When approaching the time/context limit, leave a bootable repository if possible, update `PROGRESS.md`, and give a concise summary of what works, what is blocked, what was verified, and the single best next prompt.

## Scope and success rules

The full specification below defines the target, **not a license to claim every feature is finished**. Mandatory features should be implemented as real working functionality in priority order. Optional WhatsApp comes last. Do not add decorative fake data to production dashboards. Seed data is allowed only through explicit demo setup. Prefer a smaller fully working slice over many broken pages. When something cannot be completed, mark it clearly in `PROGRESS.md` and the README.

---

# Build ContextFlow AI — Full-Stack AI Knowledge & Task Management Platform

You are a senior full-stack engineer. Build a **complete, production-style, deployable SaaS application** called **ContextFlow AI**.

**Time budget: approximately 2 hours.** Prioritize a verified end-to-end vertical slice, then expand in the specified phase order. Never claim an integration works unless it has been tested. Do not create mock-only features, hardcoded dashboards, or non-functional buttons.

## 1. Tech Stack

- **Frontend + Backend:** Next.js 15+ App Router, TypeScript
- **UI:** Tailwind CSS, shadcn/ui, Lucide icons
- **Database:** Supabase PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** Groq API (use an available supported model through the Groq SDK)
- **Document Storage:** Supabase Storage
- **Validation:** Zod
- **Logging:** Pino, structured JSON logs with file output locally
- **Notifications:** Telegram Bot API (primary), WhatsApp Cloud API (optional)
- **Deployment:** Vercel + Supabase

Use environment variables for all credentials. Never expose secrets in frontend code.

## 2. Product Objective

Build a platform that prevents knowledge and task context from getting lost between meetings, employees, and work handovers.

The platform must:

1. Capture meetings, agendas, participants, notes, decisions and action items.
2. Use Groq AI to extract structured summaries, decisions, tasks, owners and deadlines from raw notes.
3. Track tasks through their lifecycle, including assignment, reassignment, status, deadlines and outcomes.
4. Carry unresolved tasks into subsequent meetings while preserving their complete history.
5. Generate personalized AI catch-up briefs for absent participants and employees receiving handovers.
6. Maintain a searchable knowledge base of documents and past meetings.
7. Link relevant knowledge to tasks and meetings.
8. Notify employees of important task and meeting events.
9. Provide a special **Context Continuity Engine** to identify risks and generate next-meeting recommendations.

## 3. Users and Role-Based Access Control

Implement four roles:

- **Admin:** Full workspace access, user management, all meetings/tasks.
- **Team Lead:** Create meetings, manage tasks, reassign work, initiate handovers, view team analytics.
- **Member:** Participate in meetings, create notes, manage assigned tasks, upload documents, generate AI briefs.
- **Viewer:** Read authorized workspace information without modifying it.

Enforce permissions on backend routes and with Supabase Row Level Security.

Support multiple workspaces with isolated data.

## 4. Pages and Features

### Dashboard
- Summary cards: open tasks, overdue tasks, upcoming meetings, completed tasks.
- Recent meetings and activity.
- AI-generated insights and at-risk tasks.
- Personalized "My Tasks" and missed-meeting indicators.

### Meetings
- Create, edit, list and view meetings.
- Agenda, participants, attendance, raw notes, status and date.
- Generate AI recap using Groq.
- Extract decisions and suggested tasks.
- Allow human review before saving AI results.
- Carry forward unresolved tasks into future meetings.
- Show meeting history and linked documents.

### Action Items
- Create, assign, edit, filter and close tasks.
- Status: To Do, In Progress, Blocked, Done.
- Priority, deadline, owner and source meeting.
- Reassignment and status history.
- Require outcome notes on closure.
- Preserve original task IDs when carrying tasks forward.

### AI Catch-Up
- Generate personalized summaries for users who missed meetings.
- Highlight important decisions, assigned tasks and changes.
- Include relevant documents and references to source meetings.
- Generate handover briefs for incoming task owners.

### Work Handovers
- Select outgoing and incoming employees.
- Display unfinished tasks.
- Generate AI handover context.
- Confirm transfer and reassign selected tasks.
- Preserve complete ownership history.

### Knowledge Base and Document Upload
- Upload PDF, TXT and DOCX documents.
- Store files in Supabase Storage.
- Extract text server-side and persist searchable content.
- Search documents and previous meetings.
- Use retrieved context with Groq to suggest relevant links to tasks and meetings.
- Show document previews or download links.
- Enforce file type, size and access restrictions.

### Notifications — Extra Feature
Implement **Telegram Bot notifications** as the primary working integration.

Trigger notifications when:
- A task is assigned or reassigned.
- A deadline approaches.
- A task becomes overdue.
- A meeting is scheduled.
- A handover is completed.

Users should connect Telegram using a secure account-linking flow, not by entering someone else's chat ID.

Create a notification preferences page, a notification history table, and delivery status tracking.

Use Telegram Bot API with environment variables. For deadline reminders, use a scheduled cron endpoint with authorization and idempotency protection.

Structure notification providers so WhatsApp Cloud API can be added using the same interface. Implement WhatsApp only if time permits; account for opt-in and approved message templates.

### Special Feature — Context Continuity Engine
Implement an intelligent meeting continuity system:

- Detect overdue tasks, blockers, missing owners and incomplete handovers.
- Generate a Context Health Score using explainable deterministic criteria.
- Use Groq to explain risks and recommend next actions.
- Automatically suggest unresolved tasks for the next meeting.
- Show a timeline connecting original meetings, decisions, reassignment events and final outcomes.

This is the primary differentiating feature.

## 5. Database

Create SQL migrations and Supabase RLS policies for:

- workspaces
- profiles
- workspace_members
- meetings
- meeting_participants
- decisions
- action_items
- task_events
- meeting_action_items
- handovers
- handover_items
- knowledge_documents
- knowledge_links
- ai_generations
- activity_events
- notification_preferences
- notification_connections
- notifications

Use UUID primary keys, foreign keys, timestamps, proper indexes and workspace isolation.

## 6. Groq AI Integration

Create reusable server-side AI services for:

1. Meeting summary and structured extraction.
2. Personalized catch-up briefs.
3. Handover context generation.
4. Continuity risk analysis.
5. Knowledge document relevance suggestions.

Use structured JSON output validated with Zod.

Do not invent participants, task owners, deadlines or decisions. Resolve owners against actual workspace users and return null when uncertain.

Handle API errors, timeouts, malformed responses and rate limits gracefully. Preserve user data when AI fails.

## 7. Logging and Engineering

Implement structured logging with Pino:

- Request/correlation ID per API request.
- Log levels: debug, info, warn, error.
- Meeting creation and updates.
- Task assignment, reassignment and closure.
- AI request latency, success and failure.
- Notification delivery attempts and outcomes.
- Errors with useful context.

Write logs to `logs/app.log` locally. Document that Vercel needs an external persistent log sink rather than relying on its ephemeral filesystem.

Add server-side validation, loading states, error boundaries, confirmation dialogs, empty states and success/error toasts.

## 8. UI/UX

Build a polished, modern B2B SaaS interface.

Design direction:
- Inspired by Linear and Notion.
- Professional, minimal, clean.
- Sidebar navigation and top header.
- Light and dark modes.
- Subtle teal/indigo accents.
- Responsive layouts.
- Consistent cards, tables, badges, dialogs and forms.
- Real database-driven statistics.
- Functional navigation and controls.

Navigation:
Dashboard | Meetings | Action Items | Handovers | Knowledge Base | AI Briefs | Notifications | Activity | Settings

## 9. Demo Data

Create a realistic seeded workspace named "NovaTech" with five demo users:

- Aisha — Admin
- Rahul — Team Lead
- Priya — Member
- Arjun — Member
- Neha — Viewer

Seed meetings, decisions, documents, action items, overdue tasks, one missed meeting, a handover and a task carried between meetings.

Provide a safe setup process for authenticated demo accounts.

## 10. Required End-to-End Demo

The following workflow must work:

1. Rahul logs in and creates a meeting.
2. Rahul adds participants and raw notes.
3. Groq generates a structured meeting recap.
4. Rahul reviews and confirms suggested tasks.
5. Tasks are persisted with owners and deadlines.
6. Arjun receives a Telegram notification for his assigned task.
7. Priya, who missed the meeting, generates an AI catch-up brief.
8. Arjun hands over an unfinished task to Priya.
9. The system preserves reassignment history.
10. Rahul carries the task into the next meeting.
11. The Context Continuity Engine highlights risks.
12. Priya closes the task with an outcome.
13. The complete history remains accessible.

## 11. Development Order

Build incrementally in this exact priority, completing and checking each working slice before expanding:

**Phase 1:** Next.js setup, Supabase Auth, schema, RLS and application shell.

**Phase 2:** Working meeting and task CRUD, assignment, lifecycle and carry-forward.

**Phase 3:** Groq AI extraction, human approval, catch-up briefs and knowledge linking.

**Phase 4:** Handovers and Context Continuity Engine.

**Phase 5:** Document upload, extraction and searchable knowledge base.

**Phase 6:** Telegram notifications, notification preferences and delivery history.

**Phase 7:** UI polish, logging verification, demo data, testing, README and deployment.

Do not sacrifice mandatory assessment functionality for optional WhatsApp integration.

## 12. Deliverables

Produce:
- Complete working source code.
- SQL migrations and RLS policies.
- `.env.example`.
- Demo seed scripts.
- README with setup, architecture, AI configuration, data sources, logging, special feature, assumptions and known limitations.
- Vercel deployment instructions.
- End-to-end verification checklist.

## 13. Implementation Rules

- Use real Supabase persistence, not localStorage as the database.
- Use actual Groq API calls, not simulated AI responses.
- Never expose service-role keys to the browser.
- Never trust frontend role checks alone.
- Do not automatically commit unverified AI-generated tasks.
- Avoid duplicate tasks and duplicate notifications.
- Keep the architecture modular and easy to explain.
- Do not leave broken imports, placeholder API calls or non-functional buttons.
- Prefer working functionality over excessive abstractions.
- Clearly identify any features that are not fully implemented.

**Start immediately by inspecting the repository, then create the project structure, database schema, environment configuration and authentication. Implement each phase in working code. Do not stop at an architecture overview.**

---

## OpenCode-specific final verification and handoff

Before ending, attempt the commands actually defined by this repo (for example `npm run lint`, `npx tsc --noEmit`, `npm run build`); report the real results. Check for broken imports, insecure secrets, unauthorized writes, unimplemented buttons and missing env variables. Do not claim external API success without valid credentials and an actual request. Update `PROGRESS.md` with a phase-by-phase status table: done / partial / blocked / not started, plus the next three actionable steps. Include a short handoff prompt that another OpenCode or Claude Code session can use to continue directly from the repository.
