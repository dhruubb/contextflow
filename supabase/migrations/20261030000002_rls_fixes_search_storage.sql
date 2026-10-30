-- ContextFlow AI — Migration 002
-- Run AFTER 20261030000001_contextflow_schema.sql. Safe to re-run.
--  * Fixes the workspaces SELECT policy (the subquery compared workspace_members.workspace_id to its own id column)
--  * Adds RLS policies for every table (9 tables previously had RLS enabled but no policies)
--  * Role helpers with a pinned search_path (SECURITY DEFINER hardening)
--  * Auto-creates profiles for new auth users, updated_at triggers
--  * Full-text search columns for documents and meetings
--  * Notification de-duplication keys, Telegram link tokens, AI generation status
--  * Private "documents" storage bucket (5 MB, PDF/DOCX/TXT) with workspace-scoped policies

-- ---------------------------------------------------------------------------
-- 1. Column / constraint changes
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_connections ALTER COLUMN destination_id DROP NOT NULL;
ALTER TABLE public.notification_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE public.notification_connections ADD COLUMN IF NOT EXISTS telegram_username TEXT;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON public.notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.ai_generations ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE public.ai_generations ADD COLUMN IF NOT EXISTS target_id UUID;
ALTER TABLE public.ai_generations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE public.ai_generations ADD COLUMN IF NOT EXISTS error_message TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_generations_ws_type ON public.ai_generations(workspace_id, generation_type, created_at DESC);

ALTER TABLE public.handover_items ADD COLUMN IF NOT EXISTS previous_assignee_id UUID REFERENCES public.profiles(id);

ALTER TABLE public.task_events DROP CONSTRAINT IF EXISTS task_events_event_type_check;
ALTER TABLE public.task_events ADD CONSTRAINT task_events_event_type_check CHECK (event_type IN (
  'created', 'status_changed', 'reassigned', 'priority_changed', 'due_date_changed',
  'carried_forward', 'closed', 'comment_added', 'handed_over', 'document_linked', 'updated'
));

ALTER TABLE public.decisions ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;

-- Knowledge links are unique per (document, target)
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_links ON public.knowledge_links(document_id, target_type, target_id);

