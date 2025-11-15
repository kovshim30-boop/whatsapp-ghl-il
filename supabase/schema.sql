-- ========================================
-- WhatsApp-GHL SaaS Platform
-- Database Schema for Supabase
-- ========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- 1. ORGANIZATIONS TABLE (Multi-tenancy)
-- ========================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'starter', 'pro', 'enterprise')),
  max_accounts INTEGER DEFAULT 1,
  max_messages_per_month INTEGER DEFAULT 1000,
  webhook_url TEXT,
  ghl_api_key TEXT,
  ghl_location_id TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 2. WHATSAPP_SESSIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT UNIQUE NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number TEXT,
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connecting', 'connected', 'disconnected', 'error')),
  qr_code TEXT,
  auth_state JSONB, -- Baileys auth state stored as JSON
  last_seen_at TIMESTAMPTZ,
  error_message TEXT,
  reconnect_attempts INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_org ON whatsapp_sessions(organization_id);
CREATE INDEX idx_sessions_status ON whatsapp_sessions(status);
CREATE INDEX idx_sessions_phone ON whatsapp_sessions(phone_number) WHERE phone_number IS NOT NULL;

-- ========================================
-- 3. MESSAGES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  content JSONB NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  is_group_message BOOLEAN DEFAULT FALSE,
  group_jid TEXT,
  synced_to_ghl BOOLEAN DEFAULT FALSE,
  ghl_message_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_org ON messages(organization_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX idx_messages_ghl_sync ON messages(synced_to_ghl) WHERE synced_to_ghl = FALSE;
CREATE INDEX idx_messages_from ON messages(from_number);
CREATE INDEX idx_messages_to ON messages(to_number);

-- ========================================
-- 4. WHATSAPP_GROUPS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  participant_count INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, group_jid)
);

CREATE INDEX idx_groups_session ON whatsapp_groups(session_id);
CREATE INDEX idx_groups_org ON whatsapp_groups(organization_id);

-- ========================================
-- 5. GROUP_PARTICIPANTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS group_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  is_super_admin BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, phone_number)
);

CREATE INDEX idx_participants_group ON group_participants(group_id);

-- ========================================
-- 6. USAGE_TRACKING TABLE (for billing)
-- ========================================
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  messages_sent INTEGER DEFAULT 0,
  messages_received INTEGER DEFAULT 0,
  active_sessions INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, period_start)
);

CREATE INDEX idx_usage_org ON usage_tracking(organization_id);
CREATE INDEX idx_usage_period ON usage_tracking(period_start);

-- ========================================
-- 7. WEBHOOK_LOGS TABLE (reliability tracking)
-- ========================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  webhook_url TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('pending', 'success', 'failed', 'retrying')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_status ON webhook_logs(status) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_webhook_org ON webhook_logs(organization_id);

-- ========================================
-- 8. SYSTEM_LOGS TABLE (monitoring)
-- ========================================
CREATE TABLE IF NOT EXISTS system_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level TEXT CHECK (level IN ('info', 'warn', 'error', 'critical')),
  message TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_logs_level ON system_logs(level) WHERE level IN ('error', 'critical');
CREATE INDEX idx_logs_created ON system_logs(created_at DESC);

-- ========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- Organizations policies
CREATE POLICY "Users can view their own organizations"
  ON organizations FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can update their own organizations"
  ON organizations FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own organizations"
  ON organizations FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- WhatsApp Sessions policies
CREATE POLICY "Users can view their org sessions"
  ON whatsapp_sessions FOR SELECT
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage their org sessions"
  ON whatsapp_sessions FOR ALL
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

-- Messages policies
CREATE POLICY "Users can view their org messages"
  ON messages FOR SELECT
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their org messages"
  ON messages FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

-- Groups policies
CREATE POLICY "Users can view their org groups"
  ON whatsapp_groups FOR SELECT
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage their org groups"
  ON whatsapp_groups FOR ALL
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

-- Usage tracking policies
CREATE POLICY "Users can view their org usage"
  ON usage_tracking FOR SELECT
  USING (
    organization_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );

-- ========================================
-- FUNCTIONS & TRIGGERS
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to relevant tables
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at
  BEFORE UPDATE ON whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usage_updated_at
  BEFORE UPDATE ON usage_tracking
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-create organization for new users
CREATE OR REPLACE FUNCTION create_organization_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO organizations (owner_id, name, subscription_tier)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'My Organization'), 'free');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create org when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_organization_for_new_user();

-- Function to track usage automatically
CREATE OR REPLACE FUNCTION track_message_usage()
RETURNS TRIGGER AS $$
DECLARE
  period_start_date DATE;
BEGIN
  period_start_date := DATE_TRUNC('month', NEW.timestamp)::DATE;

  INSERT INTO usage_tracking (organization_id, period_start, period_end, messages_sent, messages_received)
  VALUES (
    NEW.organization_id,
    period_start_date,
    (period_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
    CASE WHEN NEW.direction = 'outbound' THEN 1 ELSE 0 END,
    CASE WHEN NEW.direction = 'inbound' THEN 1 ELSE 0 END
  )
  ON CONFLICT (organization_id, period_start)
  DO UPDATE SET
    messages_sent = usage_tracking.messages_sent + (CASE WHEN NEW.direction = 'outbound' THEN 1 ELSE 0 END),
    messages_received = usage_tracking.messages_received + (CASE WHEN NEW.direction = 'inbound' THEN 1 ELSE 0 END),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-track message usage
CREATE TRIGGER on_message_created
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION track_message_usage();

-- ========================================
-- VIEWS (for analytics)
-- ========================================

-- View: Active sessions per organization
CREATE OR REPLACE VIEW v_active_sessions AS
SELECT
  o.id AS organization_id,
  o.name AS organization_name,
  COUNT(ws.id) AS active_session_count,
  ARRAY_AGG(ws.phone_number) FILTER (WHERE ws.phone_number IS NOT NULL) AS phone_numbers
FROM organizations o
LEFT JOIN whatsapp_sessions ws ON ws.organization_id = o.id AND ws.status = 'connected'
GROUP BY o.id, o.name;

-- View: Message stats per organization
CREATE OR REPLACE VIEW v_message_stats AS
SELECT
  o.id AS organization_id,
  o.name AS organization_name,
  COUNT(m.id) AS total_messages,
  COUNT(m.id) FILTER (WHERE m.direction = 'inbound') AS inbound_messages,
  COUNT(m.id) FILTER (WHERE m.direction = 'outbound') AS outbound_messages,
  COUNT(m.id) FILTER (WHERE m.synced_to_ghl = false) AS pending_sync
FROM organizations o
LEFT JOIN messages m ON m.organization_id = o.id
GROUP BY o.id, o.name;

-- ========================================
-- SAMPLE DATA (for testing)
-- ========================================

-- You can uncomment this for local testing
-- INSERT INTO auth.users (id, email) VALUES (uuid_generate_v4(), 'test@example.com');

-- ========================================
-- COMPLETION MESSAGE
-- ========================================

DO $$
BEGIN
  RAISE NOTICE '✅ WhatsApp-GHL Database Schema created successfully!';
  RAISE NOTICE '📊 Tables created: organizations, whatsapp_sessions, messages, whatsapp_groups, group_participants, usage_tracking, webhook_logs, system_logs';
  RAISE NOTICE '🔒 RLS policies enabled';
  RAISE NOTICE '⚡ Triggers and functions configured';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Run this in Supabase SQL Editor';
  RAISE NOTICE '2. Verify RLS policies in Authentication > Policies';
  RAISE NOTICE '3. Configure environment variables in your backend';
END $$;
