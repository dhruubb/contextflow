-- ContextFlow AI — Migration 004: unread notifications + performance (health score) history
-- Run AFTER migrations 001–003. Safe to re-run.

-- Unread notification badge
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, workspace_id) WHERE read_at IS NULL;
DROP POLICY IF EXISTS notif_update ON public.notifications;
CREATE POLICY notif_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Performance trend: a snapshot is stored whenever the workspace's health score changes
CREATE TABLE IF NOT EXISTS public.health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_ws ON public.health_snapshots(workspace_id, created_at DESC);

ALTER TABLE public.health_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hs_select ON public.health_snapshots;
DROP POLICY IF EXISTS hs_insert ON public.health_snapshots;
CREATE POLICY hs_select ON public.health_snapshots FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY hs_insert ON public.health_snapshots FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