-- Profiles must belong to auth users (NOT VALID keeps any legacy rows; new rows are enforced)
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_fk
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Full-text search
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS search tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(extracted_text, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_search ON public.knowledge_documents USING GIN(search);

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS search tsvector
  GENERATED ALWAYS AS (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(agenda, '') || ' ' || coalesce(raw_notes, '') || ' ' || coalesce(summary, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_meetings_search ON public.meetings USING GIN(search);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON public.meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON public.meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_action_items_task ON public.meeting_action_items(action_item_id);
CREATE INDEX IF NOT EXISTS idx_decisions_meeting ON public.decisions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_handover_items_task ON public.handover_items(action_item_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_ws ON public.knowledge_documents(workspace_id);

-- ---------------------------------------------------------------------------
-- 2. Helper functions (SECURITY DEFINER with pinned search_path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ws_role(ws UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.workspace_members WHERE workspace_id = ws AND user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = ws_id AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_write(ws UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.ws_role(ws) IN ('admin', 'team_lead', 'member'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_lead(ws UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.ws_role(ws) IN ('admin', 'team_lead'), false)
$$;

CREATE OR REPLACE FUNCTION public.shares_workspace(other UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members a
    JOIN public.workspace_members b ON a.workspace_id = b.workspace_id
    WHERE a.user_id = auth.uid() AND b.user_id = other
  )
$$;

CREATE OR REPLACE FUNCTION public.meeting_ws(mid UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.meetings WHERE id = mid
$$;
CREATE OR REPLACE FUNCTION public.task_ws(tid UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.action_items WHERE id = tid
$$;
CREATE OR REPLACE FUNCTION public.handover_ws(hid UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.handovers WHERE id = hid
$$;
CREATE OR REPLACE FUNCTION public.document_ws(did UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_id FROM public.knowledge_documents WHERE id = did
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['workspaces', 'profiles', 'meetings', 'action_items', 'knowledge_documents', 'notification_preferences'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. RLS policies — drop everything from 001 and recreate consistently
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN (
    'workspaces', 'profiles', 'workspace_members', 'meetings', 'meeting_participants', 'decisions',
    'action_items', 'task_events', 'meeting_action_items', 'handovers', 'handover_items',
    'knowledge_documents', 'knowledge_links', 'ai_generations', 'activity_events',
    'notification_preferences', 'notification_connections', 'notifications')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Workspaces
CREATE POLICY ws_select ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id));
CREATE POLICY ws_update ON public.workspaces FOR UPDATE TO authenticated USING (public.ws_role(id) = 'admin') WITH CHECK (public.ws_role(id) = 'admin');

-- Profiles: yourself + people you share a workspace with
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.shares_workspace(id));
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Workspace members: admins manage
CREATE POLICY wm_select ON public.workspace_members FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY wm_insert ON public.workspace_members FOR INSERT TO authenticated WITH CHECK (public.ws_role(workspace_id) = 'admin');
CREATE POLICY wm_update ON public.workspace_members FOR UPDATE TO authenticated USING (public.ws_role(workspace_id) = 'admin') WITH CHECK (public.ws_role(workspace_id) = 'admin');
CREATE POLICY wm_delete ON public.workspace_members FOR DELETE TO authenticated USING (public.ws_role(workspace_id) = 'admin');

-- Meetings: leads create/delete, any writer can update (members add notes; finer rules in API)
CREATE POLICY meetings_select ON public.meetings FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY meetings_insert ON public.meetings FOR INSERT TO authenticated WITH CHECK (public.is_lead(workspace_id) AND created_by = auth.uid());
CREATE POLICY meetings_update ON public.meetings FOR UPDATE TO authenticated USING (public.can_write(workspace_id)) WITH CHECK (public.can_write(workspace_id));
CREATE POLICY meetings_delete ON public.meetings FOR DELETE TO authenticated USING (public.is_lead(workspace_id));

-- Meeting participants
CREATE POLICY mp_select ON public.meeting_participants FOR SELECT TO authenticated USING (public.is_workspace_member(public.meeting_ws(meeting_id)));
CREATE POLICY mp_insert ON public.meeting_participants FOR INSERT TO authenticated WITH CHECK (public.can_write(public.meeting_ws(meeting_id)));
CREATE POLICY mp_update ON public.meeting_participants FOR UPDATE TO authenticated USING (public.can_write(public.meeting_ws(meeting_id)));
CREATE POLICY mp_delete ON public.meeting_participants FOR DELETE TO authenticated USING (public.is_lead(public.meeting_ws(meeting_id)));

-- Decisions
CREATE POLICY decisions_select ON public.decisions FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY decisions_insert ON public.decisions FOR INSERT TO authenticated WITH CHECK (public.can_write(workspace_id));
CREATE POLICY decisions_update ON public.decisions FOR UPDATE TO authenticated USING (public.can_write(workspace_id));
CREATE POLICY decisions_delete ON public.decisions FOR DELETE TO authenticated USING (public.is_lead(workspace_id));

-- Action items
CREATE POLICY tasks_select ON public.action_items FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY tasks_insert ON public.action_items FOR INSERT TO authenticated WITH CHECK (public.can_write(workspace_id));
CREATE POLICY tasks_update ON public.action_items FOR UPDATE TO authenticated USING (public.can_write(workspace_id)) WITH CHECK (public.can_write(workspace_id));
CREATE POLICY tasks_delete ON public.action_items FOR DELETE TO authenticated USING (public.is_lead(workspace_id));

-- Task events: append-only history (no UPDATE / DELETE policies)
CREATE POLICY te_select ON public.task_events FOR SELECT TO authenticated USING (public.is_workspace_member(public.task_ws(task_id)));
CREATE POLICY te_insert ON public.task_events FOR INSERT TO authenticated WITH CHECK (public.can_write(public.task_ws(task_id)) AND actor_id = auth.uid());

-- Meeting <-> action item links (carry-forward)
CREATE POLICY mai_select ON public.meeting_action_items FOR SELECT TO authenticated USING (public.is_workspace_member(public.meeting_ws(meeting_id)));
CREATE POLICY mai_insert ON public.meeting_action_items FOR INSERT TO authenticated WITH CHECK (public.can_write(public.meeting_ws(meeting_id)));
CREATE POLICY mai_update ON public.meeting_action_items FOR UPDATE TO authenticated USING (public.can_write(public.meeting_ws(meeting_id)));
CREATE POLICY mai_delete ON public.meeting_action_items FOR DELETE TO authenticated USING (public.is_lead(public.meeting_ws(meeting_id)));

-- Handovers: leads, or the outgoing owner for their own work
CREATE POLICY ho_select ON public.handovers FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY ho_insert ON public.handovers FOR INSERT TO authenticated WITH CHECK (
  public.can_write(workspace_id) AND (public.is_lead(workspace_id) OR outgoing_user_id = auth.uid()));
CREATE POLICY ho_update ON public.handovers FOR UPDATE TO authenticated USING (
  public.can_write(workspace_id) AND (public.is_lead(workspace_id) OR outgoing_user_id = auth.uid() OR incoming_user_id = auth.uid()));

CREATE POLICY hi_select ON public.handover_items FOR SELECT TO authenticated USING (public.is_workspace_member(public.handover_ws(handover_id)));
CREATE POLICY hi_insert ON public.handover_items FOR INSERT TO authenticated WITH CHECK (public.can_write(public.handover_ws(handover_id)));
CREATE POLICY hi_update ON public.handover_items FOR UPDATE TO authenticated USING (public.can_write(public.handover_ws(handover_id)));

-- Knowledge base
CREATE POLICY kd_select ON public.knowledge_documents FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY kd_insert ON public.knowledge_documents FOR INSERT TO authenticated WITH CHECK (public.can_write(workspace_id) AND uploaded_by = auth.uid());
CREATE POLICY kd_update ON public.knowledge_documents FOR UPDATE TO authenticated USING (public.is_lead(workspace_id) OR uploaded_by = auth.uid());
CREATE POLICY kd_delete ON public.knowledge_documents FOR DELETE TO authenticated USING (public.is_lead(workspace_id) OR uploaded_by = auth.uid());

CREATE POLICY kl_select ON public.knowledge_links FOR SELECT TO authenticated USING (public.is_workspace_member(public.document_ws(document_id)));
CREATE POLICY kl_insert ON public.knowledge_links FOR INSERT TO authenticated WITH CHECK (public.can_write(public.document_ws(document_id)));
CREATE POLICY kl_delete ON public.knowledge_links FOR DELETE TO authenticated USING (public.can_write(public.document_ws(document_id)));

-- AI generations (audit log of every AI call)
CREATE POLICY ai_select ON public.ai_generations FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY ai_insert ON public.ai_generations FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id) AND created_by = auth.uid());
CREATE POLICY ai_update ON public.ai_generations FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- Activity feed (append-only)
CREATE POLICY act_select ON public.activity_events FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY act_insert ON public.activity_events FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id) AND actor_id = auth.uid());

-- Notifications: private to the recipient. Rows are written server-side (service role) by the notification service.
CREATE POLICY notif_select ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY nc_all ON public.notification_connections FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY np_all ON public.notification_preferences FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. Storage: private documents bucket, path = <workspace_id>/<file>
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 5242880, ARRAY[
  'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types, public = false;

CREATE OR REPLACE FUNCTION public.storage_ws(object_name TEXT) RETURNS UUID
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN split_part(object_name, '/', 1)::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

DROP POLICY IF EXISTS cf_docs_select ON storage.objects;
DROP POLICY IF EXISTS cf_docs_insert ON storage.objects;
DROP POLICY IF EXISTS cf_docs_delete ON storage.objects;
CREATE POLICY cf_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND public.is_workspace_member(public.storage_ws(name)));
CREATE POLICY cf_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND public.can_write(public.storage_ws(name)));
CREATE POLICY cf_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND public.is_lead(public.storage_ws(name)));

-- ---------------------------------------------------------------------------
-- 6. Duplicate protection for AI-approved items, decision links
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_action_items_meeting_title
  ON public.action_items(source_meeting_id, lower(title)) WHERE source_meeting_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_decisions_meeting_title
  ON public.decisions(meeting_id, lower(title)) WHERE meeting_id IS NOT NULL;

ALTER TABLE public.knowledge_links DROP CONSTRAINT IF EXISTS knowledge_links_target_type_check;
ALTER TABLE public.knowledge_links ADD CONSTRAINT knowledge_links_target_type_check
  CHECK (target_type IN ('meeting', 'action_item', 'handover', 'decision'));

-- ---------------------------------------------------------------------------
-- 7. Atomic handover (SECURITY INVOKER: runs under the caller's RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.perform_handover(
  p_workspace UUID, p_outgoing UUID, p_incoming UUID, p_task_ids UUID[], p_ai_summary TEXT, p_notes TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_handover UUID;
  v_task RECORD;
  v_count INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.is_lead(p_workspace) OR (public.can_write(p_workspace) AND p_outgoing = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed to hand over these tasks';
  END IF;
  IF p_outgoing = p_incoming THEN RAISE EXCEPTION 'outgoing and incoming users must differ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace AND user_id = p_incoming AND role <> 'viewer') THEN
    RAISE EXCEPTION 'incoming user must be a non-viewer member of this workspace';
  END IF;

  INSERT INTO public.handovers (workspace_id, outgoing_user_id, incoming_user_id, status, ai_summary, notes)
  VALUES (p_workspace, p_outgoing, p_incoming, 'pending', p_ai_summary, p_notes)
  RETURNING id INTO v_handover;

  FOR v_task IN
    SELECT id, assignee_id FROM public.action_items
    WHERE id = ANY(p_task_ids) AND workspace_id = p_workspace AND assignee_id = p_outgoing AND status <> 'done'
    FOR UPDATE
  LOOP
    INSERT INTO public.handover_items (handover_id, action_item_id, transferred, previous_assignee_id)
    VALUES (v_handover, v_task.id, true, v_task.assignee_id);
    UPDATE public.action_items SET assignee_id = p_incoming WHERE id = v_task.id;
    INSERT INTO public.task_events (task_id, event_type, actor_id, previous_value, new_value, notes)
    VALUES (v_task.id, 'handed_over', auth.uid(), p_outgoing::text, p_incoming::text, 'Handover ' || v_handover::text);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'no eligible unfinished tasks owned by the outgoing user'; END IF;

  UPDATE public.handovers SET status = 'completed', completed_at = now() WHERE id = v_handover;
  RETURN v_handover;
END $$;
