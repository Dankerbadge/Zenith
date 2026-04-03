-- ZENITH SOCIAL FEATURES - DATABASE SCHEMA
-- Generated from docs/supabase_schema.sql for deterministic CLI deployments.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- ============================================
-- USERS TABLE (extends auth.users)
-- ============================================
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  
  -- Stats
  total_xp INTEGER DEFAULT 0,
  current_rank TEXT DEFAULT 'Iron IV',
  winning_days INTEGER DEFAULT 0,
  total_workouts INTEGER DEFAULT 0,
  
  -- Social
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  
  -- Premium
  is_premium BOOLEAN DEFAULT FALSE,
  premium_until TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- FOLLOWS TABLE
-- ============================================
CREATE TABLE public.follows (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  follower_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);
-- ============================================
-- POSTS TABLE (Workout shares, achievements, etc)
-- ============================================
CREATE TABLE public.posts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Content
  content TEXT NOT NULL,
  post_type TEXT NOT NULL, -- 'workout', 'run', 'achievement', 'rank_up', 'text'
  
  -- Associated data (JSON for flexibility)
  data JSONB, -- workout stats, achievement details, etc
  
  -- Media
  image_url TEXT,
  
  -- Engagement
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  
  -- Visibility
  is_public BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- LIKES TABLE
-- ============================================
CREATE TABLE public.likes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, post_id)
);
-- ============================================
-- COMMENTS TABLE
-- ============================================
CREATE TABLE public.comments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  
  -- Engagement
  likes_count INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- TEAMS TABLE
-- ============================================
CREATE TABLE public.teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  
  -- Team type
  team_type TEXT NOT NULL, -- 'triathlon', 'running', 'cycling', 'gym', 'general'
  
  -- Settings
  is_public BOOLEAN DEFAULT FALSE,
  invite_code TEXT,
  
  -- Owner/Coach
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Stats
  members_count INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- TEAM MEMBERS TABLE
-- ============================================
CREATE TABLE public.team_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Role: 'coach', 'athlete', 'admin'
  role TEXT DEFAULT 'athlete',
  
  -- Permissions + privacy
  coach_access_mode TEXT DEFAULT 'training_only', -- 'training_only' | 'all_data'
  
  -- Stats
  xp_contributed INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(team_id, user_id)
);
-- ============================================
-- TEAM CHALLENGES TABLE
-- ============================================
CREATE TABLE public.team_challenges (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  
  title TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT NOT NULL, -- 'weekly_mileage', 'streak', 'xp', etc
  
  -- Target and tracking
  target_value INTEGER NOT NULL,
  current_value INTEGER DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'active', -- 'active', 'completed', 'expired'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- LEADERBOARDS TABLE (cached rankings)
-- ============================================
CREATE TABLE public.leaderboards (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  leaderboard_type TEXT NOT NULL, -- 'weekly_xp', 'monthly_wins', etc
  scope TEXT NOT NULL, -- 'global', 'team', 'friends'
  scope_id UUID, -- team_id if scope='team'
  
  -- Rankings data (JSON array of {user_id, rank, value})
  rankings JSONB NOT NULL,
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(leaderboard_type, scope, scope_id)
);
-- ============================================
-- ACTIVITY FEED TABLE (cached relevant activities)
-- ============================================
CREATE TABLE public.activity_feed (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  activity_type TEXT NOT NULL, -- 'workout', 'follow', 'achievement', etc
  data JSONB NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_follows_follower ON public.follows(follower_id);
CREATE INDEX idx_follows_following ON public.follows(following_id);
CREATE INDEX idx_posts_user ON public.posts(user_id);
CREATE INDEX idx_posts_created ON public.posts(created_at DESC);
CREATE INDEX idx_likes_post ON public.likes(post_id);
CREATE INDEX idx_comments_post ON public.comments(post_id);
CREATE INDEX idx_team_members_team ON public.team_members(team_id);
CREATE INDEX idx_team_members_user ON public.team_members(user_id);
CREATE INDEX idx_activity_feed_user ON public.activity_feed(user_id);
CREATE INDEX idx_activity_feed_created ON public.activity_feed(created_at DESC);
-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_feed ENABLE ROW LEVEL SECURITY;
-- PROFILES POLICIES
CREATE POLICY "Public profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);
-- FOLLOWS POLICIES
CREATE POLICY "Follows are viewable by everyone"
  ON public.follows FOR SELECT
  USING (true);
CREATE POLICY "Users can follow others"
  ON public.follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users can unfollow"
  ON public.follows FOR DELETE
  USING (auth.uid() = follower_id);
-- POSTS POLICIES
CREATE POLICY "Public posts are viewable"
  ON public.posts FOR SELECT
  USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY "Users can create posts"
  ON public.posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts"
  ON public.posts FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts"
  ON public.posts FOR DELETE
  USING (auth.uid() = user_id);
-- LIKES POLICIES
CREATE POLICY "Likes are viewable"
  ON public.likes FOR SELECT
  USING (true);
CREATE POLICY "Users can like posts"
  ON public.likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unlike posts"
  ON public.likes FOR DELETE
  USING (auth.uid() = user_id);
-- COMMENTS POLICIES
CREATE POLICY "Comments are viewable"
  ON public.comments FOR SELECT
  USING (true);
CREATE POLICY "Users can create comments"
  ON public.comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own comments"
  ON public.comments FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own comments"
  ON public.comments FOR DELETE
  USING (auth.uid() = user_id);
-- TEAMS POLICIES
CREATE POLICY "Public teams viewable"
  ON public.teams FOR SELECT
  USING (is_public = true OR auth.uid() = owner_id);
CREATE POLICY "Users can create teams"
  ON public.teams FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can update teams"
  ON public.teams FOR UPDATE
  USING (auth.uid() = owner_id);
CREATE POLICY "Owners can delete teams"
  ON public.teams FOR DELETE
  USING (auth.uid() = owner_id);
-- TEAM MEMBERS POLICIES
CREATE POLICY "Team members viewable"
  ON public.team_members FOR SELECT
  USING (true);
CREATE POLICY "Users can join teams"
  ON public.team_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can leave teams"
  ON public.team_members FOR DELETE
  USING (auth.uid() = user_id);
-- ACTIVITY FEED POLICIES
CREATE POLICY "Users see own activity"
  ON public.activity_feed FOR SELECT
  USING (auth.uid() = user_id);
