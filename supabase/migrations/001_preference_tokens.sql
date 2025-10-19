-- Preference Tokens Table Schema
-- This table stores temporary tokens for user preference actions
-- Tokens are used to confirm sensitive actions via email

CREATE TABLE preference_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL CHECK (action IN ('pause', 'resume', 'disconnect', 'data_request')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE
);

-- Index for fast token lookups
CREATE INDEX idx_preference_tokens_token ON preference_tokens(token);
CREATE INDEX idx_preference_tokens_user_id ON preference_tokens(user_id);
CREATE INDEX idx_preference_tokens_expires_at ON preference_tokens(expires_at);

-- Function to clean up expired tokens (can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM preference_tokens 
  WHERE expires_at < NOW() OR (used = TRUE AND used_at < NOW() - INTERVAL '7 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
